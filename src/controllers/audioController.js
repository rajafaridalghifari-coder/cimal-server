const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Groq = require('groq-sdk');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts'); 

// TAMBAHKAN BARIS INI UNTUK MEMPERBAIKI ERROR EDGE TTS DI RAILWAY
global.crypto = require('crypto');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ========================================================
// FUNGSI PERAKIT WAV (KHUSUS HARDWARE ESP32)
// ========================================================
function rakitWavSempurna(filePath) {
    const rawData = fs.readFileSync(filePath);
    const dataLength = rawData.length;
    
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(dataLength + 36, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); 
    header.writeUInt16LE(1, 20); 
    header.writeUInt16LE(1, 22); 
    header.writeUInt32LE(16000, 24); 
    header.writeUInt32LE(32000, 28); 
    header.writeUInt16LE(2, 32); 
    header.writeUInt16LE(16, 34); 
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);
    
    const wavData = Buffer.concat([header, rawData]);
    fs.writeFileSync(filePath, wavData);
}

// ========================================================
// KONFIGURASI MULTER (PENYIMPANAN SEMENTARA)
// ========================================================
const storage = multer.diskStorage({
    destination: function (req, file, cb) { 
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir); 
    },
    filename: function (req, file, cb) {
        // Menyimpan format asli file agar bisa dicek nanti
        const ext = path.extname(file.originalname) || '.raw';
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + ext); 
    }
});
const upload = multer({ storage: storage });

// ========================================================
// PROSES AUDIO (OTAK AI CIMAL)
// ========================================================
const processAudio = async (req, res) => {
    const io = req.app.get('io');
    let userText = "Suara diterima"; 
    
    console.log(`\n=================================================`);
    console.log(`[PROSES 1] Permintaan masuk! Memeriksa file audio...`);

    try {
        if (!req.file) {
            console.error(`[ERROR] File audio tidak ditemukan atau format salah!`);
            return res.status(400).json({ status: 'error', message: 'File audio tidak ditemukan!' });
        }

        let audioPath = req.file.path; 
        const originalName = req.file.originalname.toLowerCase();

        // LOGIKA PINTAR: Tambahkan deteksi .pcm sesuai kodingan ESP32 terbarumu
        if (originalName.endsWith('.raw') || originalName.endsWith('.pcm')) {
            console.log(`[PROSES 1] Format mentah dari ESP32 terdeteksi. Merakit WAV...`);
            rakitWavSempurna(audioPath);
            
            const wavAudioPath = audioPath + '.wav';
            fs.renameSync(audioPath, wavAudioPath);
            audioPath = wavAudioPath; 
            
            console.log(`[PROSES 1] Selesai. File berhasil dirakit dan direname menjadi WAV.`);
        } else {
            console.log(`[PROSES 1] Format umum (${originalName}) dari Postman/App terdeteksi. Melewati perakitan WAV.`);
        }

        console.log(`[PROSES 2] Mengirim audio ke Groq Whisper (Speech-to-Text)...`);
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(audioPath), 
            model: "whisper-large-v3",
            language: "id",
            response_format: "json"
        });

        let rawText = transcription.text;
        userText = rawText
            .replace(/wisu|wisnu|uiso|wesu/gi, "uisu")
            .replace(/cema|cimol|simal|cima/gi, "cimal");

        console.log(`  -> Terdengar sebagai: "${userText}"`);
        
        // Hapus file suara pengguna setelah diubah ke teks
        fs.unlinkSync(audioPath);
        if (io) io.emit('chat_update', { sender: 'user', text: userText });

        console.log(`[PROSES 3] Membaca Pangkalan Data FAQ...`);
        let faqDataString = "";
        try {
            const faqPath = path.join(__dirname, '../data/faq.json');
            faqDataString = fs.readFileSync(faqPath, 'utf8');
        } catch (e) {
            console.log(`[WARNING] Data FAQ tidak ditemukan.`);
        }

        let finalEmotion = "NORMAL";
        let finalAnswer = "";
        let butuhUpdate = false;

        try {
            console.log(`[PROSES 4] Berpikir menggunakan AI (Groq Qwen)...`);
            const systemPrompt = `Kamu adalah CIMAL (Cerdas Informatif Mesin Automasi Layanan), asisten AI pelayanan akademik Prodi Teknik Informatika Universitas Islam Sumatera Utara (UISU).
            
            Data Resmi Prodi:
            ${faqDataString}
            
            Aturan ketat:
            1. Jawab ramah, ringkas, dan sopan. 
            2. DILARANG KERAS mengarang informasi akademik jika TIDAK ADA di Data Resmi Prodi.
            3. PENGECUALIAN: Jika pengguna bertanya tentang INFORMASI UMUM, ILMU KOMPUTER, PENGERTIAN TEKNOLOGI, atau IT secara umum (misal: apa itu AI, apa itu Python, pengertian skripsi/KP secara teori), JAWABLAH dengan cerdas berdasarkan pengetahuan umummu, dan set "butuh_update" menjadi false.
            4. Jika pertanyaan terkait program studi teknik informatika uisu TIDAK ADA di data, jawab jujur bahwa CIMAL belum memiliki info tersebut, dan arahkan ke staff akademik. Set nilai "butuh_update" menjadi true.
            5. Jika meminta data sensitif kampus, tolak demi privasi.
            6. Jika sekadar sapaan/umum, jawab natural dan set "butuh_update" menjadi false.
            7. Tentukan emosi: [NORMAL, HAPPY, ANGRY, CUTE].
            
            PENTING! Kamu HANYA BOLEH membalas dalam format JSON murni tanpa teks lain:
            {"emotion": "NORMAL", "jawaban": "Halo! Ada yang bisa Cimal bantu?", "butuh_update": false}`;

            const chatCompletion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userText }
                ],
                model: "qwen/qwen3.8-27b", // HANYA UBAH NAMA MODEL
                temperature: 0.2, 
                max_tokens: 800,
            });

            const botReplyRaw = chatCompletion.choices[0].message.content;
            
            try {
                let cleanJson = botReplyRaw.replace(/```json/gi, '').replace(/```/gi, '').trim();
                let parsedData = JSON.parse(cleanJson);
                finalEmotion = parsedData.emotion || "NORMAL";
                finalAnswer = parsedData.jawaban || botReplyRaw;
                butuhUpdate = parsedData.butuh_update || false;
            } catch (jsonErr) {
                finalAnswer = botReplyRaw;
            }

        } catch (apiError) {
            // JIKA GROQ API ERROR / KENA LIMIT, JALANKAN MODE LOKAL OLLAMA
            console.error(`[WARNING] Groq API Terkena Limit/Error! Beralih ke Mode AI Lokal (Ollama)...`);
            
            let jawabanDitemukan = "Mohon maaf, server cimal saat ini sedang sibuk. Silakan tanyakan langsung ke bagian Tata Usaha.";
            
            try {
                const response = await fetch('http://localhost:11434/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: "qwen2.5:1.5b", 
                        messages: [
                            { role: "system", content: systemPromptPrompt }, // Menggunakan systemPrompt yang sama
                            { role: "user", content: userText }
                        ],
                        stream: false
                    })
                });

                const data = await response.json();
                const botReplyRaw = data.message.content;
                
                try {
                    let cleanJson = botReplyRaw.replace(/```json/gi, '').replace(/```/gi, '').trim();
                    let parsedData = JSON.parse(cleanJson);
                    jawabanDitemukan = parsedData.jawaban || botReplyRaw;
                    finalEmotion = parsedData.emotion || "NORMAL";
                    butuhUpdate = parsedData.butuh_update || false;
                    console.log(`[INFO LOKAL] Jawaban berhasil diselamatkan oleh Ollama.`);
                } catch (jsonErr) {
                    jawabanDitemukan = botReplyRaw;
                }

            } catch (ollamaError) {
                console.error("Gagal membaca dari Ollama di mode lokal.");
                butuhUpdate = true;
            }

            finalAnswer = jawabanDitemukan;
        }

        // LOGIKA MENYIMPAN PERTANYAAN TAK TERJAWAB
        if (butuhUpdate === true || finalAnswer.includes("mengalami gangguan") || finalAnswer.includes("sedang sibuk")) {
            const updatePath = path.join(__dirname, '../data/pembaruan_database.json');
            let updateList = [];
            
            if (fs.existsSync(updatePath)) {
                try {
                    updateList = JSON.parse(fs.readFileSync(updatePath, 'utf8'));
                } catch (e) {
                    updateList = []; 
                }
            }
            
            const newText = userText.toLowerCase();
            let isDuplicate = updateList.some(existingQuestion => {
                const existingText = existingQuestion.toLowerCase();
                return existingText.includes(newText) || newText.includes(existingText);
            });

            if (!isDuplicate) {
                updateList.push(userText);
                fs.writeFileSync(updatePath, JSON.stringify(updateList, null, 2));
                console.log(`[INFO ADMIN] Audio: Pertanyaan baru ditambahkan ke pembaruan_database.json: "${userText}"`);
            }
        }

        console.log(`  -> Emosi AI: ${finalEmotion}`);
        console.log(`  -> Teks Balasan: "${finalAnswer}"`);

        if (io) io.emit('chat_update', { sender: 'cimal', text: finalAnswer });
        
        // HANYA MENGUBAH PENAMBAHAN REPLACE DLL, DSB, YG
        const teksUntukSuara = finalAnswer
            .replace(/[\*\#]/g, "")
            .replace(/UISU/g, "Uisu")
            .replace(/\bdll\b/gi, "dan lain-lain")
            .replace(/\bdsb\b/gi, "dan sebagainya")
            .replace(/\byg\b/gi, "yang");

        console.log(`[PROSES 5] Mengubah teks menjadi suara (Edge TTS - GadisNeural)...`);
        const publicFolder = path.join(process.cwd(), 'public'); 

        const idUnik = Date.now();
        const namaFolder = `cimal_suara_${idUnik}`;
        const folderTarget = path.join(publicFolder, namaFolder);

        if (!fs.existsSync(folderTarget)) {
            fs.mkdirSync(folderTarget, { recursive: true });
        }

        try {
            const tts = new MsEdgeTTS();
            
            await tts.setMetadata('id-ID-GadisNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
            await tts.toFile(folderTarget, teksUntukSuara);
            
            // HANYA MENGUBAH REQ.HEADERS.HOST AGAR DINAMIS MENGIKUTI IP
            // DETEKSI PROTOKOL OTOMATIS (Lokal = http, Cloud/Railway = https)
            const hostName = req.headers.host || "";
            const protokol = (hostName.includes('192.168.') || hostName.includes('localhost')) ? 'http' : 'https';

            const urlLokal = `${protokol}://${hostName}/public/${namaFolder}/audio.mp3`;
            
            console.log(`[PROSES 6] Menyimpan ke Antrean untuk ESP32...`);
            global.cimalResponseData = {
                emotion: finalEmotion,
                urls: [urlLokal] 
            };
            console.log(`  -> Sukses! File audio "Gadis" dan emosi siap dijemput ESP32.`);

        } catch (ttsError) {
            console.error("[ERROR] Gagal generate suara dari Edge TTS:", ttsError.message);
            throw new Error("Gagal membuat suara CIMAL.");
        }

        return res.status(200).json({
            status: 'success',
            data: { user_said: userText, cimal_reply: finalAnswer, emotion: finalEmotion }
        });

    } catch (error) {
        console.error(`\n[FATAL ERROR] Proses terhenti karena:`, error.message);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

module.exports = { upload, processAudio };
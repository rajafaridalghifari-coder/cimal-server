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

        // PERBAIKAN 1: Ubah 'const' menjadi 'let' agar nilainya bisa kita timpa
        let audioPath = req.file.path; 
        const originalName = req.file.originalname.toLowerCase();

        // LOGIKA PINTAR: Tambahkan deteksi .pcm sesuai kodingan ESP32 terbarumu
        if (originalName.endsWith('.raw') || originalName.endsWith('.pcm')) {
            console.log(`[PROSES 1] Format mentah dari ESP32 terdeteksi. Merakit WAV...`);
            rakitWavSempurna(audioPath);
            
            // PERBAIKAN 2: Ubah nama file fisiknya menjadi .wav agar Groq mau menerimanya
            const wavAudioPath = audioPath + '.wav';
            fs.renameSync(audioPath, wavAudioPath);
            audioPath = wavAudioPath; // Perbarui variabel agar Groq membaca file yang baru
            
            console.log(`[PROSES 1] Selesai. File berhasil dirakit dan direname menjadi WAV.`);
        } else {
            console.log(`[PROSES 1] Format umum (${originalName}) dari Postman/App terdeteksi. Melewati perakitan WAV.`);
        }

        console.log(`[PROSES 2] Mengirim audio ke Groq Whisper (Speech-to-Text)...`);
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(audioPath), // Sekarang Groq akan membaca file berakhiran .wav
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

        console.log(`[PROSES 4] Berpikir dan mencari jawaban (Groq Qwen)...`);
        const systemPrompt = `Kamu adalah CIMAL (Cerdas Informatif Mesin Automasi Layanan), asisten AI pelayanan akademik Prodi Teknik Informatika Universitas Islam Sumatera Utara (UISU).
        
        Data Resmi Prodi:
        ${faqDataString}
        
        Aturan ketat:
        1. Jawab ramah, ringkas, dan sopan. CIMAL dikembangkan oleh Tim Basudara Teknik Informatika UISU.
        2. DILARANG KERAS mengarang informasi akademik jika TIDAK ADA di Data Resmi Prodi.
        3. Jika pertanyaan akademik TIDAK ADA di data, jawab jujur bahwa CIMAL belum memiliki info tersebut, dan arahkan ke Tata Usaha. Set nilai "butuh_update" menjadi true.
        4. Jika meminta data sensitif kampus, tolak demi privasi.
        5. Jika sekadar sapaan/umum, jawab natural dan set "butuh_update" menjadi false.
        6. Tentukan emosi: [NORMAL, HAPPY, ANGRY, CUTE].
        
        PENTING! Kamu HANYA BOLEH membalas dalam format JSON murni tanpa teks lain:
        {"emotion": "NORMAL", "jawaban": "Halo! Ada yang bisa Cimal bantu?", "butuh_update": false}`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userText }
            ],
            model: "qwen/qwen3.8-27b", 
            temperature: 0.2, 
            max_tokens: 800,
        });

        const botReplyRaw = chatCompletion.choices[0].message.content;
        
        let finalEmotion = "NORMAL";
        let finalAnswer = botReplyRaw;

        try {
            let cleanJson = botReplyRaw.replace(/```json/gi, '').replace(/```/gi, '').trim();
            let parsedData = JSON.parse(cleanJson);
            
            finalEmotion = parsedData.emotion || "NORMAL";
            finalAnswer = parsedData.jawaban || botReplyRaw;

            // LOGIKA MENYIMPAN PERTANYAAN TAK TERJAWAB
            if (parsedData.butuh_update === true) {
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
        } catch (parseError) {
            console.log(`[WARNING] AI tidak membalas dengan format JSON yang valid. Menggunakan teks mentah.`);
            finalAnswer = botReplyRaw;
        }

        console.log(`  -> Emosi AI: ${finalEmotion}`);
        console.log(`  -> Teks Balasan: "${finalAnswer}"`);

        if (io) io.emit('chat_update', { sender: 'cimal', text: finalAnswer });
        const teksUntukSuara = finalAnswer.replace(/[\*\#]/g, ""); 

        console.log(`[PROSES 5] Mengubah teks menjadi suara (Edge TTS - GadisNeural)...`);
        const publicFolder = path.join(process.cwd(), 'public'); 

        // 1. Buat ID unik untuk nama folder (bukan nama file)
        const idUnik = Date.now();
        const namaFolder = `cimal_suara_${idUnik}`;
        const folderTarget = path.join(publicFolder, namaFolder);

        // 2. Buat folder target tersebut di dalam folder public
        if (!fs.existsSync(folderTarget)) {
            fs.mkdirSync(folderTarget, { recursive: true });
        }

        try {
            const tts = new MsEdgeTTS();
            
            // Setel suara ke GadisNeural (Remaja Indonesia) dengan kualitas MP3 standar untuk ESP32
            await tts.setMetadata('id-ID-GadisNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
            
            // 3. PENTING: Masukkan PATH FOLDER (bukan path file). 
            // msedge-tts akan otomatis membuat file bernama 'audio.mp3' di dalam folder ini.
            await tts.toFile(folderTarget, teksUntukSuara);
            
            // 4. Generate URL lokal yang mengarah ke file audio.mp3 di dalam folder unik tersebut
            const urlLokal = `http://${req.headers.host}/public/${namaFolder}/audio.mp3`;
            
            console.log(`[PROSES 6] Menyimpan ke Antrean untuk ESP32...`);
            global.cimalResponseData = {
                emotion: finalEmotion,
                urls: [urlLokal] // URL sudah diarahkan ke file audio.mp3
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
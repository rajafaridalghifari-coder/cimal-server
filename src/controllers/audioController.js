const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts'); 
global.crypto = require('crypto');

// ========================================================
// INISIALISASI GEMINI DENGAN SDK TERBARU (@google/genai)
// ========================================================
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

        console.log(`[PROSES 2] Membaca Pangkalan Data FAQ...`);
        let faqDataString = "";
        try {
            const faqPath = path.join(__dirname, '../data/faq.json');
            faqDataString = fs.readFileSync(faqPath, 'utf8');
        } catch (e) {
            console.log(`[WARNING] Data FAQ tidak ditemukan.`);
        }

        let userText = "Suara diterima";
        let finalEmotion = "NORMAL";
        let finalAnswer = "";
        let butuhUpdate = false;

        try {
            console.log(`[PROSES 3] Memproses Audio (Native Audio Gemini 2.5 Flash)...`);
            
            const systemPrompt = `Kamu adalah CIMAL (Cerdas Informatif Mesin Automasi Layanan), asisten AI pelayanan akademik Prodi Teknik Informatika Universitas Islam Sumatera Utara (UISU).
            
            Data Resmi Prodi:
            ${faqDataString}
            
            Aturan ketat:
            1. Dengarkan pertanyaan dari file audio yang dikirimkan.
            2. Jawab ramah, ringkas, dan sopan. 
            3. DILARANG KERAS mengarang informasi akademik jika TIDAK ADA di Data Resmi Prodi.
            4. PENGECUALIAN: Jika pengguna bertanya tentang INFORMASI UMUM, ILMU KOMPUTER, PENGERTIAN TEKNOLOGI, atau IT secara umum, JAWABLAH dengan cerdas, dan set "butuh_update" menjadi false.
            5. Jika informasi TIDAK ADA di data resmi, jawab jujur bahwa CIMAL belum memiliki info tersebut. Set nilai "butuh_update" menjadi true.
            6. Jika meminta data sensitif kampus, tolak demi privasi.
            7. Jika sekadar sapaan/umum, jawab natural dan set "butuh_update" menjadi false.
            8. Tentukan emosi: [NORMAL, HAPPY, ANGRY, CUTE].
            
            PENTING! Kamu HANYA BOLEH membalas dalam format JSON murni tanpa teks lain:
            {"transkrip_pertanyaan": "teks pertanyaan yang kamu dengar", "emotion": "NORMAL", "jawaban": "Halo! Ada yang bisa Cimal bantu?", "butuh_update": false}`;

            // Mengubah file audio menjadi format Base64 untuk Gemini
            const audioBase64 = fs.readFileSync(audioPath).toString("base64");

            // Pemanggilan API Gemini Native Audio
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-native-audio-dialog",
                contents: [
                    {
                        inlineData: {
                            data: audioBase64,
                            mimeType: "audio/wav"
                        }
                    },
                    { text: "Jawab pertanyaan dari suara ini berdasarkan data akademik." }
                ],
                config: {
                    systemInstruction: systemPrompt,
                    temperature: 0.2, 
                    responseMimeType: "application/json",
                }
            });

            const botReplyRaw = response.text;
            
            let cleanJson = botReplyRaw.replace(/```json/gi, '').replace(/```/gi, '').trim();
            let parsedData = JSON.parse(cleanJson);
            
            // Mengambil teks pertanyaan (transkripsi internal Gemini)
            userText = parsedData.transkrip_pertanyaan || "Suara tidak terdengar jelas";
            userText = userText.replace(/wisu|wisnu|uiso|wesu/gi, "uisu").replace(/cema|cimol|simal|cima/gi, "cimal");
            console.log(`  -> Terdengar sebagai: "${userText}"`);

            finalEmotion = parsedData.emotion || "NORMAL";
            finalAnswer = parsedData.jawaban || botReplyRaw;
            butuhUpdate = parsedData.butuh_update || false;

            // Emit teks pertanyaan ke frontend (jika ada) setelah berhasil diparsing
            if (io) io.emit('chat_update', { sender: 'user', text: userText });

        } catch (apiError) {
            console.error(`[WARNING] Gemini API Terkena Limit/Error! Beralih ke Mode Pencarian Database Lokal...`);
            
            // CATATAN PADA MODE LOKAL TANPA GROQ WHISPER:
            // Karena Groq STT dihapus dan Gemini STT gagal, kita tidak memiliki transkrip suara pengguna untuk dicari di FAQ lokal.
            finalAnswer = "Mohon maaf, sistem pengenalan suara Cimal saat ini sedang mengalami gangguan. Silakan coba kembali nanti.";
            butuhUpdate = false; 
        } finally {
            // Hapus file WAV setelah proses Gemini/Fallback selesai agar server tidak penuh
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        }

        // LOGIKA MENYIMPAN PERTANYAAN TAK TERJAWAB
        if (butuhUpdate === true || finalAnswer.includes("mengalami gangguan")) {
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

            if (!isDuplicate && userText !== "Suara diterima" && userText !== "Suara tidak terdengar jelas") {
                updateList.push(userText);
                fs.writeFileSync(updatePath, JSON.stringify(updateList, null, 2));
                console.log(`[INFO ADMIN] Audio: Pertanyaan baru ditambahkan ke pembaruan_database.json: "${userText}"`);
            }
        }

        console.log(`  -> Emosi AI: ${finalEmotion}`);
        console.log(`  -> Teks Balasan: "${finalAnswer}"`);

        if (io) io.emit('chat_update', { sender: 'cimal', text: finalAnswer });
        const teksUntukSuara = finalAnswer
            .replace(/[\*\#]/g, "")
            .replace(/UISU/g, "Uisu");

        console.log(`[PROSES 4] Mengubah teks menjadi suara (Edge TTS - GadisNeural)...`);
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
            
            const urlLokal = `https://${req.headers.host}/public/${namaFolder}/audio.mp3`;
            
            console.log(`[PROSES 5] Menyimpan ke Antrean untuk ESP32...`);
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
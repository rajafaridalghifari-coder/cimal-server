const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Groq = require('groq-sdk');
// Menggunakan Microsoft Edge TTS untuk suara "Gadis" (Remaja Perempuan Indonesia)
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts'); 

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

        const audioPath = req.file.path;
        const originalName = req.file.originalname.toLowerCase();

        // LOGIKA PINTAR: Hanya rakit WAV jika file adalah .raw murni dari ESP32
        if (originalName.endsWith('.raw')) {
            console.log(`[PROSES 1] Format .raw dari ESP32 terdeteksi. Merakit WAV...`);
            rakitWavSempurna(audioPath);
            console.log(`[PROSES 1] Selesai. File berhasil dirakit menjadi WAV.`);
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
            .replace(/wisu|wisnu|uiso|wesu/gi, "UISU")
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
        const systemPrompt = `Kamu adalah cimal, asisten AI pelayanan akademik Prodi Teknik Informatika UISU.
        Data Resmi Prodi:
        ${faqDataString}
        
        Aturan ketat:
        1. Jawab ramah dan ringkas. Jangan mengarang informasi.
        2. Tentukan satu emosi untuk jawaban ini: [NORMAL, HAPPY, ANGRY, CUTE].
        
        PENTING! Kamu HANYA BOLEH membalas dalam format JSON murni tanpa ada teks lain, seperti ini:
        {"emotion": "HAPPY", "jawaban": "Halo! Ada yang bisa Cimal bantu?"}`;

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
        if (!fs.existsSync(publicFolder)) {
            fs.mkdirSync(publicFolder, { recursive: true });
        }

        const namaFile = `cimal_suara_${Date.now()}.mp3`;
        const pathFile = path.join(publicFolder, namaFile);

        try {
            const tts = new MsEdgeTTS();
            
            // Setel suara ke GadisNeural (Remaja Indonesia) dengan kualitas MP3 standar untuk ESP32
            await tts.setMetadata('id-ID-GadisNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
            
            // Simpan langsung ke file
            await tts.toFile(pathFile, teksUntukSuara);
            
            // Generate URL lokal yang mengarah ke file mp3 tersebut
            const urlLokal = `http://${req.headers.host}/public/${namaFile}`;
            
            console.log(`[PROSES 6] Menyimpan ke Antrean untuk ESP32...`);
            global.cimalResponseData = {
                emotion: finalEmotion,
                // Hanya butuh 1 URL karena Edge TTS menghasilkan file utuh
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
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Groq = require('groq-sdk');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts'); 

global.crypto = require('crypto');

// STT Menggunakan Groq Whisper
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Fungsi Merakit File Audio Mentah
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

const storage = multer.diskStorage({
    destination: function (req, file, cb) { 
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir); 
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname) || '.raw';
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + ext); 
    }
});
const upload = multer({ storage: storage });

const processAudio = async (req, res) => {
    const io = req.app.get('io');
    let userText = "Suara diterima"; 
    
    console.log(`\n=================================================`);
    console.log(`[PROSES 1] Permintaan audio masuk dari ESP32...`);

    try {
        if (!req.file) return res.status(400).json({ status: 'error', message: 'File audio tidak ditemukan!' });

        let audioPath = req.file.path; 
        const originalName = req.file.originalname.toLowerCase();

        if (originalName.endsWith('.raw') || originalName.endsWith('.pcm')) {
            console.log(`[PROSES 1] Merakit format RAW/PCM menjadi WAV...`);
            rakitWavSempurna(audioPath);
            const wavAudioPath = audioPath + '.wav';
            fs.renameSync(audioPath, wavAudioPath);
            audioPath = wavAudioPath; 
        }

        console.log(`[PROSES 2] Speech-to-Text (Groq Whisper)...`);
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(audioPath), 
            model: "whisper-large-v3",
            language: "id",
            response_format: "json"
        });

        userText = transcription.text.replace(/wisu|wisnu|uiso|wesu/gi, "uisu").replace(/cema|cimol|simal|cima/gi, "cimal");
        console.log(`  -> Terdengar sebagai: "${userText}"`);
        
        fs.unlinkSync(audioPath); // Hapus audio sementara
        if (io) io.emit('chat_update', { sender: 'user', text: userText });

        // ========================================================
        // PROSES 3: SMART SEARCH (RAG - MENCARI JAWABAN DI FAQ LOKAL)
        // ========================================================
        console.log(`[PROSES 3] Mencari kecocokan di Pangkalan Data FAQ...`);
        let faqList = [];
        try {
            const faqPath = path.join(__dirname, '../data/faq.json');
            faqList = JSON.parse(fs.readFileSync(faqPath, 'utf8'));
        } catch (e) { console.log(`[WARNING] Data FAQ tidak ditemukan.`); }

        const userTeksLower = userText.toLowerCase();
        let bestMatchInfo = "";
        let highestScore = 0;

        for (let item of faqList) {
            let score = 0;
            const tanyaLower = item.pertanyaan.toLowerCase();
            
            if (userTeksLower.includes(tanyaLower) || tanyaLower.includes(userTeksLower)) score += 10; 

            const kataUser = userTeksLower.split(" ");
            for (let kata of kataUser) {
                if (kata.length > 3 && tanyaLower.includes(kata)) score += 1;
            }

            if (score > highestScore) {
                highestScore = score;
                bestMatchInfo = item.jawaban;
            }
        }

        let butuhUpdate = false;
        let konteksSpesifik = "";

        if (highestScore > 0 && bestMatchInfo) {
            konteksSpesifik = bestMatchInfo;
            console.log(`[INFO] Jawaban FAQ ditemukan (Skor: ${highestScore}). Menyiapkan untuk Ollama...`);
        } else {
            butuhUpdate = true;
            konteksSpesifik = "TIDAK ADA DATA DI DATABASE. Cimal belum mengetahui informasi ini.";
        }

        // ========================================================
        // PROSES 4: OLLAMA AI (MENJADIKAN BAHASA ROBOT LEBIH NATURAL)
        // ========================================================
        const systemPrompt = `Kamu adalah CIMAL, asisten AI pelayanan akademik Teknik Informatika UNIVERSITAS ISLAM SUMATERA UTARA (UISU).
        
        Tugasmu HANYA menjawab MENGGUNAKAN DATA REFERENSI di bawah.
        Aturan:
        1. Jawab ramah, ringkas, dan sopan. 
        2. DILARANG KERAS mengarang informasi akademik. Jika jawaban tidak ada di Data Resmi di atas, jangan mengarang.
        3. PENGECUALIAN: Jika pengguna bertanya tentang INFORMASI UMUM, ILMU KOMPUTER, PENGERTIAN TEKNOLOGI, atau IT secara umum, JAWABLAH dengan cerdas berdasarkan pengetahuan umummu, dan set "butuh_update" menjadi false.
        4. Jika pertanyaan terkait akademik TIDAK ADA di data resmi, jawab jujur bahwa CIMAL belum memiliki info tersebut, dan arahkan ke staff akademik. Set nilai "butuh_update" menjadi true.
        5. Jika meminta data sensitif kampus, tolak demi privasi.
        6. Tentukan emosi yang sesuai: [NORMAL, HAPPY, ANGRY, CUTE].
        7. Wajib balas dengan JSON murni:
        {"emotion": "NORMAL", "jawaban": "teks jawaban", "butuh_update": ${butuhUpdate}}`;

        let finalEmotion = "NORMAL";
        let finalAnswer = "";

        try {
            console.log(`[PROSES 4] Memperhalus kalimat (Ollama)...`);
            const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434/api/chat";
            const ollamaModel = process.env.OLLAMA_MODEL || "qwen2.5:1.5b"; 

            const response = await fetch(ollamaUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: ollamaModel,
                    messages: [
                        { role: "system", content: systemPrompt },
                        // INJEKSI KONTEKS TUNGGAL ANTI-HALU
                        { role: "user", content: `DATA REFERENSI:\n"${konteksSpesifik}"\n\nPERTANYAAN PENGGUNA:\n"${userText}"` }
                    ],
                    format: "json", 
                    stream: false,
                    options: { temperature: 0.1 }
                })
            });

            if (!response.ok) throw new Error(`Ollama HTTP Error`);

            const data = await response.json();
            let cleanJson = data.message.content.replace(/```json/gi, '').replace(/```/gi, '').trim();
            let parsedData = JSON.parse(cleanJson);
            
            finalEmotion = parsedData.emotion || "NORMAL";
            finalAnswer = parsedData.jawaban || cleanJson;

        } catch (apiError) {
            console.error(`[WARNING] Ollama Error / Ngrok Mati! Beralih ke teks mentah lokal...`);
            finalAnswer = highestScore > 0 ? bestMatchInfo : "Mohon maaf, server cimal sedang sibuk. Silakan ke Tata Usaha.";
            finalEmotion = highestScore > 0 ? "HAPPY" : "NORMAL";
        }

        // ========================================================
        // LOGIKA PENYIMPANAN & PEMBUATAN SUARA TTS
        // ========================================================
        if (butuhUpdate || finalAnswer.includes("Tata Usaha")) {
            const updatePath = path.join(__dirname, '../data/pembaruan_database.json');
            let updateList = [];
            if (fs.existsSync(updatePath)) {
                try { updateList = JSON.parse(fs.readFileSync(updatePath, 'utf8')); } catch (e) { }
            }
            if (!updateList.some(q => q.toLowerCase().includes(userText.toLowerCase()))) {
                updateList.push(userText);
                fs.writeFileSync(updatePath, JSON.stringify(updateList, null, 2));
            }
        }

        console.log(`  -> Emosi AI: ${finalEmotion}`);
        console.log(`  -> Teks Balasan: "${finalAnswer}"`);

        if (io) io.emit('chat_update', { sender: 'cimal', text: finalAnswer });
        const teksUntukSuara = finalAnswer.replace(/[\*\#]/g, "").replace(/UISU/g, "Uisu");

        console.log(`[PROSES 5] Text-to-Speech (Edge TTS)...`);
        const publicFolder = path.join(process.cwd(), 'public'); 
        const namaFolder = `cimal_suara_${Date.now()}`;
        const folderTarget = path.join(publicFolder, namaFolder);
        if (!fs.existsSync(folderTarget)) fs.mkdirSync(folderTarget, { recursive: true });

        try {
            const tts = new MsEdgeTTS();
            await tts.setMetadata('id-ID-GadisNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
            await tts.toFile(folderTarget, teksUntukSuara);
            
            const urlLokal = `https://${req.headers.host}/public/${namaFolder}/audio.mp3`;
            
            console.log(`[PROSES 6] Audio & Ekspresi siap dikirim ke ESP32!`);
            global.cimalResponseData = { emotion: finalEmotion, urls: [urlLokal] };

        } catch (ttsError) {
            console.error("[ERROR] Gagal generate suara:", ttsError.message);
            throw new Error("Gagal membuat suara.");
        }

        return res.status(200).json({
            status: 'success',
            data: { user_said: userText, cimal_reply: finalAnswer, emotion: finalEmotion }
        });

    } catch (error) {
        console.error(`\n[FATAL ERROR]`, error.message);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

module.exports = { upload, processAudio };
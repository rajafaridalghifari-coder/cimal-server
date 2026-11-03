const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Groq = require('groq-sdk');
const googleTTS = require('google-tts-api'); 

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ========================================================
// FUNGSI PERAKIT WAV
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
// KONFIGURASI MULTER (PENYIMPANAN)
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
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + '.wav'); 
    }
});
const upload = multer({ storage: storage });

const unduhSuaraGoogle = (url, pathTujuan) => {
    return new Promise((resolve, reject) => {
        const { exec } = require('child_process');
        const perintah = `curl -s -L -A "Mozilla/5.0" -o "${pathTujuan}" "${url}"`;
        
        exec(perintah, (error) => {
            if (error) {
                console.error(`[ERROR] Gagal mendownload dari Google: ${error.message}`);
                reject(error);
                return;
            }
            resolve();
        });
    });
};

// ========================================================
// PROSES AUDIO (OTAK AI)
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
        rakitWavSempurna(audioPath);
        console.log(`[PROSES 1] Selesai. File berhasil dirakit menjadi WAV.`);

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
        fs.unlinkSync(audioPath);
        if (io) io.emit('chat_update', { sender: 'user', text: userText });

        console.log(`[PROSES 3] Membaca Pangkalan Data FAQ...`);
        const faqPath = path.join(__dirname, '../data/faq.json');
        const faqDataString = fs.readFileSync(faqPath, 'utf8');

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

        console.log(`[PROSES 5] Mengubah teks menjadi suara (Google TTS)...`);
        const audioData = googleTTS.getAllAudioUrls(teksUntukSuara, { 
            lang: 'id', slow: false, host: 'https://translate.google.com', splitPunct: ',.?'
        });

        const localUrls = [];
        const publicFolder = path.join(process.cwd(), 'public'); 
        
        if (!fs.existsSync(publicFolder)) {
            fs.mkdirSync(publicFolder, { recursive: true });
        }

        for (let i = 0; i < audioData.length; i++) {
            let urlGoogle = typeof audioData[i] === 'string' ? audioData[i] : audioData[i].url;
            
            if (urlGoogle.startsWith('//')) {
                urlGoogle = 'https:' + urlGoogle;
            } else if (urlGoogle.startsWith('/')) {
                urlGoogle = 'https://translate.google.com' + urlGoogle;
            }

            const namaFile = `cimal_suara_${i}.mp3`;
            const pathFile = path.join(publicFolder, namaFile);
            
            await unduhSuaraGoogle(urlGoogle, pathFile);
            
            // Otomatis mengikuti IP laptop yang dihubungi ESP32
            const urlLokal = `http://${req.headers.host}/public/${namaFile}`;
            localUrls.push(urlLokal);
        }

        console.log(`[PROSES 6] Menyimpan ke Antrean untuk ESP32...`);
        global.cimalResponseData = {
            emotion: finalEmotion,
            urls: localUrls
        };
        console.log(`  -> Sukses! File audio dan emosi siap dijemput ESP32.`);

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
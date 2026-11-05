const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const getChatResponse = async (req, res) => {
    try {
        const userMessage = req.body.message;

        if (!userMessage) {
            return res.status(400).json({ error: "Pesan tidak boleh kosong" });
        }

        console.log(`\n[CHAT TEKS] Pesan masuk dari Mobile App: "${userMessage}"`);

        // 1. MEMBACA PANGKALAN DATA FAQ
        let faqDataString = "";
        try {
            const faqPath = path.join(__dirname, '../data/faq.json');
            faqDataString = fs.readFileSync(faqPath, 'utf8');
        } catch (err) {
            console.error("[WARNING] File faq.json tidak ditemukan untuk Chat.");
        }

        // 2. SYSTEM PROMPT (ATURAN BARU)
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
        
        PENTING! Balas HANYA dengan format JSON murni:
        {"jawaban": "isi jawaban teks yang rapi di sini", "butuh_update": false}`;

        let finalAnswer = "";
        let butuhUpdate = false;

        // 3. PROSES AI DENGAN FITUR KEBAL LIMIT (FALLBACK LOKAL)
        try {
            console.log(`[CHAT TEKS] Sedang berpikir dan mencari jawaban (Groq Qwen)...`);
            const chatCompletion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage }
                ],
                model: "qwen/qwen3.8-27b", 
                temperature: 0.2, 
                max_tokens: 800,
            });

            const botReplyRaw = chatCompletion.choices[0].message.content;
            
            // Parsing JSON dari Groq
            let cleanJson = botReplyRaw.replace(/```json/gi, '').replace(/```/gi, '').trim();
            let parsedData = JSON.parse(cleanJson);
            
            finalAnswer = parsedData.jawaban || botReplyRaw;
            butuhUpdate = parsedData.butuh_update || false;

        } catch (apiError) {
            // JIKA GROQ API ERROR / KENA LIMIT, JALANKAN MODE LOKAL
            console.error(`[WARNING] Groq API (Chat) Terkena Limit/Error! Beralih ke Mode Pencarian Database Lokal...`);
            
            let jawabanDitemukan = "Mohon maaf, sistem AI Cimal sedang mengalami gangguan jaringan atau kelebihan muatan. Silakan tanyakan langsung ke bagian Tata Usaha.";
            
            try {
                const faqList = JSON.parse(faqDataString);
                const userTeksLower = userMessage.toLowerCase();

                for (let item of faqList) {
                    const tanyaLower = item.pertanyaan.toLowerCase();
                    if (userTeksLower.includes(tanyaLower) || tanyaLower.includes(userTeksLower)) {
                        jawabanDitemukan = item.jawaban;
                        break;
                    }
                }
            } catch (faqError) {
                console.error("Gagal membaca faq.json di mode lokal (Chat).");
            }

            finalAnswer = jawabanDitemukan;
        }
        
        // 4. LOGIKA MENYIMPAN PERTANYAAN TAK TERJAWAB
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
            
            const newText = userMessage.toLowerCase();
            let isDuplicate = updateList.some(existingQuestion => {
                const existingText = existingQuestion.toLowerCase();
                return existingText.includes(newText) || newText.includes(existingText);
            });

            if (!isDuplicate) {
                updateList.push(userMessage);
                fs.writeFileSync(updatePath, JSON.stringify(updateList, null, 2));
                console.log(`[INFO ADMIN] Chat: Pertanyaan baru ditambahkan ke pembaruan_database.json: "${userMessage}"`);
            }
        } 

        console.log(`[CHAT TEKS] Jawaban berhasil dibuat: "${finalAnswer.substring(0, 50)}..."`);
        res.json({ response: finalAnswer });
        
    } catch (error) {
        console.error("Error pada Groq API (Chat):", error);
        res.status(500).json({ error: "Terjadi kesalahan pada server AI CIMAL." });
    }
};

module.exports = { getChatResponse };
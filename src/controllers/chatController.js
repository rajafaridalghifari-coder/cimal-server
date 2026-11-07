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

        // 2. SYSTEM PROMPT
        const systemPrompt = `Kamu adalah CIMAL (Cerdas Informatif Mesin Automasi Layanan), asisten AI pelayanan akademik Prodi Teknik Informatika Universitas Islam Sumatera Utara (UISU).
        
        Data Resmi Prodi:
        ${faqDataString}
        
        Aturan ketat:
        1. Jawab ramah, ringkas, dan sopan. 
        2. DILARANG KERAS mengarang informasi akademik jika TIDAK ADA di Data Resmi Prodi.
        3. PENGECUALIAN: Jika pengguna bertanya tentang INFORMASI UMUM, ILMU KOMPUTER, PENGERTIAN TEKNOLOGI, atau IT secara umum, JAWABLAH dengan cerdas berdasarkan pengetahuan umummu, dan set "butuh_update" menjadi false.
        4. Jika pertanyaan terkait Prodi TI UISU TIDAK ADA di data, jawab jujur bahwa CIMAL belum memiliki info tersebut, dan arahkan ke staff akademik. Set nilai "butuh_update" menjadi true.
        5. Jika meminta data sensitif kampus, tolak demi privasi.
        6. Jika sekadar sapaan/umum, jawab natural dan set "butuh_update" menjadi false.
        
        PENTING! Balas HANYA dengan format JSON murni:
        {"jawaban": "isi jawaban teks yang rapi di sini", "butuh_update": false}`;

        let finalAnswer = "";
        let butuhUpdate = false;

        // 3. PROSES AI: GROQ (UTAMA) -> OLLAMA (CADANGAN LOKAL)
        try {
            console.log(`[CHAT TEKS] Sedang berpikir menggunakan Groq (Cloud)...`);
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
            
            try {
                let cleanJson = botReplyRaw.replace(/```json/gi, '').replace(/```/gi, '').trim();
                let parsedData = JSON.parse(cleanJson);
                finalAnswer = parsedData.jawaban || botReplyRaw;
                butuhUpdate = parsedData.butuh_update || false;
            } catch (jsonErr) {
                finalAnswer = botReplyRaw;
            }

            console.log(`✅ [CHAT TEKS] Sukses! Jawaban didapat dari Groq.`);

        } catch (apiError) {
            console.error(`❌ [WARNING] Groq Limit/Error: ${apiError.message}`);
            console.log(`🔄 [CHAT TEKS] Mengalihkan ke Otak Lokal (Ollama)...`);
            
            try {
                const response = await fetch('http://localhost:11434/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: "qwen2.5:1.5b", 
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userMessage }
                        ],
                        stream: false
                    })
                });

                const data = await response.json();
                const botReplyRaw = data.message.content;
                
                try {
                    let cleanJson = botReplyRaw.replace(/```json/gi, '').replace(/```/gi, '').trim();
                    let parsedData = JSON.parse(cleanJson);
                    finalAnswer = parsedData.jawaban || botReplyRaw;
                    butuhUpdate = parsedData.butuh_update || false;
                } catch (jsonErr) {
                    finalAnswer = botReplyRaw; 
                }

                console.log(`✅ [CHAT TEKS] Sukses! Jawaban diselamatkan oleh Ollama Lokal.`);

            } catch (ollamaError) {
                console.error(`❌ [FATAL] Ollama Lokal juga gagal: ${ollamaError.message}`);
                finalAnswer = "Mohon maaf, server AI CIMAL saat ini sedang sibuk. Silakan tanyakan langsung ke bagian Tata Usaha.";
                butuhUpdate = true;
            }
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
                console.log(`📝 [INFO ADMIN] Chat: Pertanyaan baru ditambahkan ke log.`);
            }
        } 

        res.json({ response: finalAnswer });
        
    } catch (error) {
        console.error("Error Sistem di getChatResponse:", error);
        res.status(500).json({ error: "Terjadi kesalahan pada server AI CIMAL." });
    }
};

module.exports = { getChatResponse };
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
        7. Tentukan emosi: [NORMAL, HAPPY, ANGRY, CUTE].
        
        PENTING! Balas HANYA dengan format JSON murni:
        {"jawaban": "isi jawaban teks yang rapi di sini", "butuh_update": false}`;

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
        let finalAnswer = botReplyRaw;
        
        // 3. PARSING JSON DAN LOGIKA PEMBARUAN DATABASE
        try {
            let cleanJson = botReplyRaw.replace(/```json/gi, '').replace(/```/gi, '').trim();
            let parsedData = JSON.parse(cleanJson);
            
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
                
                const newText = userMessage.toLowerCase();
                let isDuplicate = updateList.some(existingQuestion => {
                    const existingText = existingQuestion.toLowerCase();
                    return existingText.includes(newText) || newText.includes(existingText);
                });

                if (!isDuplicate) {
                    updateList.push(userMessage);
                    fs.writeFileSync(updatePath, JSON.stringify(updateList, null, 2));
                    console.log(`[INFO ADMIN] Pertanyaan baru ditambahkan ke pembaruan_database.json: "${userMessage}"`);
                }
            }
        } catch (parseError) {
            console.log(`[WARNING] AI membalas tanpa JSON valid. Teks: ${botReplyRaw}`);
        }

        console.log(`[CHAT TEKS] Jawaban berhasil dibuat: "${finalAnswer.substring(0, 50)}..."`);
        res.json({ response: finalAnswer });
    } catch (error) {
        console.error("Error pada Groq API (Chat):", error);
        res.status(500).json({ error: "Terjadi kesalahan pada server AI CIMAL." });
    }
};

module.exports = { getChatResponse };
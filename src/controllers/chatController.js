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

        // 1. MEMBACA PANGKALAN DATA FAQ (Sama seperti Audio Controller)
        let faqDataString = "";
        try {
            const faqPath = path.join(__dirname, '../data/faq.json');
            faqDataString = fs.readFileSync(faqPath, 'utf8');
        } catch (err) {
            console.error("[WARNING] File faq.json tidak ditemukan untuk Chat, menggunakan pengetahuan dasar.");
        }

        // 2. MERAKIT SYSTEM PROMPT PINTAR
        const systemPrompt = `Kamu adalah CIMAL (Computerized Intelligent Multilingual Academic Liaison), asisten AI pelayanan akademik Prodi Teknik Informatika Fakultas Teknik Universitas Islam Sumatera Utara (UISU).
        
        Data Resmi Prodi:
        ${faqDataString}
        
        Aturan ketat:
        1. Jawab pertanyaan pengguna dengan ramah, jelas, dan ringkas berdasarkan Data Resmi Prodi di atas.
        2. Jika informasi yang ditanyakan tidak ada di dalam data, jawab sesuai pengetahuan umum akademik namun tetap profesional, atau arahkan mahasiswa untuk bertanya ke tata usaha.
        3. Jangan pernah mengarang informasi (halusinasi) terkait jadwal, biaya, atau aturan spesifik yang tidak ada di data.`;

        // 3. MENGIRIM KE GROQ API DENGAN MODEL YANG KOMPATIBEL
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ],
            // LLaMA 3.1 8B Instant sangat cepat, pintar, dan stabil untuk chat berbahasa Indonesia
            model: "llama-3.1-8b-instant", 
            // Temperature disetel rendah (0.2 - 0.3) agar AI fokus pada fakta di file FAQ dan tidak mengarang
            temperature: 0.2, 
            max_tokens: 800,
        });

        const finalAnswer = chatCompletion.choices[0].message.content;

        // Mengirimkan balasan ke aplikasi mobile temanmu
        res.json({ response: finalAnswer });
    } catch (error) {
        console.error("Error pada Groq API (Chat):", error);
        res.status(500).json({ error: "Terjadi kesalahan pada server AI CIMAL." });
    }
};

module.exports = { getChatResponse };
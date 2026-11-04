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

        // 1. MEMBACA PANGKALAN DATA FAQ
        let faqDataString = "";
        try {
            const faqPath = path.join(__dirname, '../data/faq.json');
            faqDataString = fs.readFileSync(faqPath, 'utf8');
        } catch (err) {
            console.error("[WARNING] File faq.json tidak ditemukan untuk Chat.");
        }

        // 2. SYSTEM PROMPT (Disesuaikan agar membalas teks biasa, bukan JSON)
        const systemPrompt = `Kamu adalah CIMAL (Computerized Intelligent Multilingual Academic Liaison), asisten AI pelayanan akademik Prodi Teknik Informatika Universitas Islam Sumatera Utara (UISU).
        
        Data Resmi Prodi:
        ${faqDataString}
        
        Aturan ketat:
        1. Jawab pertanyaan pengguna dengan ramah, jelas, dan ringkas berdasarkan Data Resmi Prodi di atas.
        2. Jangan gunakan format JSON. Balas langsung dengan teks percakapan biasa yang rapi.
        3. Jika informasi yang ditanyakan tidak ada di data, jawab sesuai pengetahuan umum atau arahkan mahasiswa ke Tata Usaha. Jangan mengarang info akademik.`;

        // 3. MENGIRIM KE GROQ API DENGAN MODEL QWEN YANG TERSEDIA
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ],
            // Menggunakan Qwen sesuai dengan yang tersedia di daftar akunmu
            model: "qwen/qwen3.8-27b", 
            temperature: 0.2, 
            max_tokens: 800,
        });

        const finalAnswer = chatCompletion.choices[0].message.content;

        // Mengirimkan balasan berupa teks ke aplikasi mobile
        res.json({ response: finalAnswer });
    } catch (error) {
        console.error("Error pada Groq API (Chat):", error);
        res.status(500).json({ error: "Terjadi kesalahan pada server AI CIMAL." });
    }
};

module.exports = { getChatResponse };
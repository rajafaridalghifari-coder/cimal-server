const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const getChatResponse = async (req, res) => {
    try {
        const userMessage = req.body.message;

        if (!userMessage) {
            return res.status(400).json({ error: "Pesan tidak boleh kosong" });
        }

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    // Prompt khusus untuk CIMAL sebagai asisten prodi
                    content: "Kamu adalah CIMAL (Computerized Intelligent Multilingual Academic Liaison), asisten AI untuk Program Studi Teknik Informatika Fakultas Teknik Universitas Islam Sumatera Utara (UISU). Jawablah pertanyaan seputar akademik dengan ramah, jelas, dan informatif."
                },
                {
                    role: "user",
                    content: userMessage
                }
            ],
            model: "llama3-8b-8192", 
        });

        res.json({ response: chatCompletion.choices[0].message.content });
    } catch (error) {
        console.error("Error pada Groq API:", error);
        res.status(500).json({ error: "Terjadi kesalahan pada server AI CIMAL." });
    }
};

module.exports = { getChatResponse };
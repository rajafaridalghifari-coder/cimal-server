const Groq = require('groq-sdk');
const faq = require('../data/faq.json');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const noDataResponse =
    'Maaf, saya belum memiliki informasi resmi yang cukup untuk menjawabnya. Silakan konfirmasi ke Program Studi Teknik Informatika UISU.';

function normalize(text) {
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatAnswer(answer) {
    return Array.isArray(answer) ? answer.join('\n') : String(answer ?? '');
}

const getChatResponse = async (req, res) => {
    const userMessage =
        typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    if (!userMessage) {
        return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
    }

    const normalizedMessage = normalize(userMessage);
    const matches = faq.filter((item) =>
        Array.isArray(item.keywords) &&
        item.keywords.some((keyword) =>
            normalizedMessage.includes(normalize(keyword)),
        ),
    );

    if (matches.length === 0) {
        return res.json({ response: noDataResponse });
    }

    const reference = matches
        .slice(0, 4)
        .map(
            (item) =>
                `Kata kunci: ${item.keywords.join(', ')}\nInformasi: ${formatAnswer(item.answer)}`,
        )
        .join('\n\n');

    try {
        const chatCompletion = await groq.chat.completions.create({
            model: 'openai/gpt-oss-20b',
            temperature: 0.2,
            messages: [
                {
                    role: 'system',
                    content:
                        'Kamu adalah CIMAL, asisten Teknik Informatika UISU. ' +
                        'Jawab pertanyaan akademik HANYA berdasarkan DATA REFERENSI ' +
                        'yang diberikan. Jangan memakai pengetahuan luar, menambah ' +
                        'fakta, atau menebak. Jika data tidak memuat jawaban, katakan ' +
                        'bahwa informasi resmi belum tersedia. Pertahankan angka, ' +
                        'nama, dan rincian persis seperti pada referensi.',
                },
                {
                    role: 'user',
                    content:
                        `DATA REFERENSI:\n${reference}\n\n` +
                        `PERTANYAAN:\n${userMessage}`,
                },
            ],
        });

        const answer = chatCompletion.choices[0]?.message?.content?.trim();
        if (!answer) {
            return res.json({ response: noDataResponse });
        }

        return res.json({ response: answer });
    } catch (error) {
        console.error('Error pada Groq API:', error);
        return res
            .status(500)
            .json({ error: 'Terjadi kesalahan pada server AI CIMAL.' });
    }
};

module.exports = { getChatResponse };

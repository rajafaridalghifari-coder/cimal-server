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

// PERBAIKAN 1: kata kunci kosong ("") diabaikan.
// Sebelumnya "".includes("") selalu true sehingga satu entri ikut terkirim
// pada SETIAP pertanyaan.
function validKeywords(item) {
    return Array.isArray(item.keywords)
        ? item.keywords.map(normalize).filter((keyword) => keyword.length > 0)
        : [];
}

function toReference(items) {
    return items
        .map(
            (item) =>
                `Topik: ${validKeywords(item).join(', ')}\nInformasi: ${formatAnswer(item.answer)}`,
        )
        .join('\n\n');
}

const getChatResponse = async (req, res) => {
    const userMessage =
        typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    if (!userMessage) {
        return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
    }

    const normalizedMessage = normalize(userMessage);
    const matches = faq.filter((item) =>
        validKeywords(item).some((keyword) => normalizedMessage.includes(keyword)),
    );

    // PERBAIKAN 2: jika tidak ada kata kunci yang cocok (misalnya pertanyaan
    // dengan susunan kata berbeda), seluruh FAQ dikirim sebagai referensi
    // agar LLM tetap dapat menemukan informasi yang relevan.
    const reference =
        matches.length > 0 ? toReference(matches.slice(0, 4)) : toReference(faq);

    try {
        const chatCompletion = await groq.chat.completions.create({
            model: 'openai/gpt-oss-20b',
            temperature: 0.2,
            messages: [
                {
                    role: 'system',
                    content:
                        'Kamu adalah CIMAL, asisten Teknik Informatika UISU. ' +
                        'Jawab pertanyaan dalam bahasa Indonesia HANYA berdasarkan DATA REFERENSI. ' +
                        // PERBAIKAN 3: instruksi diperjelas agar model tidak terlalu cepat menolak.
                        'Pertanyaan pengguna bisa memakai kata yang berbeda dari data ' +
                        '(misalnya "ketua prodi" = "kaprodi", "semester dua" = "semester 2", ' +
                        '"kerja praktek" = "KP"). Jika ada informasi pada DATA REFERENSI yang ' +
                        'menjawab pertanyaan, gunakan informasi tersebut. ' +
                        'Jangan memakai pengetahuan luar, menambah fakta, atau menebak. ' +
                        'Hanya jika DATA REFERENSI benar-benar tidak memuat jawabannya, ' +
                        'katakan bahwa informasi resmi belum tersedia dan sarankan menghubungi ' +
                        'Program Studi Teknik Informatika UISU. ' +
                        'Pertahankan angka, nama, dan rincian persis seperti pada referensi.',
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

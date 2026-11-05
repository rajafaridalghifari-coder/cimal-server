const Groq = require('groq-sdk');
const faq = require('../data/faq.json');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const noDataResponse =
    'Maaf, saya belum memiliki informasi resmi yang cukup untuk menjawabnya. Silakan konfirmasi ke Program Studi Teknik Informatika UISU.';

const MAX_REFERENCES = 4;

// Angka yang ditulis dengan kata diubah menjadi digit,
// misalnya "semester dua" menjadi "semester 2".
const NUMBER_WORDS = {
    satu: '1', dua: '2', tiga: '3', empat: '4',
    lima: '5', enam: '6', tujuh: '7', delapan: '8',
};

// Kata umum yang tidak membantu memilih entri FAQ.
const STOPWORDS = new Set([
    'apa', 'apakah', 'saja', 'yang', 'di', 'ke', 'dari', 'dan', 'atau', 'untuk',
    'dengan', 'pada', 'ini', 'itu', 'ada', 'adalah', 'bisa', 'dapat', 'saya',
    'aku', 'kamu', 'mau', 'ingin', 'kalau', 'jika', 'berapa', 'bagaimana',
    'kapan', 'siapa', 'mana', 'dimana', 'tidak', 'harus', 'seperti', 'punya',
    'program', 'studi', 'prodi', 'teknik', 'informatika', 'uisu', 'cimal',
    'tolong', 'dong', 'ya', 'sih', 'nya', 'lewat', 'oleh', 'sebenarnya',
]);

function normalize(text) {
    return String(text ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map((word) => NUMBER_WORDS[word] ?? word)
        .join(' ');
}

function tokens(text) {
    return normalize(text)
        .split(' ')
        .filter((word) => (word.length > 1 || /^\d$/.test(word)) && !STOPWORDS.has(word));
}

function formatAnswer(answer) {
    return Array.isArray(answer) ? answer.join('\n') : String(answer ?? '');
}

// Entri tanpa kata kunci diabaikan, dan kata kunci kosong ("") dibuang.
// Sebelumnya "".includes("") selalu true sehingga satu entri ikut terkirim
// pada SETIAP pertanyaan.
const entries = faq
    .map((item) => {
        const keywords = Array.isArray(item.keywords)
            ? item.keywords.map(normalize).filter((keyword) => keyword.length > 0)
            : [];
        const text = formatAnswer(item.answer);
        return {
            keywords,
            text,
            keywordTokens: new Set(keywords.flatMap(tokens)),
            answerTokens: new Set(tokens(text)),
        };
    })
    .filter((entry) => entry.keywords.length > 0 && entry.text.trim().length > 0);

// Skor relevansi: kata kunci utuh yang muncul pada pertanyaan bernilai paling
// tinggi; setelah itu kata pertanyaan yang muncul pada kata kunci, lalu kata
// pertanyaan yang muncul pada isi jawaban.
function score(entry, normalizedMessage, messageTokens) {
    let value = 0;
    for (const keyword of entry.keywords) {
        if (` ${normalizedMessage} `.includes(` ${keyword} `)) value += 10;
    }
    for (const word of messageTokens) {
        if (entry.keywordTokens.has(word)) value += 3;
        else if (entry.answerTokens.has(word)) value += 1;
    }
    return value;
}

function selectReferences(message) {
    const normalizedMessage = normalize(message);
    const messageTokens = [...new Set(tokens(message))];
    return entries
        .map((entry) => ({ entry, value: score(entry, normalizedMessage, messageTokens) }))
        .filter((item) => item.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, MAX_REFERENCES)
        .map((item) => item.entry);
}

const getChatResponse = async (req, res) => {
    const userMessage =
        typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    if (!userMessage) {
        return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
    }

    const references = selectReferences(userMessage);
    if (references.length === 0) {
        return res.json({ response: noDataResponse });
    }

    const reference = references
        .map((entry) => `Topik: ${entry.keywords.join(', ')}\nInformasi: ${entry.text}`)
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
                        'Jawab pertanyaan dalam bahasa Indonesia HANYA berdasarkan DATA REFERENSI. ' +
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

module.exports = { getChatResponse, selectReferences };

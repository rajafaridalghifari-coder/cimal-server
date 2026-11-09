
const fs = require('fs');
const path = require('path');

const getChatResponse = async (req, res) => {
    try {
        const userMessage = req.body.message;

        if (!userMessage) {
            return res.status(400).json({
                error: "Pesan tidak boleh kosong"
            });
        }

        console.log(`\n[CHAT TEKS] Pesan masuk dari Mobile App: "${userMessage}"`);

        // ========================================================
        // 1. MEMBACA PANGKALAN DATA FAQ LOKAL
        // ========================================================

        const faqPath = path.join(__dirname, '../data/faq.json');
        let faqList = [];

        try {
            const faqDataString = fs.readFileSync(faqPath, 'utf8');
            faqList = JSON.parse(faqDataString);
        } catch (error) {
            console.error("[WARNING] File faq.json tidak ditemukan untuk Chat.");
        }

        // ========================================================
        // 2. SMART SEARCH
        // ========================================================

        console.log(`[PROSES] Mencari kecocokan di database lokal...`);

        // Normalisasi teks
        const normalizeText = (text) => {
            return String(text || "")
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^\p{L}\p{N}]+/gu, " ")
                .trim()
                .replace(/\s+/g, " ");
        };

        // Menyamakan variasi penulisan dan singkatan
        const normalizeQuestion = (text) => {
            let result = normalizeText(text);

            const replacements = [
                [/\bdua\b/g, "2"],
                [/\btiga\b/g, "3"],
                [/\bempat\b/g, "4"],
                [/\blima\b/g, "5"],
                [/\benam\b/g, "6"],
                [/\btujuh\b/g, "7"],
                [/\bdelapan\b/g, "8"],
                [/\bpertama\b/g, "1"],
                [/\bawal\b/g, "1"],
                [/\bterakhir\b/g, "8"],
                [/\bpbo\b/g, "pemrograman berorientasi objek"],
                [/\bkkn\b/g, "kkn tematik"],
                [/\bkaprodi\b/g, "ketua program studi"],
                [/\bketua prodi\b/g, "ketua program studi"],
                [/\bkepala prodi\b/g, "ketua program studi"],
                [/\bstaff\b/g, "staf"]
            ];

            for (const [pattern, replacement] of replacements) {
                result = result.replace(pattern, replacement);
            }

            return result.replace(/\s+/g, " ").trim();
        };

        const normalizedQuestion = normalizeQuestion(userMessage);

        // Merapikan jawaban FAQ
        const formatAnswer = (answerData) => {
            if (Array.isArray(answerData)) {
                return answerData.map((text, index) => {
                    if (/^\d+\./.test(String(text).trim())) {
                        return text;
                    }

                    return `${index + 1}. ${text}`;
                }).join("\n");
            }

            return typeof answerData === "string"
                ? answerData
                : "";
        };

        // Variabel wajib dideklarasikan sebelum pencarian
        let combinedAnswers = [];
        let isFound = false;

        // --------------------------------------------------------
        // A. DETEKSI VARIASI PERTANYAAN VISI
        // --------------------------------------------------------

        const visionPatterns = [
            "visi",
            "ingin menjadi seperti apa",
            "akan menjadi seperti apa",
            "cita cita program studi",
            "arah pengembangan program studi",
            "target program studi tahun 2027",
            "tujuan jangka panjang program studi"
        ];

        const isVisionQuestion = visionPatterns.some(pattern =>
            normalizedQuestion.includes(normalizeQuestion(pattern))
        );

        if (isVisionQuestion) {
            const visionItem = faqList.find(item =>
                Array.isArray(item.keywords) &&
                item.keywords.some(keyword =>
                    normalizeText(keyword) === "visi"
                )
            );

            if (visionItem) {
                combinedAnswers.push(formatAnswer(visionItem.answer));
                isFound = true;

                console.log(
                    "[SMART SEARCH] Pertanyaan dikenali sebagai VISI."
                );
            }
        }

        // --------------------------------------------------------
        // B. PENCARIAN KHUSUS NAMA MATA KULIAH
        // --------------------------------------------------------

        const courseAliases = [
            "struktur data",
            "pemrograman berorientasi objek",
            "kecerdasan buatan",
            "pemrograman web",
            "kkn tematik"
        ];

        const asksCourseSemester =
            /semester|diambil|dipelajari|diajarkan|dilaksanakan|mata kuliah apa|matkul apa/.test(normalizedQuestion);

        let matchedCourse = courseAliases.find(course =>
            normalizedQuestion.includes(course)
        );

        if (!isFound && matchedCourse && asksCourseSemester) {
            const foundSemesters = [];

            for (const item of faqList) {
                if (!item || !Array.isArray(item.keywords)) continue;

                const semesterKeyword = item.keywords.find(keyword =>
                    /^mata kuliah semester \d+$/.test(normalizeText(keyword))
                );

                if (!semesterKeyword) continue;

                const semesterMatch = normalizeText(semesterKeyword)
                    .match(/semester (\d+)/);

                if (!semesterMatch) continue;

                const semesterNumber = semesterMatch[1];

                const answerItems = Array.isArray(item.answer)
                    ? item.answer
                    : [item.answer];

                const courseExists = answerItems.some(answer =>
                    normalizeText(answer).includes(matchedCourse)
                );

                if (courseExists) {
                    foundSemesters.push(semesterNumber);
                }
            }

            if (foundSemesters.length > 0) {
                const uniqueSemesters = [...new Set(foundSemesters)];

                const semesterText = uniqueSemesters
                    .map(number => `semester ${number}`)
                    .join(" dan ");

                combinedAnswers.push(
                    `Mata kuliah ${matchedCourse} terdapat pada ${semesterText}.`
                );

                isFound = true;

                console.log(
                    `[SMART SEARCH] Mata kuliah "${matchedCourse}" ditemukan pada ${semesterText}.`
                );
            }
        }

        // --------------------------------------------------------
        // C. PENCARIAN SEMESTER BERDASARKAN NOMOR
        // --------------------------------------------------------

        if (!isFound) {
            const semesterMatch = normalizedQuestion.match(
                /semester ([1-8])/
            );

            if (semesterMatch) {
                const semesterNumber = semesterMatch[1];

                const asksSemesterCourses =
                    /mata kuliah|matkul|belajar apa|pelajaran/.test(normalizedQuestion);

                const asksSemesterSKS =
                    /sks|satuan kredit/.test(normalizedQuestion);

                const semesterItem = faqList.find(item =>
                    Array.isArray(item.keywords) &&
                    item.keywords.some(keyword =>
                        normalizeText(keyword) ===
                        `mata kuliah semester ${semesterNumber}`
                    )
                );

                if (semesterItem && (asksSemesterCourses || asksSemesterSKS)) {
                    if (asksSemesterSKS) {
                        const answerItems = Array.isArray(semesterItem.answer)
                            ? semesterItem.answer
                            : [semesterItem.answer];

                        const sksAnswer = answerItems.find(answer =>
                            /jumlah sks semester/i.test(answer)
                        );

                        if (sksAnswer) {
                            combinedAnswers.push(sksAnswer);
                            isFound = true;
                        }
                    } else {
                        combinedAnswers.push(
                            `Berikut daftar mata kuliah semester ${semesterNumber}:\n` +
                            formatAnswer(semesterItem.answer)
                        );

                        isFound = true;
                    }
                }
            }
        }

        // --------------------------------------------------------
        // D. SMART SEARCH KEYWORD UMUM
        // --------------------------------------------------------

        if (!isFound) {
            const stopWords = new Set([
                "apa", "apakah", "saja", "yang", "dan", "atau",
                "di", "ke", "dari", "untuk", "dengan", "bagaimana",
                "gimana", "siapa", "berapa", "kapan", "dimana",
                "mana", "adalah", "itu", "ini", "tentang",
                "tolong", "jelaskan", "sebutkan", "mohon",
                "informasi", "sekarang", "bisa", "tidak"
            ]);

            const questionWords = [
                ...new Set(
                    normalizedQuestion
                        .split(" ")
                        .filter(word => word.length > 2 && !stopWords.has(word))
                )
            ];

            let bestMatch = null;
            let highestScore = 0;

            for (const item of faqList) {
                if (!item || !Array.isArray(item.keywords)) continue;

                for (const keyword of item.keywords) {
                    if (typeof keyword !== "string") continue;

                    const normalizedKeyword = normalizeQuestion(keyword);

                    if (!normalizedKeyword) continue;

                    const keywordWords = normalizedKeyword
                        .split(" ")
                        .filter(word => word.length > 2);

                    let score = 0;

                    if (normalizedQuestion === normalizedKeyword) {
                        score = 100;
                    } else if (
                        ` ${normalizedQuestion} `.includes(
                            ` ${normalizedKeyword} `
                        )
                    ) {
                        score = 80 + keywordWords.length;
                    } else {
                        const matchedWords = keywordWords.filter(word =>
                            questionWords.includes(word)
                        );

                        const coverage = keywordWords.length > 0
                            ? matchedWords.length / keywordWords.length
                            : 0;

                        if (
                            matchedWords.length >= 2 &&
                            coverage >= 0.6
                        ) {
                            score = 40 + coverage * 20 + matchedWords.length;
                        } else if (
                            keywordWords.length === 1 &&
                            matchedWords.length === 1
                        ) {
                            score = 35;
                        }
                    }

                    if (score > highestScore) {
                        highestScore = score;
                        bestMatch = item;
                    }
                }
            }

            if (bestMatch && highestScore >= 35) {
                combinedAnswers.push(formatAnswer(bestMatch.answer));
                isFound = true;

                console.log(
                    `[SMART SEARCH] FAQ ditemukan dengan skor ${highestScore}.`
                );
            }
        }

        // ========================================================
        // 3. MENYIAPKAN KONTEKS UNTUK OLLAMA
        // ========================================================

        let butuhUpdate = !isFound;

        let konteksSpesifik = isFound
            ? combinedAnswers.join("\n\n")
            : "TIDAK ADA DATA DI DATABASE.";

        console.log(
            isFound
                ? `[INFO] Informasi ditemukan: ${konteksSpesifik.substring(0, 120)}`
                : `[INFO] Pertanyaan belum ditemukan dalam FAQ.`
        );

        // ========================================================
        // 4. PROSES AI
        // ========================================================

        const systemPrompt = `Kamu adalah CIMAL (Cerdas Informatif Mesin Automasi Layanan), asisten AI pelayanan akademik Prodi Teknik Informatika UISU.

Tugas utamamu HANYA SATU: Jawab pertanyaan pengguna MENGGUNAKAN DATA REFERENSI.

ATURAN KETAT ANTI-HALUSINASI:
1. Jawab ramah, ringkas, dan sopan.
2. Kamu adalah CIMAL (Cerdas Informatif Mesin Automasi Layanan) jika ada yang menyebut cimal berarti itu kamu.
3. JANGAN PERNAH menambahkan topik, istilah, atau kalimat pembuka yang tidak ada hubungannya dengan pertanyaan pengguna.
4. Jika pengguna bertanya soal Uang Kuliah, jawab soal Uang Kuliah. Jika Skripsi, jawab Skripsi. DILARANG KERAS mencampuradukkan topik (misal: menyebut Kerja Praktik/KP saat ditanya hal lain).
5. Langsung ke inti jawaban sesuai DATA REFERENSI dengan ramah dan natural.
6. PENGECUALIAN: Jika pengguna bertanya tentang INFORMASI UMUM, ILMU KOMPUTER, PENGERTIAN TEKNOLOGI, atau IT secara umum, JAWABLAH dengan cerdas berdasarkan pengetahuan umummu, dan set "butuh_update" menjadi false.
7. Jika Data Referensi berbentuk daftar (poin-poin, angka 1, 2, 3), KAMU WAJIB MENYAJIKANNYA KEMBALI DALAM BENTUK DAFTAR YANG RAPI KE BAWAH. JANGAN MENGGABUNGKANNYA MENJADI SATU PARAGRAF. Bacakan SECARA LENGKAP poin per poin. JANGAN DIGABUNG.
8. Jika DATA REFERENSI berbunyi "TIDAK ADA DATA DI DATABASE", sampaikan mohon maaf dan arahkan mahasiswa ke Tata Usaha Prodi.
9. Sumber referensi akademik mutlak dari faq.json.
10. Tentukan emosi yang sesuai (NORMAL, HAPPY, ANGRY, atau CUTE).

ATURAN TAMBAHAN PEMAHAMAN DAN PARAFRASE:

11. Pahami maksud pertanyaan pengguna, bukan hanya kata-kata yang digunakan.
12. Jika pengguna menggunakan susunan kalimat berbeda tetapi memiliki maksud yang sama dengan informasi dalam DATA REFERENSI, gunakan informasi tersebut untuk menjawab.
13. WAJIB memparafrasekan jawaban FAQ menggunakan kalimat sendiri yang natural, komunikatif, dan mudah dipahami.
14. Jangan hanya menyalin isi FAQ secara mentah, kecuali untuk nama resmi, istilah akademik, angka, atau informasi yang harus dipertahankan.
15. Pertahankan seluruh makna dan fakta dari DATA REFERENSI.
16. Jangan mengubah nama orang, jabatan, nominal biaya, jumlah SKS, semester, persyaratan, atau informasi penting lainnya.
17. Jika DATA REFERENSI berbentuk daftar, pertahankan seluruh poin dan urutannya. Susunan kalimat boleh diperbaiki tanpa menghilangkan informasi.
18. Buat kalimat pembuka yang sesuai dengan topik pertanyaan pengguna.
19. Hindari pembuka yang sama secara berulang dan jangan menggunakan pembuka generik yang tidak relevan.
20. DILARANG menambahkan fakta, asumsi, atau informasi yang tidak tersedia dalam DATA REFERENSI.

21. Jangan mengubah nama resmi Program Studi Teknik Informatika UISU menjadi nama lain.
22. Jangan mengubah istilah, nama mata kuliah, atau nama jabatan yang tercantum dalam DATA REFERENSI.
23. Jika DATA REFERENSI berisi angka atau daftar, pertahankan nilai dan seluruh urutannya.

WAJIB membalas MENGGUNAKAN FORMAT JSON SAJA seperti ini:
{
  "emotion": "NORMAL",
  "jawaban": "Isi jawabanmu di sini",
  "butuh_update": ${butuhUpdate}
}`;

        let finalAnswer = "";

        try {
            console.log(`[CHAT TEKS] Sedang merangkai kalimat (Ollama)...`);

            const ollamaUrl =
                process.env.OLLAMA_URL || "http://localhost:11434/api/chat";

            const ollamaModel =
                process.env.OLLAMA_MODEL || "qwen2.5:1.5b";

            const response = await fetch(ollamaUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: ollamaModel,
                    messages: [
                        {
                            role: "system",
                            content: systemPrompt
                        },
                        {
                            role: "user",
                            content: `DATA REFERENSI:\n"${konteksSpesifik}"\n\nPERTANYAAN PENGGUNA:\n"${userMessage}"`
                        }
                    ],
                    format: "json",
                    stream: false,
                    options: {
                        temperature: 0.1
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`Ollama HTTP Error: ${response.status}`);
            }

            const data = await response.json();
            const botReplyRaw = data.message.content;

            let cleanJson = botReplyRaw
                .replace(/```json/gi, '')
                .replace(/```/gi, '')
                .trim();

            let parsedData = JSON.parse(cleanJson);

            finalAnswer = parsedData.jawaban || botReplyRaw;

        } catch (apiError) {
            console.error(
                `[WARNING] Ollama Error / Ngrok Mati! Beralih ke teks lokal...`,
                apiError
            );

            finalAnswer = isFound
                ? konteksSpesifik
                : "Mohon maaf, server CIMAL saat ini sedang sibuk. Silakan tanyakan ke Tata Usaha.";
        }

        // ========================================================
        // 5. LOGIKA MENYIMPAN PERTANYAAN TAK TERJAWAB
        // ========================================================

        if (
            butuhUpdate === true ||
            finalAnswer.includes("mengalami gangguan") ||
            finalAnswer.includes("Tata Usaha")
        ) {
            const updatePath = path.join(
                __dirname,
                '../data/pembaruan_database.json'
            );

            let updateList = [];

            if (fs.existsSync(updatePath)) {
                try {
                    updateList = JSON.parse(
                        fs.readFileSync(updatePath, 'utf8')
                    );
                } catch (e) {
                    updateList = [];
                }
            }

            const newText = userMessage.toLowerCase();

            let isDuplicate = updateList.some(existingQuestion => {
                const existingText = existingQuestion.toLowerCase();

                return (
                    existingText.includes(newText) ||
                    newText.includes(existingText)
                );
            });

            if (!isDuplicate) {
                updateList.push(userMessage);

                fs.writeFileSync(
                    updatePath,
                    JSON.stringify(updateList, null, 2)
                );

                console.log(
                    `[INFO ADMIN] Chat: Pertanyaan baru disimpan ke pembaruan_database.json: "${userMessage}"`
                );
            }
        }

        console.log(
            `[CHAT TEKS] Jawaban berhasil dibuat: "${finalAnswer.substring(0, 70)}..."`
        );

        res.json({
            response: finalAnswer
        });

    } catch (error) {
        console.error("Error pada AI API (Chat):", error);

        res.status(500).json({
            error: "Terjadi kesalahan pada server AI CIMAL."
        });
    }
};

module.exports = { getChatResponse };

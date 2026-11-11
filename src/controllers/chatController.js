
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

      
        // ========================================================
        // 4. PROSES AI - OLLAMA DENGAN PENGAMAN FAQ
        // ========================================================

        const systemPrompt = `Kamu adalah CIMAL (Cerdas Informatif Mesin Automasi Layanan), asisten AI pelayanan akademik Program Studi Teknik Informatika UISU.

TUGAS UTAMA:
Menghasilkan jawaban yang natural dan komunikatif berdasarkan DATA REFERENSI dari FAQ.

ATURAN KETAT ANTI-HALUSINASI:

1. DATA REFERENSI adalah satu-satunya sumber kebenaran informasi akademik.
2. DILARANG menggunakan pengetahuan internal model untuk menambahkan informasi akademik yang tidak terdapat dalam DATA REFERENSI.
3. DILARANG membuat, menebak, atau mengarang informasi.
4. Jawab hanya sesuai topik yang ditanyakan pengguna.
5. Jangan mencampurkan informasi dari topik FAQ yang berbeda.
6. Jangan mengubah nama orang, jabatan, nama resmi program studi, nama mata kuliah, nominal uang, jumlah SKS, semester, persyaratan, tanggal, dan angka lainnya.
7. Jangan menghilangkan informasi penting dari DATA REFERENSI.
8. Jika DATA REFERENSI berbentuk daftar, pertahankan seluruh item, isi, dan urutannya. Jangan menghilangkan atau menggabungkan item.
9. Jika DATA REFERENSI tidak tersedia, jangan membuat jawaban sendiri.
10. Gunakan bahasa Indonesia yang sopan, ramah, ringkas, dan mudah dipahami.

ATURAN PARAFRASE:

11. Pahami maksud pertanyaan pengguna meskipun susunan kalimatnya berbeda.
12. Buat jawaban dengan kalimat yang natural dan tidak harus sama persis dengan pertanyaan pengguna.
13. Parafrasekan susunan kalimat berdasarkan DATA REFERENSI tanpa mengubah makna dan fakta.
14. Nama resmi, istilah akademik, angka, nominal, jumlah SKS, semester, serta persyaratan harus dipertahankan.
15. Untuk jawaban berbentuk daftar, pertahankan teks setiap item secara utuh dan urutannya. Kalimat pembuka boleh dibuat lebih natural.
16. Jangan menambahkan pembuka yang tidak relevan.
17. Jangan menyimpulkan sesuatu yang tidak disebutkan dalam DATA REFERENSI.
18. Jika informasi tidak tersedia, sampaikan bahwa informasi belum tersedia dan arahkan pengguna ke Tata Usaha Prodi.
19. Tentukan emosi yang sesuai: NORMAL, HAPPY, ANGRY, atau CUTE.

FORMAT WAJIB:
Kembalikan JSON yang valid saja:
{
  "emotion": "NORMAL",
  "jawaban": "Jawaban berdasarkan DATA REFERENSI",
  "butuh_update": ${butuhUpdate}
}`;

        // Mengambil fakta penting berupa angka dan satuan.
        // Pemeriksaan ini membantu mendeteksi perubahan fakta oleh LLM.
        const extractProtectedFacts = (text) => {
            const source = String(text || "");

            const patterns = [
                /\bRp\.?\s*\d[\d.,]*/gi,
                /\bIPK\s*[:=]?\s*\d+(?:[.,]\d+)?/gi,
                /\bsemester\s+\d+\b/gi,
                /\b\d+(?:[.,]\d+)?\s*(?:SKS|tahun|bulan|minggu|hari|jam|kali|orang)\b/gi,
                /\b20\d{2}\b/g
            ];

            const facts = [];

            for (const pattern of patterns) {
                const matches = source.match(pattern) || [];
                facts.push(...matches);
            }

            return [...new Set(
                facts.map(fact => normalizeText(fact))
            )];
        };

        // Mengambil item daftar bernomor.
        const extractNumberedItems = (text) => {
            return String(text || "")
                .split("\n")
                .filter(line => /^\s*\d+\.\s+/.test(line))
                .map(line =>
                    normalizeText(line.replace(/^\s*\d+\.\s*/, ""))
                );
        };

        // Memeriksa apakah fakta penting tetap dipertahankan.
        const validateLLMAnswer = (source, generated) => {
            const sourceFacts = extractProtectedFacts(source);
            const generatedFacts = extractProtectedFacts(generated);

            const missingFacts = sourceFacts.filter(
                fact => !generatedFacts.includes(fact)
            );

            const additionalFacts = generatedFacts.filter(
                fact => !sourceFacts.includes(fact)
            );

            const sourceItems = extractNumberedItems(source);
            const generatedItems = extractNumberedItems(generated);

            const missingItems = sourceItems.filter(
                item => !generatedItems.some(
                    generatedItem => generatedItem.includes(item)
                )
            );

            const listCountMismatch =
                sourceItems.length > 0 &&
                sourceItems.length !== generatedItems.length;

            if (
                missingFacts.length > 0 ||
                additionalFacts.length > 0 ||
                missingItems.length > 0 ||
                listCountMismatch
            ) {
                console.warn("[VALIDASI LLM] Jawaban tidak sesuai FAQ.", {
                    missingFacts,
                    additionalFacts,
                    missingItems,
                    listCountMismatch
                });

                return false;
            }

            return true;
        };

        let finalAnswer = "";

        // Jika FAQ tidak ditemukan, jangan izinkan model mengarang jawaban.
        if (!isFound) {
            finalAnswer =
                "Mohon maaf, informasi tersebut belum tersedia dalam database FAQ. Silakan menghubungi Tata Usaha Program Studi Teknik Informatika UISU untuk mendapatkan informasi lebih lanjut.";
        } else {
            try {
                console.log("[CHAT TEKS] Ollama sedang memparafrasekan jawaban FAQ...");

                const ollamaUrl =
                    process.env.OLLAMA_URL ||
                    "http://localhost:11434/api/chat";

                const ollamaModel =
                    process.env.OLLAMA_MODEL ||
                    "qwen2.5:1.5b";

                const response = await fetch(ollamaUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
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
                                content:
                                    `DATA REFERENSI FAQ:\n${konteksSpesifik}\n\n` +
                                    `PERTANYAAN PENGGUNA:\n${userMessage}\n\n` +
                                    `Buat jawaban yang natural berdasarkan FAQ. ` +
                                    `Jangan mengubah fakta, angka, atau isi daftar.`
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
                    throw new Error(
                        `Ollama HTTP Error: ${response.status}`
                    );
                }

                const data = await response.json();

                const botReplyRaw = data?.message?.content;

                if (!botReplyRaw) {
                    throw new Error("Respons Ollama kosong.");
                }

                const cleanJson = botReplyRaw
                    .replace(/```json/gi, "")
                    .replace(/```/gi, "")
                    .trim();

                const parsedData = JSON.parse(cleanJson);

                const generatedAnswer =
                    typeof parsedData.jawaban === "string"
                        ? parsedData.jawaban.trim()
                        : "";

                if (!generatedAnswer) {
                    throw new Error("Jawaban LLM tidak valid.");
                }

                // Validasi hasil parafrase dengan FAQ.
                const isValid = validateLLMAnswer(
                    konteksSpesifik,
                    generatedAnswer
                );

                if (isValid) {
                    finalAnswer = generatedAnswer;

                    console.log(
                        "[VALIDASI LLM] Jawaban sesuai dengan fakta FAQ."
                    );
                } else {
                    // Jika hasil LLM berubah, gunakan sumber FAQ.
                    finalAnswer = konteksSpesifik;

                    console.warn(
                        "[VALIDASI LLM] Menggunakan jawaban asli FAQ sebagai fallback."
                    );
                }

            } catch (apiError) {
                console.error(
                    "[WARNING] Ollama gagal memproses jawaban FAQ:",
                    apiError
                );

                // Fallback saat server AI gagal.
                finalAnswer = konteksSpesifik;
            }
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

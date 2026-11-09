const fs = require('fs');
const path = require('path');

const getChatResponse = async (req, res) => {
    try {
        const userMessage = req.body.message;

        if (!userMessage) {
            return res.status(400).json({ error: "Pesan tidak boleh kosong" });
        }

        console.log(`\n[CHAT TEKS] Pesan masuk dari Mobile App: "${userMessage}"`);

        // 1. MEMBACA PANGKALAN DATA FAQ LOKAL
        const faqPath = path.join(__dirname, '../data/faq.json');
        let faqList = [];
        try {
            const faqDataString = fs.readFileSync(faqPath, 'utf8');
            faqList = JSON.parse(faqDataString);
        } catch (err) {
            console.error("[WARNING] File faq.json tidak ditemukan untuk Chat.");
        }

        // ========================================================
        // 2. SMART SEARCH (MULTITASKING & AUTO-NUMBERING)
        // ========================================================
        console.log(`[PROSES] Mencari kecocokan di database lokal...`);
        const userTeksLower = userMessage.toLowerCase();
        
        let exactMatches = []; 
        let highestPartialScore = 0;
        let bestPartialMatch = null;

        for (let item of faqList) {
            let score = 0;
            let firstMentionIndex = 99999; 
            const keywords = item.keywords || [];
            
            for (let kw of keywords) {
                const kwLower = kw.toLowerCase();
                const indexPosisi = userTeksLower.indexOf(kwLower);
                
                if (indexPosisi !== -1) {
                    score += 10; 
                    if (indexPosisi < firstMentionIndex) {
                        firstMentionIndex = indexPosisi;
                    }
                }

                const kataUser = userTeksLower.split(" ");
                for (let kata of kataUser) {
                    if (kata.length > 3 && kwLower.includes(kata)) { 
                        score += 1;
                    }
                }
            }

            // MENYIMPAN NILAI 'SCORE' UNTUK DISORTIR NANTI
            if (score >= 10) {
                exactMatches.push({ answer: item.answer, score: score, posisi: firstMentionIndex });
            } else if (score > 0 && score > highestPartialScore) {
                highestPartialScore = score;
                bestPartialMatch = item.answer;
            }
        }

        // Fungsi khusus untuk merapikan Array dan menambahkan nomor otomatis
        const formatAnswer = (answerData) => {
            if (Array.isArray(answerData)) {
                let numberedArray = answerData.map((teks, index) => {
                    if (/^\d+\./.test(teks.trim())) {
                        return teks; 
                    } else {
                        return `${index + 1}. ${teks}`; 
                    }
                });
                return numberedArray.join('\n');
            }
            return answerData;
        };

        let combinedAnswers = [];
        let isFound = false;

        // LOGIKA PENYARINGAN KETAT ANTI NGAWUR (TOP 1 MATCH SAJA)
        if (exactMatches.length > 0) {
            isFound = true;
            // Urutkan berdasarkan skor paling tinggi
            exactMatches.sort((a, b) => {
                if (b.score === a.score) return a.posisi - b.posisi;
                return b.score - a.score;
            });
            // HANYA AMBIL 1 TOPIK TERATAS AGAR OLLAMA FOKUS
            combinedAnswers.push(formatAnswer(exactMatches[0].answer)); 
            
        } else if (bestPartialMatch) {
            isFound = true;
            combinedAnswers.push(formatAnswer(bestPartialMatch));
        }

        let butuhUpdate = !isFound;
        let konteksSpesifik = isFound ? combinedAnswers.join('\n\n') : "TIDAK ADA DATA DI DATABASE.";
        console.log(isFound ? `[INFO] Topik paling relevan ditemukan dan dirapikan.` : `[INFO] Pertanyaan baru!`);

        // ========================================================
        // 3. PROSES AI (MEMPERHALUS BAHASA DARI KONTEKS)
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
        7. Jika Data Referensi berbentuk daftar (poin-poin, angka 1, 2, 3), KAMU WAJIB MENYAJIKANNYA KEMBALI DALAM BENTUK DAFTAR YANG RAPI KE BAWAH. JANGAN MENGGABUNGKANNYA MENJADI SATU PARAGRAF. bacakan SECARA LENGKAP poin per poin. JANGAN DIGABUNG.
        8. Jika DATA REFERENSI berbunyi "TIDAK ADA DATA DI DATABASE", sampaikan mohon maaf dan arahkan mahasiswa ke Tata Usaha Prodi.
        9. Sumber referensi akademik mutlak dari faq.json
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


WAJIB membalas MENGGUNAKAN FORMAT JSON SAJA seperti ini:
{
  "emotion": "NORMAL",
  "jawaban": "Isi jawabanmu di sini",
  "butuh_update": ${butuhUpdate}
}`;

        let finalAnswer = "";

        try {
            console.log(`[CHAT TEKS] Sedang merangkai kalimat (Ollama)...`);
            const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434/api/chat";
            const ollamaModel = process.env.OLLAMA_MODEL || "qwen2.5:1.5b"; 

            const response = await fetch(ollamaUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: ollamaModel,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: `DATA REFERENSI:\n"${konteksSpesifik}"\n\nPERTANYAAN PENGGUNA:\n"${userMessage}"` }
                    ],
                    format: "json", 
                    stream: false,
                    options: { temperature: 0.1 }
                })
            });

            if (!response.ok) throw new Error(`Ollama HTTP Error: ${response.status}`);

            const data = await response.json();
            const botReplyRaw = data.message.content;
            
            let cleanJson = botReplyRaw.replace(/```json/gi, '').replace(/```/gi, '').trim();
            let parsedData = JSON.parse(cleanJson);
            
            finalAnswer = parsedData.jawaban || botReplyRaw;

        } catch (apiError) {
            console.error(`[WARNING] Ollama Error / Ngrok Mati! Beralih ke teks lokal...`);
            finalAnswer = isFound ? konteksSpesifik : "Mohon maaf, server cimal saat ini sedang sibuk. Silakan tanyakan ke Tata Usaha.";
        }
        
        // ========================================================
        // 4. LOGIKA MENYIMPAN PERTANYAAN TAK TERJAWAB
        // ========================================================
        if (butuhUpdate === true || finalAnswer.includes("mengalami gangguan") || finalAnswer.includes("Tata Usaha")) {
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
                console.log(`[INFO ADMIN] Chat: Pertanyaan baru disimpan ke pembaruan_database.json: "${userMessage}"`);
            }
        } 

        console.log(`[CHAT TEKS] Jawaban berhasil dibuat: "${finalAnswer.substring(0, 70)}..."`);
        res.json({ response: finalAnswer });
        
    } catch (error) {
        console.error("Error pada AI API (Chat):", error);
        res.status(500).json({ error: "Terjadi kesalahan pada server AI CIMAL." });
    }
};

module.exports = { getChatResponse };

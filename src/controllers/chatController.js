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
        // 2. SMART SEARCH (MENCARI JAWABAN DI DATABASE SEBELUM KE AI)
        // ========================================================
        console.log(`[PROSES] Mencari kecocokan di database lokal...`);
        const userTeksLower = userMessage.toLowerCase();
        let bestMatchInfo = "";
        let highestScore = 0;

        for (let item of faqList) {
            let score = 0;
            const keywords = item.keywords || [];
            
            for (let kw of keywords) {
                const kwLower = kw.toLowerCase();
                
                if (userTeksLower.includes(kwLower) || kwLower.includes(userTeksLower)) {
                    score += 10; 
                }

                const kataUser = userTeksLower.split(" ");
                for (let kata of kataUser) {
                    if (kata.length > 3 && kwLower.includes(kata)) { 
                        score += 1;
                    }
                }
            }

            if (score > highestScore) {
                highestScore = score;
                // PERBAIKAN: Tangani jawaban berbentuk array agar rapi (pakai \n)
                if (Array.isArray(item.answer)) {
                    bestMatchInfo = item.answer.join('\n');
                } else {
                    bestMatchInfo = item.answer;
                }
            }
        }

        let butuhUpdate = false;
        let konteksSpesifik = "";

        if (highestScore > 0 && bestMatchInfo) {
            konteksSpesifik = bestMatchInfo;
            console.log(`[INFO] Jawaban FAQ ditemukan (Skor: ${highestScore}). Menyiapkan untuk diperhalus Ollama...`);
        } else {
            butuhUpdate = true;
            konteksSpesifik = "TIDAK ADA DATA DI DATABASE.";
            console.log(`[INFO] Pertanyaan baru! Tidak ada di FAQ.`);
        }

        // ========================================================
        // 3. PROSES AI (MEMPERHALUS BAHASA DARI KONTEKS YANG DITEMUKAN)
        // ========================================================
        const systemPrompt = `Kamu adalah CIMAL, asisten AI pelayanan akademik Prodi Teknik Informatika UNIVERSITAS ISLAM SUMATERA UTARA (UISU).
        
        Tugas utamamu HANYA SATU: Jawab pertanyaan pengguna MENGGUNAKAN DATA REFERENSI yang diberikan di bawah ini.
        
        Aturan Penting:
        1. Jawab ramah, ringkas, dan sopan. 
        2. DILARANG KERAS mengarang informasi akademik. Jika jawaban tidak ada di Data Resmi di atas, jangan mengarang.
        3. PENGECUALIAN: Jika pengguna bertanya tentang INFORMASI UMUM, ILMU KOMPUTER, PENGERTIAN TEKNOLOGI, atau IT secara umum, JAWABLAH dengan cerdas berdasarkan pengetahuan umummu, dan set "butuh_update" menjadi false.
        4. Jika pertanyaan terkait akademik TIDAK ADA di data resmi, jawab jujur bahwa CIMAL belum memiliki info tersebut, dan arahkan ke staff akademik. Set nilai "butuh_update" menjadi true.
        5. Jika meminta data sensitif kampus, tolak demi privasi.
        6. Jika Data Referensi berbentuk daftar (poin-poin, angka 1, 2, 3), KAMU WAJIB MENYAJIKANNYA KEMBALI DALAM BENTUK DAFTAR YANG RAPI KE BAWAH. JANGAN MENGGABUNGKANNYA MENJADI SATU PARAGRAF.
        7. Berikan kalimat pembuka sebelum memberikan daftar (contoh: "Berikut adalah materi KP di Teknik Informatika UISU:").
        8. Jika Data Referensi berisi beberapa informasi (seperti Visi dan Misi), jelaskan KEDUANYA dengan lengkap, jangan dipotong.
        9. Tentukan emosi yang sesuai: [NORMAL, HAPPY, ANGRY, CUTE].
        10. Wajib balas dengan JSON murni:
        {"emotion": "NORMAL", "jawaban": "teks jawaban", "butuh_update": ${butuhUpdate}}`;

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
            console.error(`[WARNING] Ollama Error / Ngrok Mati! Beralih ke teks mentah lokal...`);
            finalAnswer = highestScore > 0 ? bestMatchInfo : "Mohon maaf, server cimal saat ini sedang sibuk. Silakan tanyakan ke Tata Usaha.";
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
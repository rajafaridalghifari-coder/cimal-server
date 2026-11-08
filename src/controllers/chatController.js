const fs = require('fs');
const path = require('path');

const getChatResponse = async (req, res) => {
    try {
        const userMessage = req.body.message;

        if (!userMessage) {
            return res.status(400).json({ error: "Pesan tidak boleh kosong" });
        }

        console.log(`\n[CHAT TEKS] Pesan masuk dari Mobile App: "${userMessage}"`);

        // 1. MEMBACA PANGKALAN DATA FAQ
        let faqDataString = "";
        try {
            const faqPath = path.join(__dirname, '../data/faq.json');
            faqDataString = fs.readFileSync(faqPath, 'utf8');
        } catch (err) {
            console.error("[WARNING] File faq.json tidak ditemukan untuk Chat.");
        }

        // 2. SYSTEM PROMPT (ATURAN BARU)
        const systemPrompt = `Kamu adalah CIMAL (Cerdas Informatif Mesin Automasi Layanan), asisten AI pelayanan akademik Prodi Teknik Informatika Universitas Islam Sumatera Utara (UISU).
        
        Data Resmi Prodi:
        ${faqDataString}
        
        Aturan ketat:
        1. Jawab ramah, ringkas, dan sopan. 
        2. DILARANG KERAS mengarang informasi akademik jika TIDAK ADA di Data Resmi Prodi.
        3. PENGECUALIAN: Jika pengguna bertanya tentang INFORMASI UMUM, ILMU KOMPUTER, PENGERTIAN TEKNOLOGI, atau IT secara umum (misal: apa itu AI, apa itu Python, pengertian skripsi/KP secara teori), JAWABLAH dengan cerdas berdasarkan pengetahuan umummu, dan set "butuh_update" menjadi false.
        4. Jika pertanyaan terkait program studi teknik informatika uisu TIDAK ADA di data, jawab jujur bahwa CIMAL belum memiliki info tersebut, dan arahkan ke staff akademik. Set nilai "butuh_update" menjadi true.
        5. Jika meminta data sensitif kampus, tolak demi privasi.
        6. Jika sekadar sapaan/umum, jawab natural dan set "butuh_update" menjadi false.
        
        PENTING! Balas HANYA dengan format JSON murni:
        {"jawaban": "isi jawaban teks yang rapi di sini", "butuh_update": false}`;

        let finalAnswer = "";
        let butuhUpdate = false;

        // 3. PROSES AI DENGAN FITUR KEBAL LIMIT (FALLBACK LOKAL)
        try {
            console.log(`[CHAT TEKS] Sedang berpikir dan mencari jawaban (Ollama)...`);
            
            // Mengambil URL dan Model Ollama dari env
            const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434/api/chat";
            const ollamaModel = process.env.OLLAMA_MODEL || "qwen2.5:1.5b "; 

            // Pemanggilan API Ollama
            const response = await fetch(ollamaUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: ollamaModel,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userMessage }
                    ],
                    format: "json", // Memaksa Ollama membalas dalam format JSON murni
                    stream: false,
                    options: {
                        temperature: 0.2
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`Ollama HTTP Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const botReplyRaw = data.message.content;
            
            // Parsing JSON dari Ollama
            let cleanJson = botReplyRaw.replace(/```json/gi, '').replace(/```/gi, '').trim();
            let parsedData = JSON.parse(cleanJson);
            
            finalAnswer = parsedData.jawaban || botReplyRaw;
            butuhUpdate = parsedData.butuh_update || false;

        } catch (apiError) {
            // JIKA OLLAMA ERROR / TIDAK AKTIF, JALANKAN MODE LOKAL PINTAR
            console.error(`[ERROR API OLLAMA] Detail:`, apiError.message || apiError); 
            console.error(`[WARNING] Ollama Error / Tidak Aktif! Beralih ke Mode Pencarian Database Lokal...`);
            
            // Pesan default jika benar-benar tidak ada kata yang cocok di database
            let jawabanDitemukan = "Mohon maaf, server cimal saat ini sedang sibuk. Silakan tanyakan langsung ke bagian Tata Usaha.";
            
            try {
                const faqList = JSON.parse(faqDataString);
                const userTeksLower = userMessage.toLowerCase();
                
                let bestMatch = null;
                let highestScore = 0;

                // Memeriksa setiap data di database FAQ
                for (let item of faqList) {
                    let score = 0;
                    const tanyaLower = item.pertanyaan.toLowerCase();
                    
                    // 1. Cek jika kalimatnya sama persis
                    if (userTeksLower.includes(tanyaLower) || tanyaLower.includes(userTeksLower)) {
                        score += 10; 
                    }

                    // 2. Cek kecocokan per kata (mengatasi typo atau kalimat terbalik)
                    const kataUser = userTeksLower.split(" ");
                    for (let kata of kataUser) {
                        // Abaikan kata hubung pendek (di, ke, dan, itu)
                        if (kata.length > 3 && tanyaLower.includes(kata)) { 
                            score += 1;
                        }
                    }

                    // Simpan jawaban dengan skor kecocokan tertinggi
                    if (score > highestScore) {
                        highestScore = score;
                        bestMatch = item.jawaban;
                    }
                }

                // Jika ada minimal 1 kata penting yang cocok, gunakan jawaban dari database
                if (highestScore > 0 && bestMatch) {
                    jawabanDitemukan = bestMatch;
                    butuhUpdate = false; // Karena bisa dijawab, tidak perlu masuk log pembaruan
                    if (typeof finalEmotion !== 'undefined') finalEmotion = "HAPPY";
                    console.log(`[INFO LOKAL] Jawaban berhasil ditemukan di database (Skor: ${highestScore})`);
                } else {
                    butuhUpdate = true; // Benar-benar tidak ada di database, wajib masuk log
                }

            } catch (faqError) {
                console.error("Gagal membaca faq.json di mode lokal.");
            }

            finalAnswer = jawabanDitemukan;
        }
        
        // 4. LOGIKA MENYIMPAN PERTANYAAN TAK TERJAWAB
        if (butuhUpdate === true || finalAnswer.includes("mengalami gangguan")) {
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
                console.log(`[INFO ADMIN] Chat: Pertanyaan baru ditambahkan ke pembaruan_database.json: "${userMessage}"`);
            }
        } 

        console.log(`[CHAT TEKS] Jawaban berhasil dibuat: "${finalAnswer.substring(0, 50)}..."`);
        res.json({ response: finalAnswer });
        
    } catch (error) {
        console.error("Error pada AI API (Chat):", error);
        res.status(500).json({ error: "Terjadi kesalahan pada server AI CIMAL." });
    }
};

module.exports = { getChatResponse };
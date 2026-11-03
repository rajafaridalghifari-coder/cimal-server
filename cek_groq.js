require('dotenv').config();
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function cekModelGroq() {
    console.log("[INFO] Menghubungi server Groq untuk meminta daftar model...");
    try {
        const response = await groq.models.list();
        console.log("\n[SUKSES] Berikut adalah model teks yang aktif dan bisa Anda gunakan:");
        
        // Menyaring dan menampilkan daftar ID model
        response.data.forEach(model => {
            console.log(`👉 ${model.id}`);
        });
        
    } catch (error) {
        console.error("\n[ERROR]:", error.message);
    }
}

cekModelGroq();
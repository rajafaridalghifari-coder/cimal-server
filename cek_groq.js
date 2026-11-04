require('dotenv').config();

async function cekModelTersedia() {
    const apiKey = process.env.GROQ_API_KEY;
    
    if (!apiKey) {
        console.log("GROQ_API_KEY tidak ditemukan di file .env");
        return;
    }

    try {
        console.log("Menghubungi server Groq untuk mengambil daftar model...\n");
        
        // Endpoint resmi Groq untuk mengecek seluruh model yang didukung akun
        const response = await fetch("https://api.groq.com/openai/v1/models", {
            method: 'GET',
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            }
        });
        
        const data = await response.json();
        
        console.log("=== DAFTAR MODEL GROQ YANG TERSEDIA ===");
        data.data.forEach(model => {
            console.log(`-> ${model.id}`);
        });
        console.log("=======================================\n");
        
    } catch (error) {
        console.error("Gagal mengambil data model:", error);
    }
}

cekModelTersedia();
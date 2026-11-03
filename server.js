require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const http = require('http'); 
const { Server } = require('socket.io'); 
const apiRoutes = require('./src/routes/apiRoutes.js');
const chatRoutes = require('./src/routes/chatRoutes');
const swaggerUi = require('swagger-ui-express'); // Tambahan untuk Swagger UI

const app = express();
// Hugging Face Spaces secara default menggunakan port 7860, process.env.PORT akan mendeteksinya dari Docker
const PORT = process.env.PORT || 3000; 

const server = http.createServer(app);
const io = new Server(server);

app.set('io', io);

// =================================================================
// 1. KONFIGURASI SWAGGER UI
// =================================================================
const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'CIMAL API Documentation',
    version: '1.0.0',
    description: 'Dokumentasi REST API untuk CIMAL (Computerized Intelligent Multilingual Academic Liaison), asisten AI untuk Program Studi Teknik Informatika Fakultas Teknik UISU.'
  },
  paths: {
    '/api/cimal/chat': {
      post: {
        summary: 'Kirim pesan teks dari Mobile App ke CIMAL',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { 
                    message: { 
                        type: 'string', 
                        example: 'Berapa sks maksimal yang bisa diambil di semester 7?' 
                    } 
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Respon berhasil dari Groq API' },
          '400': { description: 'Format request salah atau pesan kosong' },
          '500': { description: 'Kesalahan server pada Groq API' }
        }
      }
    },
    '/api/cimal-speaker': {
      get: {
        summary: 'Endpoint Polling untuk ESP32 (Cek Audio Baru)',
        responses: {
          '200': { description: 'Mengembalikan status audio, ekspresi, dan URL file' }
        }
      }
    }
  }
};

// Memasang UI Swagger di path /api-docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));


app.use('/public', (req, res, next) => {
    res.setHeader('Connection', 'close');
    next();
});
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(cors()); 
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));
app.use('/api/cimal', chatRoutes);

// =================================================================
// 2. PINTU KHUSUS ESP32 SPEAKER (SISTEM ANTREAN / POLLING)
// =================================================================
global.cimalResponseData = null; 

app.get('/api/cimal-speaker', (req, res) => {
    // Console log agar kita tahu ESP32 terhubung dan mengecek
    console.log("[WIFI] ESP32 datang mengecek data baru...");

    if (global.cimalResponseData && global.cimalResponseData.urls && global.cimalResponseData.urls.length > 0) {
        const urlsToPlay = global.cimalResponseData.urls;
        const ekspresi = global.cimalResponseData.emotion;
        
        console.log(`-> [INFO] Data ditemukan! Mengirim file audio dan ekspresi: [${ekspresi}] ke ESP32.`);
        
        // Kirim response ke ESP32
        res.json({ 
            new_audio: true, 
            emotion: ekspresi, 
            urls: urlsToPlay 
        });

        // Kosongkan agar ESP32 tidak memutarnya berulang-ulang saat nge-loop
        global.cimalResponseData = null; 
    } else {
        // Jika tidak ada apa-apa
        res.json({ new_audio: false });
    }
});

// Menyambungkan rute utama ke /api (Ini biasanya untuk upload audio dari ESP32)
app.use('/api', apiRoutes);

// Menjalankan server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`[SERVER] Robot Asisten API berjalan di port ${PORT}!`);
    console.log(`[SWAGGER] Dokumentasi API tersedia di http://localhost:${PORT}/api-docs`);
    console.log(`[WIFI] Menunggu kedatangan data audio dari ESP32...`);
    console.log(`[CHAT] Pintu /api/cimal/chat siap menerima teks dari Mobile App!`);
    console.log(`======================================================\n`);
});
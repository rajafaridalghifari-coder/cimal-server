globalThis.File = globalThis.File || require('node:buffer').File;
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const http = require('http'); 
const { Server } = require('socket.io'); 
const apiRoutes = require('./src/routes/apiRoutes.js');
const chatRoutes = require('./src/routes/chatRoutes');
const swaggerUi = require('swagger-ui-express');

const app = express();
const PORT = process.env.PORT || 3000; 

const server = http.createServer(app);
const io = new Server(server);
app.set('io', io);

// =================================================================
// 1. MIDDLEWARE WAJIB (HARUS PALING ATAS!)
// =================================================================
app.use(cors()); 
app.use(express.json()); // Wajib di atas agar POST JSON dari mobile app terbaca
app.use(express.urlencoded({ extended: true }));

// =================================================================
// 2. KONFIGURASI FOLDER PUBLIK
// =================================================================
app.use('/public', (req, res, next) => {
    res.setHeader('Connection', 'close');
    next();
});
app.use('/public', express.static(path.join(__dirname, 'public')));

// =================================================================
// 3. KONFIGURASI SWAGGER UI
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

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// =================================================================
// 4. ROUTING UTAMA (API)
// =================================================================
app.use('/api/cimal', chatRoutes); // Rute Mobile Chat
app.use('/api', apiRoutes);        // Rute Upload Suara ESP32

// =================================================================
// 5. PINTU KHUSUS ESP32 SPEAKER (SISTEM ANTREAN / POLLING)
// =================================================================
global.cimalResponseData = null; 

app.get('/api/cimal-speaker', (req, res) => {
    console.log("[WIFI] ESP32 datang mengecek data baru...");

    if (global.cimalResponseData && global.cimalResponseData.urls && global.cimalResponseData.urls.length > 0) {
        const urlsToPlay = global.cimalResponseData.urls;
        const ekspresi = global.cimalResponseData.emotion;
        
        console.log(`-> [INFO] Data ditemukan! Mengirim file audio dan ekspresi: [${ekspresi}] ke ESP32.`);
        
        res.json({ 
            new_audio: true, 
            emotion: ekspresi, 
            urls: urlsToPlay 
        });

        global.cimalResponseData = null; 
    } else {
        res.json({ new_audio: false });
    }
});

// =================================================================
// 6. MENJALANKAN SERVER
// =================================================================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`[SERVER] Robot Asisten API berjalan di port ${PORT}!`);
    console.log(`[SWAGGER] Dokumentasi API tersedia di http://localhost:${PORT}/api-docs`);
    console.log(`[WIFI] Menunggu kedatangan data audio dari ESP32...`);
    console.log(`[CHAT] Pintu /api/cimal/chat siap menerima teks dari Mobile App!`);
    console.log(`======================================================\n`);
});
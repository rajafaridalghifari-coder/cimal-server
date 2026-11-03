const express = require('express');
const router = express.Router();
const { upload, processAudio } = require('../controllers/audioController');

// Menerima file audio dari Postman / ESP32 dengan key "audio"
router.post('/upload-suara', upload.single('audio'), processAudio);

module.exports = router;
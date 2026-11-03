const express = require('express');
const router = express.Router();

// Path disesuaikan: naik satu folder (..), lalu masuk ke controllers
const { getChatResponse } = require('../controllers/chatController');

// Endpoint yang akan dituju temanmu menjadi: /api/cimal/chat
router.post('/chat', getChatResponse);

module.exports = router;
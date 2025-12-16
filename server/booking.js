const router = require('express').Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Подключение к SQLite базе данных
const dbPath = process.env.NODE_ENV === 'production' 
    ? '/tmp/bookings.db' // На Render.com используем /tmp
    : path.join(__dirname, 'bookings.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных:', err);
    } else {
        console.log('✅ Подключено к SQLite базе данных');
        initializeDatabase();
    }
});

// Инициализация БД
function initializeDatabase() {
    db.serialize(() => {
        // Таблица бронирований
        db.run(`CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_id TEXT UNIQUE,
            hall_number INTEGER,
            date TEXT,
            time TEXT,
            duration INTEGER,
            guests TEXT,
            name TEXT,
            phone TEXT,
            email TEXT DEFAULT '',
            comments TEXT DEFAULT '',
            menu_items TEXT DEFAULT '[]',
            total_amount REAL,
            payment_status TEXT DEFAULT 'pending',
            payment_id TEXT,
            yookassa_payment_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        // Таблица занятых слотов
        db.run(`CREATE TABLE IF NOT EXISTS busy_slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hall_number INTEGER,
            date TEXT,
            time TEXT,
            duration INTEGER,
            booking_id TEXT,
            UNIQUE(hall_number, date, time)
        )`);
        
        // Индексы для быстрого поиска
        db.run(`CREATE INDEX IF NOT EXISTS idx_busy_slots_date_hall ON busy_slots(date, hall_number)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(phone)`);
        
        console.log('✅ База данных инициализирована');
    });
}

// Проверка доступности времени
router.get('/availability', (req, res) => {
    try {
        const { date, hall } = req.query;
        
        if (!date || !hall) {
            return res.status(400).json({ 
                error: 'Необходимо указать date и hall' 
            });
        }
        
        db.all(
            `SELECT time, duration FROM busy_slots 
             WHERE hall_number = ? AND date = ?`,
            [hall, date],
            (err, rows) => {
                if (err) {
                    console.error('Ошибка запроса к БД:', err);
                    return res.status(500).json({ error: 'Ошибка базы данных' });
                }
                
                // Получаем все занятые слоты
                const busySlots = rows.map(row => row.time);
                
                // Генерируем все возможные слоты (10:00 - 22:00)
                const allSlots = Array.from({ length: 13 }, (_, i) => 
                    `${(i + 10).toString().padStart(2, '0')}:00`
                );
                
                // Фильтруем доступные слоты
                const availableSlots = allSlots.filter(slot => !busySlots.includes(slot));
                
                console.log(`📅 Проверка доступности: дата ${date}, зал ${hall}`);
                console.log(`   Занятые слоты: ${busySlots.length}`);
                
                res.json({
                    date: date,
                    hall: hall,
                    available_slots: availableSlots,
                    busy_slots: busySlots,
                    total_slots: allSlots.length
                });
            }
        );
        
    } catch (error) {
        console.error('Ошибка проверки доступности:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Проверка конкретного временного слота
router.get('/check-slot', (req, res) => {
    try {
        const { date, hall, time, duration = 2 } = req.query;
        
        if (!date || !hall || !time) {
            return res.status(400).json({ 
                error: 'Необходимо указать date, hall и time' 
            });
        }
        
        // Парсим время
        const startHour = parseInt(time.split(':')[0]);
        if (isNaN(startHour) || startHour < 10 || startHour > 22) {
            return res.status(400).json({ 
                error: 'Некорректное время' 
            });
        }
        
        // Генерируем все слоты для проверки
        const slotsToCheck = Array.from({ length: parseInt(duration) }, (_, i) => 
            `${(startHour + i).toString().padStart(2, '0')}:00`
        );
        
        // Проверяем, не выходит ли бронирование за пределы рабочего времени
        const endHour = startHour + parseInt(duration) - 1;
        if (endHour > 22) {
            return res.json({
                available: false,
                error: 'Бронирование выходит за пределы рабочего времени (после 22:00)'
            });
        }
        
        // Проверяем занятость в БД
        const placeholders = slotsToCheck.map(() => '?').join(',');
        const query = `
            SELECT time FROM busy_slots 
            WHERE hall_number = ? 
            AND date = ? 
            AND time IN (${placeholders})
        `;
        
        db.all(query, [hall, date, ...slotsToCheck], (err, rows) => {
            if (err) {
                console.error('Ошибка запроса к БД:', err);
                return res.status(500).json({ error: 'Ошибка базы данных' });
            }
            
            const conflictingSlots = rows.map(r => r.time);
            const available = conflictingSlots.length === 0;
            
            console.log(`🔍 Проверка слота: ${date} ${time} на ${duration}ч`);
            console.log(`   Зал: ${hall}, Доступен: ${available}`);
            
            res.json({
                available: available,
                conflicting_slots: conflictingSlots,
                requested_slots: slotsToCheck,
                date: date,
                hall: hall,
                time: time,
                duration: duration
            });
        });
        
    } catch (error) {
        console.error('Ошибка проверки слота:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Создание нового бронирования
router.post('/create', (req, res) => {
    try {
        const {
            hall,
            date,
            time,
            duration = 2,
            guests = '1-10',
            name,
            phone,
            email = '',
            comments = '',
            menuItems = [],
            total
        } = req.body;
        
        // Валидация обязательных полей
        if (!hall || !date || !time || !name || !phone || !total) {
            return res.status(400).json({ 
                success: false, 
                error: 'Заполните все обязательные поля' 
            });
        }
        
        // Генерируем уникальный ID бронирования
        const bookingId = 'BK' + Date.now() + Math.random().toString(36).substr(2, 6).toUpperCase();
        
        // Преобразуем menuItems в JSON строку
        const menuItemsJson = JSON.stringify(menuItems);
        
        // Начинаем транзакцию
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            // 1. Сохраняем бронирование
            const stmt = db.prepare(`
                INSERT INTO bookings (
                    booking_id, hall_number, date, time, duration, 
                    guests, name, phone, email, comments, 
                    menu_items, total_amount, payment_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            stmt.run(
                bookingId,
                hall,
                date,
                time,
                duration,
                guests,
                name,
                phone,
                email,
                comments,
                menuItemsJson,
                total,
                'pending'
            );
            
            stmt.finalize();
            
            // 2. Занимаем временные слоты
            const startHour = parseInt(time.split(':')[0]);
            const slots = Array.from({ length: duration }, (_, i) => ({
                hall: hall,
                date: date,
                time: `${(startHour + i).toString().padStart(2, '0')}:00`,
                bookingId: bookingId
            }));
            
            const slotStmt = db.prepare(`
                INSERT INTO busy_slots (hall_number, date, time, booking_id) 
                VALUES (?, ?, ?, ?)
            `);
            
            slots.forEach(slot => {
                slotStmt.run([slot.hall, slot.date, slot.time, slot.bookingId]);
            });
            
            slotStmt.finalize();
            
            // 3. Фиксируем транзакцию
            db.run('COMMIT', (err) => {
                if (err) {
                    console.error('Ошибка транзакции:', err);
                    db.run('ROLLBACK');
                    return res.status(500).json({ 
                        success: false, 
                        error: 'Ошибка при сохранении бронирования' 
                    });
                }
                
                console.log(`✅ Бронирование создано: ${bookingId}`);
                console.log(`   Зал: ${hall}, Дата: ${date} ${time}, Клиент: ${name}`);
                
                res.json({
                    success: true,
                    booking_id: bookingId,
                    message: 'Бронирование успешно создано'
                });
            });
        });
        
    } catch (error) {
        console.error('Ошибка создания бронирования:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Внутренняя ошибка сервера' 
        });
    }
});

// Получение информации о бронировании
router.get('/:bookingId', (req, res) => {
    const { bookingId } = req.params;
    
    db.get(
        `SELECT * FROM bookings WHERE booking_id = ?`,
        [bookingId],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка базы данных' });
            }
            
            if (!row) {
                return res.status(404).json({ error: 'Бронирование не найдено' });
            }
            
            res.json({
                success: true,
                booking: {
                    ...row,
                    menu_items: JSON.parse(row.menu_items || '[]')
                }
            });
        }
    );
});

module.exports = router;
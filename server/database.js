const { Pool } = require('pg');
require('dotenv').config();

// Для Render.com используем PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Инициализация таблиц
async function initializeDatabase() {
    try {
        // Таблица бронирований
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bookings (
                id SERIAL PRIMARY KEY,
                booking_id VARCHAR(50) UNIQUE NOT NULL,
                hall_number INTEGER NOT NULL,
                date DATE NOT NULL,
                time TIME NOT NULL,
                duration INTEGER DEFAULT 2,
                guests VARCHAR(50),
                name VARCHAR(100) NOT NULL,
                phone VARCHAR(20) NOT NULL,
                email VARCHAR(100),
                comments TEXT,
                menu_items JSONB DEFAULT '[]',
                total_amount DECIMAL(10,2) NOT NULL,
                payment_status VARCHAR(20) DEFAULT 'pending',
                payment_id VARCHAR(100),
                yookassa_payment_id VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Таблица занятых слотов
        await pool.query(`
            CREATE TABLE IF NOT EXISTS busy_slots (
                id SERIAL PRIMARY KEY,
                hall_number INTEGER NOT NULL,
                date DATE NOT NULL,
                time TIME NOT NULL,
                duration INTEGER,
                booking_id VARCHAR(50),
                UNIQUE(hall_number, date, time)
            )
        `);
        
        // Индексы
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_busy_slots_date_hall 
            ON busy_slots(date, hall_number)
        `);
        
        console.log('✅ PostgreSQL база данных инициализирована');
        
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error);
        throw error;
    }
}

module.exports = {
    pool,
    initializeDatabase
};
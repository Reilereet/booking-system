const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { YooCheckout } = require('@a2seven/yoo-checkout');

const yooKassaClient = new YooCheckout({
    shopId: process.env.YOOKASSA_SHOP_ID,
    secretKey: process.env.YOOKASSA_SECRET_KEY
});

router.post('/create-payment', async (req, res) => {
    try {
        // 1. Получаем ВСЕ данные из тела запроса от вашего фронтенда (Tilda)
        const {
            amount,
            description,
            return_url,
            email, // Клиентский email ДОЛЖЕН передаваться с фронтенда
            metadata = {}
        } = req.body;

        // 2. Простая валидация обязательных полей
        if (!amount || amount < 1) {
            return res.status(400).json({ 
                success: false, 
                error: 'Некорректная сумма оплаты' 
            });
        }
        if (!email) {
            return res.status(400).json({ 
                success: false, 
                error: 'Для создания платежа требуется email клиента' 
            });
        }

        const idempotenceKey = require('uuid').v4();
        
        console.log('Создание платежа. Данные:', { amount, description, email });

        // 3. Формируем объект платежа для ЮKassa
        const paymentData = {
            amount: {
                value: amount.toFixed(2),
                currency: 'RUB'
            },
            payment_method_data: {
                type: 'bank_card'
            },
            confirmation: {
                type: 'redirect',
                return_url: return_url
            },
            description: description || 'Оплата бронирования',
            metadata: metadata,
            capture: true,
            // 4. Добавляем чек, если передан email
            receipt: {
                customer: {
                    email: email // Используем email из запроса
                },
                items: [
                    {
                        description: description || 'Бронирование банкетного зала',
                        quantity: '1.00',
                        amount: {
                            value: amount.toFixed(2),
                            currency: 'RUB'
                        },
                        vat_code: 1, // Ставка НДС 20%
                        payment_mode: 'full_payment',
                        payment_subject: 'service'
                    }
                ]
            }
        };

        // 5. Создаем платеж
        const payment = await yooKassaClient.createPayment(paymentData, idempotenceKey);

        console.log('Платеж создан:', payment.id);

        res.json({
            success: true,
            payment_id: payment.id,
            confirmation_url: payment.confirmation.confirmation_url
        });

    } catch (error) {
        console.error('❌ Ошибка создания платежа:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Ошибка при создании платежа'
        });
    }
});

// Вебхук для уведомлений от ЮKassa
router.post('/webhook', async (req, res) => {
    try {
        const event = req.body.event;
        const payment = req.body.object;
        
        console.log(`🔔 Webhook от ЮKassa: ${event}`, {
            payment_id: payment.id,
            amount: payment.amount,
            status: payment.status,
            metadata: payment.metadata
        });

        // Проверяем подпись уведомления (рекомендуется в продакшене)
        // const signature = req.headers['x-yookassa-signature'];
        // if (!verifySignature(signature, req.body)) {
        //     return res.status(400).send('Invalid signature');
        // }

        // Обработка событий
        switch (event) {
            case 'payment.succeeded':
                console.log(`✅ Платеж ${payment.id} успешно завершен`);
                // Здесь обновите статус заказа в БД
                // await updateBookingStatus(payment.metadata.booking_id, 'paid');
                break;
                
            case 'payment.canceled':
                console.log(`❌ Платеж ${payment.id} отменен`);
                // await updateBookingStatus(payment.metadata.booking_id, 'canceled');
                break;
                
            case 'payment.waiting_for_capture':
                console.log(`⏳ Платеж ${payment.id} ожидает подтверждения`);
                break;
        }
        
        // Всегда возвращаем 200 OK ЮKassa
        res.sendStatus(200);
        
    } catch (error) {
        console.error('Ошибка обработки webhook:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Вспомогательная функция для проверки подписи (опционально)
function verifySignature(signature, body) {
    // Реализуйте проверку подписи согласно документации ЮKassa
    // https://yookassa.ru/developers/using-api/webhooks#verification
    return true; // Заглушка
}

module.exports = router;
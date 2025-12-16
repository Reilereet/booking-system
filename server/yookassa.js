// После извлечения данных:
const receiptItems = metadata.items || [];
const customerComments = metadata.comments?.trim() || '';

// УБЕДИТЕСЬ, что items - это МАССИВ
if (!Array.isArray(receiptItems)) {
    console.error('❌ items не является массивом:', receiptItems);
    return res.status(400).json({ 
        success: false, 
        error: 'Некорректный формат данных заказа' 
    });
}

const yooKassaClient = new YooCheckout({
    shopId: process.env.YOOKASSA_SHOP_ID,
    secretKey: process.env.YOOKASSA_SECRET_KEY
});

router.post('/create-payment', async (req, res) => {
    try {
        const {
            amount,
            description,
            return_url,
            metadata = {}
        } = req.body;

        console.log('Получены метаданные от клиента:', metadata); // ← ДЛЯ ОТЛАДКИ

        // --- 1. ИЗВЛЕКАЕМ ДАННЫЕ ДЛЯ ЧЕКА ИЗ METADATA ---
        // Убедимся, что email точно есть и он не пустой
        const customerEmail = metadata.email?.trim();
        if (!customerEmail || customerEmail === 'no-email@example.com') {
            console.error('❌ Отсутствует или невалиден email:', customerEmail);
            return res.status(400).json({ 
                success: false, 
                error: 'Для создания платежа требуется email клиента' 
            });
        }
        
        const customerName = metadata.name?.trim() || 'Клиент';
        const customerPhone = metadata.phone?.trim() || '';
        const customerComments = metadata.comments?.trim() || ''; // ← НОВОЕ: комментарии
        
        // Получаем массив заказанных блюд
        const receiptItems = metadata.items || [];
        console.log('Извлеченные данные:', { customerEmail, customerName, itemsCount: receiptItems.length });

        // --- 2. ФОРМИРУЕМ ОБЪЕКТ "RECEIPT" ДЛЯ ЮKASSA ---
        const receipt = {
            customer: {
                email: customerEmail,
                full_name: customerName, // Полное имя для чека
                phone: customerPhone,    // Телефон (опционально, но желательно)
            },
            items: []
        };

        // --- 3. ФОРМИРУЕМ ПОЗИЦИИ ЧЕКА ---
        console.log('Начинаем формировать позиции чека...');

        // 3.1. АРЕНДА ЗАЛА - ОСНОВНАЯ ПОЗИЦИЯ (ВСЕГДА ЕСТЬ)
        const hallDescription = `Аренда банкетного зала №${metadata.hall || metadata.hallNumber}`;
        receipt.items.push({
            description: hallDescription.substring(0, 128),
            quantity: '1.00',
            amount: {
                value: amount.toFixed(2), // ВСЯ сумма на аренду
                currency: 'RUB'
            },
            vat_code: 1,
            payment_subject: 'service',
            payment_mode: 'full_payment'
        });
        console.log('Добавлена позиция "Аренда зала"');

        // 3.2. КОММЕНТАРИИ КЛИЕНТА (ТОЛЬКО ЕСЛИ ЕСТЬ)
        if (customerComments && customerComments.trim() !== '') {
            const commentText = `Пожелание: ${customerComments.substring(0, 100)}`;
            receipt.items.push({
                description: commentText,
                quantity: '1.00',
                amount: {
                    value: '0.01', // 1 копейка - ЮKassa принимает ненулевые значения
                    currency: 'RUB'
                },
                vat_code: 1,
                payment_subject: 'service',
                payment_mode: 'full_payment'
            });
            console.log('Добавлен комментарий клиента');
        }

        // 3.3. ЗАКАЗАННЫЕ БЛЮДА ИЛИ ЗАГЛУШКА "НЕТ БЛЮД"
        if (receiptItems && receiptItems.length > 0) {
            console.log(`Добавляем ${receiptItems.length} блюд в чек`);
            receiptItems.forEach((item, index) => {
                receipt.items.push({
                    description: String(item.name || `Позиция ${index + 1}`).substring(0, 128),
                    quantity: String(item.quantity || 1),
                    amount: {
                        value: (Number(item.price || 0) * Number(item.quantity || 1)).toFixed(2),
                        currency: 'RUB'
                    },
                    vat_code: 1,
                    payment_subject: 'commodity',
                    payment_mode: 'full_payment'
                });
            });
        } else {
            // 3.4. ЗАГЛУШКА ЕСЛИ БЛЮД НЕТ
            console.log('Блюда не заказаны, добавляем заглушку');
            receipt.items.push({
                description: 'Без заказанных блюд',
                quantity: '1.00',
                amount: {
                    value: '0.01', // Минимальная ненулевая сумма
                    currency: 'RUB'
                },
                vat_code: 1,
                payment_subject: 'service',
                payment_mode: 'full_payment'
            });
        }

        // 3.5. ПРОВЕРКА И ЛОГИРОВАНИЕ
        console.log('Итоговый чек содержит позиций:', receipt.items.length);
        console.log('Структура чека для отладки:');
        receipt.items.forEach((item, i) => {
            console.log(`  [${i}] ${item.description}: ${item.amount.value} руб. x${item.quantity}`);
        });

        // Проверяем сумму чека
        const totalReceiptAmount = receipt.items.reduce((sum, item) => {
            return sum + (parseFloat(item.amount.value) * parseFloat(item.quantity));
        }, 0);

        console.log(`Сумма чека: ${totalReceiptAmount.toFixed(2)} руб., Сумма платежа: ${amount} руб.`);

        // Допустима небольшая разница из-за комментариев за 0.01
        if (Math.abs(totalReceiptAmount - amount) > 0.02) {
            console.warn('⚠️ Разница в суммах больше 2 копеек. Возможна ошибка.');
        }
        console.log('Сформирован чек с позициями:', receipt.items);
        // --- 4. ПРОВЕРКА СУММЫ ---
        // ЮKassa строго следит, чтобы сумма в чеке равнялась сумме платежа
        const totalReceiptAmount = receipt.items.reduce((sum, item) => {
            return sum + (parseFloat(item.amount.value) * parseFloat(item.quantity));
        }, 0);
        
        if (Math.abs(totalReceiptAmount - amount) > 0.01) {
            console.warn(`⚠️ Сумма чека (${totalReceiptAmount}) не равна сумме платежа (${amount})`);
            // Можно откорректировать последнюю позицию или добавить корректировочную позицию
        }

        const idempotenceKey = uuidv4();
        
        console.log('Создание платежа с чеком:', {
            amount,
            description,
            customer: customerEmail,
            items_count: receipt.items.length
        });

        // --- 5. ПЕРЕДАЁМ RECEIPT В ЗАПРОС К ЮKASSA ---
        const payment = await yooKassaClient.createPayment({
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
            description: description,
            metadata: metadata,
            capture: true,
            receipt: receipt // ← ВОТ ГЛАВНОЕ ИЗМЕНЕНИЕ!
        }, idempotenceKey);

        console.log('Платеж и чек созданы:', payment.id);
        
        res.json({
            success: true,
            payment_id: payment.id,
            confirmation_url: payment.confirmation.confirmation_url
        });

    } catch (error) {
        console.error('❌ Ошибка создания платежа с чеком:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Ошибка при создании платежа с чеком'
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
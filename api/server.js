const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = process.env.PORT || 3000;

// Временное хранилище данных (замените на MongoDB/PostgreSQL в продакшене)
let registrations = [];
let products = [
  { id: 1, name: 'Продукт A', stock: 100 },
  { id: 2, name: 'Продукт B', stock: 50 },
];
let orders = [];

app.use(bodyParser.json());

// Базовая обработка ошибок
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
});

// Аутентификация Telegram Web App (проверка initData)
function verifyTelegramWebAppData(initData) {
  return true; // Заглушка
}

// Регистрация пользователя
app.post('/api/register', (req, res) => {
  const { telegramId, name, initData } = req.body;
  if (!verifyTelegramWebAppData(initData)) {
    return res.status(401).json({ success: false, error: 'Неверный initData' });
  }
  const registration = {
    id: registrations.length + 1,
    telegramId,
    name,
    status: 'pending',
  };
  registrations.push(registration);
  res.json({ success: true, registration });
});

// Создание заявки
app.post('/api/orders', (req, res) => {
  const { telegramId, productId, quantity, initData } = req.body;
  if (!verifyTelegramWebAppData(initData)) {
    return res.status(401).json({ success: false, error: 'Неверный initData' });
  }
  const product = products.find((p) => p.id === parseInt(productId));
  if (!product || product.stock < quantity) {
    return res.status(400).json({ success: false, error: 'Недостаточно товара или неверный продукт' });
  }
  const order = { id: orders.length + 1, telegramId, productId, quantity, status: 'pending' };
  orders.push(order);
  product.stock -= quantity;
  res.json({ success: true, order });
});

// Получение списка продуктов
app.get('/api/products', (req, res) => {
  res.json(products);
});

// Для админ-панели: получение неподтвержденных регистраций
app.get('/api/registrations', (req, res) => {
  res.json(registrations.filter((r) => r.status === 'pending'));
});

// Для админ-панели: подтверждение/отклонение регистрации
app.post('/api/registrations/:id', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const registration = registrations.find((r) => r.id === parseInt(id));
  if (!registration) {
    return res.status(404).json({ success: false, error: 'Регистрация не найдена' });
  }
  registration.status = status;
  res.json({ success: true });
});

// Для админ-панели: управление продуктами
app.post('/api/products', (req, res) => {
  const { name, stock } = req.body;
  const product = { id: products.length + 1, name, stock: parseInt(stock) };
  products.push(product);
  res.json({ success: true, product });
});

app.put('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const { name, stock } = req.body;
  const product = products.find((p) => p.id === parseInt(id));
  if (!product) {
    return res.status(404).json({ success: false, error: 'Продукт не найден' });
  }
  product.name = name || product.name;
  product.stock = stock !== undefined ? parseInt(stock) : product.stock;
  res.json({ success: true, product });
});

app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;
  products = products.filter((p) => p.id !== parseInt(id));
  res.json({ success: true });
});

// Тестовый эндпоинт
app.get('/', (req, res) => {
  res.json({ message: 'API работает' });
});

// Вебхук для Telegram
app.post('/webhook', (req, res) => {
  const update = req.body;
  // Передаем обновление в aiogram
  bot.process_update(update);
  res.sendStatus(200);
});

app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});

module.exports = app;
const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const app = express();
const port = process.env.PORT || 3000;

// Подключение к MongoDB
const uri = 'mongodb+srv://wh1ytettv:fireforce228@cluster0.cejtnos.mongodb.net/'; // Замени на свою строку подключения
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
let db;

async function connectToMongo() {
  try {
    await client.connect();
    db = client.db('b2b_tg_bot');
    console.log('Подключено к MongoDB');
    // Инициализация начальных данных, если коллекция пуста
    const productsCollection = db.collection('products');
    const productsCount = await productsCollection.countDocuments();
    if (productsCount === 0) {
      await productsCollection.insertMany([
        { id: 1, name: 'Продукт A', stock: 100 },
        { id: 2, name: 'Продукт B', stock: 50 },
        { id: 3, name: 'Продукт C', stock: 30 },
      ]);
      console.log('Добавлены начальные продукты');
    }
  } catch (err) {
    console.error('Ошибка подключения к MongoDB:', err);
    process.exit(1);
  }
}

connectToMongo();

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
app.post('/api/register', async (req, res) => {
  try {
    const { telegramId, name, email, companyName, phone, initData } = req.body;
    if (!telegramId || !name) {
      return res.status(400).json({ success: false, error: 'telegramId и name обязательны' });
    }
    if (!verifyTelegramWebAppData(initData)) {
      return res.status(401).json({ success: false, error: 'Неверный initData' });
    }
    const registrationsCollection = db.collection('registrations');
    const existingRegistration = await registrationsCollection.findOne({ telegramId });
    if (existingRegistration) {
      return res.status(400).json({ success: false, error: 'Пользователь уже зарегистрирован' });
    }
    const registration = {
      telegramId,
      name,
      email: email || '',
      companyName: companyName || '',
      phone: phone || '',
      status: 'pending',
      createdAt: new Date(),
    };
    const result = await registrationsCollection.insertOne(registration);
    registration.id = result.insertedId;
    res.json({ success: true, registration });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка при регистрации' });
  }
});

// Создание заявки
app.post('/api/orders', async (req, res) => {
  try {
    const { telegramId, productId, quantity, initData } = req.body;
    if (!telegramId || !productId || !quantity) {
      return res.status(400).json({ success: false, error: 'telegramId, productId и quantity обязательны' });
    }
    if (!verifyTelegramWebAppData(initData)) {
      return res.status(401).json({ success: false, error: 'Неверный initData' });
    }
    const productsCollection = db.collection('products');
    const product = await productsCollection.findOne({ id: parseInt(productId) });
    if (!product || product.stock < quantity) {
      return res.status(400).json({ success: false, error: 'Недостаточно товара или неверный продукт' });
    }
    const ordersCollection = db.collection('orders');
    const order = {
      telegramId,
      productId: parseInt(productId),
      quantity: parseInt(quantity),
      status: 'pending',
      createdAt: new Date(),
    };
    const result = await ordersCollection.insertOne(order);
    order.id = result.insertedId;
    await productsCollection.updateOne(
      { id: parseInt(productId) },
      { $inc: { stock: -quantity } }
    );
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка при создании заявки' });
  }
});

// Получение списка продуктов
app.get('/api/products', async (req, res) => {
  try {
    const productsCollection = db.collection('products');
    const products = await productsCollection.find({}).toArray();
    res.json(products);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка при загрузке продуктов' });
  }
});

// Для админ-панели: получение неподтвержденных регистраций
app.get('/api/registrations', async (req, res) => {
  try {
    const { telegramId } = req.query;
    const registrationsCollection = db.collection('registrations');
    if (telegramId) {
      const registration = await registrationsCollection.findOne({ telegramId });
      if (!registration) {
        return res.json({ status: 'not_found' });
      }
      res.json(registration);
    } else {
      const pendingRegistrations = await registrationsCollection.find({ status: 'pending' }).toArray();
      res.json(pendingRegistrations);
    }
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка при загрузке регистраций' });
  }
});

// Для админ-панели: подтверждение/отклонение регистрации
app.post('/api/registrations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const registrationsCollection = db.collection('registrations');
    const result = await registrationsCollection.updateOne(
      { id: parseInt(id) },
      { $set: { status } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Регистрация не найдена' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка при обновлении регистрации' });
  }
});

// Для админ-панели: управление продуктами
app.post('/api/products', async (req, res) => {
  try {
    const { name, stock } = req.body;
    if (!name || stock === undefined) {
      return res.status(400).json({ success: false, error: 'name и stock обязательны' });
    }
    const productsCollection = db.collection('products');
    const productCount = await productsCollection.countDocuments();
    const product = { id: productCount + 1, name, stock: parseInt(stock) };
    await productsCollection.insertOne(product);
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка при добавлении продукта' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, stock } = req.body;
    const productsCollection = db.collection('products');
    const product = await productsCollection.findOne({ id: parseInt(id) });
    if (!product) {
      return res.status(404).json({ success: false, error: 'Продукт не найден' });
    }
    const updateData = {};
    if (name) updateData.name = name;
    if (stock !== undefined) updateData.stock = parseInt(stock);
    await productsCollection.updateOne({ id: parseInt(id) }, { $set: updateData });
    res.json({ success: true, product: { ...product, ...updateData } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка при обновлении продукта' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const productsCollection = db.collection('products');
    const result = await productsCollection.deleteOne({ id: parseInt(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Продукт не найден' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка при удалении продукта' });
  }
});

// Тестовый эндпоинт
app.get('/', (req, res) => {
  res.json({ message: 'API работает' });
});

app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});

module.exports = app;
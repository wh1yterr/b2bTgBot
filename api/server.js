const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const app = express();
const port = process.env.PORT || 3000;

// Временное хранилище данных (на случай ошибки подключения к MongoDB)
let registrations = [];
let products = [
  { id: 1, name: 'Продукт A', stock: 100 },
  { id: 2, name: 'Продукт B', stock: 50 },
  { id: 3, name: 'Продукт C', stock: 30 },
];
let orders = [];

app.use(bodyParser.json());

// Подключение к MongoDB
const uri = process.env.MONGODB_URI;
const client = uri ? new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true }) : null;
let db;
let useMongoDB = true;

// Проверка формата строки подключения
function isValidMongoUri(uri) {
  if (!uri) return false;
  return uri.startsWith('mongodb+srv://') && uri.includes('@') && uri.includes('.mongodb.net/');
}

async function connectToMongo() {
  if (!client || !isValidMongoUri(uri)) {
    console.error('Некорректная строка подключения MongoDB:', uri);
    useMongoDB = false;
    return;
  }
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
    // Переносим данные из памяти в MongoDB
    if (registrations.length > 0) {
      await db.collection('registrations').insertMany(registrations);
      registrations = [];
    }
    if (orders.length > 0) {
      await db.collection('orders').insertMany(orders);
      orders = [];
    }
    if (products.length > 0) {
      await productsCollection.insertMany(products);
      products = [];
    }
  } catch (err) {
    console.error('Ошибка подключения к MongoDB:', err);
    useMongoDB = false; // Откатываемся на память
  }
}

if (client) connectToMongo();

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
    const registration = {
      telegramId,
      name,
      email: email || '',
      companyName: companyName || '',
      phone: phone || '',
      status: 'pending',
      createdAt: new Date(),
    };
    if (useMongoDB) {
      const registrationsCollection = db.collection('registrations');
      const existingRegistration = await registrationsCollection.findOne({ telegramId });
      if (existingRegistration) {
        return res.status(400).json({ success: false, error: 'Пользователь уже зарегистрирован' });
      }
      const result = await registrationsCollection.insertOne(registration);
      registration.id = result.insertedId;
    } else {
      registration.id = registrations.length + 1;
      registrations.push(registration);
    }
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
    let product;
    if (useMongoDB) {
      const productsCollection = db.collection('products');
      product = await productsCollection.findOne({ id: parseInt(productId) });
      if (!product || product.stock < quantity) {
        return res.status(400).json({ success: false, error: 'Недостаточно товара или неверный продукт' });
      }
    } else {
      product = products.find((p) => p.id === parseInt(productId));
      if (!product || product.stock < quantity) {
        return res.status(400).json({ success: false, error: 'Недостаточно товара или неверный продукт' });
      }
    }
    const order = {
      telegramId,
      productId: parseInt(productId),
      quantity: parseInt(quantity),
      status: 'pending',
      createdAt: new Date(),
    };
    if (useMongoDB) {
      const ordersCollection = db.collection('orders');
      const productsCollection = db.collection('products');
      const result = await ordersCollection.insertOne(order);
      order.id = result.insertedId;
      await productsCollection.updateOne(
        { id: parseInt(productId) },
        { $inc: { stock: -quantity } }
      );
    } else {
      order.id = orders.length + 1;
      orders.push(order);
      product.stock -= quantity;
    }
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка при создании заявки' });
  }
});

// Получение списка продуктов
app.get('/api/products', async (req, res) => {
  try {
    if (useMongoDB) {
      const productsCollection = db.collection('products');
      const productsList = await productsCollection.find({}).toArray();
      res.json(productsList);
    } else {
      res.json(products);
    }
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка при загрузке продуктов' });
  }
});

// Для админ-панели: получение неподтвержденных регистраций
app.get('/api/registrations', async (req, res) => {
  try {
    const { telegramId } = req.query;
    if (useMongoDB) {
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
    } else {
      if (telegramId) {
        const registration = registrations.find((r) => r.telegramId === telegramId);
        if (!registration) {
          return res.json({ status: 'not_found' });
        }
        res.json(registration);
      } else {
        const pendingRegistrations = registrations.filter((r) => r.status === 'pending');
        res.json(pendingRegistrations);
      }
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
    if (useMongoDB) {
      const registrationsCollection = db.collection('registrations');
      const result = await registrationsCollection.updateOne(
        { id: parseInt(id) },
        { $set: { status } }
      );
      if (result.matchedCount === 0) {
        return res.status(404).json({ success: false, error: 'Регистрация не найдена' });
      }
    } else {
      const registration = registrations.find((r) => r.id === parseInt(id));
      if (!registration) {
        return res.status(404).json({ success: false, error: 'Регистрация не найдена' });
      }
      registration.status = status;
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
    const product = { id: products.length + 1, name, stock: parseInt(stock) };
    if (useMongoDB) {
      const productsCollection = db.collection('products');
      const result = await productsCollection.insertOne(product);
    } else {
      products.push(product);
    }
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка при добавлении продукта' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, stock } = req.body;
    if (useMongoDB) {
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
    } else {
      const product = products.find((p) => p.id === parseInt(id));
      if (!product) {
        return res.status(404).json({ success: false, error: 'Продукт не найден' });
      }
      product.name = name || product.name;
      product.stock = stock !== undefined ? parseInt(stock) : product.stock;
      res.json({ success: true, product });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка при обновлении продукта' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (useMongoDB) {
      const productsCollection = db.collection('products');
      const result = await productsCollection.deleteOne({ id: parseInt(id) });
      if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, error: 'Продукт не найден' });
      }
    } else {
      products = products.filter((p) => p.id !== parseInt(id));
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

// Обработка запросов favicon
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.get('/favicon.png', (req, res) => {
  res.status(204).end();
});

app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});

module.exports = app;
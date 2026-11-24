const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { testConnection } = require('./db');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');
const favoriteRoutes = require('./routes/favorites');
const moneyRoutes = require('./routes/money');
const adminRoutes = require('./routes/admin');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // правильно определяет HTTPS, если стоит nginx

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// CORS нужен только если HTML-страницы живут на другом домене/порту, чем API
if (config.corsOrigin) {
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/money-requests', moneyRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Статика сайта — index.html и остальные файлы из public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Неизвестный адрес API -> JSON, а не HTML
app.use('/api', (req, res) => res.status(404).json({ error: 'Такого метода API нет' }));

// Общий обработчик ошибок: клиент всегда получает JSON
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный JSON в запросе' });
  }
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Такая запись уже существует' });
  }

  const status = err.status || 500;
  if (status >= 500) {
    console.error('[Ошибка сервера]', err);
  }
  res.status(status).json({ error: status >= 500 ? 'Внутренняя ошибка сервера' : err.message });
});

async function start() {
  try {
    await testConnection();
    console.log('[ok] Подключение к MySQL установлено:', config.db.host + '/' + config.db.database);
  } catch (err) {
    console.error('\n[!] Не удалось подключиться к MySQL:', err.message);
    console.error('    Проверь DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME в .env');
    console.error('    И убедись, что база создана на сервере.\n');
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`[ok] Сервер запущен: http://localhost:${config.port}`);
  });
}

start();

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const required = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error('\n[!] В файле .env не заполнено: ' + missing.join(', '));
  console.error('    Скопируй .env.example в .env и укажи свои значения.\n');
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('\n[!] JWT_SECRET слишком короткий (нужно минимум 32 символа).');
  console.error('    Сгенерируй так: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n');
  process.exit(1);
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME
  },
  jwtSecret: process.env.JWT_SECRET,
  cookieSecure: String(process.env.COOKIE_SECURE).toLowerCase() === 'true',
  corsOrigin: (process.env.CORS_ORIGIN || '').trim(),
  admin: {
    username: (process.env.ADMIN_USERNAME || 'admin').trim(),
    email: (process.env.ADMIN_EMAIL || 'admin@example.com').trim(),
    password: process.env.ADMIN_PASSWORD || ''
  }
};

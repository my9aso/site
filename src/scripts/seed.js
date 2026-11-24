// Первичное наполнение базы: админ + пара демо-товаров.
// Запуск:  npm run seed
// Повторный запуск безопасен: пароль админа обновится, товары не задублируются.
const config = require('../config');
const { pool } = require('../db');

async function main() {
  if (!config.admin.password || config.admin.password.length < 8) {
    throw new Error('Укажи ADMIN_PASSWORD в .env (минимум 8 символов)');
  }

  const [existing] = await pool.query(
    'SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1',
    [config.admin.username, config.admin.email]
  );

  if (existing.length > 0) {
    await pool.query('UPDATE users SET role = "admin", `password` = ? WHERE id = ?', [
      config.admin.password,
      existing[0].id
    ]);
    console.log(`[ok] Админ «${config.admin.username}» уже был — пароль и роль обновлены`);
  } else {
    await pool.query(
      'INSERT INTO users (username, email, `password`, role) VALUES (?, ?, ?, "admin")',
      [config.admin.username, config.admin.email, config.admin.password]
    );
    console.log(`[ok] Создан админ «${config.admin.username}»`);
  }

  const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM products');
  if (count === 0) {
    const demo = [
      ['Мужчина', 'Мужская модель', 1500.0, 'muzik.png', 10],
      ['Женщина', 'Женская модель', 2000.0, 'zencina.png', 10],
      ['Резинка будущего', 'Та самая', 2500.0, 'ziletka.png', 10]
    ];
    await pool.query(
      'INSERT INTO products (title, description, price, image_url, stock) VALUES ?',
      [demo]
    );
    console.log(`[ok] Добавлено демо-товаров: ${demo.length}`);
  } else {
    console.log('[ok] Товары уже есть — пропускаю');
  }

  console.log('\nГотово. Запускай сервер: npm start');
}

main()
  .catch((err) => {
    console.error('\n[!] Ошибка наполнения базы:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

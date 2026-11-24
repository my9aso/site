const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const STATUSES = ['pending', 'accepted', 'rejected'];

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Некорректный id');
  return id;
}

// Прицепляем состав заявок к списку
async function attachItems(orders) {
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const [items] = await pool.query(
    `SELECT order_id, product_id, title, price, quantity
       FROM order_items
      WHERE order_id IN (?)`,
    [ids]
  );
  const byOrder = new Map();
  for (const item of items) {
    if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []);
    byOrder.get(item.order_id).push(item);
  }
  return orders.map((order) => ({ ...order, items: byOrder.get(order.id) || [] }));
}

// Все заявки: ?status=pending|accepted|rejected (без параметра — все)
router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;

    const params = [];
    let sql = `
      SELECT o.id, o.status, o.total, o.comment, o.created_at, o.decided_at,
             u.id AS user_id, u.username, u.email,
             d.username AS decided_by
        FROM orders o
        JOIN users u ON u.id = o.user_id
        LEFT JOIN users d ON d.id = o.decided_by`;

    if (status) {
      sql += ' WHERE o.status = ?';
      params.push(status);
    }
    // Сначала необработанные (pending), затем новые сверху
    sql += ' ORDER BY (o.status = "pending") DESC, o.id DESC LIMIT 200';

    const [orders] = await pool.query(sql, params);
    res.json({ orders: await attachItems(orders) });
  })
);

// Одна заявка
router.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query(
      `SELECT o.id, o.status, o.total, o.comment, o.created_at, o.decided_at,
              u.id AS user_id, u.username, u.email,
              d.username AS decided_by
         FROM orders o
         JOIN users u ON u.id = o.user_id
         LEFT JOIN users d ON d.id = o.decided_by
        WHERE o.id = ?
        LIMIT 1`,
      [id]
    );
    if (rows.length === 0) throw httpError(404, 'Заявка не найдена');
    const [order] = await attachItems(rows);
    res.json({ order });
  })
);

// Принять заявку: списываем товар со склада
router.post(
  '/orders/:id/accept',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [orders] = await conn.query(
        'SELECT id, status, user_id, total FROM orders WHERE id = ? FOR UPDATE',
        [id]
      );
      if (orders.length === 0) throw httpError(404, 'Заявка не найдена');
      if (orders[0].status !== 'pending') throw httpError(409, 'Эта заявка уже обработана');

      const [items] = await conn.query(
        'SELECT product_id, title, quantity FROM order_items WHERE order_id = ?',
        [id]
      );

      // Сначала проверяем всё, потом списываем — иначе можно списать половину
      for (const item of items) {
        if (!item.product_id) continue;
        const [products] = await conn.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [
          item.product_id
        ]);
        if (products.length === 0) continue;
        if (products[0].stock < item.quantity) {
          throw httpError(
            409,
            `Недостаточно товара «${item.title}» на складе (осталось ${products[0].stock} шт.)`
          );
        }
      }

      for (const item of items) {
        if (!item.product_id) continue;
        await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [
          item.quantity,
          item.product_id
        ]);
      }

      // Деньги списываем с баланса покупателя (как кнопка «Разрешить» на сайте)
      const [buyers] = await conn.query('SELECT balance FROM users WHERE id = ? FOR UPDATE', [
        orders[0].user_id
      ]);
      if (buyers[0].balance < orders[0].total) {
        throw httpError(
          409,
          `У покупателя не хватает баланса: нужно ${orders[0].total} ₽, на счету ${buyers[0].balance} ₽`
        );
      }
      await conn.query('UPDATE users SET balance = balance - ? WHERE id = ?', [
        orders[0].total,
        orders[0].user_id
      ]);

      await conn.query(
        'UPDATE orders SET status = "accepted", decided_at = NOW(), decided_by = ? WHERE id = ?',
        [req.user.id, id]
      );

      await conn.commit();
      res.json({ ok: true, status: 'accepted' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// Отклонить заявку (товар со склада не трогаем)
router.post(
  '/orders/:id/reject',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [result] = await pool.query(
      `UPDATE orders
          SET status = "rejected", decided_at = NOW(), decided_by = ?
        WHERE id = ? AND status = "pending"`,
      [req.user.id, id]
    );
    if (result.affectedRows === 0) throw httpError(409, 'Заявка не найдена или уже обработана');
    res.json({ ok: true, status: 'rejected' });
  })
);

// ---- Запросы на выдачу денег ----

router.get(
  '/money-requests',
  asyncHandler(async (req, res) => {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const params = [];
    let sql = `
      SELECT m.id, m.amount, m.status, m.created_at, m.decided_at,
             u.id AS user_id, u.username, u.email, u.balance,
             d.username AS decided_by
        FROM money_requests m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN users d ON d.id = m.decided_by`;

    if (status) {
      sql += ' WHERE m.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY (m.status = "pending") DESC, m.id DESC LIMIT 200';

    const [rows] = await pool.query(sql, params);
    res.json({ requests: rows });
  })
);

router.post(
  '/money-requests/:id/accept',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [rows] = await conn.query(
        'SELECT id, user_id, amount, status FROM money_requests WHERE id = ? FOR UPDATE',
        [id]
      );
      if (rows.length === 0) throw httpError(404, 'Запрос не найден');
      if (rows[0].status !== 'pending') throw httpError(409, 'Этот запрос уже обработан');

      await conn.query('UPDATE users SET balance = balance + ? WHERE id = ?', [
        rows[0].amount,
        rows[0].user_id
      ]);
      await conn.query(
        'UPDATE money_requests SET status = "accepted", decided_at = NOW(), decided_by = ? WHERE id = ?',
        [req.user.id, id]
      );

      await conn.commit();
      res.json({ ok: true, status: 'accepted' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

router.post(
  '/money-requests/:id/reject',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [result] = await pool.query(
      `UPDATE money_requests
          SET status = "rejected", decided_at = NOW(), decided_by = ?
        WHERE id = ? AND status = "pending"`,
      [req.user.id, id]
    );
    if (result.affectedRows === 0) throw httpError(409, 'Запрос не найден или уже обработан');
    res.json({ ok: true, status: 'rejected' });
  })
);

// Сколько всего висит необработанного — для бейджа в шапке
router.get(
  '/pending-count',
  asyncHandler(async (req, res) => {
    const [[ordersRow]] = await pool.query(
      'SELECT COUNT(*) AS count FROM orders WHERE status = "pending"'
    );
    const [[moneyRow]] = await pool.query(
      'SELECT COUNT(*) AS count FROM money_requests WHERE status = "pending"'
    );
    res.json({
      orders: ordersRow.count,
      money: moneyRow.count,
      total: ordersRow.count + moneyRow.count
    });
  })
);

// Пользователи сайта
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.email, u.role, u.created_at,
              (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders_count,
              (SELECT COUNT(*) FROM cart_items c WHERE c.user_id = u.id) AS cart_count
         FROM users u
        ORDER BY u.id DESC
        LIMIT 500`
    );
    res.json({ users: rows });
  })
);

// ---- Товары (управление из админки) ----

router.get(
  '/products',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, title, description, price, image_url, stock, is_active, created_at
         FROM products ORDER BY id DESC`
    );
    res.json({ products: rows });
  })
);

router.post(
  '/products',
  asyncHandler(async (req, res) => {
    const title = String(req.body?.title || '').trim();
    const description = req.body?.description ? String(req.body.description).trim() : null;
    const price = Number(req.body?.price);
    const stock = Math.trunc(Number(req.body?.stock ?? 0));
    const imageUrl = req.body?.image_url ? String(req.body.image_url).trim() : null;

    if (title.length < 1 || title.length > 190) throw httpError(400, 'Название: от 1 до 190 символов');
    if (!Number.isFinite(price) || price < 0) throw httpError(400, 'Некорректная цена');
    if (!Number.isInteger(stock) || stock < 0) throw httpError(400, 'Некорректное количество');

    const [result] = await pool.query(
      'INSERT INTO products (title, description, price, image_url, stock, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      [title, description, price.toFixed(2), imageUrl, stock]
    );
    res.status(201).json({ product: { id: result.insertId, title, description, price, image_url: imageUrl, stock } });
  })
);

router.patch(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const fields = [];
    const params = [];

    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (title.length < 1 || title.length > 190) throw httpError(400, 'Название: от 1 до 190 символов');
      fields.push('title = ?');
      params.push(title);
    }
    if (req.body?.description !== undefined) {
      fields.push('description = ?');
      params.push(req.body.description ? String(req.body.description).trim() : null);
    }
    if (req.body?.price !== undefined) {
      const price = Number(req.body.price);
      if (!Number.isFinite(price) || price < 0) throw httpError(400, 'Некорректная цена');
      fields.push('price = ?');
      params.push(price.toFixed(2));
    }
    if (req.body?.stock !== undefined) {
      const stock = Math.trunc(Number(req.body.stock));
      if (!Number.isInteger(stock) || stock < 0) throw httpError(400, 'Некорректное количество');
      fields.push('stock = ?');
      params.push(stock);
    }
    if (req.body?.image_url !== undefined) {
      fields.push('image_url = ?');
      params.push(req.body.image_url ? String(req.body.image_url).trim() : null);
    }
    if (req.body?.is_active !== undefined) {
      fields.push('is_active = ?');
      params.push(req.body.is_active ? 1 : 0);
    }

    if (fields.length === 0) throw httpError(400, 'Нечего обновлять');

    params.push(id);
    const [result] = await pool.query(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, params);
    if (result.affectedRows === 0) throw httpError(404, 'Товар не найден');
    res.json({ ok: true });
  })
);

// Удаление — мягкое (товар скрывается, история заявок остаётся целой)
router.delete(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [result] = await pool.query('UPDATE products SET is_active = 0 WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw httpError(404, 'Товар не найден');
    res.json({ ok: true });
  })
);

module.exports = router;

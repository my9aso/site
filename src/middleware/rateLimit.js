// Простой ограничитель частоты запросов (в памяти процесса).
// Защищает вход и регистрацию от перебора паролей.
// Для нескольких процессов/серверов нужен Redis — для одного Node-процесса хватает этого.
function rateLimit({ windowMs = 15 * 60 * 1000, max = 30, message = 'Слишком много попыток. Попробуй позже' } = {}) {
  const hits = new Map(); // ключ -> { count, resetAt }

  // Периодическая уборка, чтобы Map не рос бесконечно
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  if (cleanup.unref) cleanup.unref();

  return function limiter(req, res, next) {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = rateLimit;

// Обёртка, чтобы не писать try/catch в каждом обработчике:
// любая ошибка внутри async-функции попадёт в общий обработчик ошибок.
module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

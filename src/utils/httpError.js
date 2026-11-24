// Простая ошибка с HTTP-статусом: throw httpError(409, 'текст')
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = httpError;

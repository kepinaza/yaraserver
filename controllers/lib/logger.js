const db = require('./db');

async function logAction({
  type,
  username = null,
  telegram_id = null,
  order_id = null,
  message = ''
}) {
  try {
    await db.query(`
      INSERT INTO vip_logs (type, username, telegram_id, order_id, message)
      VALUES (?, ?, ?, ?, ?)
    `, [type, username, telegram_id, order_id, message]);
  } catch (err) {
    console.error("Failed to log action:", err);
  }
}

module.exports = { logAction };

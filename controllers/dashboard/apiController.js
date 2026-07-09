const db = require("../lib/db");
const path = require("path");

const apiDashboard = async (req, res) => {
  try {
    const video = db.prepare('SELECT * FROM video ORDER By created_at DESC LIMIT 1').get();
    const totalVideo = db.prepare("SELECT COUNT(*) as count FROM video").get().count;
    const totalGenres = db.prepare("SELECT COUNT(*) as count FROM genre").get().count;
    const totalSeries = db.prepare("SELECT COUNT(*) as count FROM series").get().count;
    
    res.json({
      video,
      totalVideo,
      totalGenres,
      totalSeries
    });
  } catch (err) {
    console.error("❌ Gagal ambil status dashboard:", err);
    res.status(500).json({ error: err.message });
  }
}

const apiGenre = (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json([]);

  try {
    const results = db.prepare(`
      SELECT name FROM genre
      WHERE LOWER(name) LIKE ?
      ORDER BY name
      LIMIT 10  
    `).all(`%${q}%`);
    res.json(results);
  } catch (err) {
    console.error("❌ Genre lookup failed:", err);
    res.status(500).json([]);
  }
}

const apiSeries = (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  try {
    const results = db.prepare(`
      SELECT series_title, series_code FROM series
      WHERE series_title LIKE ? OR series_code LIKE ?
      ORDER BY series_title
      LIMIT 10
    `).all(`%${q}%`, `%${q}%`);
    res.json(results);
  } catch (err) {
    console.error("❌ Series lookup failed:", err);
    res.status(500).json([]);
  }
}

const apiSearch = (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  try {
  const stmt = db.prepare(`
    SELECT DISTINCT title, series_title FROM video
    WHERE title LIKE ? OR series_title LIKE ?
    ORDER BY title
    LIMIT 10
  `);
  
  const results = stmt.all(`%${q}%`, `%${q}%`);
  res.json(results);
  } catch (err) {
    console.error("❌ Search lookup failed:", err);
    res.status(500).json([]);
  }
}

const apiCode = (req, res) => {
  const prefix = (req.query.prefix || '').toUpperCase().trim();
  if (!prefix.match(/^[A-Z]{3}$/)) return res.status(400).json({ error: 'Invalid prefix' });

  try {
    const row = db.prepare(`
      SELECT code FROM video
      WHERE code LIKE ?
      ORDER BY LENGTH(code) DESC, code DESC
      LIMIT 1
      `).get(`${prefix}%`);

      let nextCode = `${prefix}1`;
      if (row?.code) {
        const numberPart = parseInt(row.code.slice(prefix.length)) || 0;
        nextCode = `${prefix}${numberPart + 1}`;
      }
      
      res.json({ nextCode });
  } catch (err) {
    console.error("❌ Error fetching next code:", err);
    res.status(500).json({ error: 'Database error' });
  }
}

module.exports = {
  apiDashboard,
  apiGenre,
  apiSeries,
  apiSearch,
  apiCode
}
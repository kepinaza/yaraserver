const db = require("../lib/db");
const sanitizeFolderName = require("../../utils/sanitizeFolder");
const path = require("path");
const fs = require("fs");

const getVideo = async (req, res) => {
  const { search = "", sort = "random", rating = "", genre = "", code = "", series = "", page = 1, view = "" } = req.query;
  const limit = 20;
  const offset = (parseInt(page) - 1) * limit;

  if (view === "series") {

    const folders = db.prepare(`
      SELECT 
        series_title as name,
        COUNT(*) as total,
        (
          SELECT thumbnail 
          FROM video v2 
          WHERE v2.series_title = video.series_title 
          ORDER BY RANDOM() 
          LIMIT 1
        ) as thumbnail
      FROM video
      WHERE series_title IS NOT NULL AND series_title != ''
      GROUP BY series_title
      ORDER BY series_title ASC
    `).all();

    return res.render("video", {
      folders,
      folderType: "series",
      isFolderView: true,
      query: req.query,

      // prevent undefined errors
      video: [],
      page: 1,
      totalPages: 1,
      totalAllRatings: 0,
      ratingCounts: {},
      seriesList: [],
      code: "",
      bchCount: 0,
      dwsCount: 0,
      nowCount: folders.length,
      remaining: 0,
      isDump: false
    });
  }

  if (view === "genre") {

    const allvideo = db.prepare(`
      SELECT genre, thumbnail FROM video
      WHERE genre IS NOT NULL AND genre != ''
    `).all();

    const genreMap = {};

    allvideo.forEach(v => {
      v.genre.split(',').map(g => g.trim()).forEach(g => {
        if (!genreMap[g]) {
          genreMap[g] = {
            name: g,
            total: 0,
            thumbnails: []
          };
        }
        genreMap[g].total++;
        genreMap[g].thumbnails.push(v.thumbnail);
      });
    });

    const folders = Object.values(genreMap).map(g => ({
      name: g.name,
      total: g.total,
      thumbnail: g.thumbnails[Math.floor(Math.random() * g.thumbnails.length)]
    }));

    return res.render("video", {
      folders,
      folderType: "genre",
      isFolderView: true,
      query: req.query,

      // prevent undefined errors
      video: [],
      page: 1,
      totalPages: 1,
      totalAllRatings: 0,
      ratingCounts: {},
      seriesList: [],
      code: "",
      bchCount: 0,
      dwsCount: 0,
      nowCount: folders.length,
      remaining: 0,
      isDump: false
    });
  }

  let baseSql = `FROM video WHERE 1=1`;
  const params = [];

  if (search) {
    baseSql += ` AND (title LIKE ? OR code LIKE ? OR genre LIKE ? OR series_title LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (rating) {
    baseSql += ` AND rating = ?`;
    params.push(parseInt(rating));
  }
  
  const totalAllRatings = db.prepare(`SELECT COUNT(*) as count FROM video`).get().count;

  const ratingCounts = {};
  for (let r = 1; r <= 5; r++) {
    const count = db.prepare(`SELECT COUNT(*) as count FROM video WHERE rating = ?`).get(r).count;
    ratingCounts[r] = count;
  }

  if (genre) {
    baseSql += ` AND genre LIKE ?`;
    params.push(`%${genre}%`);
  }

  if (series) {
    baseSql += ` AND series_title LIKE ?`
    params.push(series);
  }

  if (code === "BCH" || code === "DWS") {
    baseSql += ` AND code LIKE ?`;
    params.push(`%${code}%`);
  }

  let orderBy = "ORDER BY RANDOM()";

  if (sort === "newest") {
    orderBy = "ORDER BY created_at DESC";
  } else if (sort === "oldest") {
    orderBy = "ORDER BY created_at ASC";
  }

  const videoSql = `SELECT * ${baseSql} ${orderBy} LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) as count ${baseSql}`

  try {
    const total = db.prepare(countSql).get(...params).count;
    const video = db.prepare(videoSql).all(...params, limit, offset);
    const totalPages = Math.ceil(total / limit);

    const nowCount = Math.min(page * limit, total);
    const remaining = Math.max(total - nowCount, 0);

    // Get distinct series list
    const seriesList = db.prepare(`
      SELECT DISTINCT series_code, series_title 
      FROM video 
      WHERE series_code IS NOT NULL AND series_code != ''
      ORDER BY series_title ASC
    `).all();

    const bchCount = db.prepare(`SELECT COUNT(*) as count FROM video WHERE code LIKE '%BCH%'`).get().count;
    const dwsCount = db.prepare(`SELECT COUNT(*) as count FROM video WHERE code LIKE '%DWS%'`).get().count;

    res.render("video", { 
      video, 
      query: req.query,
      page: parseInt(page),
      totalPages,
      totalAllRatings,
      ratingCounts,
      seriesList, 
      code,
      bchCount,
      dwsCount,
      nowCount,
      remaining,
      isDump: false,
      isFolderView: false
    });
  } catch (err) {
    console.error("Failed to fetch video:", err);
    res.status(500).send("Error loading video.");
  }
}

const dumpVideo = (req, res) => {
  const video = db.prepare(`SELECT * FROM video WHERE is_deleted = 1`).all();

  res.render("video", { 
    video,
    query: {},
    page: 1,
    totalPages: 1,
    totalAllRatings: 0,
    ratingCounts: {},
    seriesList: [],
    code: "",
    bchCount: 0,
    dwsCount: 0,
    nowCount: video.length,
    remaining: 0,
    isDump: true,
    isFolderView: false,
    folders: [],
    folderType: ""
  });
}

const getEditVideo = (req, res) => {
  try {
    const video = db.prepare("SELECT * FROM video WHERE id = ?").get(req.params.id);
    if (!video) return res.status(404).send("Video not found");

    res.render("edit", { video });
  } catch (err) {
    console.error("❌ Edit page error:", err);
    res.status(500).send("Server error");
  }
}

const editVideo = async (req, res) => {
  const { title, rating, genre, series_code, series_title } = req.body;
  const parsedRating = parseInt(rating) || 0;
  const id = req.params.id;

  const existing = db.prepare("SELECT * FROM video WHERE id = ?").get(id);
  if (!existing) return res.status(404).send("Video not found");

  let finalPath = existing.path;
  let duration = existing.duration;
  let size = existing.size;

  const publicRoot = path.resolve("public");

  /* ===============================
     1️⃣ Handle SERIES MOVE logic
  =============================== */

  const oldSeries = existing.series_title?.trim() || "";
  const newSeries = series_title?.trim() || "";

  if (oldSeries !== newSeries) {
    const oldAbsPath = path.join(publicRoot, existing.path);
    let newRelPath;

    // ➕ Assign to a series
    if (newSeries) {
      const folderName = sanitizeFolderName(newSeries);
      const seriesFolder = path.join("Uploads", folderName);
      const seriesAbsFolder = path.join(publicRoot, seriesFolder);

      fs.mkdirSync(seriesAbsFolder, { recursive: true });

      newRelPath = path.join(seriesFolder, path.basename(existing.path));
    }
    // ➖ Remove from series
    else {
      newRelPath = path.join("Uploads", path.basename(existing.path));
    }

    const newAbsPath = path.join(publicRoot, newRelPath);

    // Move file only if path changed
    if (oldAbsPath !== newAbsPath && fs.existsSync(oldAbsPath)) {
      fs.renameSync(oldAbsPath, newAbsPath);
    }

    finalPath = newRelPath;
  }

  /* ===============================
     2️⃣ Handle NEW VIDEO replacement
  =============================== */

  if (req.file) {
    const file = req.file;

    let uploadFolder = "Uploads";
    if (newSeries) {
      const folderName = sanitizeFolderName(newSeries);
      uploadFolder = path.join("Uploads", folderName);
      fs.mkdirSync(path.join(publicRoot, uploadFolder), { recursive: true });
    }

    finalPath = path.join(uploadFolder, file.filename);
    const fullPath = path.join(publicRoot, finalPath);

    const stat = fs.statSync(fullPath);
    size = stat.size;

    await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(fullPath, (err, meta) => {
        if (err) return reject(err);
        duration = meta.format.duration;
        resolve();
      });
    });
  }

  /* ===============================
     3️⃣ Update DATABASE
  =============================== */

  db.prepare(`
    UPDATE video SET
      title = ?,
      rating = ?,
      genre = ?,
      series_code = ?,
      series_title = ?,
      path = ?,
      duration = ?,
      size = ?
    WHERE id = ?
  `).run(
    title,
    parsedRating,
    genre,
    series_code || null,
    series_title || null,
    finalPath,
    duration,
    size,
    id
  );

  // Ensure series exists
  if (series_title) {
    db.prepare(`
      INSERT OR IGNORE INTO series (series_code, series_title)
      VALUES (?, ?)
    `).run(series_code, series_title);
  }

  res.redirect("/video");
}

const getIdVideo = (req, res) => {
  try {
    const video = db.prepare("SELECT * FROM video WHERE id = ?").get(req.params.id);
    if (!video) return res.status(404).send("Video not found");
    res.render("video_preview", { video });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
}

const getDumpId = (req, res) => {
  const id = req.params.id;

  db.prepare(`
    UPDATE video
    SET is_deleted = 1
    WHERE id = ?
  `).run(id);

  res.sendStatus(200);
}

const restoreVideo = (req, res) => {
  db.prepare(`
    UPDATE video SET is_deleted = 0 WHERE id = ?  
  `).run(req.params.id);

  res.redirect('/video/dump');
}

const deleteVideo = (req, res) => {
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).send("Invalid password");
  }

  const video = db.prepare("SELECT * FROM video WHERE id = ?").get(req.params.id);
  if (!video) return res.status(404);

  const absPath = path.join("public", video.path);
  if (fs.existsSync(absPath)) fs.unlinkSync(absPath);

  const absThumPath = path.join("public", video.thumbnail);
  if (fs.existsSync(absThumPath)) fs.unlinkSync(absThumPath);

  db.prepare("DELETE FROM video WHERE id = ?").run(req.params.id);

  res.sendStatus(200);
}

module.exports = {
    getVideo,
    dumpVideo,
    getEditVideo,
    editVideo,
    getIdVideo,
    getDumpId,
    restoreVideo,
    deleteVideo
}
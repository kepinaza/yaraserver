require('dotenv').config();
const express = require('express');
const PORT = process.env.PORT || 4040;
const { handler } = require('./controllers/index');
const path = require('path');
const cron = require('node-cron');
const db = require('./controllers/lib/db');
const fs = require('fs');
const multer = require('multer');
const FormData = require('form-data');
const formData = new FormData();
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const { checkExpiredVIPs, checkVideoSchedules, uploadNow, newVideoLog, saweriaMMS, sendReminders } = require('./controllers/lib/telegram');
const { setTelegramWebhook, getTelegramWebhookInfo, deleteTelegramWebhook } = require('./utils/telegramWebhook');
const { logAction } = require('./controllers/lib/logger');
const { axiosInstance } = require("./controllers/lib/axios");

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = path.join(__dirname, "public", "Uploads");
    fs.mkdirSync(folder, { recursive: true });
    cb(null, folder);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

cron.schedule("*/1 * * * *", async () => {
  console.log("⏰ Checking for videos to send...");
  await checkVideoSchedules();
});

cron.schedule('*/5 * * * *', async () => {
  console.log("⏰ Menjalankan pemeriksaan VIP yang kadaluarsa...");
  await checkExpiredVIPs();

  console.log("🔔 Mengecek pengingat pembayaran...");
  await sendReminders();
});

const app = express();
app.use(express.urlencoded({extended: true}));
app.use(express.json());
app.use("/Uploads", express.static(path.join(__dirname, "public", "Uploads")));
app.set('view engine', 'ejs');

app.post("/", async (req, res) => {
  try {
    const result = await handler(req);
    res.send(result);
  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.status(200).send("OK");
  }
});

app.get("/", (req, res) => {
  res.render("dashboard");
});

// Render upload form
app.get("/upload", (req, res) => {
  res.render("upload");  // Make sure your views folder has upload.ejs
});

app.post('/webhook/saweria', async (req, res) => {
  try {
    const sawer = await saweriaMMS(req.body);
    res.status(200), {sawer};
  } catch (error) {
    console.error('Webhook error:', error.message);
    console.log(error);
    res.status(500);
  }
});

// Handle video upload POST
app.post("/upload", upload.single("video"), async (req, res) => {
  const { title, code, scheduled_date } = req.body;
  const file = req.file;

  if (!file) return res.status(400).send("No video uploaded.");

  const filepath = `Uploads/${file.filename}`;
  const fullFilePath = path.resolve("public", filepath);

  // Generate thumbnail paths
  const thumbFilename = file.filename.replace(/\.[^/.]+$/, ".jpg");
  const thumbDir = path.resolve("public", "Uploads", "thumbnails");
  const thumbFullPath = path.join(thumbDir, thumbFilename);
  const thumbRelativePath = `Uploads/thumbnails/${thumbFilename}`;

  // Ensure the thumbnails directory exists
  if (!fs.existsSync(thumbDir)) {
    fs.mkdirSync(thumbDir, { recursive: true });
  }

  // Get file size
  let size;
  try {
    const stat = fs.statSync(fullFilePath);
    size = stat.size; // bytes
  } catch (err) {
    console.error("❌ File stat error:", err);
    return res.status(500).send("Failed to read video file.");
  }

  // Get video duration and generate thumbnail in one ffprobe + screenshots sequence
  ffmpeg.ffprobe(fullFilePath, (err, metadata) => {
    if (err) {
      console.error("❌ ffprobe error:", err);
      return res.status(500).send("Failed to read video metadata.");
    }

    const duration = metadata.format.duration; // seconds

    // Generate thumbnail
    ffmpeg(fullFilePath)
      .on("end", async () => {
        try {
          await db.query(
            `INSERT INTO videos (title, code, path, thumbnail, scheduled_date, sent, duration, size) VALUES (?, ?, ?, ?, ?, FALSE, ?, ?)`,
            [title, code, filepath, thumbRelativePath, scheduled_date, duration, size]
          );

          await newVideoLog();

          res.redirect("/videos");
        } catch (err) {
          console.error("❌ Database error:", err);
          res.status(500).send("Failed to save video data.");
        }
      })
      .on("error", (err) => {
        console.error("❌ Thumbnail generation error:", err);
        res.status(500).send("Failed to generate thumbnail.");
      })
      .screenshots({
        count: 1,
        folder: thumbDir,
        filename: thumbFilename,
        size: "320x240"
      });
  });
});

app.post("/videos/upload/:id", async (req, res) => {
  const videoId = req.params.id;
  try {
    await uploadNow(videoId);
    res.redirect("/videos")
  } catch (err) {
    console.error("❌ Manual upload failed:", err.message);
    if (!res.headersSent) {
      res.status(500).send("Upload failed.");
    }
  }
});

// List all videos
app.get("/videos", async (req, res) => {
  const { search = "", status = "", sort = "newest" } = req.query;

  let sql = "SELECT * FROM videos WHERE 1";
  const params = [];

  if (search) {
    sql += " AND (title LIKE ? OR code LIKE ?)";
    const keyword = `%${search}%`;
    params.push(keyword, keyword);
  }

  if (status === "scheduled") {
    sql += " AND sent = 0";
  } else if (status === "sent") {
    sql += " AND sent = 1";
  }

  // Sorting logic
  if (sort === "oldest") {
    sql += " ORDER BY scheduled_date ASC";
  } else {
    sql += " ORDER BY scheduled_date DESC";
  }

  try {
    const [videos] = await db.query(sql, params);
    res.render("videos", { videos, query: req.query });
  } catch (err) {
    console.error("Failed to fetch videos:", err);
    res.status(500).send("Error loading videos.");
  }
});

app.get("/videos/:id", async (req, res) => {
  try {
    const [result] = await db.query("SELECT * FROM videos WHERE id = ?", [req.params.id]);
    if (result.length === 0) return res.status(404).send("Video not found");

    res.render("video_preview", { video: result[0] });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const [
      webhookInfo,
      [vipRows],
      [vipTotalResult],
      [logRows],
      [logTotalResult],
      [latestVideo],
      [paymentRows]
    ] = await Promise.all([
      getTelegramWebhookInfo(),
      db.query("SELECT * FROM vip_members ORDER BY join_date DESC LIMIT 5"),
      db.query("SELECT COUNT(*) AS total FROM vip_members"),
      db.query("SELECT * FROM vip_logs ORDER BY log_time DESC LIMIT 5"),
      db.query("SELECT COUNT(*) AS total FROM vip_logs"),
      db.query("SELECT * FROM videos WHERE sent = FALSE ORDER BY scheduled_date DESC LIMIT 1"),
      db.query("SELECT * FROM payments ORDER BY created_at DESC LIMIT 5")
    ]);

    res.json({
      webhookInfo,
      vip: {
        total: vipTotalResult[0]?.total || 0,
        latest: vipRows
      },
      logs: {
        total: logTotalResult[0]?.total || 0,
        latest: logRows
      },
      video: latestVideo[0] || null,
      payments: paymentRows
    });
  } catch (err) {
    console.error("❌ Gagal ambil status dashboard:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/telegram-webhook", async (req, res) => {
  const { handler } = require("./controllers/index");
  try {
    const response = await handler(req);
    res.status(200).send(response);
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).send("Internal error");
  }
});

app.get("/webhook", async (req, res) => {
  try {
    const info = await getTelegramWebhookInfo();
    res.render("webhook", { info });
  } catch (err) {
    console.error("❌ Error getting webhook info:", err);
    res.status(500).send("Failed to get webhook info");
  }
});

app.post("/webhook/set", async (req, res) => {
  const { url } = req.body;
  try {
    const result = await setTelegramWebhook(url);
    res.redirect("/webhook");
  } catch (err) {
    console.error("❌ Error setting webhook:", err);
    res.status(500).send("Failed to set webhook");
  }
});

app.post("/webhook/delete", async (req, res) => {
  try {
    await deleteTelegramWebhook();
    res.redirect("/webhook");
  } catch (err) {
    console.error("❌ Error deleting webhook:", err);
    res.status(500).send("Failed to delete webhook");
  }
});

app.get('/vip', async (req, res) => {
  const vipPage = parseInt(req.query.vipPage) || 1;
  const limit = 10;
  const vipOffset = (vipPage - 1) * limit;

  try {
    const [vipData] = await db.query(
      "SELECT * FROM vip_members ORDER BY join_date DESC LIMIT ? OFFSET ?",
      [limit, vipOffset]
    );

    const [countResult] = await db.query("SELECT COUNT(*) AS total FROM vip_members");
    const vipTotal = countResult[0].total;

    const vipTotalPages = Math.ceil(vipTotal / limit);

    res.render('vip', {
      vip: vipData,
      vipPage,
      vipTotalPages,
    });
  } catch (err) {
    console.error("❌ Gagal mengambil data dashboard:", err);
    res.status(500).send("Gagal mengambil data");
  }
});

app.get('/log', async (req, res) => {
  const logPage = parseInt(req.query.logPage) || 1;
  const limit = 10;
  const logOffset = (logPage - 1) * limit;

  try {
    const [logData] = await db.query(
      "SELECT * FROM vip_logs ORDER BY log_time DESC LIMIT ? OFFSET ?",
      [limit, logOffset]
    );

    const [countResult] = await db.query("SELECT COUNT(*) AS total FROM vip_logs");
    const logTotal = countResult[0].total;

    const logTotalPages = Math.ceil(logTotal / limit);

    res.render('log', {
      logs: logData,
      logPage,
      logTotalPages
    });
  } catch (err) {
    console.error("❌ Gagal mengambil data dashboard:", err);
    res.status(500).send("Gagal mengambil data");
  }
});

app.get('/payment', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    const search = req.query.search || '';
    const verified = req.query.verified;

    let sql = `SELECT * FROM payments WHERE 1=1`;
    let countSql = `SELECT COUNT(*) as count FROM payments WHERE 1=1`;
    const params = [];
    const countParams = [];

    if (search) {
      sql += ` AND (donator_name LIKE ? OR donator_email LIKE ?)`;
      countSql += ` AND (donator_name LIKE ? OR donator_email LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
      countParams.push(`%${search}%`, `%${search}%`);
    }

    if (verified === '1' || verified === '0') {
      sql += ` AND verified = ?`;
      countSql += ` AND verified = ?`;
      params.push(verified);
      countParams.push(verified);
    }

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [payment] = await db.execute(sql, params);
    const [[{ count }]] = await db.execute(countSql, countParams);
    const totalPages = Math.ceil(count / limit);

    res.render('payment', {
      payment,
      page,
      totalPages,
      search,
      verified
    });
  } catch (err) {
    console.error('Error loading payment:', err.message);
    res.status(500).send('Server error');
  }
});


app.listen(PORT, async () => {
    console.log("Server listening on PORT", PORT);
});
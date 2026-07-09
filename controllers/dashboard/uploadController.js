const {ffmpeg, ffmpegPath, ffprobePath} = require("../../utils/ffmpeg");
const db = require("../lib/db");
const path = require("path");
const fs = require("fs");

const getUpload = async (req, res) => {
  const genres = db.prepare("SELECT * FROM genre ORDER BY name ASC").all();
  res.render("upload", { genres });  // Make sure your views folder has upload.ejs
};

// Handle video upload POST
const postUpload = async (req, res) => {
  const { title, code, rating, genre, is_series, series_code, series_title } = req.body;
  const parsedRating = parseInt(rating) || 0;
  const file = req.file;

  if (!file) return res.status(400).send("No video uploaded.");

  const originalFilePath = path.resolve ("public", "Uploads", file.filename);
  let uploadFolder = "Uploads";

  if (is_series === 'true' && typeof series_title == 'string' && series_title.trim()) {
    const folderName = series_title.trim().replace(/[\\/:*?"<>|]/g, "_");
    uploadFolder = path.join("Uploads", folderName);
    const fullSeriesPath = path.resolve("public", uploadFolder);
    fs.mkdirSync(fullSeriesPath, { recursive: true });

    const newPath = path.join(fullSeriesPath, file.filename);
    fs.renameSync(originalFilePath, newPath);
  } 

  const filepath = path.join(uploadFolder, file.filename);
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
          db.prepare(`
            INSERT INTO video (title, code, path, thumbnail, duration, size, rating, genre, series_code, series_title) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(title, code, filepath, thumbRelativePath, duration, size, parsedRating, genre, series_code, series_title);

          // Insert series
          db.prepare(`
            INSERT OR IGNORE INTO series (series_code, series_title)
            VALUES (?, ?)
          `).run(series_code, series_title);

          // Insert genres
          const genreList = genre.split(",").map(g => g.trim().toLowerCase()).filter(g => g);
          const insertGenreStmt = db.prepare("INSERT OR IGNORE INTO genre (name) VALUES (?)");

          for (const g of genreList) {
            insertGenreStmt.run(g);
          }

          res.redirect("/upload");
          console.log(`✅ Video uploaded successfully. (${title} - ${code})`)
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
};

module.exports = {
    getUpload,
    postUpload
}
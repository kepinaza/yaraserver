const multer = require("multer");
const fs = require("fs");
const path = require("path");

const storage = multer.diskStorage({
    destination(req, file, cb) {
        const folder = path.join(__dirname, "..", "public", "Uploads");
        fs.mkdirSync(folder, { recursive: true });
        cb(null, folder);
    },
    filename(req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

module.exports = multer({ storage });
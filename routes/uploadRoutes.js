const router = require("express").Router();
const {getUpload, postUpload} = require("../controllers/dashboard/uploadController");
const upload = require("../middlewares/uploadMiddleware");

router.get("/", getUpload);
router.post("/", upload.single("video"), postUpload);

module.exports = router;
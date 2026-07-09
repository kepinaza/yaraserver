const router = require("express").Router();
const {getVideo, dumpVideo, getEditVideo, editVideo, getIdVideo, getDumpId, restoreVideo, deleteVideo} = require("../controllers/dashboard/videoController");
const upload = require("../middlewares/uploadMiddleware");
const express = require("express");

router.get("/", getVideo);
router.get("/dump", dumpVideo);
router.get("/edit/:id", getEditVideo);
router.get("/:id", getIdVideo);
router.post("/edit/:id", upload.single("video"), editVideo);
router.post("/dump/:id", getDumpId);
router.post("/restore/:id", restoreVideo);
router.post("/delete/:id", express.json() , deleteVideo);

module.exports = router;
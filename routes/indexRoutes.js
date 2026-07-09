const router = require("express").Router();
const {dashboard} = require("../controllers/dashboard/indexController");

router.get("/", dashboard);

module.exports = router;
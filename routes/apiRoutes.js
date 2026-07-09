const router = require("express").Router();
const {apiDashboard, apiGenre, apiSeries, apiSearch, apiCode} = require("../controllers/dashboard/apiController");

router.get("/dashboard", apiDashboard);
router.get("/genre", apiGenre);
router.get("/series", apiSeries);
router.get("/search", apiSearch);
router.get("/code", apiCode);

module.exports = router;
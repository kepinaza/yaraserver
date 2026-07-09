const express = require("express");
const path = require("path");

require("dotenv").config();
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use("/Uploads", express.static(path.join(__dirname, "public/Uploads")));

app.set("view engine", "ejs");

app.use("/", require("./routes/indexRoutes"));
app.use("/upload", require("./routes/uploadRoutes"));
app.use("/video", require("./routes/videoRoutes"));
app.use("/api", require("./routes/apiRoutes"));

const PORT = process.env.PORT || 4040;

app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
});
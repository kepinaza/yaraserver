function sanitizeFolderName(name) {
  return name.trim().replace(/[\\/:*?"<>|]/g, "");
}

module.exports = sanitizeFolderName;
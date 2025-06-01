const { axiosInstance } = require("../controllers/lib/axios");
const db = require("../controllers/lib/db");

async function setTelegramWebhook(webhookUrl) {
  try {
    const response = await axiosInstance.get("setWebhook", { url: webhookUrl });
    return response.data;
  } catch (err) {
    throw err.response?.data || err.message;
  }
}

async function getTelegramWebhookInfo() {
  try {
    const response = await axiosInstance.get("getWebhookInfo");
    return response.data;
  } catch (err) {
    throw err.response?.data || err.message;
  }
}

async function deleteTelegramWebhook() {
  try {
    const response = await axiosInstance.get("deleteWebhook");
    return response.data;
  } catch (err) {
    throw err.response?.data || err.message;
  }
}

module.exports = {
  setTelegramWebhook,
  getTelegramWebhookInfo,
  deleteTelegramWebhook
};

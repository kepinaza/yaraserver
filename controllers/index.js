const { handleMessage, handleMemberUpdate } = require("./lib/telegram");

async function handler(req) {
    const body = req.body;

    if (!body) return "No Body";

    if (body.message) {
        await handleMessage(body.message);
    }

    if (body.chat_member) {
        await handleMemberUpdate(body);
    }

    return "OK";
}

module.exports = { handler };

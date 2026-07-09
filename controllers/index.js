async function handler(req) {
    const body = req.body;

    if (!body) return "No Body";

    return "OK";
}

module.exports = { handler };

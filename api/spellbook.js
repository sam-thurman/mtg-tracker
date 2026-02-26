// Vercel serverless function: proxies requests to Commander Spellbook API
// to avoid CORS issues from the browser.
export default async function handler(req, res) {
    // Forward the query string (e.g. ?q=card%3D"Sol Ring")
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const apiUrl = `https://backend.commanderspellbook.com/variants/${qs}`;

    try {
        const apiRes = await fetch(apiUrl, {
            headers: { Accept: "application/json" },
        });

        const body = await apiRes.text();

        res.status(apiRes.status);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(body);
    } catch (err) {
        res.status(500).json({ error: String(err) });
    }
}

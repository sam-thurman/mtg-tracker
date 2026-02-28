// Vercel serverless function: proxies requests to Card Kingdom API
// to avoid CORS issues from the browser and potentially handle large response limits.
export default async function handler(req, res) {
    const apiUrl = `https://api.cardkingdom.com/api/pricelist`;

    try {
        const apiRes = await fetch(apiUrl, {
            headers: { Accept: "application/json" },
        });

        if (!apiRes.ok) {
            res.status(apiRes.status).json({ error: `Card Kingdom API returned ${apiRes.status}` });
            return;
        }

        const body = await apiRes.text();

        res.status(200);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate"); // Cache on Vercel edge for 1 hour
        res.end(body);
    } catch (err) {
        res.status(500).json({ error: String(err) });
    }
}

import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";

const app = express();

app.use(express.json());

// Security Middleware to prevent scraping
const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://test-download2-vidvault.vercel.app'];
const API_KEY = 'StreamSearch-V1-Secret-Key-8392';

app.use((req, res, next) => {
    // Only protect the API routes, not static files or the /gdirect page
    if (req.path === '/search' || req.path === '/download-links') {
        const origin = req.headers.origin || req.headers.referer;
        
        // Simple Origin check (if origin is present)
        if (origin && !ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed))) {
            return res.status(403).json({ error: 'Access denied: Invalid Origin' });
        }

        // Custom API Key check
        const clientApiKey = req.headers['x-api-key'];
        if (clientApiKey !== API_KEY) {
            return res.status(403).json({ error: 'Access denied: Invalid or missing API Key' });
        }
    }
    
    // Add basic CORS headers for our frontend
    const reqOrigin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(reqOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', reqOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    }

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
});
app.use(express.static("public"));

async function getDownloadLinks(pageUrl) {
    const res = await axios.get(pageUrl, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        },
    });

    const $ = cheerio.load(res.data);
    const links = [];
    const extractionPromises = [];

    $(".download-links-div a.btn").each((_, el) => {
        const parentText = $(el)
            .closest("h3")
            .prev()
            .text()
            .trim() || $(el).closest("h3").text().trim();

        const buttonText = $(el).text().replace(/\s+/g, " ").trim();
        const url = $(el).attr("href");

        if (url && url.includes("nexdrive.")) {
            extractionPromises.push(
                axios.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36" } })
                    .then(innerRes => {
                        const $2 = cheerio.load(innerRes.data);
                        const resolvedLinks = [];
                        
                        const isWebSeries = $2(".ep-title-h4").length > 0;

                        if (isWebSeries) {
                            $2(".ep-title-h4").each((_, epHeader) => {
                                const epTitle = $2(epHeader).text().trim();
                                const btnWrap = $2(epHeader).next(".ep-buttons-wrap");
                                const epLinks = [];
                                btnWrap.find("a").each((_, innerEl) => {
                                    const innerText = $2(innerEl).text().replace(/\s+/g, " ").trim();
                                    if (innerText.includes("G-Direct") || innerText.includes("VGMLINKS") || innerText.includes("V-Gmlinks")) {
                                        epLinks.push({
                                            title: innerText,
                                            url: $2(innerEl).attr("href")
                                        });
                                    }
                                });
                                if (epLinks.length > 0) {
                                    resolvedLinks.push({
                                        episodeTitle: epTitle,
                                        links: epLinks
                                    });
                                }
                            });
                        } else {
                            const singleLinks = [];
                            $2("a").each((_, innerEl) => {
                                const innerText = $2(innerEl).text().replace(/\s+/g, " ").trim();
                                if (innerText.includes("G-Direct") || innerText.includes("VGMLINKS") || innerText.includes("V-Gmlinks")) {
                                    singleLinks.push({
                                        title: innerText,
                                        url: $2(innerEl).attr("href")
                                    });
                                }
                            });
                            if (singleLinks.length > 0) {
                                resolvedLinks.push({
                                    episodeTitle: null,
                                    links: singleLinks
                                });
                            }
                        }

                        links.push({
                            quality: parentText || null,
                            title: buttonText,
                            url: url,
                            directLinks: resolvedLinks
                        });
                    })
                    .catch(err => {
                        console.error(`Failed to fetch inner links for ${url}:`, err.message);
                        links.push({
                            quality: parentText || null,
                            title: buttonText,
                            url: url,
                            directLinks: []
                        });
                    })
            );
        } else {
            links.push({
                quality: parentText || null,
                title: buttonText,
                url: url,
                directLinks: []
            });
        }
    });

    await Promise.all(extractionPromises);
    return links;
}

app.post("/download-links", async (req, res) => {
    try {
        const { url } = req.body;

        const resLinks = await getDownloadLinks(url);

        res.json(resLinks);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post("/search", async (req, res) => {
    try {
        const { query } = req.body;

        const body = new URLSearchParams({
            do: "search",
            subaction: "search",
            story: query
        });

        const response = await axios.post(
            "https://vegamovie.ss/",
            body.toString(),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/137 Safari/537.36",
                    Referer: "https://vegamovie.ss/",
                    Origin: "https://vegamovie.ss/"
                }
            }
        );

        const $ = cheerio.load(response.data);

        const results = [];

        $("article.post-item").each((_, el) => {
            const card = $(el);

            results.push({
                title: card.find(".entry-title a").text().trim(),
                url: card.find(".entry-title a").attr("href"),
                image: new URL(
                    card.find("img").attr("src"),
                    "https://vegamovie.ss"
                ).href,
                date: card.find(".date-time span").text().trim()
            });
        });

        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get("/gdirect", async (req, res) => {
    try {
        const targetUrl = req.query.url;
        if (!targetUrl) return res.send("No URL provided");

        const fetchRes = await fetch(targetUrl, {
            method: "POST",
            headers: {
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "accept-language": "en-US,en;q=0.6",
                "cache-control": "no-cache",
                "content-type": "application/x-www-form-urlencoded",
                "pragma": "no-cache",
                "priority": "u=0, i",
                "sec-ch-ua": `"Brave";v="149", "Chromium";v="149", "Not)A;Brand";v="24"`,
                "sec-ch-ua-arch": `""`,
                "sec-ch-ua-bitness": `"64"`,
                "sec-ch-ua-full-version-list": `"Brave";v="149.0.0.0", "Chromium";v="149.0.0.0", "Not)A;Brand";v="24.0.0.0"`,
                "sec-ch-ua-mobile": "?1",
                "sec-ch-ua-model": `"Pixel 9"`,
                "sec-ch-ua-platform": `"Android"`,
                "sec-ch-ua-platform-version": `"15"`,
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "same-origin",
                "sec-fetch-user": "?1",
                "sec-gpc": "1",
                "upgrade-insecure-requests": "1",
                "cookie": "cf_clearance=M8Mw1kqXyEHm6T_Uji0KYKfXJEFqWoBDuiqbp6AbvO4-1782969833-1.2.1.1-iOLxJHxvzVZ.OTExuMuhIhsabVwFdqOoJQdCPm1ohJsDZPRv5uBD7pmE0eSwwA1Dw.QjLIDDFjAfBujJ5K10lxPMn9sWIai3b1V3hg2pU5u9rH.w0H0zlQ9TuYy.JMXkszoTxYYpX0X0gHTdTtGtbSwS1m8FlV5kyi5pwS7zv2YlMz8FkndTpHxYF8joX9b7cvcaESLqQOG_3T_O9ryw8DE0L4WXIpcH.VlkF8Yx8kWYWRSkHoy00.A8uI9u27VE.ATQCvBmjNlG1Oh7AAKVeeWDJjO3tdqNdhZBG6k08ahRyrP7y4l2j.Wa3JnBhzjGQVyRyE6zbT28PTFnY.nMm.94hY8YHyPCn5IxepF9NSuq8ZMsneBO5v5cs54y8EwyH5e5uOALty5OT33lH7MENvIp6OPsQ45dbtdcLw_jHKEX3GMgfUE78Z2ul3Cu6rY3etLBwYmdV06zNtRBy0o0_MUT.SWK.zw.1Cks6Vb8Fq.KqRC5IMzHElH.5ZQltxU8",
                "Referer": "https://fast-dl.one/dl/b027f0?__cf_chl_f_tk=r8e2a8DZdCUOLRc4rycvf33XjEoMkyLoQYp3rGv7fUw-1782969818-1.0.1.1-Iq49mDUAc_mWRuc7GBCj5nITm40I_yEU9rbLM2wfZIw"
            },
            body: "cf-turnstile-response=1.6AkLhkaw6VgCY_Uqo9Zq6ehnoIgX6TGnnzQkgTQRzapfonDBF2O6OpI5Si2GzW8bZN7LI5fLfzI25OlLeozPI6doLZdNdjn3VE9jnJCONnuwiIbXGtWlVs6hpENoYyW49KRS4vA49oPFsWAlvmaaBuhX3N4UQxSV5MpMLpGk8aCSmPB34OlNoldVk4J3x1Q7uSDGb3k0ryuDAeV4s-lwQ2DyNV7BLOFoB3JO8l0DLisDgDOeZodQsfKpZJRNhHxDI7uMBSmBSV5CicUg5KZLBQR6iPSbSlNUba4e5BVpjzPnpx960ym_eUWbeuiKVrfEGhW8aDGVyZwt3hH2q5GIzGoOrKpnd6sertb6CAbaNA644uSz2jx0WLGOaCCy149sne6LLvx-cwx3rSKFMqEUzCx3Z30LVlZjIC7_FAcr47dAAxOtnP9eBXHHfk_GWuZEsWIOPnJKwETfB9rFTPJHJ1Dnga4NB2LoqtmxJGj81mn09tWuvZ0LpncREb21hF5yc_6wFqOyO-KXIHs6bUQ0nqjV6GnrhO5d2vOxU951BUFB8PEBCBRPx9fw_uQalij6ZdSWP8gZ2ufb0B5rk8X1fYo7BpfvU860x_e9mOo5xzN9mGRASyJhn58ZaWjp_AnpjIf1VVDxTV2R7UyQYph-Z-BlAEnAMxSY7I9OGyhFzOk.B1w_pdEleCTwagkgHRYDkQ.d6bb66d3ef2426d1a898fd030fe4f6a6bb71b2e553b6ceb020ee4bb0f07e21df"
        });

        const html = await fetchRes.text();
        const $ = cheerio.load(html);
        const vdLink = $("a#vd").attr("href");

        if (vdLink) {
            res.send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Download Link Ready - StreamSearch</title>
                    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
                    <style>
                        body {
                            font-family: 'Outfit', sans-serif;
                            margin: 0;
                            height: 100vh;
                            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                            color: #f8fafc;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                        }
                        .card {
                            background: rgba(30, 41, 59, 0.7);
                            backdrop-filter: blur(15px);
                            -webkit-backdrop-filter: blur(15px);
                            border: 1px solid rgba(255, 255, 255, 0.1);
                            padding: 40px 30px;
                            border-radius: 24px;
                            text-align: center;
                            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                            max-width: 450px;
                            width: 90%;
                            animation: slideUp 0.5s ease-out;
                        }
                        @keyframes slideUp {
                            from { opacity: 0; transform: translateY(20px); }
                            to { opacity: 1; transform: translateY(0); }
                        }
                        h2 {
                            margin-top: 0;
                            font-size: 2rem;
                            font-weight: 700;
                            background: linear-gradient(to right, #3b82f6, #8b5cf6);
                            -webkit-background-clip: text;
                            -webkit-text-fill-color: transparent;
                            margin-bottom: 12px;
                        }
                        p {
                            color: #94a3b8;
                            font-size: 1.1rem;
                            margin-bottom: 30px;
                            line-height: 1.5;
                        }
                        .btn {
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            gap: 10px;
                            padding: 16px 32px;
                            background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
                            color: white;
                            text-decoration: none;
                            border-radius: 50px;
                            font-weight: 600;
                            font-size: 1.1rem;
                            box-shadow: 0 10px 20px rgba(139, 92, 246, 0.3);
                            transition: all 0.3s ease;
                        }
                        .btn:hover {
                            transform: translateY(-3px);
                            box-shadow: 0 15px 30px rgba(139, 92, 246, 0.4);
                            background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
                        }
                        .btn svg {
                            width: 20px;
                            height: 20px;
                        }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2>Your File is Ready</h2>
                        <p>Your high-speed download link from Google Servers has been successfully generated.</p>
                        <a href="${vdLink}" class="btn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            Download Now
                        </a>
                    </div>
                </body>
                </html>
            `);
        } else {
            res.send("Could not extract googleusercontent link. It's possible the token expired or the page structure changed.");
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Error processing the request: " + err.message);
    }
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    app.listen(3000, () =>
        console.log("http://localhost:3000")
    );
}

export default app;
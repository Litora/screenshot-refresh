import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
// Required environment variables
const REQUIRED_ENVS = [
    "SITE_URL",
    "SCREENSHOTONE_ACCESS_KEY",
    "SCREENSHOTONE_SECRET_KEY",
    "WORKER_UPLOAD_URL",
    "WORKER_UPLOAD_SECRET",
];
for (const name of REQUIRED_ENVS) {
    if (!process.env[name]) {
        console.error(`❌ Missing required environment variable: ${name}`);
        process.exit(1);
    }
}
// Read env variables after check
const SITE_URL = process.env.SITE_URL;
const SCREENSHOTONE_ACCESS_KEY = process.env.SCREENSHOTONE_ACCESS_KEY;
const SCREENSHOTONE_SECRET_KEY = process.env.SCREENSHOTONE_SECRET_KEY;
const WORKER_UPLOAD_URL = process.env.WORKER_UPLOAD_URL;
const WORKER_UPLOAD_SECRET = process.env.WORKER_UPLOAD_SECRET;
const POLL_RETRIES = Number(process.env.POLL_RETRIES ?? 30);
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL ?? 10); // seconds
const EXPECT_TEXT = process.env.EXPECT_TEXT ?? "";
const OUT_FILE = path.resolve("screenshot.png");
function buildUrl(options) {
    const query = new URLSearchParams(options);
    const hmac = crypto.createHmac("sha256", SCREENSHOTONE_SECRET_KEY);
    hmac.update(query.toString());
    const signature = hmac.digest("hex");
    query.append("signature", signature);
    const url = `https://api.screenshotone.com/take?${query}`;
    return url;
}
async function waitForSite() {
    for (let i = 0; i < POLL_RETRIES; i++) {
        try {
            const res = await axios.get(SITE_URL, { timeout: 5000 });
            if (res.status === 200) {
                if (!EXPECT_TEXT || res.data.includes(EXPECT_TEXT)) {
                    console.log("✅ Site is live");
                    return;
                }
            }
        }
        catch {
            // ignore temporary errors
        }
        console.log(`⏳ Waiting for site... (${i + 1}/${POLL_RETRIES})`);
        await new Promise((r) => setTimeout(r, POLL_INTERVAL * 1000));
    }
    throw new Error("Site did not become available in time");
}
async function takeScreenshot() {
    const options = {
        access_key: SCREENSHOTONE_ACCESS_KEY,
        url: SITE_URL,
        format: "png",
        delay: "0",
        timeout: "60",
        response_type: "by_format",
        image_quality: "100",
    };
    const screenshotUrl = buildUrl(options);
    const response = await axios.get(screenshotUrl, {
        responseType: "arraybuffer",
    });
    fs.writeFileSync(OUT_FILE, Buffer.from(response.data));
    console.log("✅ Screenshot saved");
}
function computeHmac(buffer, secret, timestamp) {
    const h = crypto.createHmac("sha256", secret);
    h.update(timestamp + ".");
    h.update(buffer);
    return h.digest("hex");
}
async function uploadToWorker() {
    const buf = fs.readFileSync(OUT_FILE);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = computeHmac(buf, WORKER_UPLOAD_SECRET, timestamp);
    const res = await axios.post(`${WORKER_UPLOAD_URL.replace(/\/$/, "")}/upload`, buf, {
        headers: {
            "x-upload-timestamp": timestamp,
            "x-upload-signature": signature,
            "Content-Type": "application/octet-stream",
        },
        maxBodyLength: Infinity,
    });
    if (res.status === 200) {
        console.log("✅ Uploaded screenshot to Worker successfully");
    }
    else {
        throw new Error(`Worker upload failed with status ${res.status}`);
    }
}
async function main() {
    try {
        await waitForSite();
        await takeScreenshot();
        await uploadToWorker();
        console.log("🎉 All steps completed successfully!");
    }
    catch (err) {
        console.error("❌ Error:", err.message);
        process.exit(1);
    }
}
main();

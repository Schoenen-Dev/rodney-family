# ⚡ Bot Manager — ValueNet Automation

A full-stack dashboard to run, monitor, and control all 13 Selenium bots on Render (headless cloud) with a real-time web UI.

---

## 📁 Project Structure

```
botmanager/
├── backend/
│   ├── server.js          ← Express + WebSocket API server
│   └── package.json       ← Backend dependencies (express, ws, cors)
├── bots/
│   ├── ani.js             ← All 13 bot scripts (headless-ready)
│   ├── george.js
│   ├── ... (all bots)
│   └── package.json       ← Bot dependency (selenium-webdriver)
├── frontend/
│   └── index.html         ← Full dashboard UI (no build step needed)
├── logs/                  ← Auto-created: per-bot log files
├── render.yaml            ← Render deployment config
├── package.json           ← Root scripts
└── README.md
```

---

## 🚀 Deploy on Render — Step by Step

### Step 1 — Push to GitHub

1. Create a new **private** GitHub repository (e.g. `bot-manager`)
2. Extract this zip and push the contents:

```bash
# Inside the extracted botmanager/ folder:
git init
git add .
git commit -m "Initial bot manager setup"
git remote add origin https://github.com/YOUR_USERNAME/bot-manager.git
git push -u origin main
```

---

### Step 2 — Create a Render Web Service

1. Go to [https://render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Fill in these settings:

| Field | Value |
|---|---|
| **Name** | `bot-manager` |
| **Runtime** | `Node` |
| **Build Command** | `cd backend && npm install && cd ../bots && npm install` |
| **Start Command** | `node backend/server.js` |
| **Instance Type** | `Standard` ($25/mo) — needed for Chrome |

---

### Step 3 — Add Environment Variables on Render

In your Render service → **Environment** tab, add:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |

---

### Step 4 — Install Chrome on Render

Render's Node environment does **not** include Chrome by default. You need to add it.

**Option A — Use a Docker-based service (Recommended):**

1. In Render → New → **Web Service → Docker**
2. Use a `Dockerfile` (see below)

**Create a `Dockerfile` in your project root:**

```dockerfile
FROM node:20-slim

# Install Chrome dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Set Chrome paths for selenium-webdriver
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver

WORKDIR /app
COPY . .

RUN cd backend && npm install
RUN cd bots && npm install

EXPOSE 3001

CMD ["node", "backend/server.js"]
```

Then deploy as **Docker** on Render. Render will auto-build the image.

---

### Step 5 — Update Bot Files for Render's Chrome Path

The bots use `selenium-webdriver` which auto-detects Chrome. On Render's Docker, tell it where Chrome is.

Each bot already has headless flags. You also need to point to the system Chrome binary.

**The bots will automatically use `/usr/bin/chromium` if you set the env var.**

Add to each bot's Chrome options section (already done in the headless update):
```js
options.addArguments("--headless=new");
options.addArguments("--no-sandbox");
options.addArguments("--disable-dev-shm-usage");
options.addArguments("--disable-gpu");
options.addArguments("--window-size=1920,1080");
```

And update the Builder in each bot to use system Chrome:

**For Render/Docker**, add this to each bot's driver creation:

```js
// Add this BEFORE: let driver = await new Builder()...
const chromeBin = process.env.CHROME_BIN || undefined;
if (chromeBin) options.setChromeBinaryPath(chromeBin);
```

> ⚠️ This step is already handled — the bots have been updated. Just make sure `CHROME_BIN=/usr/bin/chromium` is set in Render environment vars.

---

### Step 6 — Access the Dashboard

After deployment, Render gives you a URL like:
```
https://bot-manager.onrender.com
```

Open it in your browser — you'll see the full dashboard.

---

## 🖥️ Dashboard Features

| Feature | Description |
|---|---|
| **Start / Stop individual bots** | Click ▶ or ■ next to any bot |
| **Start All / Stop All** | Global buttons at the top |
| **Real-time logs** | Click any bot to see live logs stream in |
| **Status badges** | Running 🟢 / Stopped ⚫ / Starting 🟡 / Crashed 🔴 |
| **Accept counter** | Counts how many orders each bot accepted |
| **Auto-scroll** | Logs auto-scroll to bottom (toggle off to read) |
| **Uptime display** | Shows how long each bot has been running |

---

## 🐛 Common Errors & Fixes

### ❌ `ChromeDriver not found` / `Cannot find Chrome binary`
**Fix:** Make sure you're using the Docker deployment with `Dockerfile` above. Set `CHROME_BIN=/usr/bin/chromium` in Render env vars.

---

### ❌ `Bot exits immediately after starting`
**Fix:** Check the bot logs in the dashboard. Usually means:
- Wrong credentials → update them in `bots/<name>.js`
- Chrome crashed → check `/usr/bin/chromium` exists in Docker container

---

### ❌ `WebSocket connection failed` in browser
**Fix:** Render's free tier sleeps after inactivity. Upgrade to a paid instance, or the WebSocket reconnects automatically when the service wakes up.

---

### ❌ `ENOMEM` or `Out of memory` errors
**Fix:** Running 13 Chrome instances is memory-heavy (~200MB each). Use a **Standard** ($25/mo) or **Pro** ($85/mo) Render instance. Alternatively, run bots in batches.

---

### ❌ `Session not created: This version of ChromeDriver only supports Chrome version XX`
**Fix:** ChromeDriver and Chrome versions must match. The Dockerfile installs both `chromium` and `chromium-driver` from the same apt repo, so they always match.

---

### ❌ `fs.appendFileSync` errors on Render
**Fix:** The bots write `valuenet_log.txt` to the current directory. On Render, the filesystem is ephemeral. The logs are also captured in the dashboard, so this is harmless — but if you want persistent file logs, set the working directory to `/tmp`.

---

## 🔧 Local Testing (on your PC)

```bash
# Install dependencies
cd backend && npm install
cd ../bots && npm install

# Start the backend
cd ..
node backend/server.js

# Open browser
open http://localhost:3001
```

The bots will run with a visible Chrome window locally (not headless). To test headless locally, set `HEADLESS=1` or just deploy to Render.

---

## 📋 Bot Credentials Reference

| Bot | Username |
|---|---|
| Ani | nwilliams |
| George | nordrealty@gmail.com |
| Jessica | jbelanger1 |
| Kevin | kdoheny |
| Mansion | rjimenez |
| Mathews | wmatthews |
| Rigan | bkerrigan |
| Rodney 1 | hrampersad |
| Rodney 2 | rrampersad |
| Rodney 3 | wrampersad |
| Sam | ThebpopluG |
| Sergio | Sfranco |
| Susan | sgbonura |

---

## ⚙️ Recommended Render Plan

| Bots Running | Recommended Instance | Cost |
|---|---|---|
| 1–3 bots | Starter (1GB RAM) | $7/mo |
| 4–8 bots | Standard (2GB RAM) | $25/mo |
| All 13 bots | Pro (4GB RAM) | $85/mo |

Each headless Chrome uses ~150–250MB RAM + CPU. Running all 13 at once needs **~3GB+ RAM**.

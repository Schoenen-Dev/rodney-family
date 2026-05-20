/**
 * Bot Manager Backend
 * Express + WebSocket server for managing Selenium bots
 */

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, "../frontend")));

// ─── Bot Registry ─────────────────────────────────────────────────────────────
const BOTS_DIR = path.join(__dirname, "../bots");

const BOT_META = {
  "rodney1": { username: "hrampersad",          display: "Rodney 1" },
  "rodney2": { username: "rrampersad",          display: "Rodney 2" },
  "rodney3": { username: "wrampersad",          display: "Rodney 3" },
};

// Runtime state
const botProcesses = {};   // botId → { process, status, logs[], startedAt, acceptCount }
const clients = new Set(); // Connected WebSocket clients

// ─── WebSocket Broadcast ───────────────────────────────────────────────────────
function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// ─── Bot Status Helper ─────────────────────────────────────────────────────────
function getBotStatus(botId) {
  const proc = botProcesses[botId];
  if (!proc) return "stopped";
  return proc.status;
}

function getAllBotStatuses() {
  return Object.keys(BOT_META).map((id) => {
    const proc = botProcesses[id];
    return {
      id,
      display: BOT_META[id].display,
      username: BOT_META[id].username,
      status: proc ? proc.status : "stopped",
      startedAt: proc ? proc.startedAt : null,
      acceptCount: proc ? proc.acceptCount : 0,
      recentLogs: proc ? proc.logs.slice(-50) : [],
    };
  });
}

// ─── Log Manager ──────────────────────────────────────────────────────────────
const MAX_LOGS = 500;

function addLog(botId, line, level = "info") {
  const proc = botProcesses[botId];
  if (!proc) return;

  // Detect accept events
  if (line.includes("ACCEPTED") || line.includes("⚡")) {
    proc.acceptCount++;
    level = "success";
  } else if (line.includes("❌") || line.includes("Fatal") || line.includes("Error:")) {
    level = "error";
  } else if (line.includes("⚠️") || line.includes("failed") || line.includes("rejected")) {
    level = "warn";
  } else if (line.includes("✅") || line.includes("Login successful") || line.includes("refreshed")) {
    level = "success";
  }

  const entry = {
    ts: new Date().toISOString(),
    line: line.trim(),
    level,
  };

  proc.logs.push(entry);
  if (proc.logs.length > MAX_LOGS) proc.logs.shift();

  // Write to file log
  const logFile = path.join(__dirname, "../logs", `${botId}.log`);
  fs.appendFileSync(logFile, `[${entry.ts}] ${line.trim()}\n`);

  broadcast({ type: "log", botId, entry });
}

// ─── Start Bot ─────────────────────────────────────────────────────────────────
function startBot(botId) {
  if (botProcesses[botId] && botProcesses[botId].status === "running") {
    return { success: false, error: "Bot is already running" };
  }

  // Find bot file (case-sensitive match)
  const botFile = fs.readdirSync(BOTS_DIR).find(
    (f) => f.toLowerCase() === `${botId.toLowerCase()}.js`
  );

  if (!botFile) {
    return { success: false, error: `Bot file not found for: ${botId}` };
  }

  const botPath = path.join(BOTS_DIR, botFile);

  botProcesses[botId] = {
    process: null,
    status: "starting",
    startedAt: new Date().toISOString(),
    acceptCount: 0,
    logs: [],
  };

  broadcast({ type: "status", botId, status: "starting", startedAt: botProcesses[botId].startedAt });

  const child = spawn("node", [botPath], {
    cwd: BOTS_DIR,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  botProcesses[botId].process = child;

  child.stdout.on("data", (data) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    lines.forEach((line) => addLog(botId, line));
  });

  child.stderr.on("data", (data) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    lines.forEach((line) => addLog(botId, line, "error"));
  });

  child.on("spawn", () => {
    if (botProcesses[botId]) {
      botProcesses[botId].status = "running";
      broadcast({ type: "status", botId, status: "running" });
      addLog(botId, `🚀 Bot process started (PID: ${child.pid})`, "info");
    }
  });

  child.on("error", (err) => {
    addLog(botId, `❌ Process error: ${err.message}`, "error");
    if (botProcesses[botId]) {
      botProcesses[botId].status = "error";
      broadcast({ type: "status", botId, status: "error" });
    }
  });

  child.on("exit", (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    addLog(botId, `🔴 Bot exited (${reason})`, code === 0 ? "info" : "error");
    if (botProcesses[botId]) {
      botProcesses[botId].status = code === 0 ? "stopped" : "crashed";
      botProcesses[botId].process = null;
      broadcast({
        type: "status",
        botId,
        status: botProcesses[botId].status,
        exitCode: code,
      });
    }
  });

  return { success: true };
}

// ─── Stop Bot ──────────────────────────────────────────────────────────────────
function stopBot(botId) {
  const proc = botProcesses[botId];
  if (!proc || !proc.process) {
    return { success: false, error: "Bot is not running" };
  }

  proc.status = "stopping";
  broadcast({ type: "status", botId, status: "stopping" });
  addLog(botId, "⏹ Stop requested — terminating process...", "warn");

  try {
    proc.process.kill("SIGTERM");
    setTimeout(() => {
      if (proc.process && !proc.process.killed) {
        proc.process.kill("SIGKILL");
        addLog(botId, "⚠️ Force killed (SIGKILL)", "warn");
      }
    }, 5000);
  } catch (e) {
    addLog(botId, `⚠️ Kill error: ${e.message}`, "error");
  }

  return { success: true };
}

// ─── REST API ──────────────────────────────────────────────────────────────────
app.get("/api/bots", (req, res) => {
  res.json(getAllBotStatuses());
});

app.get("/api/bots/:id/logs", (req, res) => {
  const { id } = req.params;
  const proc = botProcesses[id];
  if (!proc) return res.json([]);
  res.json(proc.logs);
});

app.post("/api/bots/:id/start", (req, res) => {
  const { id } = req.params;
  if (!BOT_META[id]) return res.status(404).json({ error: "Unknown bot" });
  const result = startBot(id);
  res.json(result);
});

app.post("/api/bots/:id/stop", (req, res) => {
  const { id } = req.params;
  if (!BOT_META[id]) return res.status(404).json({ error: "Unknown bot" });
  const result = stopBot(id);
  res.json(result);
});

app.post("/api/bots/start-all", (req, res) => {
  const results = {};
  for (const id of Object.keys(BOT_META)) {
    results[id] = startBot(id);
  }
  res.json(results);
});

app.post("/api/bots/stop-all", (req, res) => {
  const results = {};
  for (const id of Object.keys(BOT_META)) {
    if (botProcesses[id] && botProcesses[id].process) {
      results[id] = stopBot(id);
    }
  }
  res.json(results);
});

// ─── WebSocket Connections ─────────────────────────────────────────────────────
wss.on("connection", (ws) => {
  clients.add(ws);

  // Send full state on connect
  ws.send(JSON.stringify({ type: "init", bots: getAllBotStatuses() }));

  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

// ─── Ensure logs dir ───────────────────────────────────────────────────────────
const logsDir = path.join(__dirname, "../logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// ─── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Bot Manager backend running on port ${PORT}`);
});

// ─── Graceful Shutdown ─────────────────────────────────────────────────────────
process.on("SIGTERM", () => {
  console.log("Shutting down — stopping all bots...");
  for (const id of Object.keys(botProcesses)) {
    if (botProcesses[id] && botProcesses[id].process) {
      try { botProcesses[id].process.kill("SIGKILL"); } catch (_) {}
    }
  }
  process.exit(0);
});

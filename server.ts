import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// In-memory database for prototyping the provider backend
const apiKeys = new Set<string>(["sk_test_123456789"]);
const messageLogs: any[] = [];
const pendingMessages: any[] = []; // Queue for the Android Gateway

const GATEWAY_SECRET = process.env.GATEWAY_SECRET || "my_secret_gateway_key_123";

// --- PUBLIC API FOR CUSTOMERS ---
// Customers will call this endpoint using the API keys you provide them
app.post("/api/v1/messages", async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized: Missing or invalid API key. Use 'Authorization: Bearer YOUR_KEY'" });
    return;
  }
  
  const key = authHeader.split(" ")[1];
  if (!apiKeys.has(key)) {
    res.status(403).json({ error: "Forbidden: Invalid API key" });
    return;
  }

  const { to, from, body } = req.body;
  if (!to || !body) {
    res.status(400).json({ error: "Missing required fields: 'to' and 'body'" });
    return;
  }

  const messageId = "msg_" + crypto.randomBytes(8).toString("hex");
  
  // 1. Log the message as queued
  const logEntry = {
    id: messageId,
    to,
    from: from || "MySMS",
    body,
    status: "queued",
    timestamp: new Date().toISOString(),
  };
  
  messageLogs.unshift(logEntry);
  
  // 2. Add to the pending queue for the Android Gateway to pick up
  pendingMessages.push(logEntry);

  // 3. Respond to your customer immediately
  res.status(201).json({
    id: messageId,
    status: "queued",
    to,
    from: logEntry.from
  });
});

// --- ANDROID GATEWAY API ---
// Your Android phone will poll these endpoints to send SMS and report status

// 1. Phone asks: "Are there any messages I need to send?"
app.get("/api/gateway/pending", (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${GATEWAY_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized Gateway" });
  }

  // Send all pending messages to the phone and clear the queue
  const messagesToSend = [...pendingMessages];
  pendingMessages.length = 0;

  res.json({ messages: messagesToSend });
});

// 2. Phone reports: "I sent the message successfully (or it failed)"
app.post("/api/gateway/status", (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${GATEWAY_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized Gateway" });
  }

  const { id, status, error } = req.body;
  
  const log = messageLogs.find(m => m.id === id);
  if (log) {
    log.status = status; // e.g., 'delivered' or 'failed'
    if (error) log.error = error;
  }

  res.json({ success: true });
});

// --- DASHBOARD API (Internal) ---
// These endpoints power your admin dashboard
app.get("/api/internal/keys", (req, res) => {
  res.json({ keys: Array.from(apiKeys) });
});

app.post("/api/internal/keys", (req, res) => {
  const newKey = "sk_live_" + crypto.randomBytes(16).toString("hex");
  apiKeys.add(newKey);
  res.json({ key: newKey });
});

app.get("/api/internal/logs", (req, res) => {
  res.json({ logs: messageLogs });
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();


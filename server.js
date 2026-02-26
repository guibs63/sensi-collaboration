// guibs:/server.js
"use strict";

const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { Pool } = require("pg");

// (optionnel) OpenAI — garde seulement si tu l'utilises vraiment
// const OpenAI = require("openai");

const app = express();
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "DELETE"] },
});

// --- DB
if (!process.env.DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL is missing. /projects and /messages will fail.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // optionnel

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      project TEXT NOT NULL,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}
ensureTables().catch((e) => console.error("ensureTables error:", e));

// --- HEALTH (test immédiat)
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    hasDbUrl: Boolean(process.env.DATABASE_URL),
  });
});

// --- Helpers
function cleanStr(v) {
  return String(v ?? "").trim();
}

// ---- REST (supports both /projects and /api/projects)
async function getProjects(req, res) {
  try {
    const r = await pool.query("SELECT name FROM projects ORDER BY created_at DESC");
    res.json(r.rows.map((x) => x.name));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load projects" });
  }
}

async function createProject(req, res) {
  try {
    const clean = cleanStr(req.body?.name);
    if (!clean) return res.status(400).json({ error: "Project name required" });

    await pool.query(
      "INSERT INTO projects(name) VALUES($1) ON CONFLICT (name) DO NOTHING",
      [clean]
    );
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create project" });
  }
}

async function deleteProject(req, res) {
  try {
    const name = cleanStr(req.params.name);
    if (!name) return res.status(400).json({ error: "Project required" });

    await pool.query("DELETE FROM messages WHERE project = $1", [name]);
    await pool.query("DELETE FROM projects WHERE name = $1", [name]);

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete project" });
  }
}

async function getMessages(req, res) {
  try {
    const project = cleanStr(req.query.project);
    if (!project) return res.json([]);

    const r = await pool.query(
      `SELECT id, project, username, message, created_at
       FROM messages
       WHERE project = $1
       ORDER BY id ASC`,
      [project]
    );
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load messages" });
  }
}

// Routes sans /api
app.get("/projects", getProjects);
app.post("/projects", createProject);
app.delete("/projects/:name", deleteProject);

app.get("/messages", getMessages);

// Routes avec /api (alias)
app.get("/api/projects", getProjects);
app.post("/api/projects", createProject);
app.delete("/api/projects/:name", deleteProject);

app.get("/api/messages", getMessages);

// --- Socket.io
io.on("connection", (socket) => {
  socket.on("joinProject", ({ project }) => {
    const p = cleanStr(project);
    if (!p) return;

    // leave other rooms
    for (const room of socket.rooms) {
      if (room !== socket.id) socket.leave(room);
    }

    socket.join(p);
    socket.emit("joinedProject", { project: p });
  });

  socket.on("chatMessage", async ({ project, username, message }) => {
    try {
      const p = cleanStr(project);
      const u = cleanStr(username) || "Anonyme";
      const m = cleanStr(message);
      if (!p || !m) return;

      const r = await pool.query(
        `INSERT INTO messages(project, username, message)
         VALUES ($1, $2, $3)
         RETURNING id, project, username, message, created_at`,
        [p, u, m]
      );

      const saved = r.rows[0];

      io.to(p).emit("chatMessage", saved);
      socket.emit("chatMessage", saved);
    } catch (e) {
      console.error("chatMessage error:", e);
      socket.emit("errorMessage", { error: "Failed to save message" });
    }
  });

  socket.on("deleteMessage", async ({ id, project }) => {
    try {
      const mid = Number(id);
      const p = cleanStr(project);
      if (!Number.isFinite(mid) || !p) return;

      await pool.query("DELETE FROM messages WHERE id = $1 AND project = $2", [mid, p]);
      io.to(p).emit("messageDeleted", { id: mid });
      socket.emit("messageDeleted", { id: mid });
    } catch (e) {
      console.error("deleteMessage error:", e);
      socket.emit("errorMessage", { error: "Failed to delete message" });
    }
  });
});

// --- Debug 404 (super utile en prod)
app.use((req, res) => {
  console.warn("404:", req.method, req.url);
  res.status(404).json({ error: "Not found", path: req.url });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on", PORT));
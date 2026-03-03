// guibs:/server.js (COMPLET) — ULTRA v3.4.5 — Presence realtime FIX ✅
// Aligné avec ton client ULTRA v3.4.5 :
// - joinProject / presenceUpdate / chatMessage / chatHistory / projectsUpdate / createProject / deleteProject / deleteMessage
// - /projects (HTTP) + /upload (HTTP) + /health (HTTP)
// - Rooms Socket.IO = nom du projet (string)
// - Présence temps réel : apparaît dans le cadre “Users en ligne”

"use strict";

const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Server } = require("socket.io");

// =========================
// App
// =========================
const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json({ limit: "2mb" }));

const ROOT = __dirname;
const STORAGE_DIR = path.join(ROOT, "storage");
const UPLOADS_DIR = path.join(ROOT, "uploads");

ensureDir(STORAGE_DIR);
ensureDir(UPLOADS_DIR);

// Static front
app.use(express.static(ROOT));
app.use("/uploads", express.static(UPLOADS_DIR));

// =========================
// Version / Health
// =========================
const VERSION = "ultra-v3.4.5-presence-fix";
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    version: VERSION,
    ai: "disabled",
    web: "url-open only",
  });
});

// =========================
// Simple JSON persistence
// (Railway: FS peut être éphémère -> OK quand même, ça marche local)
// =========================
const PROJECTS_FILE = path.join(STORAGE_DIR, "projects.json");
const MESSAGES_FILE = path.join(STORAGE_DIR, "messages.json");

let projects = loadJson(PROJECTS_FILE, ["test", "Evercell"]);
let messagesByProject = loadJson(MESSAGES_FILE, {}); // { [project]: [messages...] }

function saveAll() {
  saveJson(PROJECTS_FILE, projects);
  saveJson(MESSAGES_FILE, messagesByProject);
}

// =========================
// /projects (ton client tente fetch avant socket)
// =========================
app.get("/projects", (_req, res) => {
  res.json({ ok: true, projects });
});

// =========================
// Upload
// =========================
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || "file").replace(/[^\w.\-]+/g, "_");
      cb(null, `${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

app.post("/upload", upload.single("file"), (req, res) => {
  try {
    const f = req.file;
    if (!f) return res.status(400).json({ ok: false, error: "No file" });

    const url = `/uploads/${encodeURIComponent(f.filename)}`;

    // Optionnel : push un message chat avec pièce jointe
    const project = cleanStr(req.body?.project);
    const username = cleanStr(req.body?.username) || "Anonyme";
    const userId = cleanStr(req.body?.userId) || "";

    if (project) {
      const msg = makeMessage({
        project,
        username,
        userId,
        message: `📎 Fichier envoyé: ${f.originalname}`,
        attachment: { url, filename: f.originalname, mimetype: f.mimetype },
      });

      pushMessage(project, msg);
      io.to(project).emit("chatMessage", msg);
    }

    res.json({ ok: true, url, filename: f.originalname, mimetype: f.mimetype });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// =========================
// HTTP Server + Socket.IO
// =========================
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
});

// =========================
// Presence (LE truc qui manquait)
// project -> Map(socket.id -> { username, userId })
// =========================
const presenceByProject = new Map();

function getPresenceList(project) {
  const map = presenceByProject.get(project);
  if (!map) return [];
  return Array.from(map.values());
}

function emitPresence(project) {
  io.to(project).emit("presenceUpdate", {
    project,
    users: getPresenceList(project),
  });
}

function presenceJoin(socket, project, username, userId) {
  if (!presenceByProject.has(project)) presenceByProject.set(project, new Map());
  presenceByProject.get(project).set(socket.id, { username, userId });
  emitPresence(project);
}

function presenceLeave(socket, project) {
  const map = presenceByProject.get(project);
  if (map) {
    map.delete(socket.id);
    if (map.size === 0) presenceByProject.delete(project);
  }
  emitPresence(project);
}

// =========================
// Socket events (alignés client)
// =========================
io.on("connection", (socket) => {
  console.log("🔌 connected", socket.id);

  // ---- projects
  socket.on("getProjects", () => {
    socket.emit("projectsUpdate", { projects });
  });

  socket.on("createProject", ({ name } = {}, ack) => {
    const p = cleanStr(name);
    if (!isValidProjectName(p)) {
      const resp = { ok: false, message: "Nom invalide (2-50, lettres/chiffres/espaces/_-.)" };
      if (typeof ack === "function") ack(resp);
      return;
    }
    if (!projects.includes(p)) {
      projects.push(p);
      saveJson(PROJECTS_FILE, projects);
    }
    io.emit("projectsUpdate", { projects });
    const resp = { ok: true, project: p, projects };
    if (typeof ack === "function") ack(resp);
  });

  socket.on("deleteProject", ({ project } = {}) => {
    const p = cleanStr(project);
    if (!p) return;

    projects = projects.filter((x) => x !== p);
    delete messagesByProject[p];

    saveAll();

    io.emit("projectsUpdate", { projects });
    io.emit("projectDeleted", { project: p });

    // clear presence room
    presenceByProject.delete(p);
    io.to(p).emit("presenceUpdate", { project: p, users: [] });
  });

  // ---- join project (TON EVENT)
  socket.on("joinProject", ({ username, project, userId } = {}) => {
    const p = cleanStr(project);
    const u = cleanStr(username) || "Anonyme";
    const uid = cleanStr(userId) || "";

    if (!p) return;

    // leave previous room if any
    const prev = socket.data.project;
    if (prev && prev !== p) {
      try { socket.leave(prev); } catch {}
      presenceLeave(socket, prev);
    }

    socket.data.project = p;
    socket.data.username = u;
    socket.data.userId = uid;

    socket.join(p);

    // history
    const hist = Array.isArray(messagesByProject[p]) ? messagesByProject[p] : [];
    socket.emit("chatHistory", { project: p, messages: hist });

    // system notify
    io.to(p).emit("systemMessage", { project: p, text: `👋 ${u} a rejoint le projet.` });

    // ✅ presence update (c’est ça qui remplit ton cadre)
    presenceJoin(socket, p, u, uid);
  });

  // optional leave (ton client l’émet au beforeunload dans ma version patch)
  socket.on("leaveProject", () => {
    const p = socket.data.project;
    if (!p) return;
    try { socket.leave(p); } catch {}
    presenceLeave(socket, p);
    io.to(p).emit("systemMessage", { project: p, text: `👋 ${socket.data.username || "Un user"} a quitté le projet.` });
    socket.data.project = null;
  });

  // ---- chat
  socket.on("chatMessage", ({ username, userId, message, project } = {}) => {
    const p = cleanStr(project) || cleanStr(socket.data.project);
    if (!p) return;

    const u = cleanStr(username) || cleanStr(socket.data.username) || "Anonyme";
    const uid = cleanStr(userId) || cleanStr(socket.data.userId) || "";
    const msg = cleanStr(message);
    if (!msg) return;

    const row = makeMessage({ project: p, username: u, userId: uid, message: msg });
    pushMessage(p, row);

    io.to(p).emit("chatMessage", row);
  });

  // ---- delete message (TON EVENT + ack)
  socket.on("deleteMessage", ({ project, messageId } = {}, ack) => {
    const p = cleanStr(project) || cleanStr(socket.data.project);
    const mid = Number(messageId);

    if (!p || !Number.isFinite(mid)) {
      if (typeof ack === "function") ack({ ok: false, error: "bad_request" });
      return;
    }

    const uid = cleanStr(socket.data.userId);
    const arr = Array.isArray(messagesByProject[p]) ? messagesByProject[p] : [];

    const idx = arr.findIndex((m) => Number(m.id) === mid);
    if (idx === -1) {
      if (typeof ack === "function") ack({ ok: false, error: "not_found" });
      return;
    }

    // autoriser suppression seulement si même userId (si présent)
    const owner = cleanStr(arr[idx]?.userId);
    if (owner && uid && owner !== uid) {
      if (typeof ack === "function") ack({ ok: false, error: "forbidden" });
      return;
    }

    arr.splice(idx, 1);
    messagesByProject[p] = arr;
    saveJson(MESSAGES_FILE, messagesByProject);

    io.to(p).emit("messageDeleted", { project: p, messageId: mid });
    if (typeof ack === "function") ack({ ok: true });
  });

  // ---- disconnect -> remove presence + emit
  socket.on("disconnect", (reason) => {
    const p = socket.data.project;
    if (p) {
      presenceLeave(socket, p);
      io.to(p).emit("systemMessage", { project: p, text: `💨 ${socket.data.username || "Un user"} s'est déconnecté.` });
    }
    console.log("❌ disconnected", socket.id, reason);
  });
});

// =========================
// Message helpers
// =========================
function cleanStr(v) { return String(v ?? "").trim(); }

function isValidProjectName(name) {
  return /^[a-zA-Z0-9 _.\-]{2,50}$/.test(cleanStr(name));
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw);
    return data ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); } catch {}
}

// ID monotone in-memory (OK pour session)
// (si tu veux persistant, je te mets un compteur dans storage)
let nextId = 1;

function makeMessage({ project, username, userId, message, attachment }) {
  return {
    id: nextId++,
    ts: Date.now(),
    project: cleanStr(project),
    username: cleanStr(username) || "Anonyme",
    userId: cleanStr(userId) || "",
    message: cleanStr(message) || "",
    attachment: attachment || null,
  };
}

function pushMessage(project, msg) {
  const p = cleanStr(project);
  if (!messagesByProject[p]) messagesByProject[p] = [];
  messagesByProject[p].push(msg);

  // cap historique
  if (messagesByProject[p].length > 600) {
    messagesByProject[p] = messagesByProject[p].slice(-600);
  }
  saveJson(MESSAGES_FILE, messagesByProject);
}

// =========================
// Listen (Railway PORT)
// =========================
const PORT = Number(process.env.PORT || 8080);
server.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
  console.log("Version:", VERSION);
});
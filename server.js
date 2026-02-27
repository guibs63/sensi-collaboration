// guibs:/server.js (complet adapté : projets dynamiques + suppression + persistance)
"use strict";

const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

/* --------------------------------------------------
   STORAGE
-------------------------------------------------- */
const STORAGE_DIR = path.join(__dirname, "storage");
const HISTORY_FILE = path.join(STORAGE_DIR, "messages.json");
const PROJECTS_FILE = path.join(STORAGE_DIR, "projects.json");

const MAX_MESSAGES_PER_PROJECT = Number(process.env.MAX_MESSAGES_PER_PROJECT || 200);

function ensureStorage() {
  try {
    if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
    if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, JSON.stringify({}, null, 2), "utf8");
    if (!fs.existsSync(PROJECTS_FILE)) fs.writeFileSync(PROJECTS_FILE, JSON.stringify(["Ever"], null, 2), "utf8");
  } catch (e) {
    console.error("[storage] ensureStorage failed:", e);
  }
}

function safeReadJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw || "");
  } catch {
    return fallback;
  }
}

function safeWriteJson(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.error("[storage] write failed:", file, e);
  }
}

ensureStorage();

/* --------------------------------------------------
   DATA IN MEMORY
-------------------------------------------------- */
let historyByProject = safeReadJson(HISTORY_FILE, {});
let projects = safeReadJson(PROJECTS_FILE, ["Ever"]);
if (!Array.isArray(projects) || projects.length === 0) projects = ["Ever"];

// normalise unique + trim
projects = Array.from(new Set(projects.map((p) => String(p || "").trim()).filter(Boolean)));
if (projects.length === 0) projects = ["Ever"];

function saveProjects() {
  safeWriteJson(PROJECTS_FILE, projects);
}

function saveHistoryNow() {
  safeWriteJson(HISTORY_FILE, historyByProject);
}

// debounce history save
let saveTimer = null;
function scheduleHistorySave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveHistoryNow();
  }, 400);
}

/* --------------------------------------------------
   HELPERS
-------------------------------------------------- */
function cleanStr(v) {
  return String(v ?? "").trim();
}

function safeProjectKey(project) {
  const p = cleanStr(project);
  if (!p) return "";
  return p.slice(0, 80);
}

function isValidProjectName(name) {
  // simple + safe (évite / .. etc.)
  // autorise lettres, chiffres, espaces, _ - .
  return /^[a-zA-Z0-9 _.\-]{2,50}$/.test(name);
}

function listProjects() {
  return projects.slice().sort((a, b) => a.localeCompare(b, "fr"));
}

function pushMessage(project, msgObj) {
  const p = safeProjectKey(project);
  if (!p) return;

  if (!Array.isArray(historyByProject[p])) historyByProject[p] = [];
  historyByProject[p].push(msgObj);

  if (historyByProject[p].length > MAX_MESSAGES_PER_PROJECT) {
    historyByProject[p] = historyByProject[p].slice(-MAX_MESSAGES_PER_PROJECT);
  }

  scheduleHistorySave();
}

function getHistory(project) {
  const p = safeProjectKey(project);
  if (!p) return [];
  const arr = historyByProject[p];
  return Array.isArray(arr) ? arr : [];
}

function deleteProjectData(project) {
  const p = safeProjectKey(project);
  if (!p) return;

  // supprime messages
  if (historyByProject[p]) delete historyByProject[p];

  // supprime presence map (voir plus bas)
  if (presence.has(p)) presence.delete(p);

  // sauvegardes
  saveHistoryNow();
}

/* --------------------------------------------------
   HEALTH CHECK
-------------------------------------------------- */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    env: process.env.NODE_ENV || "production",
  });
});

/* --------------------------------------------------
   PROJECTS HTTP API
-------------------------------------------------- */
app.get("/projects", (req, res) => {
  res.json({ ok: true, projects: listProjects() });
});

/* --------------------------------------------------
   HISTORY HTTP (debug)
-------------------------------------------------- */
app.get("/history", (req, res) => {
  const project = safeProjectKey(req.query.project);
  if (!project) return res.status(400).json({ ok: false, error: "missing project" });

  res.json({ ok: true, project, messages: getHistory(project) });
});

/* --------------------------------------------------
   ROOT
-------------------------------------------------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* --------------------------------------------------
   SOCKET.IO
-------------------------------------------------- */
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// presence: project -> Map(socketId -> username)
const presence = new Map();

function getProjectUsers(project) {
  const m = presence.get(project);
  if (!m) return [];
  return Array.from(m.values()).filter(Boolean);
}

function emitPresence(project) {
  io.to(project).emit("presenceUpdate", { project, users: getProjectUsers(project) });
}

function emitSystem(project, text) {
  io.to(project).emit("systemMessage", {
    id: Date.now(),
    ts: Date.now(),
    project,
    text,
  });
}

function broadcastProjects() {
  io.emit("projectsUpdate", { projects: listProjects() });
}

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  /* ---------- projects realtime ---------- */
  socket.on("getProjects", () => {
    socket.emit("projectsUpdate", { projects: listProjects() });
  });

  socket.on("createProject", ({ name }) => {
    const n = cleanStr(name);

    if (!isValidProjectName(n)) {
      socket.emit("projectError", { action: "create", message: "Nom de projet invalide (2-50, lettres/chiffres/espaces/_-.)" });
      return;
    }

    if (projects.includes(n)) {
      socket.emit("projectError", { action: "create", message: "Ce projet existe déjà." });
      return;
    }

    projects.push(n);
    projects = Array.from(new Set(projects));
    saveProjects();
    broadcastProjects();

    socket.emit("projectOk", { action: "create", project: n });
  });

  socket.on("deleteProject", ({ project }) => {
    const p = safeProjectKey(project);
    if (!p) return;

    // option: empêcher la suppression du dernier projet
    if (projects.length <= 1 && projects.includes(p)) {
      socket.emit("projectError", { action: "delete", message: "Impossible de supprimer le dernier projet." });
      return;
    }

    if (!projects.includes(p)) {
      socket.emit("projectError", { action: "delete", message: "Projet introuvable." });
      return;
    }

    // prévenir les clients dans la room
    io.to(p).emit("projectDeleted", { project: p });

    // forcer les sockets à quitter la room
    // (Socket.IO v4 : on peut fetch sockets dans room)
    io.in(p).fetchSockets().then((sockets) => {
      sockets.forEach((s) => s.leave(p));
    }).catch(() => {});

    // supprimer données + liste
    projects = projects.filter((x) => x !== p);
    if (projects.length === 0) projects = ["Ever"]; // garde un fallback
    saveProjects();

    deleteProjectData(p);

    broadcastProjects();
    socket.emit("projectOk", { action: "delete", project: p });
  });

  /* ---------- join project ---------- */
  socket.on("joinProject", ({ project, username }) => {
    const p = safeProjectKey(project);
    const u = cleanStr(username) || "Anonyme";
    if (!p) return;

    // si projet n’existe pas, refuse
    if (!projects.includes(p)) {
      socket.emit("projectError", { action: "join", message: `Projet "${p}" inexistant.` });
      socket.emit("projectsUpdate", { projects: listProjects() });
      return;
    }

    socket.join(p);

    if (!presence.has(p)) presence.set(p, new Map());
    presence.get(p).set(socket.id, u);

    // envoyer l'historique (persistant)
    socket.emit("chatHistory", { project: p, messages: getHistory(p) });

    emitPresence(p);
    emitSystem(p, `👋 ${u} a rejoint ${p}`);
  });

  /* ---------- chat ---------- */
  socket.on("chatMessage", ({ project, username, message }) => {
    const p = safeProjectKey(project);
    const u = cleanStr(username) || "Anonyme";
    const m = cleanStr(message);
    if (!p || !m) return;

    // sécurité: si projet supprimé entre temps
    if (!projects.includes(p)) {
      socket.emit("projectError", { action: "chat", message: `Projet "${p}" supprimé ou introuvable.` });
      return;
    }

    const msg = { id: Date.now(), ts: Date.now(), project: p, username: u, message: m };

    pushMessage(p, { id: msg.id, ts: msg.ts, username: msg.username, message: msg.message });

    io.to(p).emit("chatMessage", msg);
  });

  /* ---------- disconnect ---------- */
  socket.on("disconnect", () => {
    for (const [proj, map] of presence.entries()) {
      if (map.has(socket.id)) {
        map.delete(socket.id);
        emitPresence(proj);
      }
    }
    console.log("Socket disconnected:", socket.id);
  });
});

/* --------------------------------------------------
   SAFETY
-------------------------------------------------- */
process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));

process.on("SIGTERM", () => {
  console.warn("[SIGTERM] shutting down");
  try {
    saveProjects();
    saveHistoryNow();
  } catch (_) {}
  server.close(() => process.exit(0));
});

/* --------------------------------------------------
   START
-------------------------------------------------- */
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on", PORT);
});
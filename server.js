// guibs:/server.js
"use strict";

const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

/* --------------------------------------------------
   HEALTH CHECK (Railway friendly)
-------------------------------------------------- */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    env: process.env.NODE_ENV || "production"
  });
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
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const presence = new Map(); // project -> Map(socketId -> username)

function cleanStr(v) {
  return String(v ?? "").trim();
}

function getProjectUsers(project) {
  const m = presence.get(project);
  if (!m) return [];
  return Array.from(m.values()).filter(Boolean);
}

function emitPresence(project) {
  io.to(project).emit("presenceUpdate", {
    project,
    users: getProjectUsers(project)
  });
}

function emitSystem(project, text) {
  io.to(project).emit("systemMessage", {
    id: Date.now(),
    project,
    text
  });
}

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("joinProject", ({ project, username }) => {
    const p = cleanStr(project);
    const u = cleanStr(username) || "Anonyme";
    if (!p) return;

    socket.join(p);

    if (!presence.has(p)) presence.set(p, new Map());
    presence.get(p).set(socket.id, u);

    emitPresence(p);
    emitSystem(p, `👋 ${u} a rejoint ${p}`);
  });

  socket.on("chatMessage", ({ project, username, message }) => {
    const p = cleanStr(project);
    const u = cleanStr(username) || "Anonyme";
    const m = cleanStr(message);
    if (!p || !m) return;

    io.to(p).emit("chatMessage", {
      id: Date.now(),
      project: p,
      username: u,
      message: m
    });
  });

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
   SAFETY (no silent crash)
-------------------------------------------------- */
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

process.on("SIGTERM", () => {
  console.warn("[SIGTERM] shutting down");
  server.close(() => process.exit(0));
});

/* --------------------------------------------------
   START
-------------------------------------------------- */
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on", PORT);
});
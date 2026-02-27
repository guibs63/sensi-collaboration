// guibs:/server.js (COMPLET) — Sensi auto + Serper web + mémoire intelligente (GLOBAL + par PROJET)
"use strict";

const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { Server } = require("socket.io");

let OpenAI = null;
try { OpenAI = require("openai"); } catch (_) {}

/* ==================================================
   APP INIT
================================================== */
const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

/* ==================================================
   CONFIG
================================================== */
const APP_VERSION = process.env.APP_VERSION || "dynamic-projects-v9-global-memory";

const STORAGE_DIR = path.join(__dirname, "storage");
const HISTORY_FILE = path.join(STORAGE_DIR, "messages.json");
const PROJECTS_FILE = path.join(STORAGE_DIR, "projects.json");

// Memory files
const MEMORY_PROJECT_FILE = path.join(STORAGE_DIR, "memory.json");         // { [project]: MemoryItem[] }
const MEMORY_GLOBAL_FILE  = path.join(STORAGE_DIR, "memory_global.json");  // MemoryItem[]

const UPLOADS_DIR = path.join(__dirname, "uploads");

const MAX_MESSAGES_PER_PROJECT = Number(process.env.MAX_MESSAGES_PER_PROJECT || 200);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 15);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// IA
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";

// Web (Serper)
const SERPER_API_KEY = process.env.SERPER_API_KEY || "";
const SERPER_ENDPOINT = "https://google.serper.dev/search";

/* ==================================================
   INIT DIRS
================================================== */
function ensureDirs() {
  try {
    if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

    if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, JSON.stringify({}, null, 2), "utf8");
    if (!fs.existsSync(PROJECTS_FILE)) fs.writeFileSync(PROJECTS_FILE, JSON.stringify(["Ever"], null, 2), "utf8");

    if (!fs.existsSync(MEMORY_PROJECT_FILE)) fs.writeFileSync(MEMORY_PROJECT_FILE, JSON.stringify({}, null, 2), "utf8");
    if (!fs.existsSync(MEMORY_GLOBAL_FILE)) fs.writeFileSync(MEMORY_GLOBAL_FILE, JSON.stringify([], null, 2), "utf8");
  } catch (e) {
    console.error("[init] ensureDirs failed:", e);
  }
}
ensureDirs();

app.use("/uploads", express.static(UPLOADS_DIR));

/* ==================================================
   STORAGE HELPERS
================================================== */
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); }
  catch (e) { console.error("[storage] write failed:", file, e); }
}

let historyByProject = readJSON(HISTORY_FILE, {});
let projects = readJSON(PROJECTS_FILE, ["Ever"]);

// Memory
let memoryByProject = readJSON(MEMORY_PROJECT_FILE, {});   // { [project]: MemoryItem[] }
let memoryGlobal = readJSON(MEMORY_GLOBAL_FILE, []);       // MemoryItem[]

if (!Array.isArray(projects) || projects.length === 0) projects = ["Ever"];
projects = Array.from(new Set(projects.map((p) => String(p || "").trim()).filter(Boolean)));
if (projects.length === 0) projects = ["Ever"];

function cleanStr(v) { return String(v ?? "").trim(); }
function safeProjectKey(project) { const p = cleanStr(project); return p ? p.slice(0, 80) : ""; }
function isValidProjectName(name) { return /^[a-zA-Z0-9 _.\-]{2,50}$/.test(name); }
function listProjects() { return projects.slice().sort((a, b) => a.localeCompare(b, "fr")); }

function hasOpenAI() { return Boolean(OpenAI && process.env.OPENAI_API_KEY); }
function hasWeb() { return Boolean(SERPER_API_KEY); }

function saveProjects() { writeJSON(PROJECTS_FILE, projects); }
function saveHistoryNow() { writeJSON(HISTORY_FILE, historyByProject); }
function saveMemoryProjectNow() { writeJSON(MEMORY_PROJECT_FILE, memoryByProject); }
function saveMemoryGlobalNow() { writeJSON(MEMORY_GLOBAL_FILE, memoryGlobal); }

let saveTimer = null;
function scheduleHistorySave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveHistoryNow(); }, 400);
}

let memProjSaveTimer = null;
function scheduleMemoryProjectSave() {
  if (memProjSaveTimer) return;
  memProjSaveTimer = setTimeout(() => { memProjSaveTimer = null; saveMemoryProjectNow(); }, 400);
}

let memGlobalSaveTimer = null;
function scheduleMemoryGlobalSave() {
  if (memGlobalSaveTimer) return;
  memGlobalSaveTimer = setTimeout(() => { memGlobalSaveTimer = null; saveMemoryGlobalNow(); }, 400);
}

/* ==================================================
   HISTORY
================================================== */
function getHistory(project) {
  const p = safeProjectKey(project);
  const arr = historyByProject[p];
  return Array.isArray(arr) ? arr : [];
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

function deleteMessageIfAuthor(project, messageId, requesterUserId) {
  const p = safeProjectKey(project);
  if (!Array.isArray(historyByProject[p])) return { ok: false, reason: "no_history" };

  const idNum = Number(messageId);
  if (!Number.isFinite(idNum)) return { ok: false, reason: "bad_id" };

  const reqId = cleanStr(requesterUserId);
  if (!reqId) return { ok: false, reason: "no_user" };

  const arr = historyByProject[p];
  const idx = arr.findIndex((m) => Number(m?.id) === idNum);
  if (idx === -1) return { ok: false, reason: "not_found" };

  const msg = arr[idx];
  if (cleanStr(msg?.userId) !== reqId) return { ok: false, reason: "not_author" };

  arr.splice(idx, 1);
  scheduleHistorySave();
  return { ok: true };
}

/* ==================================================
   MEMORY (GLOBAL + PROJECT)
================================================== */
/**
 * MemoryItem = {
 *   id: string,
 *   ts: number,
 *   text: string,
 *   type: "person"|"relationship"|"preference"|"project"|"fact"|"other",
 *   confidence: number, // 0..1
 *   scope: "global"|"project",
 *   project?: string,
 *   authorUserId: string,
 *   authorName: string
 * }
 */
function normalizeMemoryText(t) {
  return cleanStr(t)
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .slice(0, 240);
}

function getProjectMemory(project) {
  const p = safeProjectKey(project);
  const arr = memoryByProject[p];
  return Array.isArray(arr) ? arr : [];
}
function getGlobalMemory() {
  return Array.isArray(memoryGlobal) ? memoryGlobal : [];
}

function addMemoryItem(scope, project, item) {
  const txt = normalizeMemoryText(item?.text);
  if (!txt) return { ok: false, reason: "empty" };

  const mem = {
    id: crypto.randomBytes(10).toString("hex"),
    ts: Date.now(),
    text: txt,
    type: cleanStr(item?.type) || "fact",
    confidence: Number.isFinite(Number(item?.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0.75,
    scope,
    project: scope === "project" ? safeProjectKey(project) : undefined,
    authorUserId: cleanStr(item?.authorUserId) || "",
    authorName: cleanStr(item?.authorName) || "",
  };

  if (scope === "global") {
    if (!Array.isArray(memoryGlobal)) memoryGlobal = [];
    const exists = memoryGlobal.some((x) => normalizeMemoryText(x?.text) === txt);
    if (exists) return { ok: true, dedup: true };
    memoryGlobal.push(mem);
    if (memoryGlobal.length > 400) memoryGlobal = memoryGlobal.slice(-400);
    scheduleMemoryGlobalSave();
    return { ok: true, mem };
  }

  // project
  const p = safeProjectKey(project);
  if (!p) return { ok: false, reason: "bad_project" };

  if (!Array.isArray(memoryByProject[p])) memoryByProject[p] = [];
  const arr = memoryByProject[p];
  const exists = arr.some((x) => normalizeMemoryText(x?.text) === txt);
  if (exists) return { ok: true, dedup: true };

  arr.push(mem);
  if (arr.length > 250) memoryByProject[p] = arr.slice(-250);
  scheduleMemoryProjectSave();
  return { ok: true, mem };
}

function clearProjectMemory(project) {
  const p = safeProjectKey(project);
  if (!p) return false;
  memoryByProject[p] = [];
  scheduleMemoryProjectSave();
  return true;
}
function clearGlobalMemory() {
  memoryGlobal = [];
  scheduleMemoryGlobalSave();
  return true;
}

function forgetMemoryByQuery(scope, project, query) {
  const q = cleanStr(query).toLowerCase();
  if (!q) return { ok: false, removed: 0 };

  if (scope === "global") {
    const before = getGlobalMemory().length;
    memoryGlobal = getGlobalMemory().filter((m) => !String(m?.text || "").toLowerCase().includes(q));
    const removed = before - memoryGlobal.length;
    if (removed > 0) scheduleMemoryGlobalSave();
    return { ok: true, removed };
  }

  const p = safeProjectKey(project);
  const before = getProjectMemory(p).length;
  memoryByProject[p] = getProjectMemory(p).filter((m) => !String(m?.text || "").toLowerCase().includes(q));
  const removed = before - memoryByProject[p].length;
  if (removed > 0) scheduleMemoryProjectSave();
  return { ok: true, removed };
}

function formatMemoryForPrompt(project) {
  const global = getGlobalMemory().slice(-35);
  const proj = getProjectMemory(project).slice(-35);

  const gTxt = global.length
    ? global.map((m) => `- (global, ${m.type}, conf ${Math.round((m.confidence || 0) * 100)}%) ${m.text}`).join("\n")
    : "(vide)";

  const pTxt = proj.length
    ? proj.map((m) => `- (projet, ${m.type}, conf ${Math.round((m.confidence || 0) * 100)}%) ${m.text}`).join("\n")
    : "(vide)";

  return { gTxt, pTxt };
}

/* ==================================================
   ROUTES
================================================== */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    env: process.env.NODE_ENV || "production",
    version: APP_VERSION,
    ai: hasOpenAI() ? "enabled" : "disabled",
    web: hasWeb() ? "enabled" : "disabled",
  });
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/projects", (req, res) => res.json({ ok: true, projects: listProjects() }));

/* ==================================================
   SOCKET.IO INIT
================================================== */
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

/* ==================================================
   UPLOAD (HTTP)
================================================== */
function extFromMime(mime, originalName) {
  const fallback = path.extname(originalName || "").slice(0, 10);
  if (fallback) return fallback;
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "application/pdf") return ".pdf";
  return "";
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = extFromMime(file.mimetype, file.originalname);
    const id = crypto.randomBytes(12).toString("hex");
    cb(null, `${Date.now()}_${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    const allowedExt = new Set([".png", ".jpg", ".jpeg", ".webp", ".pdf", ".txt", ".md", ".csv", ".docx", ".xlsx"]);
    const ext = (path.extname(file.originalname || "") || "").toLowerCase();
    if (allowedExt.has(ext)) return cb(null, true);

    const allowedMime = new Set([
      "image/png","image/jpeg","image/webp",
      "application/pdf",
      "text/plain","text/markdown","text/csv",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]);
    if (allowedMime.has(file.mimetype)) return cb(null, true);

    cb(new Error("Type de fichier non autorisé."));
  },
});

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const project = safeProjectKey(req.body?.project);
    const username = cleanStr(req.body?.username) || "Anonyme";
    const userId = cleanStr(req.body?.userId);

    if (!project || !projects.includes(project)) return res.status(400).json({ ok: false, error: "Projet invalide." });
    if (!userId) return res.status(400).json({ ok: false, error: "userId manquant." });
    if (!req.file) return res.status(400).json({ ok: false, error: "Aucun fichier." });

    const hostBase = PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const url = `${hostBase}/uploads/${encodeURIComponent(req.file.filename)}`;

    const attachment = {
      url,
      path: `/uploads/${req.file.filename}`,
      filename: req.file.originalname,
      storedAs: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
    };

    const msg = {
      id: Date.now(),
      ts: Date.now(),
      project,
      username,
      userId,
      message: `📎 ${attachment.filename}`,
      attachment,
    };

    pushMessage(project, {
      id: msg.id,
      ts: msg.ts,
      username: msg.username,
      userId: msg.userId,
      message: msg.message,
      attachment: msg.attachment,
    });

    io.to(project).emit("chatMessage", msg);

    analyzeFileWithSensi({ project, username, attachment }).catch((e) => console.error("[sensi-file]", e));

    res.json({ ok: true, project, attachment });
  } catch (e) {
    console.error("[upload]", e);
    res.status(500).json({ ok: false, error: "Upload error" });
  }
});

/* ==================================================
   EMIT HELPERS
================================================== */
function emitSensi(project, text, meta = {}) {
  const msg = {
    id: Date.now(),
    ts: Date.now(),
    project,
    username: "Sensi",
    userId: "sensi",
    message: String(text || ""),
    meta,
  };

  pushMessage(project, {
    id: msg.id,
    ts: msg.ts,
    username: msg.username,
    userId: msg.userId,
    message: msg.message,
    meta: msg.meta,
  });

  io.to(project).emit("chatMessage", msg);
}

function emitSystem(project, text) {
  io.to(project).emit("systemMessage", { id: Date.now(), ts: Date.now(), project, text });
}

/* ==================================================
   WEB (Serper)
================================================== */
async function serperSearch(query, num = 6) {
  if (!SERPER_API_KEY) throw new Error("SERPER_API_KEY missing");
  const q = cleanStr(query);
  if (!q) return [];

  const resp = await fetch(SERPER_ENDPOINT, {
    method: "POST",
    headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q, num }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Serper error: ${resp.status} ${t}`);
  }

  const data = await resp.json();
  return (data?.organic || []).slice(0, num).map((r) => ({
    title: r.title || "",
    link: r.link || "",
    snippet: r.snippet || "",
  }));
}

function formatSearchResults(results) {
  if (!results || results.length === 0) return "Aucun résultat.";
  return results
    .map((r, i) => {
      const t = cleanStr(r.title) || "Sans titre";
      const l = cleanStr(r.link);
      const s = cleanStr(r.snippet);
      return `${i + 1}. ${t}\nURL: ${l}\nRésumé: ${s}`;
    })
    .join("\n\n");
}

function mightNeedWeb(userText) {
  const t = cleanStr(userText).toLowerCase();
  if (!t) return false;
  const triggers = [
    "aujourd", "hier", "demain", "en ce moment", "actu", "news",
    "prix", "cours", "taux", "météo", "élection", "président",
    "date", "horaire", "heure", "source", "site officiel", "lien"
  ];
  if (triggers.some((k) => t.includes(k))) return true;
  if (t.startsWith("cherche ") || t.startsWith("recherche ") || t.includes("google")) return true;
  return false;
}

/* ==================================================
   OPENAI (simple, no tools/tool_outputs)
================================================== */
async function openaiText({ system, user, maxTokens = 520 }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const resp = await client.responses.create({
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: [{ type: "input_text", text: system }] },
      { role: "user", content: [{ type: "input_text", text: user }] },
    ],
    max_output_tokens: maxTokens,
  });
  return cleanStr(resp.output_text || "");
}

/* ==================================================
   FORCED MEMO PARSING (GLOBAL by default)
   - "mémorise : ..." => global
   - "mémorise projet : ..." => project
================================================== */
function extractForcedMemo(userText) {
  const t = cleanStr(userText);
  if (!t) return { scope: "", text: "" };

  const mProj = t.match(/^\s*(m[ée]morise|memo|note)\s+projet\s*[:\-]\s*(.+)$/i);
  if (mProj && mProj[2]) return { scope: "project", text: cleanStr(mProj[2]) };

  const m1 = t.match(/^\s*(m[ée]morise|memo|note)\s*[:\-]\s*(.+)$/i);
  if (m1 && m1[2]) return { scope: "global", text: cleanStr(m1[2]) };

  const m2 = t.match(/^\s*(m[ée]morise|memo|note)\s+que\s+(.+)$/i);
  if (m2 && m2[2]) return { scope: "global", text: cleanStr(m2[2]) };

  return { scope: "", text: "" };
}

/* ==================================================
   INTELLIGENT MEMORY EXTRACTION
================================================== */
async function sensiExtractMemories({ project, username, userId, userText }) {
  if (!hasOpenAI()) return { memories: [], ack: "" };

  const { gTxt, pTxt } = formatMemoryForPrompt(project);

  const system = `
Tu es un extracteur de mémoire pour un chat collaboratif.
Décide si le message contient des informations DURABLES et UTILES à mémoriser.

Règles:
- Mémorise des faits stables: relations ("X est mon épouse"), identités, préférences durables, contexte important, contraintes/decisions.
- Ne mémorise PAS: humeur, small talk, questions ponctuelles, info éphémère.
- Choisis un scope:
  - "global" si c'est vrai pour l'utilisateur en général (ex: "Mel est mon épouse")
  - "project" si c'est spécifique au projet (ex: "dans EverCell, on vise TRL3")
- Réponds STRICTEMENT en JSON entre <json>...</json>.

Format:
{
  "memories":[
    {"text":"...", "type":"person|relationship|preference|project|fact|other", "confidence":0.0-1.0, "scope":"global|project"}
  ],
  "ack":"(si demande explicite de mémorisation: courte phrase, sinon vide)"
}

Mémoire actuelle (global):
${gTxt}

Mémoire actuelle (projet "${project}"):
${pTxt}
`.trim();

  const user = `Projet: ${project}\nAuteur: ${username} (${userId})\nMessage: ${userText}`;

  const out = await openaiText({ system, user, maxTokens: 380 });
  const m = out.match(/<json>\s*([\s\S]+?)\s*<\/json>/i);
  if (!m) return { memories: [], ack: "" };

  try {
    const parsed = JSON.parse(m[1]);
    const memories = Array.isArray(parsed?.memories) ? parsed.memories : [];
    const ack = cleanStr(parsed?.ack);
    return { memories, ack };
  } catch {
    return { memories: [], ack: "" };
  }
}

/* ==================================================
   SENSI MAIN
================================================== */
async function sensiRespondToUserMessage({ project, username, userId, userText }) {
  if (!hasOpenAI()) {
    emitSensi(project, "ℹ️ IA non configurée (OPENAI_API_KEY manquante).");
    return;
  }

  const p = safeProjectKey(project);
  const t = cleanStr(userText);
  const low = t.toLowerCase();

  // Commands
  if (low === "/memos" || low === "/memos global" || low === "/memos project") {
    const showGlobal = (low === "/memos" || low === "/memos global");
    const showProject = (low === "/memos" || low === "/memos project");

    let parts = [];
    if (showGlobal) {
      const g = getGlobalMemory();
      parts.push("🧠 MÉMOIRE GLOBALE:");
      parts.push(g.length ? g.slice(-60).map((m, i) => `${i + 1}. [${m.type}] ${m.text}`).join("\n") : "(vide)");
    }
    if (showProject) {
      const pm = getProjectMemory(p);
      parts.push(`\n🧠 MÉMOIRE PROJET "${p}":`);
      parts.push(pm.length ? pm.slice(-60).map((m, i) => `${i + 1}. [${m.type}] ${m.text}`).join("\n") : "(vide)");
    }

    return emitSensi(p, parts.join("\n"));
  }

  if (low === "/memo clear") {
    clearProjectMemory(p);
    return emitSensi(p, `🧠 Mémoire du projet "${p}" effacée ✅`);
  }
  if (low === "/memo clear global") {
    clearGlobalMemory();
    return emitSensi(p, "🧠 Mémoire globale effacée ✅");
  }

  if (low.startsWith("/memo forget global ")) {
    const q = t.slice("/memo forget global ".length);
    const res = forgetMemoryByQuery("global", p, q);
    return emitSensi(p, `🧠 Oubli global : ${res.removed} entrée(s) supprimée(s) ✅`);
  }
  if (low.startsWith("/memo forget ")) {
    const q = t.slice("/memo forget ".length);
    const res = forgetMemoryByQuery("project", p, q);
    return emitSensi(p, `🧠 Oubli projet : ${res.removed} entrée(s) supprimée(s) ✅`);
  }

  // 1) Forced memo (global default)
  const forced = extractForcedMemo(t);
  if (forced.text) {
    // Try LLM classification for type/confidence, but keep forced scope
    try {
      const ex = await sensiExtractMemories({
        project: p,
        username,
        userId,
        userText: `mémorise: ${forced.text}`,
      });

      const items = (ex.memories || []).length
        ? ex.memories
        : [{ text: forced.text, type: "fact", confidence: 0.9, scope: forced.scope || "global" }];

      for (const it of items) {
        const scope = (forced.scope || it.scope || "global") === "project" ? "project" : "global";
        addMemoryItem(scope, p, {
          text: it.text,
          type: it.type,
          confidence: it.confidence,
          authorUserId: userId,
          authorName: username,
        });
      }

      emitSensi(p, ex.ack || `🧠 OK, je mémorise (${forced.scope || "global"}) : "${forced.text}"`);
    } catch {
      const scope = forced.scope || "global";
      addMemoryItem(scope === "project" ? "project" : "global", p, {
        text: forced.text,
        type: "fact",
        confidence: 0.85,
        authorUserId: userId,
        authorName: username,
      });
      emitSensi(p, `🧠 OK, je mémorise (${scope}) : "${forced.text}"`);
    }
    return;
  }

  // 2) Smart memory extraction
  try {
    const ex = await sensiExtractMemories({ project: p, username, userId, userText: t });
    const memories = Array.isArray(ex.memories) ? ex.memories : [];
    for (const it of memories) {
      if (!it?.text) continue;
      const scope = (String(it.scope || "").toLowerCase() === "project") ? "project" : "global";
      addMemoryItem(scope, p, {
        text: it.text,
        type: it.type || "fact",
        confidence: it.confidence,
        authorUserId: userId,
        authorName: username,
      });
    }
    if (ex.ack) emitSensi(p, ex.ack);
  } catch (e) {
    console.error("[sensi-memo]", e);
  }

  // 3) Web (heuristic)
  let webBlock = "";
  if (hasWeb() && mightNeedWeb(t)) {
    try {
      const results = await serperSearch(t, 6);
      webBlock = `\n\n[WEB RESULTS]\n${formatSearchResults(results)}\n[/WEB RESULTS]\n`;
    } catch (e) {
      console.error("[serper]", e);
      webBlock = `\n\n[WEB RESULTS]\n(Erreur web search)\n[/WEB RESULTS]\n`;
    }
  }

  // 4) Prompt with memory + recent
  const mem = formatMemoryForPrompt(p);
  const recent = getHistory(p).slice(-20);
  const recentTxt = recent
    .map((m) => `${cleanStr(m?.username) || "??"}: ${cleanStr(m?.message)}`)
    .join("\n");

  const system = `
Tu es Sensi, IA d'assistance au travail collaboratif.
Tu as accès à une mémoire GLOBALE (partagée entre tous les projets) et une mémoire PROJET (spécifique au projet courant).
Priorité: si conflit, la mémoire PROJET prime.

Règles:
- Réponds en français, clair, concret.
- Utilise la mémoire pour être cohérente et "comprendre" les relations (ex: qui est Mel).
- Si [WEB RESULTS] est présent, utilise-les et cite les sources (titres + URLs).
- N'invente pas de mémoires.
`.trim();

  const user = `
[PROJET]
${p}
[/PROJET]

[MÉMOIRE GLOBALE]
${mem.gTxt}
[/MÉMOIRE GLOBALE]

[MÉMOIRE PROJET]
${mem.pTxt}
[/MÉMOIRE PROJET]

[CONTEXTE RÉCENT]
${recentTxt || "(vide)"}
[/CONTEXTE RÉCENT]

[QUESTION UTILISATEUR]
${t}
[/QUESTION UTILISATEUR]
${webBlock}
`.trim();

  const answer = await openaiText({ system, user, maxTokens: 620 });
  if (answer) emitSensi(p, answer);
}

/* ==================================================
   FILE ANALYSIS (simple)
================================================== */
async function extractTextFromFile(localFilePath, mimetype, originalName) {
  const ext = (path.extname(originalName || "") || "").toLowerCase();

  if (mimetype.startsWith("text/") || [".txt", ".md", ".csv"].includes(ext)) {
    const raw = fs.readFileSync(localFilePath, "utf8");
    return raw.slice(0, 12000);
  }

  if (mimetype === "application/pdf" || ext === ".pdf") {
    try {
      const pdfParse = require("pdf-parse");
      const buf = fs.readFileSync(localFilePath);
      const out = await pdfParse(buf);
      return String(out?.text || "").slice(0, 12000);
    } catch { return ""; }
  }

  if (ext === ".docx") {
    try {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ path: localFilePath });
      return String(result?.value || "").slice(0, 12000);
    } catch { return ""; }
  }

  if (ext === ".xlsx") {
    try {
      const XLSX = require("xlsx");
      const wb = XLSX.readFile(localFilePath);
      const sheetName = wb.SheetNames?.[0];
      if (!sheetName) return "";
      const ws = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(ws);
      return String(csv || "").slice(0, 12000);
    } catch { return ""; }
  }

  return "";
}

async function analyzeFileWithSensi({ project, username, attachment }) {
  if (!hasOpenAI()) {
    emitSensi(project, `ℹ️ IA non configurée. Fichier reçu : ${attachment.filename}`);
    return;
  }

  const isImage = String(attachment.mimetype || "").startsWith("image/");
  const localPath = path.join(UPLOADS_DIR, attachment.storedAs);

  let extracted = "";
  if (!isImage) extracted = await extractTextFromFile(localPath, attachment.mimetype, attachment.filename);

  const system = `Tu es Sensi. Analyse le fichier et propose résumé + points clés + actions.`;
  const user =
    `Fichier envoyé par "${username}" dans "${project}".\n` +
    `Nom: ${attachment.filename}\nType: ${attachment.mimetype}\n` +
    (isImage ? `Image URL: ${attachment.url}` : `Extrait:\n${extracted || "(pas d'extraction dispo)"}`);

  const out = await openaiText({ system, user, maxTokens: 520 });
  if (out) emitSensi(project, `🧠 Analyse Sensi — ${attachment.filename}\n\n${out}`);
}

/* ==================================================
   SOCKET.IO
================================================== */
const presence = new Map();

function getUsers(project) {
  const map = presence.get(project);
  if (!map) return [];
  return Array.from(map.values()).map((v) => v.username).filter(Boolean);
}
function emitPresence(project) {
  io.to(project).emit("presenceUpdate", { project, users: getUsers(project) });
}
function broadcastProjects() {
  io.emit("projectsUpdate", { projects: listProjects() });
}

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);
  socket.data.userId = "";
  socket.data.username = "";

  socket.on("getProjects", () => socket.emit("projectsUpdate", { projects: listProjects() }));

  socket.on("createProject", ({ name }) => {
    const n = cleanStr(name);
    if (!isValidProjectName(n)) return socket.emit("projectError", { message: "Nom invalide (2-50, lettres/chiffres/espaces/_-.)" });
    if (projects.includes(n)) return socket.emit("projectError", { message: "Projet déjà existant." });
    projects.push(n);
    projects = Array.from(new Set(projects));
    saveProjects();
    broadcastProjects();
  });

  socket.on("deleteProject", ({ project }) => {
    const p = safeProjectKey(project);
    if (!p) return;
    if (!projects.includes(p)) return socket.emit("projectError", { message: "Projet introuvable." });
    if (projects.length <= 1) return socket.emit("projectError", { message: "Impossible de supprimer le dernier projet." });

    io.to(p).emit("projectDeleted", { project: p });
    if (historyByProject[p]) delete historyByProject[p];
    if (memoryByProject[p]) delete memoryByProject[p];
    if (presence.has(p)) presence.delete(p);

    projects = projects.filter((x) => x !== p);
    if (projects.length === 0) projects = ["Ever"];
    saveProjects();
    saveHistoryNow();
    saveMemoryProjectNow();
    broadcastProjects();
  });

  socket.on("joinProject", ({ project, username, userId }) => {
    const p = safeProjectKey(project);
    const u = cleanStr(username) || "Anonyme";
    const uid = cleanStr(userId);

    if (!p) return;
    if (!projects.includes(p)) {
      socket.emit("projectError", { message: `Projet "${p}" inexistant.` });
      socket.emit("projectsUpdate", { projects: listProjects() });
      return;
    }
    if (!uid) return socket.emit("projectError", { message: "Identifiant utilisateur manquant (userId)." });

    socket.data.userId = uid;
    socket.data.username = u;

    socket.join(p);

    if (!presence.has(p)) presence.set(p, new Map());
    presence.get(p).set(socket.id, { username: u, userId: uid });

    socket.emit("chatHistory", { project: p, messages: getHistory(p) });
    emitPresence(p);
    emitSystem(p, `👋 ${u} a rejoint ${p}`);
  });

  socket.on("chatMessage", ({ project, username, userId, message }) => {
    const p = safeProjectKey(project);
    const u = cleanStr(username) || socket.data.username || "Anonyme";
    const uid = cleanStr(userId) || socket.data.userId;
    const m = cleanStr(message);

    if (!p || !m) return;
    if (!projects.includes(p)) return;
    if (!uid) return;

    const msg = { id: Date.now(), ts: Date.now(), project: p, username: u, userId: uid, message: m };

    pushMessage(p, { id: msg.id, ts: msg.ts, username: msg.username, userId: msg.userId, message: msg.message });
    io.to(p).emit("chatMessage", msg);

    sensiRespondToUserMessage({ project: p, username: u, userId: uid, userText: m }).catch((e) => {
      console.error("[sensi-auto]", e);
      emitSensi(p, "⚠️ Erreur Sensi (voir logs).");
    });
  });

  socket.on("deleteMessage", ({ project, messageId, userId }) => {
    const p = safeProjectKey(project);
    const id = Number(messageId);
    const uid = cleanStr(userId) || socket.data.userId;

    if (!p || !Number.isFinite(id)) return;
    if (!projects.includes(p)) return;

    const res = deleteMessageIfAuthor(p, id, uid);
    if (!res.ok) {
      if (res.reason === "not_author") socket.emit("projectError", { message: "Suppression refusée : seul l’auteur peut supprimer ce message." });
      return;
    }
    io.to(p).emit("messageDeleted", { project: p, messageId: id });
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

/* ==================================================
   START
================================================== */
process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));

process.on("SIGTERM", () => {
  console.warn("[SIGTERM] shutting down");
  try {
    saveProjects();
    saveHistoryNow();
    saveMemoryProjectNow();
    saveMemoryGlobalNow();
  } catch (_) {}
  server.close(() => process.exit(0));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server running on", PORT);
  console.log("Version:", APP_VERSION);
  console.log("AI:", hasOpenAI() ? "enabled" : "disabled");
  console.log("WEB:", hasWeb() ? "enabled" : "disabled");
});
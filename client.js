// guibs:/client.js (COMPLET)
// - userId persistant (localStorage) => seul l’auteur peut supprimer
// - projets dynamiques, présence, historique, suppression realtime

const socket = io(window.location.origin, {
  transports: ["websocket"],
});

let currentProject = null;
let currentUsername = null;

const seenMessageIds = new Set();
const messageNodes = new Map(); // messageId -> DOM element

// userId persistant
const LS_USER_ID = "sensi_user_id";
const myUserId = getOrCreateUserId();

const chat = document.getElementById("chat");
const form = document.getElementById("chat-form");
const input = document.getElementById("message");

const usernameInput = document.getElementById("username");
const projectSelect = document.getElementById("project");
const joinBtn = document.getElementById("join-btn");

const newProjectInput = document.getElementById("new-project");
const createProjectBtn = document.getElementById("create-project-btn");
const deleteProjectBtn = document.getElementById("delete-project-btn");

const usersList = document.getElementById("users");
const usersCount = document.getElementById("users-count");
const currentProjectLabel = document.getElementById("current-project-label");

/* =========================
   Utils
========================= */
function cleanStr(v) {
  return String(v ?? "").trim();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(ts) {
  try {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function getOrCreateUserId() {
  try {
    const existing = localStorage.getItem(LS_USER_ID);
    if (existing && existing.length >= 8) return existing;

    const uid =
      (crypto?.randomUUID ? crypto.randomUUID() : `uid_${Date.now()}_${Math.random().toString(16).slice(2)}`);

    localStorage.setItem(LS_USER_ID, uid);
    return uid;
  } catch {
    // fallback sans localStorage
    return `uid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

/* =========================
   UI helpers
========================= */
function clearChat() {
  chat.innerHTML = "";
  seenMessageIds.clear();
  messageNodes.clear();
}

function addSystem(text) {
  const div = document.createElement("div");
  div.className = "msg system";
  div.innerHTML = `<em>🛡️ ${escapeHtml(text)}</em>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function closeAllMenus() {
  document.querySelectorAll(".menu").forEach((m) => m.setAttribute("hidden", ""));
}
document.addEventListener("click", () => closeAllMenus());

function removeMessageFromUI(messageId) {
  const id = Number(messageId);
  if (!Number.isFinite(id)) return;

  const node = messageNodes.get(id);
  if (node && node.parentNode) node.parentNode.removeChild(node);

  messageNodes.delete(id);
  seenMessageIds.delete(id);
}

function addMessage({ id, ts, username, userId, message }) {
  const mid = Number(id);
  if (Number.isFinite(mid) && seenMessageIds.has(mid)) return;
  if (Number.isFinite(mid)) seenMessageIds.add(mid);

  const time = formatTime(ts);
  const isMine = cleanStr(userId) && cleanStr(userId) === cleanStr(myUserId);

  const row = document.createElement("div");
  row.className = "msg msg-row";
  if (Number.isFinite(mid)) row.dataset.mid = String(mid);

  // Menu ⋮ seulement si c'est mon message
  row.innerHTML = `
    <div class="msg-main">
      <span class="time">${time ? `[${time}]` : ""}</span>
      <strong>${escapeHtml(username)}:</strong>
      <span class="text">${escapeHtml(message)}</span>
    </div>

    <div class="msg-actions">
      ${isMine ? `<button class="kebab" type="button" title="Options">⋮</button>
      <div class="menu" hidden>
        <button class="menu-item delete" type="button">🗑️ Supprimer</button>
      </div>` : ""}
    </div>
  `;

  if (isMine) {
    const kebab = row.querySelector(".kebab");
    const menu = row.querySelector(".menu");
    const delBtn = row.querySelector(".menu-item.delete");

    kebab.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = menu.hasAttribute("hidden");
      closeAllMenus();
      if (isHidden) menu.removeAttribute("hidden");
    });

    delBtn.addEventListener("click", () => {
      if (!currentProject) return;
      if (!Number.isFinite(mid)) return;

      const ok = confirm("Supprimer ce message ?");
      if (!ok) return;

      socket.emit("deleteMessage", {
        project: currentProject,
        messageId: mid,
        userId: myUserId,
      });

      menu.setAttribute("hidden", "");
    });
  }

  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;

  if (Number.isFinite(mid)) messageNodes.set(mid, row);
}

function renderUsers(users) {
  const arr = Array.isArray(users) ? users : [];
  usersList.innerHTML = "";
  usersCount.textContent = String(arr.length);

  if (arr.length === 0) {
    const li = document.createElement("li");
    li.innerHTML = `<span style="color:#666;">Aucun user</span>`;
    usersList.appendChild(li);
    return;
  }

  for (const u of arr) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="userline">
        <span class="dot" title="en ligne"></span>
        <span class="uname">${escapeHtml(u)}</span>
      </span>
      <span style="color:#999;font-size:12px;">online</span>
    `;
    usersList.appendChild(li);
  }
}

function setProjectLabel(p) {
  currentProjectLabel.textContent = p || "—";
}

/* =========================
   Projects dropdown
========================= */
function setProjectsOptions(projects, keepSelection = true) {
  const prev = keepSelection ? cleanStr(projectSelect.value) : "";
  projectSelect.innerHTML = "";

  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    projectSelect.appendChild(opt);
  }

  if (keepSelection && prev) {
    const exists = Array.from(projectSelect.options).some((o) => o.value === prev);
    if (exists) projectSelect.value = prev;
  }

  if (!projectSelect.value && projectSelect.options.length > 0) {
    projectSelect.value = projectSelect.options[0].value;
  }
}

/* =========================
   Join
========================= */
function joinProject() {
  const username = cleanStr(usernameInput.value);
  const project = cleanStr(projectSelect.value);

  if (!username) {
    alert("Entre un pseudo 🙂");
    return;
  }
  if (!project) {
    alert("Aucun projet disponible.");
    return;
  }

  currentUsername = username;
  currentProject = project;

  setProjectLabel(currentProject);
  clearChat();
  renderUsers([]);
  addSystem(`Connexion au projet "${currentProject}"...`);

  socket.emit("joinProject", {
    username: currentUsername,
    project: currentProject,
    userId: myUserId,
  });
}

joinBtn.addEventListener("click", joinProject);

usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinProject();
});

/* =========================
   Create/Delete Projects
========================= */
createProjectBtn.addEventListener("click", () => {
  const name = cleanStr(newProjectInput.value);
  if (!name) return;
  socket.emit("createProject", { name });
});

newProjectInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const name = cleanStr(newProjectInput.value);
    if (!name) return;
    socket.emit("createProject", { name });
  }
});

deleteProjectBtn.addEventListener("click", () => {
  const p = cleanStr(projectSelect.value);
  if (!p) return;

  const ok = confirm(`Supprimer le projet "${p}" ?\n\n⚠️ Cela supprime aussi son historique de messages.`);
  if (!ok) return;

  socket.emit("deleteProject", { project: p });
});

/* =========================
   Send message
========================= */
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const message = cleanStr(input.value);
  const username = cleanStr(usernameInput.value);

  if (!message || !username || !currentProject) return;

  socket.emit("chatMessage", {
    username,
    userId: myUserId,
    message,
    project: currentProject,
  });

  input.value = "";
  input.focus();
});

/* =========================
   Receive: history
========================= */
socket.on("chatHistory", (payload) => {
  const p = cleanStr(payload?.project);
  const msgs = Array.isArray(payload?.messages) ? payload.messages : [];

  if (!currentProject || p !== currentProject) return;

  clearChat();

  if (msgs.length === 0) {
    addSystem(`Historique vide pour "${currentProject}".`);
    return;
  }

  addSystem(`Historique chargé pour "${currentProject}" (${msgs.length} message(s)).`);

  for (const m of msgs) {
    addMessage({
      id: m.id,
      ts: m.ts,
      username: m.username,
      userId: m.userId,
      message: m.message,
    });
  }
});

/* =========================
   Receive: live message
========================= */
socket.on("chatMessage", (data) => {
  const p = cleanStr(data?.project);
  if (currentProject && p && p !== currentProject) return;

  addMessage({
    id: data?.id,
    ts: data?.ts,
    username: data?.username,
    userId: data?.userId,
    message: data?.message,
  });
});

/* =========================
   Receive: deleted message
========================= */
socket.on("messageDeleted", (payload) => {
  const p = cleanStr(payload?.project);
  const mid = Number(payload?.messageId);

  if (currentProject && p && p !== currentProject) return;
  if (!Number.isFinite(mid)) return;

  removeMessageFromUI(mid);
});

/* =========================
   Receive: system
========================= */
socket.on("systemMessage", (msg) => {
  const p = cleanStr(msg?.project);
  if (currentProject && p && p !== currentProject) return;

  addSystem(msg?.text || "Message système");
});

/* =========================
   Receive: presence
========================= */
socket.on("presenceUpdate", (payload) => {
  const p = cleanStr(payload?.project);
  if (!currentProject || !p || p !== currentProject) return;

  renderUsers(payload?.users);
});

/* =========================
   Projects realtime list
========================= */
socket.on("projectsUpdate", (payload) => {
  const list = Array.isArray(payload?.projects) ? payload.projects : [];
  setProjectsOptions(list, true);

  if (currentProject && !list.includes(currentProject)) {
    currentProject = null;
    setProjectLabel("—");
    renderUsers([]);
    clearChat();
    addSystem("Le projet courant a été supprimé. Choisis un autre projet puis Rejoindre.");
  }
});

socket.on("projectDeleted", ({ project }) => {
  const p = cleanStr(project);
  if (currentProject && p === currentProject) {
    currentProject = null;
    setProjectLabel("—");
    renderUsers([]);
    clearChat();
    addSystem(`Le projet "${p}" a été supprimé.`);
  }
});

socket.on("projectError", (payload) => {
  alert(payload?.message || "Erreur projet");
});

/* =========================
   Connect / bootstrap
========================= */
socket.on("connect", () => {
  console.log("✅ Connecté Socket.io", socket.id);
  socket.emit("getProjects");

  // si déjà connecté à un projet, on rejoin (optionnel)
  if (currentProject && currentUsername) {
    socket.emit("joinProject", {
      username: currentUsername,
      project: currentProject,
      userId: myUserId,
    });
  }
});

socket.on("disconnect", () => {
  console.log("❌ Déconnecté Socket.io");
  addSystem("Déconnecté du serveur…");
});

socket.on("connect_error", (err) => {
  console.error("🚨 Socket error:", err.message);
  addSystem(`Erreur connexion: ${err.message}`);
});
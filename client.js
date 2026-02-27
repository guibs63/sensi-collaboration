// guibs:/client.js (complet : projets dynamiques + persistance messages + présence)

const socket = io(window.location.origin, {
  transports: ["websocket"],
});

let currentProject = null;
let currentUsername = null;

const seenMessageIds = new Set();

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

// ---------------------------
// Utils
// ---------------------------
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

function clearChat() {
  chat.innerHTML = "";
  seenMessageIds.clear();
}

function addSystem(text) {
  const div = document.createElement("div");
  div.className = "msg system";
  div.innerHTML = `<em>🛡️ ${escapeHtml(text)}</em>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function addMessage({ id, ts, username, message }) {
  if (id && seenMessageIds.has(id)) return;
  if (id) seenMessageIds.add(id);

  const time = formatTime(ts);
  const div = document.createElement("div");
  div.className = "msg";
  div.innerHTML = `
    <span class="time">${time ? `[${time}]` : ""}</span>
    <strong>${escapeHtml(username)}:</strong>
    <span class="text">${escapeHtml(message)}</span>
  `;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
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

// ---------------------------
// Projects UI
// ---------------------------
function setProjectsOptions(projects, keepSelection = true) {
  const prev = keepSelection ? cleanStr(projectSelect.value) : "";
  projectSelect.innerHTML = "";

  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    projectSelect.appendChild(opt);
  }

  // restore selection if possible
  if (keepSelection && prev) {
    const found = Array.from(projectSelect.options).some((o) => o.value === prev);
    if (found) projectSelect.value = prev;
  }

  // if nothing selected, select first
  if (!projectSelect.value && projectSelect.options.length > 0) {
    projectSelect.value = projectSelect.options[0].value;
  }
}

// ---------------------------
// Join logic
// ---------------------------
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

  socket.emit("joinProject", { username: currentUsername, project: currentProject });
}

joinBtn.addEventListener("click", joinProject);

usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinProject();
});

// ---------------------------
// Create/Delete projects (realtime)
// ---------------------------
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

// ---------------------------
// Send message
// ---------------------------
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const message = cleanStr(input.value);
  const username = cleanStr(usernameInput.value);

  if (!message || !username || !currentProject) return;

  socket.emit("chatMessage", { username, message, project: currentProject });

  input.value = "";
  input.focus();
});

// ---------------------------
// Receive: history
// ---------------------------
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
    addMessage({ id: m.id, ts: m.ts, username: m.username, message: m.message });
  }
});

// ---------------------------
// Receive: live message
// ---------------------------
socket.on("chatMessage", (data) => {
  const p = cleanStr(data?.project);
  if (currentProject && p && p !== currentProject) return;

  addMessage({
    id: data?.id,
    ts: data?.ts,
    username: data?.username,
    message: data?.message,
  });
});

// ---------------------------
// Receive: system
// ---------------------------
socket.on("systemMessage", (msg) => {
  const p = cleanStr(msg?.project);
  if (currentProject && p && p !== currentProject) return;
  addSystem(msg?.text || "Message système");
});

// ---------------------------
// Receive: presence
// ---------------------------
socket.on("presenceUpdate", (payload) => {
  const p = cleanStr(payload?.project);
  if (!currentProject || !p || p !== currentProject) return;
  renderUsers(payload?.users);
});

// ---------------------------
// Receive: projects list update (realtime)
// ---------------------------
socket.on("projectsUpdate", (payload) => {
  const list = Array.isArray(payload?.projects) ? payload.projects : [];
  setProjectsOptions(list, true);

  // si le projet courant a été supprimé, reset
  if (currentProject && !list.includes(currentProject)) {
    currentProject = null;
    setProjectLabel("—");
    renderUsers([]);
    clearChat();
    addSystem("Le projet courant a été supprimé. Choisis un autre projet puis Rejoindre.");
  }
});

// confirmation / erreurs projets
socket.on("projectOk", (payload) => {
  if (payload?.action === "create") {
    newProjectInput.value = "";
  }
});

socket.on("projectError", (payload) => {
  const msg = payload?.message || "Erreur projet";
  alert(msg);
});

// si projet supprimé pendant qu'on est dedans
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

// ---------------------------
// Connect / auto sync
// ---------------------------
socket.on("connect", () => {
  console.log("✅ Connecté Socket.io", socket.id);

  // demander liste projets au connect
  socket.emit("getProjects");

  // si on était déjà dans un projet, re-join
  if (currentProject && currentUsername) {
    socket.emit("joinProject", { username: currentUsername, project: currentProject });
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
const socket = io({ transports: ["websocket", "polling"] });

const chat = document.getElementById("chat");
const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const usernameInput = document.getElementById("username");

const projectSelect = document.getElementById("project");
const joinBtn = document.getElementById("join-btn");

const newProjectInput = document.getElementById("new-project");
const createProjectBtn = document.getElementById("create-project-btn");
const deleteProjectBtn = document.getElementById("delete-project-btn");

const typingDiv = document.getElementById("typing");
const connStatus = document.getElementById("conn-status");

let currentProject = null;
let typingTimeout = null;

// -----------------------
// CONNECTION UI
// -----------------------
socket.on("connect", () => (connStatus.textContent = "Connecté ✅"));
socket.on("disconnect", () => (connStatus.textContent = "Déconnecté ❌"));
socket.on("connect_error", () => (connStatus.textContent = "Erreur connexion ⚠️"));

// -----------------------
// HELPERS
// -----------------------
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function addMessage(id, username, message, role) {
  const div = document.createElement("div");
  div.className = "msg";
  div.dataset.id = id;

  const color = role === "assistant" ? "#7c3aed" : "#111";

  div.innerHTML = `
    <strong style="color:${color}">${escapeHtml(username)}:</strong>
    <span>${escapeHtml(message)}</span>
    <button data-id="${id}" class="delete-btn" title="Supprimer">🗑</button>
  `;

  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// soft delete message
chat.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("delete-btn")) return;
  const id = e.target.dataset.id;
  await fetch(`/messages/${id}`, { method: "DELETE" });

  const msg = document.querySelector(`[data-id='${id}']`);
  if (msg) msg.remove();
});

// -----------------------
// PROJECTS
// -----------------------
async function loadProjects(selectProjectName = null) {
  const res = await fetch("/projects");
  const projects = await res.json();

  projectSelect.innerHTML = "";

  projects.forEach((p) => {
    const option = document.createElement("option");
    option.value = p.name;
    option.textContent = p.name;
    projectSelect.appendChild(option);
  });

  if (projects.length === 0) {
    currentProject = null;
    chat.innerHTML = `<div class="muted">Aucun projet. Crée-en un ci-dessus 👆</div>`;
    return;
  }

  // if asked to select a specific project name
  const names = projects.map((p) => p.name);
  const target = selectProjectName && names.includes(selectProjectName)
    ? selectProjectName
    : projects[0].name;

  projectSelect.value = target;
  currentProject = target;

  socket.emit("join project", { project: currentProject });
}

function joinSelectedProject() {
  const selected = projectSelect.value;
  if (!selected) return;

  currentProject = selected;
  chat.innerHTML = "";
  socket.emit("join project", { project: currentProject });
}

projectSelect.addEventListener("change", joinSelectedProject);
joinBtn.addEventListener("click", joinSelectedProject);

// Create project
createProjectBtn.addEventListener("click", async () => {
  const name = newProjectInput.value.trim();
  if (!name) return alert("Nom de projet requis.");

  const res = await fetch("/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return alert(err.error || "Impossible de créer le projet.");
  }

  newProjectInput.value = "";
  await loadProjects(name); // refresh and auto-select the created project
});

// Delete project
deleteProjectBtn.addEventListener("click", async () => {
  const name = projectSelect.value;
  if (!name) return;

  const ok = confirm(`Supprimer le projet "${name}" et ses messages ?`);
  if (!ok) return;

  const res = await fetch(`/projects/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return alert(err.error || "Impossible de supprimer le projet.");
  }

  await loadProjects(); // refresh list
});

// Initial load
loadProjects();

// -----------------------
// SEND MESSAGE
// -----------------------
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const message = input.value.trim();
  const username = usernameInput.value.trim();

  if (!message || !username || !currentProject) return;

  socket.emit("chat message", { username, message, project: currentProject });
  input.value = "";

  socket.emit("stop typing", { project: currentProject });
});

// typing indicator
input.addEventListener("input", () => {
  if (!currentProject) return;

  socket.emit("typing", { project: currentProject });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit("stop typing", { project: currentProject });
  }, 600);
});

// -----------------------
// RECEIVE MESSAGE
// -----------------------
socket.on("chat message", (data) => {
  if (data.project !== currentProject) return;

  addMessage(
    data.id,
    data.username,
    data.message,
    data.username === "Sensi" ? "assistant" : "user"
  );
});

// history
socket.on("chat history", (messages) => {
  chat.innerHTML = "";
  messages.forEach((msg) => addMessage(msg.id, msg.username, msg.content, msg.role));
});

// typing
socket.on("typing", (data) => {
  if (data.project !== currentProject) return;
  typingDiv.style.display = "block";
});

socket.on("stop typing", (data) => {
  if (data?.project && data.project !== currentProject) return;
  typingDiv.style.display = "none";
});
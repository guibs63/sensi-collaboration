const socket = io({
  transports: ["websocket", "polling"], // safe on Railway
});

const chat = document.getElementById("chat");
const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const usernameInput = document.getElementById("username");
const projectSelect = document.getElementById("project");
const joinBtn = document.getElementById("join-btn");
const typingDiv = document.getElementById("typing");
const connStatus = document.getElementById("conn-status");

let currentProject = null;
let typingTimeout = null;

// -----------------------
// CONNECTION UI
// -----------------------
socket.on("connect", () => {
  connStatus.textContent = "Connecté ✅";
});
socket.on("disconnect", () => {
  connStatus.textContent = "Déconnecté ❌";
});
socket.on("connect_error", () => {
  connStatus.textContent = "Erreur connexion ⚠️";
});

// -----------------------
// LOAD PROJECTS
// -----------------------
async function loadProjects() {
  const res = await fetch("/projects");
  const projects = await res.json();

  projectSelect.innerHTML = "";

  projects.forEach((p) => {
    const option = document.createElement("option");
    option.value = p.name;
    option.textContent = p.name;
    projectSelect.appendChild(option);
  });

  if (projects.length > 0) {
    currentProject = projects[0].name;
    socket.emit("join project", { project: currentProject });
  }
}

loadProjects();

// -----------------------
// UI HELPERS
// -----------------------
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

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// delete click
chat.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("delete-btn")) return;

  const id = e.target.dataset.id;
  await fetch(`/messages/${id}`, { method: "DELETE" });

  const msg = document.querySelector(`[data-id='${id}']`);
  if (msg) msg.remove();
});

// -----------------------
// JOIN PROJECT
// -----------------------
function joinSelectedProject() {
  currentProject = projectSelect.value;
  chat.innerHTML = "";
  socket.emit("join project", { project: currentProject });
}

projectSelect.addEventListener("change", joinSelectedProject);
if (joinBtn) joinBtn.addEventListener("click", joinSelectedProject);

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

// typing (optionnel mais clean)
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

// -----------------------
// HISTORY
// -----------------------
socket.on("chat history", (messages) => {
  chat.innerHTML = "";
  messages.forEach((msg) => {
    addMessage(msg.id, msg.username, msg.content, msg.role);
  });
});

// -----------------------
// TYPING
// -----------------------
socket.on("typing", (data) => {
  if (data.project !== currentProject) return;
  typingDiv.style.display = "block";
});

socket.on("stop typing", (data) => {
  // data peut être undefined selon emit côté serveur => on gère quand même
  if (data?.project && data.project !== currentProject) return;
  typingDiv.style.display = "none";
});
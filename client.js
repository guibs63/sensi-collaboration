// Connexion Socket.io propre production
const socket = io(window.location.origin, {
  transports: ["websocket"], // évite les soucis polling/CDN
});

let currentProject = null;

const chat = document.getElementById("chat");
const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const usernameInput = document.getElementById("username");
const projectSelect = document.getElementById("project");
const joinBtn = document.getElementById("join-btn");

// ---------------------------
// Affichage message
// ---------------------------
function addMessage(username, message) {
  const div = document.createElement("div");
  div.innerHTML = `<strong>${username}:</strong> ${message}`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// ---------------------------
// Rejoindre projet
// ---------------------------
joinBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim();
  const project = projectSelect.value;

  if (!username || !project) return;

  currentProject = project;

  socket.emit("joinProject", {
    username,
    project,
  });
});

// ---------------------------
// Envoi message
// ---------------------------
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const message = input.value.trim();
  const username = usernameInput.value.trim();

  if (!message || !username || !currentProject) return;

  socket.emit("chatMessage", {
    username,
    message,
    project: currentProject,
  });

  input.value = "";
});

// ---------------------------
// Réception message
// ---------------------------
socket.on("chatMessage", (data) => {
  addMessage(data.username, data.message);
});

// ---------------------------
// Message système
// ---------------------------
socket.on("systemMessage", (msg) => {
  const div = document.createElement("div");
  div.innerHTML = `<em>SYSTEM: ${msg}</em>`;
  chat.appendChild(div);
});

// ---------------------------
// Debug connexion
// ---------------------------
socket.on("connect", () => {
  console.log("✅ Connecté au serveur Socket.io");
});

socket.on("disconnect", () => {
  console.log("❌ Déconnecté du serveur");
});

socket.on("connect_error", (err) => {
  console.error("🚨 Socket error:", err.message);
});
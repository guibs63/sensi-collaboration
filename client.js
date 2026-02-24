const socket = io();

let currentProject = null;

const chat = document.getElementById("chat");
const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const usernameInput = document.getElementById("username");
const projectSelect = document.getElementById("project");

// 🔹 Affichage message
function addMessage(username, message) {
  const div = document.createElement("div");
  div.innerHTML = `<strong>${username}:</strong> ${message}`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// 🔹 Reconnexion automatique (IMPORTANT)
socket.on("connect", () => {
  console.log("🟢 Connected to server");

  // Rejoindre le projet courant si défini
  if (currentProject) {
    socket.emit("joinProject", currentProject);
  }

  // Toujours recharger la liste des projets
  socket.emit("getProjects");
});

// 🔹 Charger projets
socket.on("projectList", (projects) => {
  projectSelect.innerHTML = "";

  projects.forEach((p) => {
    const option = document.createElement("option");
    option.value = p.name;
    option.textContent = p.name;
    projectSelect.appendChild(option);
  });

  // Si aucun projet sélectionné, prendre le premier
  if (!currentProject && projects.length > 0) {
    currentProject = projects[0].name;
    socket.emit("joinProject", currentProject);
  }
});

// 🔹 Changement de projet
projectSelect.addEventListener("change", () => {
  currentProject = projectSelect.value;
  chat.innerHTML = "";
  socket.emit("joinProject", currentProject);
});

// 🔹 Réception historique
socket.on("projectHistory", (messages) => {
  chat.innerHTML = "";
  messages.forEach((msg) => {
    addMessage(msg.username, msg.message);
  });
});

// 🔹 Réception message live
socket.on("chatMessage", (data) => {
  addMessage(data.username, data.message);
});

// 🔹 Envoi message
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const username = usernameInput.value.trim();
  const message = input.value.trim();

  if (!username || !message || !currentProject) return;

  socket.emit("chatMessage", {
    username,
    message,
    project: currentProject,
  });

  input.value = "";
});
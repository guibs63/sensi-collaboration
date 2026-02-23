const socket = io();

let currentProject = null;

const chat = document.getElementById("chat");
const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const usernameInput = document.getElementById("username");
const projectSelect = document.getElementById("project");

function addMessage(username, message) {
  const div = document.createElement("div");
  div.innerHTML = `<strong>${username}:</strong> ${message}`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// 🔹 Charger projets au démarrage
socket.emit("getProjects");

socket.on("projectList", (projects) => {
  projectSelect.innerHTML = "";
  projects.forEach((p) => {
    const option = document.createElement("option");
    option.value = p.name;
    option.textContent = p.name;
    projectSelect.appendChild(option);
  });

  if (projects.length > 0) {
    currentProject = projects[0].name;
    socket.emit("joinProject", currentProject);
  }
});

// 🔹 Rejoindre projet
projectSelect.addEventListener("change", () => {
  currentProject = projectSelect.value;
  chat.innerHTML = "";
  socket.emit("joinProject", currentProject);
});

// 🔹 Recevoir historique
socket.on("projectHistory", (messages) => {
  chat.innerHTML = "";
  messages.forEach((msg) => {
    addMessage(msg.username, msg.message);
  });
});

// 🔹 Recevoir message live
socket.on("chatMessage", (data) => {
  addMessage(data.username, data.message);
});

// 🔹 Envoyer message
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const username = usernameInput.value;
  const message = input.value;

  if (!username || !message || !currentProject) return;

  socket.emit("chatMessage", {
    username,
    message,
    project: currentProject,
  });

  input.value = "";
});
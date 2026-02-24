document.addEventListener("DOMContentLoaded", () => {

  console.log("DOM loaded");

  const socket = io();

  let currentProject = null;

  const chat = document.getElementById("chat");
  const form = document.querySelector("form"); // 🔥 plus robuste
  const input = document.getElementById("message");
  const usernameInput = document.getElementById("username");
  const projectSelect = document.getElementById("project");

  console.log("Elements:", { chat, form, input, usernameInput, projectSelect });

  if (!chat || !form || !input || !usernameInput || !projectSelect) {
    console.error("❌ Un élément DOM est manquant");
    return;
  }

  // 🔹 Affichage message
  function addMessage(username, message) {
    const div = document.createElement("div");
    div.textContent = `${username} : ${message}`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }

  // 🔹 Connexion socket
  socket.on("connect", () => {
    console.log("🟢 Connected to server");
    socket.emit("getProjects");
  });

  // 🔹 Liste projets
  socket.on("projectList", (projects) => {
    console.log("📂 Projects:", projects);

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

  // 🔹 Join manuel
  projectSelect.addEventListener("change", () => {
    currentProject = projectSelect.value;
    chat.innerHTML = "";
    socket.emit("joinProject", currentProject);
  });

  // 🔹 Historique
  socket.on("projectHistory", (messages) => {
    console.log("📜 History:", messages);
    chat.innerHTML = "";
    messages.forEach((msg) => {
      addMessage(msg.username, msg.message);
    });
  });

  // 🔹 Message live
  socket.on("chatMessage", (data) => {
    console.log("💬 Live:", data);
    addMessage(data.username, data.message);
  });

  // 🔹 Envoi message
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    console.log("FORM SUBMIT TRIGGERED");

    const username = usernameInput.value.trim();
    const message = input.value.trim();

    console.log("Sending:", { username, message, currentProject });

    if (!username || !message || !currentProject) {
      console.warn("⚠ Missing data");
      return;
    }

    socket.emit("chatMessage", {
      username,
      message,
      project: currentProject,
    });

    input.value = "";
  });

});
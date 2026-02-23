const socket = io();
let username = "";

function enterChat() {
  username = document.getElementById("username").value;
  document.getElementById("login").style.display = "none";
  document.getElementById("chat").style.display = "block";
}

function sendMessage() {
  const input = document.getElementById("input");
  const text = input.value;

  if (text.trim() === "") return;

  socket.emit("message", { user: username, text });
  input.value = "";
}

socket.on("message", (data) => {
  const messages = document.getElementById("messages");
  const div = document.createElement("div");
  div.innerHTML = `<strong>${data.user}:</strong> ${data.text}`;
  messages.appendChild(div);
});
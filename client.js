const socket = io();

const chat = document.getElementById("chat");
const form = document.getElementById("chat-form");
const messageInput = document.getElementById("message");

let soundEnabled = true;
const SOUND_KEY = "sensi_sound_enabled";

try {
  const saved = localStorage.getItem(SOUND_KEY);
  if (saved === "0") soundEnabled = false;
} catch {}

function playNotify() {
  if (!soundEnabled) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.04, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.18);

    setTimeout(() => {
      try { ctx.close(); } catch {}
    }, 300);
  } catch {}
}

function addMessage(user, msg) {
  const div = document.createElement("div");
  div.className = "msg";
  div.innerHTML = "<strong>" + user + ":</strong> " + msg;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;

  if (user === "Sensi") playNotify();
}

socket.on("chat", (data) => {
  addMessage(data.user, data.message);
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = messageInput.value.trim();
  if (!msg) return;
  socket.emit("chat", { user: "user", message: msg });
  messageInput.value = "";
});

const toggleBtn = document.createElement("button");
toggleBtn.type = "button";
toggleBtn.style.marginTop = "8px";
toggleBtn.style.marginLeft = "8px";

function refreshToggle() {
  toggleBtn.textContent = soundEnabled ? "🔔 Son ON" : "🔕 Son OFF";
}

toggleBtn.onclick = () => {
  soundEnabled = !soundEnabled;
  try { localStorage.setItem(SOUND_KEY, soundEnabled ? "1" : "0"); } catch {}
  refreshToggle();
};

refreshToggle();
document.body.appendChild(toggleBtn);

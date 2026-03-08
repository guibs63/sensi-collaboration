"use strict";

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AI_ENABLED = Boolean(OPENAI_API_KEY);
const openai = AI_ENABLED ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const MEMORIES_FILE = path.join(__dirname, "memories.json");
const VERSION = "3.8.1";

let memories = loadJson(MEMORIES_FILE, {});

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function cleanStr(v) {
  return String(v ?? "").trim();
}

function normalizeUserKey(user) {
  return cleanStr(user || "user").toLowerCase();
}

function ensureUserMemory(user) {
  const key = normalizeUserKey(user);
  if (!memories[key]) {
    memories[key] = {
      style: "",
      notes: []
    };
  }
  return memories[key];
}

function saveMemories() {
  saveJson(MEMORIES_FILE, memories);
}

function detectPoliteness(text, user) {
  const m = cleanStr(text).toLowerCase();
  const mem = ensureUserMemory(user);

  const tuPatterns = [
    "tutoie-moi",
    "tutoie moi",
    "tu peux me tutoyer",
    "on peut se tutoyer",
    "je préfère le tutoiement",
    "je prefere le tutoiement"
  ];

  const vousPatterns = [
    "vouvoie-moi",
    "vouvoie moi",
    "vous pouvez me vouvoyer",
    "je préfère le vouvoiement",
    "je prefere le vouvoiement",
    "merci de me vouvoyer"
  ];

  if (tuPatterns.some((x) => m.includes(x))) {
    mem.style = "tu";
    saveMemories();
    return "🧠 C'est noté : je peux te tutoyer 🙂";
  }

  if (vousPatterns.some((x) => m.includes(x))) {
    mem.style = "vous";
    saveMemories();
    return "🧠 C'est noté : je vous vouvoierai 🙂";
  }

  return "";
}

function detectMemory(text, user) {
  const raw = cleanStr(text);
  const lower = raw.toLowerCase();

  const triggers = [
    "mémorise ça",
    "memorise ça",
    "memorise ca",
    "mémorise ca",
    "souviens-toi que",
    "souviens toi que",
    "/remember "
  ];

  if (!triggers.some((t) => lower.includes(t) || lower.startsWith(t))) return "";

  let content = raw
    .replace(/^\/remember\s+/i, "")
    .replace(/^.*?m[ée]morise\s+[çc]a\s*[:,-]?\s*/i, "")
    .replace(/^.*?souviens[- ]toi\s+que\s*/i, "")
    .trim();

  if (!content) {
    return "🧠 Je n'ai rien trouvé de précis à mémoriser.";
  }

  const mem = ensureUserMemory(user);
  if (!mem.notes.includes(content)) {
    mem.notes.push(content);
    mem.notes = mem.notes.slice(-100);
    saveMemories();
  }

  return `🧠 C'est mémorisé : ${content}`;
}

function getAddressStyleInstruction(user, prompt) {
  const mem = ensureUserMemory(user);
  if (mem.style === "vous") return "Réponds en vouvoyant.";
  if (mem.style === "tu") return "Réponds en tutoyant.";

  const m = ` ${cleanStr(prompt).toLowerCase()} `;
  const hasVous = [" vous ", " votre ", " vos ", " pouvez-vous ", " pouvez vous "].some((x) => m.includes(x));
  const hasTu = [" tu ", " ton ", " ta ", " tes ", " tu peux ", " peux-tu ", " peux tu "].some((x) => m.includes(x));

  if (hasVous && !hasTu) return "Réponds en vouvoyant.";
  if (hasTu && !hasVous) return "Réponds en tutoyant.";
  return "Réponds naturellement en français.";
}

const EMOJI_MAP = {
  "*flowers*": "💐❤️",
  "*flower*": "🌸",
  "*rose*": "🌹",
  "*roses*": "🌹💐",
  "*heart*": "❤️",
  "*hearts*": "❤️💖",
  "*love*": "❤️🥰",
  "*hug*": "🤗",
  "*hugs*": "🤗💞",
  "*kiss*": "😘",
  "*kisses*": "😘💋",
  "*smile*": "😊",
  "*laugh*": "😄",
  "*lol*": "😂",
  "*joy*": "😄✨",
  "*happy*": "😊🌟",
  "*thumbs*": "👍",
  "*thumbs up*": "👍✨",
  "*clap*": "👏",
  "*applause*": "👏✨",
  "*bravo*": "👏🎉",
  "*ok*": "👌",
  "*wink*": "😉",
  "*blush*": "😊🌸",
  "*cute*": "🥰",
  "*adorable*": "🥹💖",
  "*star*": "⭐",
  "*stars*": "✨⭐",
  "*sparkles*": "✨",
  "*fire*": "🔥",
  "*rocket*": "🚀",
  "*party*": "🎉🥳",
  "*celebration*": "🎉✨",
  "*gift*": "🎁",
  "*music*": "🎶",
  "*song*": "🎵",
  "*violin*": "🎻",
  "*piano*": "🎹",
  "*guitar*": "🎸",
  "*sun*": "☀️",
  "*moon*": "🌙",
  "*rainbow*": "🌈",
  "*coffee*": "☕",
  "*tea*": "🍵",
  "*cookie*": "🍪",
  "*cake*": "🍰",
  "*chocolate*": "🍫",
  "*cat*": "🐱",
  "*dog*": "🐶",
  "*fox*": "🦊",
  "*bear*": "🐻",
  "*butterfly*": "🦋",
  "*angel*": "😇",
  "*pray*": "🙏",
  "*thanks*": "🙏💛",
  "*thank you*": "🙏💛",
  "*bonjour*": "👋😊",
  "*hello*": "👋🙂",
  "*good night*": "🌙💤",
  "*sleep*": "😴",
  "*thinking*": "🤔",
  "*idea*": "💡",
  "*warning*": "⚠️",
  "*check*": "✅",
  "*success*": "✅🎉",
  "*no*": "❌",
  "*stop*": "🛑",
  "*go*": "🚀",
  "*magic*": "🪄✨",
  "*crown*": "👑",
  "*king*": "🤴",
  "*queen*": "👸",
  "*robot*": "🤖",
  "*brain*": "🧠",
  "*book*": "📘",
  "*pen*": "🖊️",
  "*mail*": "📩",
  "*phone*": "📱",
  "*camera*": "📷",
  "*image*": "🖼️",
  "*paint*": "🎨",
  "*plan*": "📐",
  "*map*": "🗺️",
  "*home*": "🏠",
  "*car*": "🚗",
  "*train*": "🚆",
  "*plane*": "✈️",
  "*france*": "🇫🇷",
  "*cool*": "😎",
  "*wow*": "😮✨",
  "*sad*": "😢",
  "*cry*": "😭",
  "*angry*": "😠",
  "*surprise*": "😲",
  "*shy*": "😊🌷",
  "*strength*": "💪",
  "*victory*": "✌️",
  "*peace*": "☮️✨",
  "*luck*": "🍀",
  "*diamond*": "💎",
  "*money*": "💰",
  "*time*": "⏰",
  "*hourglass*": "⌛",
  "*memo*": "📝",
  "*question*": "❓",
  "*exclamation*": "❗",
  "*link*": "🔗",
  "*lock*": "🔒",
  "*key*": "🔑",
  "*shield*": "🛡️",
  "*tool*": "🛠️",
  "*gear*": "⚙️",
  "*light*": "💡✨",
  "*snow*": "❄️",
  "*tree*": "🌳",
  "*leaf*": "🍃",
  "*earth*": "🌍",
  "*ocean*": "🌊",
  "*wave*": "👋🌊",
  "*strong*": "💪🔥",
  "*congrats*": "🎉👏",
  "*respect*": "🙏✨"
};

function tryEmojiInterpretation(text) {
  const lower = cleanStr(text).toLowerCase();

  if (EMOJI_MAP[lower]) return EMOJI_MAP[lower];

  const matches = [];
  for (const [key, value] of Object.entries(EMOJI_MAP)) {
    if (lower.includes(key)) matches.push(value);
  }

  if (!matches.length) return "";

  return [...new Set(matches)].join(" ");
}

async function askAI(prompt, user) {
  if (!AI_ENABLED) {
    return "🔒 IA désactivée : ajoute OPENAI_API_KEY pour activer Sensi.";
  }

  const mem = ensureUserMemory(user);
  const memoryLines = Array.isArray(mem.notes) ? mem.notes.slice(-20).map((x) => `- ${x}`).join("\n") : "";
  const styleInstruction = getAddressStyleInstruction(user, prompt);

  const system = `
Tu es Sensi, assistante collaborative professionnelle.
${styleInstruction}
Tu réponds en français.
Tu exécutes directement les demandes utiles.
Tu peux reconnaître les marqueurs émotionnels et répondre avec chaleur.
Quand l'utilisateur demande un dessin, un plan ou une image, propose une description visuelle claire.
Mémoire utilisateur :
${memoryLines || "- aucune"}
`.trim();

  const res = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: prompt }
    ]
  });

  return cleanStr(res.output_text) || "Je n'ai pas pu formuler une réponse exploitable.";
}

io.on("connection", (socket) => {
  socket.on("chat", async (data) => {
    try {
      const user = cleanStr(data?.user || "user");
      const message = cleanStr(data?.message);
      if (!message) return;

      const politenessReply = detectPoliteness(message, user);
      if (politenessReply) {
        io.emit("chat", { user, message });
        io.emit("chat", { user: "Sensi", message: politenessReply });
        return;
      }

      const memoryReply = detectMemory(message, user);
      if (memoryReply) {
        io.emit("chat", { user, message });
        io.emit("chat", { user: "Sensi", message: memoryReply });
        return;
      }

      const emoji = tryEmojiInterpretation(message);
      if (emoji) {
        io.emit("chat", { user, message });
        io.emit("chat", { user: "Sensi", message: emoji });
        return;
      }

      io.emit("chat", { user, message });

      if (message.toLowerCase().includes("sensi")) {
        const reply = await askAI(message, user);
        io.emit("chat", { user: "Sensi", message: reply });
      }
    } catch (err) {
      io.emit("chat", { user: "Sensi", message: `⚠️ Erreur IA : ${err?.message || err}` });
    }
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    ai: AI_ENABLED ? "enabled" : "disabled",
    emoji_interpretation_count: Object.keys(EMOJI_MAP).length
  });
});

const PORT = Number(process.env.PORT || 8080);
server.listen(PORT, () => {
  console.log(`🚀 Sensi server running on ${PORT}`);
  console.log(`Version: ${VERSION}`);
  console.log(`AI: ${AI_ENABLED ? "enabled" : "disabled"}`);
});

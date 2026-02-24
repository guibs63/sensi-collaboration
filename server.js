const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const OpenAI = require("openai");
require("dotenv").config();

// =======================
// INIT
// =======================

const app = express();
const server = http.createServer(app);

// Socket.io avec config prod
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket"],
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// IMPORTANT pour Railway
const PORT = process.env.PORT || 8080;

// =======================
// DATABASE (Railway Postgres)
// =======================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// =======================
// OPENAI
// =======================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =======================
// ROUTE
// =======================

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

// =======================
// SOCKET.IO
// =======================

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("chatMessage", async (data) => {
    try {
      const { username, message } = data;

      if (!message) return;

      // Affiche message utilisateur à tous
      io.emit("chatMessage", {
        username,
        message,
      });

      // Appel OpenAI
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are Sensi, helpful AI assistant.",
          },
          {
            role: "user",
            content: message,
          },
        ],
      });

      const reply = completion.choices[0].message.content;

      // Réponse IA
      io.emit("chatMessage", {
        username: "Sensi",
        message: reply,
      });

    } catch (err) {
      console.error("AI Error:", err);

      socket.emit("chatMessage", {
        username: "SYSTEM",
        message: "Erreur IA.",
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// =======================
// START
// =======================

server.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server running on port " + PORT);
});
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const OpenAI = require("openai");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 8080;

// =======================
// DATABASE
// =======================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.query("SELECT NOW()")
  .then(res => console.log("✅ DB CONNECTED:", res.rows[0]))
  .catch(err => console.error("❌ DB ERROR:", err));

// =======================
// OPENAI
// =======================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =======================
// ROOT
// =======================

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

// =======================
// SOCKET.IO
// =======================

io.on("connection", (socket) => {

  console.log("🔌 User connected:", socket.id);

  // JOIN PROJECT
  socket.on("join project", async ({ project }) => {

    if (!project) return;

    socket.join(project);
    socket.project = project;

    console.log(`📂 Joined project ${project}`);

    try {
      const result = await pool.query(
        `SELECT username, content, role, project, created_at
         FROM messages
         WHERE project = $1
         ORDER BY created_at ASC`,
        [project]
      );

      socket.emit("chat history", result.rows);

    } catch (err) {
      console.error("❌ History error:", err);
    }
  });

  // MESSAGE
  socket.on("chat message", async (data) => {

    console.log("📩 DATA RECEIVED:", data);

    const { username, message, project } = data;

    if (!username || !message || !project) return;

    try {

      // Save user message
      await pool.query(
        "INSERT INTO messages (username, content, project, role) VALUES ($1,$2,$3,$4)",
        [username, message, project, "user"]
      );

      // Load last 20 messages
      const historyResult = await pool.query(
        `SELECT role, content
         FROM messages
         WHERE project = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [project]
      );

      const previousMessages = historyResult.rows
        .reverse()
        .map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

      // Generate AI
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are Sensi, AI assistant for project ${project}.
            You remember previous discussions of this project.`,
          },
          ...previousMessages,
        ],
      });

      const reply = completion.choices[0].message.content;

      // Save AI reply
      await pool.query(
        "INSERT INTO messages (username, content, project, role) VALUES ($1,$2,$3,$4)",
        ["Sensi", reply, project, "assistant"]
      );

      // Emit to room
      io.to(project).emit("chat message", {
        username: "Sensi",
        message: reply,
        project,
      });

    } catch (err) {
      console.error("❌ MESSAGE ERROR:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server running on port " + PORT);
});
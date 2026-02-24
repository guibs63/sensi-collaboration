const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const OpenAI = require("openai");
const multer = require("multer");
const fs = require("fs");

const mammoth = require("mammoth");
const xlsx = require("xlsx");
const pdfParse = require("pdf-parse");
const textract = require("textract");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

const PORT = process.env.PORT || 8080;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

console.log("✅ OpenAI connected");

// ================= DATABASE =================
const db = new sqlite3.Database("./database.sqlite");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      message TEXT,
      project TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS project_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT,
      filename TEXT,
      filepath TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// ================= UPLOAD CONFIG =================
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname),
});

const upload = multer({ storage });

// Upload route
app.post("/upload", upload.single("file"), (req, res) => {
  const { project } = req.body;
  const file = req.file;

  if (!file || !project) {
    return res.status(400).send("Missing file or project");
  }

  db.run(
    "INSERT INTO project_files (project, filename, filepath) VALUES (?, ?, ?)",
    [project, file.originalname, file.path],
    () => res.json({ success: true })
  );
});

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.resolve(".")));

app.get("/", (req, res) => {
  res.sendFile(path.resolve("index.html"));
});

// ================= FILE TEXT EXTRACTION =================
async function extractTextFromFile(filePath, filename) {
  const ext = filename.toLowerCase();

  try {

    if (ext.endsWith(".txt") || ext.endsWith(".md") || ext.endsWith(".json")) {
      return fs.readFileSync(filePath, "utf-8");
    }

    if (ext.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }

    if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
      const workbook = xlsx.readFile(filePath);
      let text = "";
      workbook.SheetNames.forEach(name => {
        const sheet = workbook.Sheets[name];
        text += xlsx.utils.sheet_to_csv(sheet);
      });
      return text;
    }

    if (ext.endsWith(".pdf")) {
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return data.text;
    }

    // Fallback universel (odt, ods, odp...)
    return new Promise((resolve) => {
      textract.fromFileWithPath(filePath, (err, text) => {
        if (err) resolve("");
        else resolve(text);
      });
    });

  } catch (err) {
    console.log("Erreur extraction:", filename);
    return "";
  }
}

// ================= SOCKET =================
io.on("connection", (socket) => {
  console.log("🟢 User connected");

  // Join project
  socket.on("joinProject", ({ project, username }) => {
    if (!project) return;

    socket.join(project);

    db.all(
      "SELECT * FROM messages WHERE project = ? ORDER BY timestamp ASC",
      [project],
      (err, rows) => {
        if (!err) socket.emit("projectHistory", rows);
      }
    );

    db.all(
      "SELECT * FROM project_files WHERE project = ?",
      [project],
      (err, rows) => {
        if (!err) socket.emit("fileList", rows);
      }
    );
  });

  // Chat message
  socket.on("chatMessage", async (data) => {
    const { username, message, project } = data;
    if (!username || !message || !project) return;

    // Save user message
    db.run(
      "INSERT INTO messages (username, message, project) VALUES (?, ?, ?)",
      [username, message, project],
      function () {
        io.in(project).emit("chatMessage", {
          id: this.lastID,
          username,
          message,
          project,
        });
      }
    );

    if (!message.toLowerCase().includes("@sensi")) return;

    try {
      db.all(
        "SELECT * FROM project_files WHERE project = ?",
        [project],
        async (err, files) => {

          let fileContent = "";

          if (files && files.length > 0) {
            for (let f of files) {
              const content = await extractTextFromFile(f.filepath, f.filename);
              fileContent += `\n\n--- Document: ${f.filename} ---\n${content}`;
            }
          }

          const cleanedMessage = message.replace(/@sensi/gi, "").trim();

          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "Tu es Sensi Brain, assistante stratégique du projet. Analyse les documents et conseille intelligemment.",
              },
              {
                role: "system",
                content: "Contenu des documents :\n" + fileContent,
              },
              {
                role: "user",
                content: cleanedMessage,
              },
            ],
          });

          const reply = response.choices[0].message.content;

          db.run(
            "INSERT INTO messages (username, message, project) VALUES (?, ?, ?)",
            ["Sensi", reply, project]
          );

          io.in(project).emit("chatMessage", {
            username: "Sensi",
            message: reply,
            project,
          });
        }
      );
    } catch (error) {
      console.error("❌ OpenAI error:", error);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected");
  });
});

// ================= START =================
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
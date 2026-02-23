const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 8080;

// ===== DATABASE =====
const db = new sqlite3.Database("./database.sqlite");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      message TEXT,
      project TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// ===== STATIC FILES =====
// IMPORTANT: servir le dossier courant de façon explicite
app.use(express.static(path.resolve(".")));

app.get("/", (req, res) => {
  res.sendFile(path.resolve("index.html"));
});

// ===== SOCKET =====
io.on("connection", (socket) => {
  console.log("User connected");

  socket.on("joinProject", (project) => {
    socket.join(project);

    db.all(
      "SELECT * FROM messages WHERE project = ? ORDER BY timestamp ASC",
      [project],
      (err, rows) => {
        if (!err) socket.emit("projectHistory", rows);
      }
    );
  });

  socket.on("chatMessage", (data) => {
    const { username, message, project } = data;

    db.run(
      "INSERT INTO messages (username, message, project) VALUES (?, ?, ?)",
      [username, message, project],
      () => {
        io.to(project).emit("chatMessage", data);
      }
    );
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

server.listen(PORT, () => {
  console.log(`Server running 🚀 on port ${PORT}`);
});
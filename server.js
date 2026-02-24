const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const OpenAI = require("openai");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // sert index.html

// =============================
// CONFIGURATION
// =============================

const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL manquant");
}

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY manquant");
}

// =============================
// POSTGRES (Railway)
// =============================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// =============================
// OPENAI
// =============================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =============================
// ROUTES
// =============================

// Healthcheck Railway
app.get("/", (req, res) => {
  res.send("🚀 Lietome backend running");
});

// Test DB
app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

// Chat route
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are Sensi, helpful AI assistant." },
        { role: "user", content: message },
      ],
    });

    res.json({
      reply: completion.choices[0].message.content,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "OpenAI error" });
  }
});

// =============================
// START SERVER
// =============================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
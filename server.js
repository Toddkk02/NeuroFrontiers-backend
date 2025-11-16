
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = "super_secret_key";


const pool = new Pool({
  user: "alessandro",  // ← Cambia qui
  host: "localhost",
  database: "forum_db",
  password: "password123",
  port: 5432,
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader) return res.status(401).json({ error: "Missing token" });

  const token = authHeader.split(" ")[1]; // "Bearer token"

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });

    req.user = user; // username + role
    next();
  });
}


function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

app.post("/api/register", async (req, res) => {
  const { username, password, birthdate } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
  "INSERT INTO users (username, password, role) VALUES ($1, $2, 'user')",
  [username, hashedPassword]
);

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "Username already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);

    if (result.rows.length === 0)
      return res.status(404).json({ error: "User not found" });

    const user = result.rows[0];

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Wrong password" });

    const token = jwt.sign(
      { username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // ✅ CORRETTO - ritorna user object
    res.json({
      message: "Login successful",
      token,
      user: {                    // ← Aggiungi questo wrapper
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// === GET ALL POSTS ===
app.get("/api/posts", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM posts ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

// === CREATE POST ===
app.post("/api/posts", authenticateToken, async (req, res) => {
  const { title, category, body } = req.body;
  
  if (!title || !category || !body) {
    return res.status(400).json({ error: "Missing fields" });
  }
  
  // Usa l'username dal token JWT invece che dal body
  const author = req.user.username;
  
  try {
    const result = await pool.query(
      "INSERT INTO posts (title, author, category, body) VALUES ($1, $2, $3, $4) RETURNING *",
      [title, author, category, body]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// === DELETE POST ===
app.delete("/api/posts/:id", authenticateToken, requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const result = await pool.query("DELETE FROM posts WHERE id=$1", [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    res.json({ message: "Post deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});


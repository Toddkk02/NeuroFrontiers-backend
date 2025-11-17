require('dotenv').config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_key";

const pool = new Pool({
  user: process.env.DB_USER || "alessandro",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "forum_db",
  password: process.env.DB_PASSWORD || "password123",
  port: process.env.DB_PORT || 5432,
});



function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "Missing token" });

  const token = authHeader.split(" ")[1];

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
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

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 12);

    await pool.query(
      "INSERT INTO users (username, password, birthdate, role) VALUES ($1, $2, $3, 'user')",
      [username.trim(), hashedPassword, birthdate || null]
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
    const result = await pool.query(
      "SELECT id, username, password, role FROM users WHERE username = $1",
      [username.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========================================
// POSTS ENDPOINTS
// ========================================

// GET ALL POSTS (con conteggi like e commenti)
app.get("/api/posts", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.*,
        COALESCE(l.like_count, 0) as likes,
        COALESCE(c.comment_count, 0) as comment_count
      FROM posts p
      LEFT JOIN (
        SELECT post_id, COUNT(*) as like_count 
        FROM post_likes 
        GROUP BY post_id
      ) l ON p.id = l.post_id
      LEFT JOIN (
        SELECT post_id, COUNT(*) as comment_count 
        FROM comments 
        GROUP BY post_id
      ) c ON p.id = c.post_id
      ORDER BY p.created_at DESC
    `);
    
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// GET SINGLE POST (con dettagli completi)
app.get("/api/posts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    // Incrementa views
    await pool.query("UPDATE posts SET views = COALESCE(views, 0) + 1 WHERE id = $1", [id]);
    
    // Get post con conteggio like e commenti
    const result = await pool.query(`
      SELECT 
        p.*,
        COALESCE(l.like_count, 0) as likes,
        COALESCE(c.comment_count, 0) as comment_count
      FROM posts p
      LEFT JOIN (
        SELECT post_id, COUNT(*) as like_count 
        FROM post_likes 
        GROUP BY post_id
      ) l ON p.id = l.post_id
      LEFT JOIN (
        SELECT post_id, COUNT(*) as comment_count 
        FROM comments 
        GROUP BY post_id
      ) c ON p.id = c.post_id
      WHERE p.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// CREATE POST
app.post("/api/posts", authenticateToken, async (req, res) => {
  const { title, category, body } = req.body;
  
  if (!title || !category || !body) {
    return res.status(400).json({ error: "Missing fields" });
  }
  
  const author = req.user.username;
  const userId = req.user.userId;
  
  try {
    const result = await pool.query(
      "INSERT INTO posts (user_id, title, author, category, body, views) VALUES ($1, $2, $3, $4, $5, 0) RETURNING *",
      [userId, title.trim(), author, category.trim(), body.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// DELETE POST
app.delete("/api/posts/:id", authenticateToken, requireAdmin, async (req, res) => {
  const id = req.params.id;
  
  try {
    const result = await pool.query("DELETE FROM posts WHERE id=$1 RETURNING *", [id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    
    res.json({ message: "Post deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// ========================================
// LIKES ENDPOINTS
// ========================================

// TOGGLE LIKE
app.post("/api/posts/:id/like", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    
    const existing = await pool.query(
      "SELECT * FROM post_likes WHERE post_id = $1 AND user_id = $2",
      [id, userId]
    );
    
    if (existing.rows.length > 0) {
      await pool.query(
        "DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2",
        [id, userId]
      );
      
      const count = await pool.query(
        "SELECT COUNT(*) as likes FROM post_likes WHERE post_id = $1",
        [id]
      );
      
      res.json({ liked: false, likes: parseInt(count.rows[0].likes) });
    } else {
      await pool.query(
        "INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)",
        [id, userId]
      );
      
      const count = await pool.query(
        "SELECT COUNT(*) as likes FROM post_likes WHERE post_id = $1",
        [id]
      );
      
      res.json({ liked: true, likes: parseInt(count.rows[0].likes) });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// CHECK IF USER LIKED
app.get("/api/posts/:id/liked", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    
    const result = await pool.query(
      "SELECT * FROM post_likes WHERE post_id = $1 AND user_id = $2",
      [id, userId]
    );
    
    res.json({ liked: result.rows.length > 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// ========================================
// COMMENTS ENDPOINTS
// ========================================

// GET COMMENTS
app.get("/api/posts/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      "SELECT * FROM comments WHERE post_id = $1 ORDER BY created_at DESC",
      [id]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// ADD COMMENT
app.post("/api/posts/:id/comments", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { body } = req.body;
    const userId = req.user.userId;
    const author = req.user.username;
    
    if (!body || body.trim().length === 0) {
      return res.status(400).json({ error: "Comment body required" });
    }
    
    const result = await pool.query(
      "INSERT INTO comments (post_id, user_id, author, body) VALUES ($1, $2, $3, $4) RETURNING *",
      [id, userId, author, body.trim()]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// DELETE COMMENT
app.delete("/api/comments/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;
    
    const comment = await pool.query("SELECT * FROM comments WHERE id = $1", [id]);
    
    if (comment.rows.length === 0) {
      return res.status(404).json({ error: "Comment not found" });
    }
    
    if (comment.rows[0].user_id !== userId && userRole !== 'admin') {
      return res.status(403).json({ error: "Not authorized" });
    }
    
    await pool.query("DELETE FROM comments WHERE id = $1", [id]);
    res.json({ message: "Comment deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

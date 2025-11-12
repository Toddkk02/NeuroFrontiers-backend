const express = require("express"); // moduli base
const cors = require('cors') // gestione api
const { Pool } = require('pg') 

const app = express(); // creiamo l'app
app.use(cors());
app.use(express.json()); // per leggere i json dal body


// configurazione del database
const pool = new Pool({
  user: "forum_user",
  host: "localhost",
  database: "forum_db",
  password: 'password123',
  port: 5432,
});


// async e await perchè pool.query è asincrono e result.rows contiene tutte le righe
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts ORDER BY created_at DESC'); // query per vedere i posts
    res.json(result.rows); // trasformazione in json
  } catch (error) {
    console.log("error in loading posts", error);
  }
});

// singolo post
app.get("/api/posts/:id", async (req, res) => {
  try {
    const id = req.params.id; // trova id
    const result = await pool.query('SELECT * FROM posts WHERE id = $1', [id]); // $1 è un parametro parametrizzato per sicurezza (SQL injection).
    if(result.rows.length === 0) return res.status(404).json({error: "post not found"});
    res.json(result.rows[0]);
    
  } catch (error) {
    res.status(500).json({error: "Database error"});
  }
});

// pubblicare un post
app.post('/api/posts', async (req, res) => {
  const { title, author, category, body } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO posts (title, author, category, body) VALUES ($1, $2, $3, $4) RETURNING *', // query coi 4 campi inseriti
      [title, author, category, body] // field
    );
    res.status(201).json(result.rows[0]); // status OK 200
  } catch (err) {
    res.status(500).json({ error: 'Database error' }); // errore
  }
});

//rimuovere un post
app.delete("/api/posts/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await pool.query("DELETE FROM posts WHERE id = $1", [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json({ message: "Post deleted successfully" });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Database error" });
  }
});
const PORT = 3000;
app.listen(PORT); // avvio server
console.log("server started on http://localhost:3000");

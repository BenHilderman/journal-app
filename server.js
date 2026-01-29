/*
 * ClearMindAI - Backend Server
 *
 * An AI-powered journaling app that helps users gain insights from their writing.
 * Built with Express.js, uses Groq's free LLM API for AI features.
 *
 * Stack:
 * - Express.js for REST API
 * - bcrypt for password hashing
 * - express-session for auth
 * - File-based JSON storage (kept simple, no database needed for personal use)
 * - Groq API for LLM calls (Llama 3.1)
 */

import express from "express"; // web framework
import cors from "cors"; // cross-origin requests
import bodyParser from "body-parser"; // parse JSON bodies
import session from "express-session"; // session management
import bcrypt from "bcryptjs"; // password hashing
import "dotenv/config"; // load .env file
import path from "path"; // file path utilities
import { fileURLToPath } from "url"; // ES module path helper
import fs from "fs"; // file system operations
import { v4 as uuidv4 } from "uuid"; // generate unique IDs

// ES modules don't have __dirname, so we recreate it
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


/* ──────────────────────────────────────────────────────────────
   EXPRESS SETUP
   ────────────────────────────────────────────────────────────── */

// Initialize Express app
const app = express();

// Enable CORS for all origins
app.use(cors());

// Parse JSON bodies up to 10mb (for large journal entries)
app.use(bodyParser.json({ limit: "10mb" }));

// Session middleware - keeps users logged in across requests
// The session ID is stored in a cookie, actual data lives in server memory
app.use(session({
  secret: process.env.SESSION_SECRET || 'clearmind-dev-secret', // signs session cookie
  resave: false, // don't save if nothing changed
  saveUninitialized: false, // don't create empty sessions
  cookie: {
    secure: false, // set true in production with HTTPS
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

// Serve static frontend files from /public folder
app.use(express.static(path.join(__dirname, "public")));


/* ──────────────────────────────────────────────────────────────
   FILE STORAGE

   Using JSON files instead of a database to keep things simple.
   Each user gets their own entries file for easy data isolation.
   ────────────────────────────────────────────────────────────── */

// file paths for data storage
const DATA_DIR = path.join(__dirname, "data"); // main data folder
const USERS_FILE = path.join(DATA_DIR, "users.json"); // all users stored here
const ENTRIES_DIR = path.join(DATA_DIR, "entries"); // each user gets own file
const EMBEDDINGS_DIR = path.join(DATA_DIR, "embeddings"); // vector data for search
const LOGS_DIR = path.join(__dirname, "logs"); // AI interaction logs

// Create directories on startup if they don't exist
[DATA_DIR, ENTRIES_DIR, EMBEDDINGS_DIR, LOGS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Initialize users file with empty array if it doesn't exist
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");


/* ──────────────────────────────────────────────────────────────
   API KEYS
   ────────────────────────────────────────────────────────────── */

// Load API keys from environment variables
const GROQ_API_KEY = process.env.GROQ_API_KEY; // required for AI features
const HF_API_KEY = process.env.HF_API_KEY; // optional, for HuggingFace


/* ──────────────────────────────────────────────────────────────
   LLM INTEGRATION (Groq API)

   Groq offers free API access to open-source models like Llama.
   They run inference on custom hardware so it's really fast.

   API follows OpenAI's chat completion format:
   - messages: array of {role, content} objects
   - temperature: 0 = deterministic, 1 = creative
   ────────────────────────────────────────────────────────────── */

// Call Groq's LLM API with chat messages
async function groqChat(messages, temperature = 0.3) {
  // Make POST request to Groq's chat completion endpoint
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`, // api key in header
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant", // fast, free model
      messages, // chat history
      temperature, // randomness level
    }),
  });

  // Handle API errors
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Groq API error: ${error}`);
  }

  // Parse response and extract the message content
  const data = await response.json();
  return data.choices[0].message.content;
}


/* ──────────────────────────────────────────────────────────────
   TEXT EMBEDDINGS (for semantic search)

   Embeddings convert text into a vector (array of numbers) that
   captures the meaning. Similar texts have similar vectors.

   This is a simple bag-of-words approach using hashing:
   1. Split text into words
   2. Hash each word to get an index in a 384-dim array
   3. Count occurrences at each index
   4. Normalize to unit length (needed for cosine similarity)

   It's not as good as transformer-based embeddings but works
   surprisingly well for finding related entries.
   ────────────────────────────────────────────────────────────── */

// Generate embedding vector for text
function getEmbedding(text) {
  // Clean text: lowercase, remove punctuation, split into words
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, '') // remove punctuation
    .split(/\s+/) // split on whitespace
    .filter(w => w.length > 2); // keep words with 3+ chars

  // Create 384-dimensional vector filled with zeros
  const embedding = new Array(384).fill(0);

  // Hash each word and increment its position in the vector
  for (const word of words) {
    // Simple string hash function (djb2 variant)
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash = hash & hash; // convert to 32-bit integer
    }
    // Map hash to index in array
    const idx = Math.abs(hash) % 384;
    embedding[idx] += 1; // increment count
  }

  // Normalize to unit vector (length = 1)
  // This is required for cosine similarity to work correctly
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= magnitude;
    }
  }

  // Return as promise for consistency with async API
  return Promise.resolve(embedding);
}

// Cosine similarity measures how similar two vectors are (0 to 1)
// 1 = identical direction, 0 = perpendicular, -1 = opposite
function cosineSimilarity(a, b) {
  let dotProduct = 0; // sum of element-wise products
  let normA = 0; // sum of squares for vector A
  let normB = 0; // sum of squares for vector B

  // Calculate all three sums in one loop
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  // Cosine = dot product / (magnitude A * magnitude B)
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}


/* ──────────────────────────────────────────────────────────────
   DATA ACCESS FUNCTIONS
   ────────────────────────────────────────────────────────────── */

// Load all users from JSON file
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  } catch {
    return []; // return empty array if file doesn't exist
  }
}

// Save users array to JSON file
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); // pretty print
}

// Get path to user's entries file
function getUserEntriesFile(userId) {
  return path.join(ENTRIES_DIR, `${userId}.json`);
}

// Get path to user's embeddings file
function getUserEmbeddingsFile(userId) {
  return path.join(EMBEDDINGS_DIR, `${userId}.json`);
}

// Load all entries for a user
function loadEntries(userId) {
  try {
    const filePath = getUserEntriesFile(userId);
    if (!fs.existsSync(filePath)) return []; // new user has no entries
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return []; // return empty on error
  }
}

// Save entries array for a user
function saveEntries(userId, entries) {
  fs.writeFileSync(getUserEntriesFile(userId), JSON.stringify(entries, null, 2));
}

// Load embeddings map for a user (entryId -> embedding vector)
function loadEmbeddings(userId) {
  try {
    const filePath = getUserEmbeddingsFile(userId);
    if (!fs.existsSync(filePath)) return {}; // empty if no embeddings
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

// Save embeddings map for a user
function saveEmbeddings(userId, embeddings) {
  fs.writeFileSync(getUserEmbeddingsFile(userId), JSON.stringify(embeddings));
}

// Log AI interactions for debugging and evaluation
function logInteraction(type, input, output) {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, type, input, output };

  // Log file named by date (one file per day)
  const logFile = path.join(LOGS_DIR, `${timestamp.split("T")[0]}.json`);

  // Load existing logs or start fresh
  let logs = [];
  if (fs.existsSync(logFile)) {
    try { logs = JSON.parse(fs.readFileSync(logFile, "utf-8")); } catch { logs = []; }
  }

  // Append new entry and save
  logs.push(logEntry);
  fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
}

// LLMs sometimes return JSON wrapped in markdown or extra text
// This extracts just the JSON object between { and }
function safeParseJson(text) {
  try {
    // Find the first { and last }
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    // Validate we found both braces in the right order
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }

    // Extract and parse just the JSON part
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch (e) {
    console.error("JSON parse failed:", e);
    return null;
  }
}


/* ──────────────────────────────────────────────────────────────
   AUTH MIDDLEWARE
   ────────────────────────────────────────────────────────────── */

// Middleware to require authentication on protected routes
function requireAuth(req, res, next) {
  // Check if session has a userId
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  // User is authenticated, continue to route handler
  next();
}


/* ══════════════════════════════════════════════════════════════
   API ENDPOINTS
   ══════════════════════════════════════════════════════════════ */


/* ──────────────────────────────────────────────────────────────
   AUTH ENDPOINTS
   ────────────────────────────────────────────────────────────── */

/*
 * POST /api/auth/signup
 *
 * Create a new user account.
 *
 * Request body:
 *   {
 *     email: string,
 *     password: string (min 6 chars),
 *     guestEntries?: array, // migrate entries from guest mode
 *     guestEmbeddings?: object // migrate embeddings from guest mode
 *   }
 *
 * Response: { id: string, email: string }
 *
 * Also creates a session (logs user in automatically).
 */
app.post("/api/auth/signup", async (req, res) => {
  try {
    // Extract fields from request body
    const { email, password, guestEntries, guestEmbeddings } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Check if email already exists
    const users = loadUsers();
    const existingUser = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Hash password with bcrypt (automatically generates salt)
    const passwordHash = await bcrypt.hash(password, 10);

    // create new user object
    const user = {
      id: uuidv4(), // unique id
      email: email.toLowerCase(), // store lowercase
      passwordHash, // hashed password
      createdAt: new Date().toISOString(), // timestamp
    };

    // Save user to database
    users.push(user);
    saveUsers(users);

    // Migrate guest data if provided (from localStorage)
    if (guestEntries && Array.isArray(guestEntries) && guestEntries.length > 0) {
      saveEntries(user.id, guestEntries);
    }
    if (guestEmbeddings && typeof guestEmbeddings === "object") {
      saveEmbeddings(user.id, guestEmbeddings);
    }

    // Create session (log user in)
    req.session.userId = user.id;

    // Return user info (without password hash)
    res.json({ id: user.id, email: user.email });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Failed to create account" });
  }
});


/*
 * POST /api/auth/signin
 *
 * Log in with email and password.
 *
 * Request body: { email: string, password: string }
 * Response: { id: string, email: string }
 */
app.post("/api/auth/signin", async (req, res) => {
  try {
    // Extract credentials from request
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Find user by email (case-insensitive)
    const users = loadUsers();
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());

    // Check if user exists
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Verify password against stored hash
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Create session (log user in)
    req.session.userId = user.id;

    // Return user info
    res.json({ id: user.id, email: user.email });
  } catch (err) {
    console.error("Signin error:", err);
    res.status(500).json({ error: "Failed to sign in" });
  }
});


/*
 * POST /api/auth/signout
 *
 * End the current session.
 * Response: { success: true }
 */
app.post("/api/auth/signout", (req, res) => {
  // Destroy session
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Failed to sign out" });
    }
    res.json({ success: true });
  });
});


/*
 * GET /api/auth/me
 *
 * Check current auth status. Called on page load.
 * Response: { user: { id, email } | null }
 */
app.get("/api/auth/me", (req, res) => {
  // Check if session exists
  if (!req.session.userId) {
    return res.json({ user: null });
  }

  // Look up user by ID
  const users = loadUsers();
  const user = users.find((u) => u.id === req.session.userId);

  // User not found (session may be stale)
  if (!user) {
    return res.json({ user: null });
  }

  // Return user info
  res.json({ user: { id: user.id, email: user.email } });
});


/* ──────────────────────────────────────────────────────────────
   ENTRY CRUD ENDPOINTS
   ────────────────────────────────────────────────────────────── */

/*
 * GET /api/entries
 *
 * Get all entries for the logged-in user.
 * Returns array sorted by date (newest first).
 *
 * Response: Entry[]
 *
 * Entry object:
 *   {
 *     id: string,
 *     content: string,
 *     date: string (YYYY-MM-DD),
 *     createdAt: string (ISO timestamp),
 *     summary: string | null, // set by /analyze
 *     tags: string[], // set by /analyze
 *     actionItems: string[], // set by /analyze
 *     mood: string | null, // set by /analyze
 *     keyInsights: string[] // set by /analyze
 *   }
 */
app.get("/api/entries", requireAuth, (req, res) => {
  // Load entries for current user
  const entries = loadEntries(req.session.userId);

  // Sort by date descending (newest first)
  entries.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Return entries array
  res.json(entries);
});


/*
 * GET /api/entries/:id
 *
 * Get a single entry by ID.
 * Response: Entry object (see above)
 */
app.get("/api/entries/:id", requireAuth, (req, res) => {
  // Load user's entries
  const entries = loadEntries(req.session.userId);

  // Find entry by ID
  const entry = entries.find((e) => e.id === req.params.id);

  // Return 404 if not found
  if (!entry) return res.status(404).json({ error: "Entry not found" });

  // Return entry
  res.json(entry);
});


/*
 * POST /api/entries
 *
 * Create a new journal entry.
 * Also generates an embedding vector for semantic search.
 *
 * Request body: { content: string, date?: string }
 * Response: Entry object
 */
app.post("/api/entries", requireAuth, async (req, res) => {
  try {
    // Extract fields from request
    const { content, date } = req.body;
    const userId = req.session.userId;

    // Validate content is provided
    if (!content) return res.status(400).json({ error: "Content required" });

    // create new entry object
    const entry = {
      id: uuidv4(), // unique id
      content, // journal text
      date: date || new Date().toISOString().split("T")[0], // default to today
      createdAt: new Date().toISOString(), // timestamp
      summary: null, // set by /analyze
      tags: [], // set by /analyze
      actionItems: [], // set by /analyze
      mood: null, // set by /analyze
      reflection: null, // set by /clarity
    };

    // Load existing entries and add new one
    const entries = loadEntries(userId);
    entries.push(entry);
    saveEntries(userId, entries);

    // Generate embedding for semantic search
    try {
      const embedding = await getEmbedding(content);
      const embeddings = loadEmbeddings(userId);
      embeddings[entry.id] = embedding;
      saveEmbeddings(userId, embeddings);
      console.log(`Created entry ${entry.id.slice(0,8)}... with embedding`);
    } catch (err) {
      console.error("Embedding generation failed:", err);
      // Continue anyway - entry is saved, just won't be searchable
    }

    // Return created entry
    res.json(entry);
  } catch (err) {
    console.error("Create entry error:", err);
    res.status(500).json({ error: "Failed to create entry" });
  }
});


/*
 * PUT /api/entries/:id
 *
 * Update an existing entry.
 * If content is changed, re-generates the embedding.
 *
 * Request body: Partial<Entry> (any fields to update)
 * Response: Updated Entry object
 */
app.put("/api/entries/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    // Load user's entries
    const entries = loadEntries(userId);

    // Find entry index
    const idx = entries.findIndex((e) => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Entry not found" });

    // merge updates into existing entry
    const updates = req.body;
    entries[idx] = {
      ...entries[idx], // keep existing fields
      ...updates, // override with updates
      updatedAt: new Date().toISOString() // track update time
    };
    saveEntries(userId, entries);

    // Re-generate embedding if content changed
    if (updates.content) {
      try {
        const embedding = await getEmbedding(updates.content);
        const embeddings = loadEmbeddings(userId);
        embeddings[req.params.id] = embedding;
        saveEmbeddings(userId, embeddings);
        console.log(`Updated entry ${req.params.id.slice(0,8)}... with new embedding`);
      } catch (err) {
        console.error("Embedding update failed:", err);
      }
    }

    // Return updated entry
    res.json(entries[idx]);
  } catch (err) {
    console.error("Update entry error:", err);
    res.status(500).json({ error: "Failed to update entry" });
  }
});


/*
 * DELETE /api/entries/:id
 *
 * Delete an entry and its embedding.
 * Response: { success: true }
 */
app.delete("/api/entries/:id", requireAuth, (req, res) => {
  const userId = req.session.userId;

  // Load user's entries
  const entries = loadEntries(userId);

  // Find entry index
  const idx = entries.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Entry not found" });

  // Remove entry from array
  entries.splice(idx, 1);
  saveEntries(userId, entries);

  // Clean up associated embedding
  const embeddings = loadEmbeddings(userId);
  delete embeddings[req.params.id];
  saveEmbeddings(userId, embeddings);

  // Return success
  res.json({ success: true });
});


/* ──────────────────────────────────────────────────────────────
   AI-POWERED ENDPOINTS
   ────────────────────────────────────────────────────────────── */

/*
 * POST /api/analyze
 *
 * Use AI to analyze a journal entry and extract structured data.
 * Updates the entry in place with analysis results.
 *
 * Request body: { entryId: string }
 * Response: Entry object (with summary, tags, mood, etc. populated)
 *
 * The LLM extracts:
 * - summary: 2-3 sentence overview
 * - tags: mood:xxx and topic:xxx tags
 * - actionItems: concrete next steps mentioned
 * - mood: primary emotion
 * - keyInsights: notable observations
 */
app.post("/api/analyze", requireAuth, async (req, res) => {
  try {
    // Get entry ID from request
    const { entryId } = req.body;
    const userId = req.session.userId;

    // Load user's entries and find the target
    const entries = loadEntries(userId);
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    // System prompt tells the LLM how to analyze
    const systemPrompt = `You are a thoughtful journaling assistant. Analyze the journal entry and extract structured information.

Respond ONLY with valid JSON in this exact format (no other text):
{
  "summary": "A clear 2-3 sentence summary of the entry",
  "tags": ["mood:feeling", "topic:subject"],
  "actionItems": ["concrete action 1", "concrete action 2"],
  "mood": "primary mood word",
  "keyInsights": ["insight 1", "insight 2"]
}

Tag guidelines:
- Include 1-2 mood tags like "mood:anxious", "mood:hopeful"
- Include 1-3 topic tags like "topic:work", "topic:relationships"
- Add special tags if relevant: "decision-needed", "win", "breakthrough"`;

    // User message contains the entry content
    const userContent = `Journal entry from ${entry.date}:\n\n${entry.content}`;

    // Call LLM with low temperature for consistent output
    const text = await groqChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      0.3 // low temperature = more deterministic
    );

    // Log for debugging
    logInteraction("analyze", { entryId, content: entry.content }, text);

    // Parse JSON from LLM response
    const parsed = safeParseJson(text);
    if (!parsed) {
      return res.status(500).json({ error: "Failed to parse analysis", raw: text });
    }

    // Update entry with analysis results
    const idx = entries.findIndex((e) => e.id === entryId);
    entries[idx] = {
      ...entries[idx],
      summary: parsed.summary || null,
      tags: parsed.tags || [],
      actionItems: parsed.actionItems || [],
      mood: parsed.mood || null,
      keyInsights: parsed.keyInsights || [],
      analyzedAt: new Date().toISOString(), // track when analyzed
    };
    saveEntries(userId, entries);

    // Return updated entry
    res.json(entries[idx]);
  } catch (err) {
    console.error("Analyze error:", err);
    res.status(500).json({ error: "Analysis failed: " + err.message });
  }
});


/*
 * POST /api/clarity
 *
 * Generate reflective questions to help user think deeper.
 * Useful when someone doesn't fully understand what they're feeling.
 *
 * Request body: { entryId: string }
 * Response: {
 *   reflection: string, // "It sounds like..." observation
 *   questions: string[] // open-ended follow-up questions
 * }
 */
app.post("/api/clarity", requireAuth, async (req, res) => {
  try {
    // Get entry ID and load entry
    const { entryId } = req.body;
    const userId = req.session.userId;
    const entries = loadEntries(userId);
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    // System prompt for coaching-style response
    const systemPrompt = `You are a gentle, insightful journaling coach. The user has written a journal entry and may not fully understand what they're feeling or what they want.

Respond ONLY with valid JSON (no other text):
{
  "reflection": "1-2 sentences starting with 'It sounds like...' about what they might be processing",
  "questions": ["open-ended question 1", "question 2", "question 3"]
}

Questions should be open-ended, specific to their situation, and focused on feelings, wants, or next steps.`;

    // Call LLM with higher temperature for variety
    const text = await groqChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Journal entry:\n\n${entry.content}` },
      ],
      0.7 // higher temp = more creative responses
    );

    // Log for debugging
    logInteraction("clarity", { entryId, content: entry.content }, text);

    // Parse JSON response
    const parsed = safeParseJson(text);
    if (!parsed) {
      return res.status(500).json({ error: "Failed to parse response", raw: text });
    }

    // Return reflection and questions
    res.json({
      reflection: parsed.reflection || null,
      questions: parsed.questions || [],
    });
  } catch (err) {
    console.error("Clarity error:", err);
    res.status(500).json({ error: "Clarity generation failed: " + err.message });
  }
});


/*
 * POST /api/search
 *
 * Semantic search - find entries by meaning, not just keywords.
 *
 * How it works:
 * 1. Convert search query to an embedding vector
 * 2. Compare against all entry embeddings using cosine similarity
 * 3. Return top matches sorted by similarity score
 *
 * Request body: { query: string, limit?: number }
 * Response: Entry[] (each with added 'similarity' field, 0-1)
 */
app.post("/api/search", requireAuth, async (req, res) => {
  try {
    // Extract search parameters
    const { query, limit = 5 } = req.body;
    const userId = req.session.userId;

    // Validate query provided
    if (!query) return res.status(400).json({ error: "Query required" });

    // Convert query to embedding vector
    const queryEmbedding = await getEmbedding(query);

    // Load user's embeddings and entries
    const embeddings = loadEmbeddings(userId);
    const entries = loadEntries(userId);

    console.log(`Search: "${query}" against ${entries.length} entries`);

    // Calculate similarity score for each entry
    const results = [];
    for (const entry of entries) {
      // Skip entries without embeddings
      if (embeddings[entry.id]) {
        const similarity = cosineSimilarity(queryEmbedding, embeddings[entry.id]);
        results.push({ ...entry, similarity });
      }
    }

    // Sort by similarity descending (best matches first)
    results.sort((a, b) => b.similarity - a.similarity);

    // Return top N results
    const topResults = results.slice(0, limit);

    console.log(`Returning ${topResults.length} results, top score: ${topResults[0]?.similarity?.toFixed(3) || 'N/A'}`);

    // Log for debugging
    logInteraction("search", { query }, { resultCount: topResults.length, topSimilarity: topResults[0]?.similarity });

    // Return results with similarity scores
    res.json(topResults);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Search failed: " + err.message });
  }
});


/*
 * POST /api/reflect
 *
 * RAG-powered reflection: finds relevant past entries and generates
 * a personalized reflection based on patterns across them.
 *
 * Flow:
 * 1. Semantic search to find entries related to the topic
 * 2. Build context from top matches
 * 3. Send to LLM to generate reflection
 *
 * Request body: { topic: string, limit?: number }
 * Response: {
 *   reflection: string,
 *   patterns: string[],
 *   suggestedQuestions: string[],
 *   relatedEntries: { id, date, similarity }[]
 * }
 */
app.post("/api/reflect", requireAuth, async (req, res) => {
  try {
    // Extract parameters
    const { topic, limit = 5 } = req.body;
    const userId = req.session.userId;

    // Validate topic provided
    if (!topic) return res.status(400).json({ error: "Topic required" });

    // Convert topic to embedding vector
    const queryEmbedding = await getEmbedding(topic);

    // Load user's data
    const embeddings = loadEmbeddings(userId);
    const entries = loadEntries(userId);

    // Find entries related to the topic
    const relevantEntries = [];
    for (const entry of entries) {
      if (embeddings[entry.id]) {
        const similarity = cosineSimilarity(queryEmbedding, embeddings[entry.id]);
        // Only include entries above threshold
        if (similarity > 0.3) {
          relevantEntries.push({ ...entry, similarity });
        }
      }
    }

    // Sort by relevance and take top entries
    relevantEntries.sort((a, b) => b.similarity - a.similarity);
    const topEntries = relevantEntries.slice(0, limit);

    // Handle case where no related entries found
    if (topEntries.length === 0) {
      return res.json({
        reflection: "I couldn't find any journal entries related to this topic yet. Try writing about it!",
        relatedEntries: [],
      });
    }

    // Build context string from related entries (truncate long ones)
    const context = topEntries
      .map((e) => `[${e.date}]: ${e.content.substring(0, 500)}${e.content.length > 500 ? "..." : ""}`)
      .join("\n\n");

    // System prompt for reflection generation
    const systemPrompt = `You are a thoughtful journaling assistant helping the user reflect on patterns in their journal.

Based on the relevant journal entries, write a reflection that identifies patterns, growth, and suggests questions for exploration.

Respond ONLY with valid JSON (no other text):
{
  "reflection": "3-5 paragraph reflection referencing specific entries by date",
  "patterns": ["pattern 1", "pattern 2"],
  "suggestedQuestions": ["question 1", "question 2"]
}`;

    // Call LLM with context
    const text = await groqChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Topic: "${topic}"\n\nRelevant entries:\n\n${context}` },
      ],
      0.7
    );

    // Log for debugging
    logInteraction("reflect", { topic, entriesUsed: topEntries.length }, text);

    // Parse response
    const parsed = safeParseJson(text);

    // Return reflection with related entry references
    res.json({
      reflection: parsed?.reflection || text,
      patterns: parsed?.patterns || [],
      suggestedQuestions: parsed?.suggestedQuestions || [],
      relatedEntries: topEntries.map((e) => ({ id: e.id, date: e.date, similarity: e.similarity })),
    });
  } catch (err) {
    console.error("Reflect error:", err);
    res.status(500).json({ error: "Reflection failed: " + err.message });
  }
});


/*
 * GET /api/recap/weekly
 *
 * Generate an AI summary of the past week's journaling.
 *
 * Includes:
 * - Narrative recap of themes and patterns
 * - Highlights and challenges
 * - Suggested intentions for next week
 * - Stats (entry count, top tags, moods)
 *
 * Response: {
 *   recap: string,
 *   highlights: string[],
 *   challenges: string[],
 *   intentions: string[],
 *   stats: { entryCount, topTags, moods, dateRange }
 * }
 */
app.get("/api/recap/weekly", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    // Load all entries
    const entries = loadEntries(userId);

    // Filter to entries from the last 7 days
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekEntries = entries.filter((e) => new Date(e.date) >= weekAgo);

    // Handle case where no entries this week
    if (weekEntries.length === 0) {
      return res.json({
        recap: "No journal entries from the past week. Try writing something today!",
        stats: { entryCount: 0 },
      });
    }

    // Build context from week's entries (sorted chronologically)
    const context = weekEntries
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((e) => {
        const summary = e.summary || e.content.substring(0, 300);
        const tags = e.tags?.length ? ` [Tags: ${e.tags.join(", ")}]` : "";
        return `[${e.date}]: ${summary}${tags}`;
      })
      .join("\n\n");

    // Aggregate tag statistics
    const allTags = weekEntries.flatMap((e) => e.tags || []);
    const tagCounts = {};
    allTags.forEach((t) => (tagCounts[t] = (tagCounts[t] || 0) + 1));

    // Aggregate mood statistics
    const allMoods = weekEntries.map((e) => e.mood).filter(Boolean);
    const moodCounts = {};
    allMoods.forEach((m) => (moodCounts[m] = (moodCounts[m] || 0) + 1));

    // System prompt for recap generation
    const systemPrompt = `You are a warm journaling assistant creating a weekly recap.

Summarize the week's themes, emotional patterns, wins, challenges, and suggest intentions for next week.

Respond ONLY with valid JSON (no other text):
{
  "recap": "3-4 paragraph weekly recap",
  "highlights": ["highlight 1", "highlight 2"],
  "challenges": ["challenge 1"],
  "intentions": ["intention for next week"]
}`;

    // Call LLM
    const text = await groqChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Week's journal entries:\n\n${context}` },
      ],
      0.7
    );

    // Log for debugging
    logInteraction("weekly-recap", { entryCount: weekEntries.length }, text);

    // Parse response
    const parsed = safeParseJson(text);

    // Return recap with stats
    res.json({
      recap: parsed?.recap || text,
      highlights: parsed?.highlights || [],
      challenges: parsed?.challenges || [],
      intentions: parsed?.intentions || [],
      stats: {
        entryCount: weekEntries.length,
        topTags: Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5),
        moods: moodCounts,
        dateRange: {
          start: weekAgo.toISOString().split("T")[0],
          end: now.toISOString().split("T")[0],
        },
      },
    });
  } catch (err) {
    console.error("Weekly recap error:", err);
    res.status(500).json({ error: "Recap generation failed: " + err.message });
  }
});


/*
 * POST /api/embeddings/regenerate
 *
 * Rebuild all embeddings for user's entries.
 * Use if search seems broken or after changing embedding logic.
 *
 * Response: { success: true, count: number }
 */
app.post("/api/embeddings/regenerate", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    // Load all entries
    const entries = loadEntries(userId);

    // Generate fresh embeddings
    const embeddings = {};
    console.log(`Regenerating embeddings for ${entries.length} entries...`);

    for (const entry of entries) {
      const embedding = await getEmbedding(entry.content);
      embeddings[entry.id] = embedding;
      console.log(`  Generated embedding for entry ${entry.id.slice(0, 8)}...`);
    }

    // Save new embeddings
    saveEmbeddings(userId, embeddings);
    console.log(`Saved ${Object.keys(embeddings).length} embeddings`);

    // Return success with count
    res.json({ success: true, count: Object.keys(embeddings).length });
  } catch (err) {
    console.error("Regenerate embeddings error:", err);
    res.status(500).json({ error: "Failed to regenerate embeddings: " + err.message });
  }
});


/*
 * GET /api/logs
 *
 * Get AI interaction logs (for debugging/evaluation).
 *
 * Query params:
 *   date - YYYY-MM-DD to get specific day's logs
 *   (none) - returns list of available dates
 */
app.get("/api/logs", (req, res) => {
  try {
    const { date } = req.query;

    // Get list of log files
    const logFiles = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith(".json"));

    // If date specified, return that day's logs
    if (date) {
      const logFile = path.join(LOGS_DIR, `${date}.json`);
      if (fs.existsSync(logFile)) {
        return res.json(JSON.parse(fs.readFileSync(logFile, "utf-8")));
      }
      return res.json([]); // no logs for that date
    }

    // Otherwise return list of available dates
    res.json({ availableDates: logFiles.map((f) => f.replace(".json", "")) });
  } catch (err) {
    console.error("Logs error:", err);
    res.status(500).json({ error: "Failed to retrieve logs" });
  }
});


/* ──────────────────────────────────────────────────────────────
   START SERVER
   ────────────────────────────────────────────────────────────── */

// Get port from environment or default to 3000
const PORT = process.env.PORT || 3000;

// Start listening for requests
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

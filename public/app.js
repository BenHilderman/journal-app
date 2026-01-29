/*
 * ClearMindAI - Frontend
 *
 * Single-page app for the journaling experience.
 * Built with vanilla JS - no framework, just DOM manipulation.
 *
 * Features:
 * - Guest mode (data in localStorage) with upgrade path to account
 * - Entry CRUD with real-time sidebar updates
 * - AI features: analyze, clarity questions, semantic search, reflection
 */


/* ──────────────────────────────────────────────────────────────
   APP STATE

   Global variables that track the current state of the app.
   These get updated as the user interacts with the UI.
   ────────────────────────────────────────────────────────────── */

let entries = []; // all loaded journal entries
let currentEntryId = null; // id of currently selected entry
let isEditing = false; // true when editor is open
let authState = { isGuest: true, user: null }; // current auth state
let signupPromptShown = false; // track if signup prompt was shown

// LocalStorage keys for guest mode data
const GUEST_ENTRIES_KEY = "clearmind_guest_entries";
const GUEST_EMBEDDINGS_KEY = "clearmind_guest_embeddings";


/* ──────────────────────────────────────────────────────────────
   DOM REFERENCES

   Cache DOM element references for better performance.
   These are used throughout the app for updates.
   ────────────────────────────────────────────────────────────── */

// Main screen containers
const welcomeScreen = document.getElementById("welcomeScreen");
const mainApp = document.getElementById("mainApp");
const entriesList = document.getElementById("entriesList");
const editorSection = document.getElementById("editorSection");
const entryDisplay = document.getElementById("entryDisplay");
const emptyState = document.getElementById("emptyState");
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");
const entryCount = document.getElementById("entryCount");

// Auth modal elements
const authModal = document.getElementById("authModal");
const authForm = document.getElementById("authForm");
const authModalTitle = document.getElementById("authModalTitle");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authError = document.getElementById("authError");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authSwitchText = document.getElementById("authSwitchText");
const authSwitchLink = document.getElementById("authSwitchLink");

// Signup prompt modal (shown after first guest entry)
const signupPromptModal = document.getElementById("signupPromptModal");


/* ──────────────────────────────────────────────────────────────
   WELCOME SCREEN - Typing Animation

   Creates a typewriter effect on the welcome screen showing
   example journal entries to give users an idea of the app.
   ────────────────────────────────────────────────────────────── */

// Example phrases for the typing animation
const typingPhrases = [
  "Today I realized that taking breaks actually makes me more productive...",
  "Feeling grateful for the small wins this week...",
  "Need to remember: progress over perfection...",
  "Had a breakthrough moment during my morning walk...",
  "Learning to be more patient with myself lately..."
];

// Store timeout ID so we can cancel the animation
let typingTimeout = null;

// Start the typewriter animation
function startTypingAnimation() {
  // Get the element to type into
  const typingElement = document.getElementById("typingText");
  if (!typingElement) return; // element not found, bail out

  // animation state
  let phraseIndex = 0; // which phrase we're on
  let charIndex = 0; // which character we're on
  let isDeleting = false; // are we deleting or typing?
  let pauseEnd = 0; // timestamp when pause ends

  // Main animation loop
  function type() {
    const currentPhrase = typingPhrases[phraseIndex];

    // Check if we're in a pause
    if (Date.now() < pauseEnd) {
      typingTimeout = setTimeout(type, 50);
      return;
    }

    if (isDeleting) {
      // Remove one character
      typingElement.textContent = currentPhrase.substring(0, charIndex - 1);
      charIndex--;

      // If we've deleted everything, move to next phrase
      if (charIndex === 0) {
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % typingPhrases.length; // loop around
        pauseEnd = Date.now() + 500; // pause before typing next
      }
    } else {
      // Add one character
      typingElement.textContent = currentPhrase.substring(0, charIndex + 1);
      charIndex++;

      // If we've typed everything, start deleting
      if (charIndex === currentPhrase.length) {
        isDeleting = true;
        pauseEnd = Date.now() + 2000; // pause at end of phrase
      }
    }

    // Calculate speed: delete faster, add randomness for natural feel
    const speed = isDeleting ? 30 : 50 + Math.random() * 50;
    typingTimeout = setTimeout(type, speed);
  }

  // Start animation after a short delay
  setTimeout(type, 800);
}

// Stop the typing animation (called when leaving welcome screen)
function stopTypingAnimation() {
  if (typingTimeout) {
    clearTimeout(typingTimeout);
    typingTimeout = null;
  }
}


/* ──────────────────────────────────────────────────────────────
   INITIALIZATION

   Entry point for the app - runs when page loads.
   ────────────────────────────────────────────────────────────── */

// Run when DOM is ready
document.addEventListener("DOMContentLoaded", async () => {
  // Set up event listeners for welcome screen
  setupWelcomeListeners();
  // Check if user is already logged in
  await checkAuthStatus();
});

// Set up all welcome screen and auth modal event listeners
function setupWelcomeListeners() {
  // "Get Started" button - enter as guest
  document.getElementById("getStartedBtn")?.addEventListener("click", () => {
    authState = { isGuest: true, user: null };
    showMainApp();
  });

  // "Sign In" link on welcome screen
  document.getElementById("showSignInBtn")?.addEventListener("click", (e) => {
    e.preventDefault(); // prevent link navigation
    showAuthModal("signin");
  });

  // Auth modal close button (X)
  document.getElementById("closeAuthModal")?.addEventListener("click", hideAuthModal);

  // Click backdrop to close modal
  document.querySelector("#authModal .modal-backdrop")?.addEventListener("click", hideAuthModal);

  // Toggle between sign in and sign up
  authSwitchLink?.addEventListener("click", (e) => {
    e.preventDefault();
    toggleAuthMode();
  });

  // Auth form submit handler
  authForm?.addEventListener("submit", handleAuthSubmit);

  // Signup prompt modal buttons
  document.getElementById("promptSignUpBtn")?.addEventListener("click", () => {
    hideSignupPrompt();
    showAuthModal("signup");
  });
  document.getElementById("promptContinueBtn")?.addEventListener("click", hideSignupPrompt);
  document.querySelector("#signupPromptModal .modal-backdrop")?.addEventListener("click", hideSignupPrompt);
}

// Check if user has an existing session on page load
async function checkAuthStatus() {
  try {
    // Call API to check session
    const response = await fetch("/api/auth/me");
    const data = await response.json();

    if (data.user) {
      // User is logged in - go straight to app
      authState = { isGuest: false, user: data.user };
      showMainApp();
    } else {
      // Not logged in - show welcome screen
      welcomeScreen.classList.remove("hidden");
      startTypingAnimation();
    }
  } catch (err) {
    // On error, show welcome screen
    console.error("Auth check failed:", err);
    welcomeScreen.classList.remove("hidden");
    startTypingAnimation();
  }
}


/* ──────────────────────────────────────────────────────────────
   SCREEN TRANSITIONS

   Functions to switch between different app screens/states.
   ────────────────────────────────────────────────────────────── */

// Transition from welcome screen to main app
function showMainApp() {
  // Stop welcome screen animation
  stopTypingAnimation();

  // Hide welcome, show app
  welcomeScreen.classList.add("hidden");
  mainApp.classList.remove("hidden");
  mainApp.classList.add("visible");

  // Load data and set up app
  loadEntries();
  setupEventListeners();
  updateUserStateUI();
}

// Update sidebar to show current auth state
function updateUserStateUI() {
  const userStateText = document.getElementById("userStateText");
  const userStateAction = document.getElementById("userStateAction");

  if (authState.isGuest) {
    // Guest mode - show sign up link
    userStateText.textContent = "Guest Mode";
    userStateAction.textContent = "Sign Up";
    userStateAction.onclick = (e) => {
      e.preventDefault();
      showAuthModal("signup");
    };
  } else {
    // Logged in - show email and sign out link
    userStateText.textContent = authState.user.email;
    userStateAction.textContent = "Sign Out";
    userStateAction.onclick = async (e) => {
      e.preventDefault();
      await signOut();
    };
  }
}

// Set up all main app event listeners
function setupEventListeners() {
  // New entry button
  document.getElementById("newEntryBtn").addEventListener("click", startNewEntry);

  // Editor buttons
  document.getElementById("saveBtn").addEventListener("click", saveEntry);
  document.getElementById("cancelBtn").addEventListener("click", cancelEdit);

  // Entry action buttons
  document.getElementById("editBtn").addEventListener("click", editCurrentEntry);
  document.getElementById("analyzeBtn").addEventListener("click", analyzeCurrentEntry);
  document.getElementById("clarityBtn").addEventListener("click", getClarityForEntry);
  document.getElementById("deleteBtn").addEventListener("click", deleteCurrentEntry);

  // Navigation tabs
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  // Search input and button
  document.getElementById("searchBtn").addEventListener("click", performSearch);
  document.getElementById("searchInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") performSearch(); // search on enter
  });

  // Reflection input and button
  document.getElementById("reflectBtn").addEventListener("click", performReflection);
  document.getElementById("reflectInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") performReflection();
  });

  // Weekly recap button
  document.getElementById("generateRecapBtn").addEventListener("click", generateRecap);
}


/* ──────────────────────────────────────────────────────────────
   AUTH MODAL

   Modal dialog for signing in or signing up.
   ────────────────────────────────────────────────────────────── */

// Track current auth mode (signin vs signup)
let authMode = "signin";

// Show the auth modal in specified mode
function showAuthModal(mode = "signin") {
  authMode = mode;

  // Reset form state
  authError.classList.add("hidden");
  authEmail.value = "";
  authPassword.value = "";

  // Update text based on mode
  if (mode === "signin") {
    authModalTitle.textContent = "Sign In";
    authSubmitBtn.textContent = "Sign In";
    authSwitchText.textContent = "Don't have an account?";
    authSwitchLink.textContent = "Sign Up";
  } else {
    authModalTitle.textContent = "Sign Up to Save Your Journal";
    authSubmitBtn.textContent = "Create Account";
    authSwitchText.textContent = "Already have an account?";
    authSwitchLink.textContent = "Sign In";
  }

  // Show the modal
  authModal.classList.remove("hidden");
}

// Hide the auth modal
function hideAuthModal() {
  authModal.classList.add("hidden");
}

// Toggle between signin and signup modes
function toggleAuthMode() {
  showAuthModal(authMode === "signin" ? "signup" : "signin");
}

// Handle auth form submission
async function handleAuthSubmit(e) {
  e.preventDefault(); // prevent page reload

  // Get form values
  const email = authEmail.value.trim();
  const password = authPassword.value;

  // Reset error state and disable button
  authError.classList.add("hidden");
  authSubmitBtn.disabled = true;
  authSubmitBtn.textContent = authMode === "signin" ? "Signing In..." : "Creating Account...";

  try {
    if (authMode === "signup") {
      // Get guest data to migrate to new account
      const guestEntries = loadGuestEntries();
      const guestEmbeddings = loadGuestEmbeddings();

      // Call signup API
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          guestEntries: guestEntries.length > 0 ? guestEntries : undefined,
          guestEmbeddings: Object.keys(guestEmbeddings).length > 0 ? guestEmbeddings : undefined
        }),
      });

      // Handle response
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Signup failed");

      // Clear guest data after successful migration
      clearGuestData();

      // Update auth state
      authState = { isGuest: false, user: data };
    } else {
      // Call signin API
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      // Handle response
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sign in failed");

      // Update auth state
      authState = { isGuest: false, user: data };
    }

    // Close modal
    hideAuthModal();

    // Navigate to app or reload data
    if (!welcomeScreen.classList.contains("hidden")) {
      showMainApp(); // coming from welcome screen
    } else {
      await loadEntries(); // already in app, just reload
      updateUserStateUI();
    }
  } catch (err) {
    // Show error message
    authError.textContent = err.message;
    authError.classList.remove("hidden");
  } finally {
    // Re-enable button
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = authMode === "signin" ? "Sign In" : "Create Account";
  }
}

// Sign out and return to welcome screen
async function signOut() {
  try {
    // Call signout API
    await fetch("/api/auth/signout", { method: "POST" });

    // Reset app state
    authState = { isGuest: true, user: null };
    entries = [];
    currentEntryId = null;
    signupPromptShown = false;

    // Return to welcome screen
    mainApp.classList.remove("visible");
    mainApp.classList.add("hidden");
    welcomeScreen.classList.remove("hidden");
  } catch (err) {
    console.error("Sign out failed:", err);
  }
}


/* ──────────────────────────────────────────────────────────────
   SIGNUP PROMPT

   Modal shown after a guest saves their first entry.
   Encourages them to create an account to save their data.
   ────────────────────────────────────────────────────────────── */

// Show the signup prompt modal
function showSignupPrompt() {
  // Only show once and only for guests
  if (!signupPromptShown && authState.isGuest) {
    signupPromptShown = true;
    signupPromptModal.classList.remove("hidden");
  }
}

// Hide the signup prompt modal
function hideSignupPrompt() {
  signupPromptModal.classList.add("hidden");
}


/* ──────────────────────────────────────────────────────────────
   GUEST MODE STORAGE

   Guest mode stores data in browser localStorage.
   When user signs up, this data is migrated to the server.
   ────────────────────────────────────────────────────────────── */

// Load guest entries from localStorage
function loadGuestEntries() {
  try {
    const data = localStorage.getItem(GUEST_ENTRIES_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return []; // return empty on error
  }
}

// Save guest entries to localStorage
function saveGuestEntries(entries) {
  localStorage.setItem(GUEST_ENTRIES_KEY, JSON.stringify(entries));
}

// Load guest embeddings from localStorage
function loadGuestEmbeddings() {
  try {
    const data = localStorage.getItem(GUEST_EMBEDDINGS_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

// Save guest embeddings to localStorage
function saveGuestEmbeddings(embeddings) {
  localStorage.setItem(GUEST_EMBEDDINGS_KEY, JSON.stringify(embeddings));
}

// Clear all guest data (after migration to account)
function clearGuestData() {
  localStorage.removeItem(GUEST_ENTRIES_KEY);
  localStorage.removeItem(GUEST_EMBEDDINGS_KEY);
}


/* ──────────────────────────────────────────────────────────────
   API LAYER

   Abstracts the difference between guest (localStorage) and
   authenticated (server) modes. Components just call api()
   and it automatically routes to the right place.
   ────────────────────────────────────────────────────────────── */

// Universal API call function
async function api(endpoint, options = {}) {
  // Guest mode - handle locally in localStorage
  if (authState.isGuest) {
    return guestApi(endpoint, options);
  }

  // Authenticated mode - call server
  const response = await fetch(`/api${endpoint}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  // Handle session expiration (401)
  if (response.status === 401) {
    authState = { isGuest: true, user: null };
    updateUserStateUI();
    throw new Error("Session expired. Please sign in again.");
  }

  // Handle other errors
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }

  // Return JSON response
  return response.json();
}

// Handle API calls locally for guest users
function guestApi(endpoint, options = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : null;

  // GET /entries - list all entries
  if (endpoint === "/entries" && method === "GET") {
    const entries = loadGuestEntries();
    // Sort by date descending
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    return Promise.resolve(entries);
  }

  // POST /entries - create new entry
  if (endpoint === "/entries" && method === "POST") {
    const entries = loadGuestEntries();

    // Create new entry object
    const entry = {
      id: generateUUID(),
      content: body.content,
      date: body.date || new Date().toISOString().split("T")[0],
      createdAt: new Date().toISOString(),
      summary: null,
      tags: [],
      actionItems: [],
      mood: null,
      reflection: null,
    };

    // Save to localStorage
    entries.push(entry);
    saveGuestEntries(entries);
    return Promise.resolve(entry);
  }

  // PUT /entries/:id - update entry
  if (endpoint.startsWith("/entries/") && method === "PUT") {
    const id = endpoint.split("/")[2]; // extract id from path
    const entries = loadGuestEntries();
    const idx = entries.findIndex((e) => e.id === id);

    // Return error if not found
    if (idx === -1) return Promise.reject(new Error("Entry not found"));

    // Merge updates and save
    entries[idx] = { ...entries[idx], ...body, updatedAt: new Date().toISOString() };
    saveGuestEntries(entries);
    return Promise.resolve(entries[idx]);
  }

  // DELETE /entries/:id - delete entry
  if (endpoint.startsWith("/entries/") && method === "DELETE") {
    const id = endpoint.split("/")[2];
    const entries = loadGuestEntries();
    const idx = entries.findIndex((e) => e.id === id);

    if (idx === -1) return Promise.reject(new Error("Entry not found"));

    // Remove from array
    entries.splice(idx, 1);
    saveGuestEntries(entries);

    // Also remove embedding
    const embeddings = loadGuestEmbeddings();
    delete embeddings[id];
    saveGuestEmbeddings(embeddings);

    return Promise.resolve({ success: true });
  }

  // AI features require an account
  if (["/analyze", "/clarity", "/search", "/reflect", "/recap/weekly"].some(e => endpoint.startsWith(e))) {
    return Promise.reject(new Error("This feature requires an account. Sign up to use AI-powered features!"));
  }

  // Unknown endpoint
  return Promise.reject(new Error("Unknown endpoint"));
}

// Regenerate embeddings for all entries (admin function)
async function regenerateEmbeddings() {
  // Require account
  if (authState.isGuest) {
    showAuthModal("signup");
    return;
  }

  showLoading("Regenerating embeddings...");

  try {
    const result = await api("/embeddings/regenerate", { method: "POST" });
    alert(`Regenerated embeddings for ${result.count} entries. Try searching again!`);
  } catch (err) {
    alert("Failed to regenerate embeddings: " + err.message);
  } finally {
    hideLoading();
  }
}

// Generate a UUID (for guest mode entry IDs)
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}


/* ──────────────────────────────────────────────────────────────
   LOADING OVERLAY

   Shows a loading spinner with message during async operations.
   ────────────────────────────────────────────────────────────── */

// Show loading overlay with message
function showLoading(message = "Loading...") {
  loadingText.textContent = message;
  loadingOverlay.classList.remove("hidden");
}

// Hide loading overlay
function hideLoading() {
  loadingOverlay.classList.add("hidden");
}


/* ──────────────────────────────────────────────────────────────
   ENTRY MANAGEMENT

   Functions for loading, displaying, and managing entries.
   ────────────────────────────────────────────────────────────── */

// Load all entries from API and update UI
async function loadEntries() {
  try {
    // Fetch entries
    entries = await api("/entries");

    // Update sidebar list
    renderEntriesList();
    updateEntryCount();

    // Show appropriate view
    if (entries.length === 0) {
      showEmpty(); // no entries yet
    } else if (!currentEntryId && !isEditing) {
      selectEntry(entries[0].id); // auto-select first
    }
  } catch (err) {
    console.error("Failed to load entries:", err);
  }
}

// Update the entry count display
function updateEntryCount() {
  const count = entries.length;
  entryCount.textContent = `${count} ${count === 1 ? "entry" : "entries"}`;
}

// Render the sidebar list of entries
function renderEntriesList() {
  // Handle empty state
  if (entries.length === 0) {
    entriesList.innerHTML = '<p class="no-entries">No entries yet</p>';
    return;
  }

  // Generate HTML for each entry
  entriesList.innerHTML = entries
    .map((entry) => {
      const preview = entry.summary || entry.content.substring(0, 50) + "...";
      const isActive = entry.id === currentEntryId ? "active" : "";
      return `
        <div class="entry-item ${isActive}" data-id="${entry.id}">
          <div class="entry-item-date">${formatDate(entry.date)}</div>
          <div class="entry-item-preview">${escapeHtml(preview)}</div>
        </div>
      `;
    })
    .join("");

  // Add click handlers to entry items
  entriesList.querySelectorAll(".entry-item").forEach((item) => {
    item.addEventListener("click", () => selectEntry(item.dataset.id));
  });
}

// Format date for display (e.g., "Mon, Jan 15")
function formatDate(dateStr) {
  const date = new Date(dateStr + "T00:00:00"); // avoid timezone issues
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Escape HTML to prevent XSS when rendering user content
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text; // set as text (not HTML)
  return div.innerHTML; // get escaped HTML
}


/* ──────────────────────────────────────────────────────────────
   VIEW SWITCHING

   Functions to switch between different views/panels.
   ────────────────────────────────────────────────────────────── */

// Switch between main views (entries, search, reflect, recap)
function switchView(view) {
  // Update nav button active states
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  // Show selected view, hide others
  document.querySelectorAll(".view").forEach((v) => {
    v.classList.remove("active");
  });
  document.getElementById(`${view}View`).classList.add("active");
}

// Show the editor (for new/edit entry)
function showEditor() {
  editorSection.classList.remove("hidden");
  entryDisplay.classList.add("hidden");
  emptyState.classList.add("hidden");
}

// Show the entry display (read mode)
function showDisplay() {
  editorSection.classList.add("hidden");
  entryDisplay.classList.remove("hidden");
  emptyState.classList.add("hidden");
}

// Show empty state (no entries)
function showEmpty() {
  editorSection.classList.add("hidden");
  entryDisplay.classList.add("hidden");
  emptyState.classList.remove("hidden");
}


/* ──────────────────────────────────────────────────────────────
   ENTRY CRUD

   Create, read, update, delete operations for entries.
   ────────────────────────────────────────────────────────────── */

// Start creating a new entry
function startNewEntry() {
  // Switch to entries view
  switchView("entries");

  // Reset state
  currentEntryId = null;
  isEditing = true;

  // Set default date to today
  document.getElementById("entryDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("entryContent").value = "";

  // Show editor and focus
  showEditor();
  document.getElementById("entryContent").focus();

  // Update sidebar to remove active state
  renderEntriesList();
}

// Save entry (create new or update existing)
async function saveEntry() {
  // Get form values
  const content = document.getElementById("entryContent").value.trim();
  const date = document.getElementById("entryDate").value;

  // Validate content
  if (!content) {
    alert("Please write something first.");
    return;
  }

  showLoading("Saving...");

  try {
    let entry;
    const isFirstEntry = entries.length === 0 && !currentEntryId;

    if (currentEntryId) {
      // Update existing entry
      entry = await api(`/entries/${currentEntryId}`, {
        method: "PUT",
        body: JSON.stringify({ content, date }),
      });
    } else {
      // Create new entry
      entry = await api("/entries", {
        method: "POST",
        body: JSON.stringify({ content, date }),
      });
    }

    // Reload entries list
    await loadEntries();

    // Select the saved entry
    currentEntryId = entry.id;
    isEditing = false;
    displayEntry(entry);

    // Prompt guests to sign up after first entry
    if (isFirstEntry && authState.isGuest) {
      setTimeout(() => showSignupPrompt(), 500);
    }
  } catch (err) {
    alert("Failed to save: " + err.message);
  } finally {
    hideLoading();
  }
}

// Cancel editing and return to previous view
function cancelEdit() {
  isEditing = false;

  // If we were editing an existing entry, show it
  if (currentEntryId) {
    const entry = entries.find((e) => e.id === currentEntryId);
    if (entry) {
      displayEntry(entry);
      return;
    }
  }

  // Otherwise show empty state
  showEmpty();
}

// Select an entry from the sidebar
function selectEntry(id) {
  const entry = entries.find((e) => e.id === id);
  if (entry) {
    currentEntryId = id;
    displayEntry(entry);
    renderEntriesList(); // update active state in sidebar
  }
}

// Display an entry in read mode
function displayEntry(entry) {
  // Set basic info
  document.getElementById("displayDate").textContent = formatDate(entry.date);
  document.getElementById("displayContent").textContent = entry.content;

  // Show analysis section if entry has been analyzed
  const analysisSection = document.getElementById("analysisSection");
  if (entry.summary || entry.tags?.length || entry.actionItems?.length) {
    analysisSection.classList.remove("hidden");

    // Set analysis fields
    document.getElementById("analysisSummary").textContent = entry.summary || "No summary yet";
    document.getElementById("analysisMood").textContent = entry.mood || "Unknown";

    // Render tags with appropriate styling
    const tagsContainer = document.getElementById("analysisTags");
    tagsContainer.innerHTML = (entry.tags || [])
      .map((tag) => {
        let tagClass = "tag";
        if (tag.startsWith("mood:")) tagClass += " mood";
        else if (tag.startsWith("topic:")) tagClass += " topic";
        return `<span class="${tagClass}">${escapeHtml(tag)}</span>`;
      })
      .join("");

    // Render action items list
    const actionsList = document.getElementById("analysisActions");
    actionsList.innerHTML = (entry.actionItems || [])
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("") || "<li>No action items</li>";

    // Render insights list
    const insightsList = document.getElementById("analysisInsights");
    insightsList.innerHTML = (entry.keyInsights || [])
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("") || "<li>No insights yet</li>";
  } else {
    // Hide analysis section if not analyzed
    analysisSection.classList.add("hidden");
  }

  // Hide clarity section by default
  document.getElementById("claritySection").classList.add("hidden");

  // Switch to display view
  showDisplay();
}

// Switch to edit mode for current entry
function editCurrentEntry() {
  const entry = entries.find((e) => e.id === currentEntryId);
  if (!entry) return;

  isEditing = true;

  // Populate form with entry data
  document.getElementById("entryDate").value = entry.date;
  document.getElementById("entryContent").value = entry.content;

  showEditor();
}

// Analyze current entry with AI
async function analyzeCurrentEntry() {
  if (!currentEntryId) return;

  // Require account for AI features
  if (authState.isGuest) {
    showAuthModal("signup");
    return;
  }

  showLoading("Analyzing entry...");

  try {
    // Call analyze API
    const entry = await api("/analyze", {
      method: "POST",
      body: JSON.stringify({ entryId: currentEntryId }),
    });

    // Reload and display updated entry
    await loadEntries();
    displayEntry(entry);
  } catch (err) {
    alert("Analysis failed: " + err.message);
  } finally {
    hideLoading();
  }
}

// Get clarity questions for current entry
async function getClarityForEntry() {
  if (!currentEntryId) return;

  // Require account
  if (authState.isGuest) {
    showAuthModal("signup");
    return;
  }

  showLoading("Generating clarity questions...");

  try {
    // Call clarity API
    const result = await api("/clarity", {
      method: "POST",
      body: JSON.stringify({ entryId: currentEntryId }),
    });

    // Display results in clarity section
    const claritySection = document.getElementById("claritySection");
    document.getElementById("clarityReflection").textContent = result.reflection || "";
    document.getElementById("clarityQuestions").innerHTML = (result.questions || [])
      .map((q) => `<li>${escapeHtml(q)}</li>`)
      .join("");

    claritySection.classList.remove("hidden");
  } catch (err) {
    alert("Failed to generate clarity: " + err.message);
  } finally {
    hideLoading();
  }
}

// Delete current entry
async function deleteCurrentEntry() {
  if (!currentEntryId) return;

  // Confirm deletion
  if (!confirm("Are you sure you want to delete this entry?")) return;

  showLoading("Deleting...");

  try {
    // Call delete API
    await api(`/entries/${currentEntryId}`, { method: "DELETE" });

    // Reset state
    currentEntryId = null;

    // Reload entries
    await loadEntries();
    showEmpty();
  } catch (err) {
    alert("Failed to delete: " + err.message);
  } finally {
    hideLoading();
  }
}


/* ──────────────────────────────────────────────────────────────
   SEMANTIC SEARCH

   Search entries by meaning using embeddings.
   Results show similarity scores (0-100%).
   ────────────────────────────────────────────────────────────── */

// Perform semantic search
async function performSearch() {
  // Get search query
  const query = document.getElementById("searchInput").value.trim();
  if (!query) return;

  // Require account
  if (authState.isGuest) {
    showAuthModal("signup");
    return;
  }

  showLoading("Searching...");

  try {
    // Call search API
    const results = await api("/search", {
      method: "POST",
      body: JSON.stringify({ query, limit: 10 }),
    });

    const resultsContainer = document.getElementById("searchResults");

    if (results.length === 0) {
      // No results - check if user has any entries
      const allEntries = await api("/entries");
      if (allEntries.length === 0) {
        resultsContainer.innerHTML = '<p class="no-results">No entries yet. Create some entries first!</p>';
      } else {
        resultsContainer.innerHTML = `<p class="no-results">No matching entries found. You have ${allEntries.length} entries - try regenerating embeddings.</p><button class="btn btn-secondary" onclick="regenerateEmbeddings()">Regenerate Embeddings</button>`;
      }
    } else {
      // Render search results
      resultsContainer.innerHTML = results
        .map(
          (entry) => `
          <div class="search-result" data-id="${entry.id}">
            <div class="search-result-header">
              <span class="search-result-date">${formatDate(entry.date)}</span>
              <span class="search-result-score">${(entry.similarity * 100).toFixed(0)}% match</span>
            </div>
            <div class="search-result-preview">
              ${escapeHtml(entry.summary || entry.content.substring(0, 150))}...
            </div>
          </div>
        `
        )
        .join("");

      // Add click handlers to navigate to entries
      resultsContainer.querySelectorAll(".search-result").forEach((item) => {
        item.addEventListener("click", () => {
          switchView("entries");
          selectEntry(item.dataset.id);
        });
      });
    }
  } catch (err) {
    alert("Search failed: " + err.message);
  } finally {
    hideLoading();
  }
}


/* ──────────────────────────────────────────────────────────────
   REFLECTION (RAG)

   Uses past entries as context to generate personalized insights.
   Finds related entries and sends them to the LLM.
   ────────────────────────────────────────────────────────────── */

// Generate reflection on a topic
async function performReflection() {
  // Get topic
  const topic = document.getElementById("reflectInput").value.trim();
  if (!topic) return;

  // Require account
  if (authState.isGuest) {
    showAuthModal("signup");
    return;
  }

  showLoading("Reflecting on past entries...");

  try {
    // Call reflect API
    const result = await api("/reflect", {
      method: "POST",
      body: JSON.stringify({ topic, limit: 7 }),
    });

    // Display results
    const resultsContainer = document.getElementById("reflectResults");
    document.getElementById("reflectContent").textContent = result.reflection;

    // Render patterns list
    document.getElementById("reflectPatterns").innerHTML = (result.patterns || [])
      .map((p) => `<li>${escapeHtml(p)}</li>`)
      .join("") || "<li>No patterns identified yet</li>";

    // Render suggested questions
    document.getElementById("reflectQuestions").innerHTML = (result.suggestedQuestions || [])
      .map((q) => `<li>${escapeHtml(q)}</li>`)
      .join("") || "<li>No questions suggested</li>";

    // Render related entries
    document.getElementById("reflectEntries").innerHTML = (result.relatedEntries || [])
      .map(
        (e) => `
          <span class="related-entry" data-id="${e.id}">
            ${formatDate(e.date)} (${(e.similarity * 100).toFixed(0)}%)
          </span>
        `
      )
      .join("") || "<span>No related entries</span>";

    // Add click handlers to related entries
    document.querySelectorAll(".related-entry").forEach((item) => {
      item.addEventListener("click", () => {
        switchView("entries");
        selectEntry(item.dataset.id);
      });
    });

    resultsContainer.classList.remove("hidden");
  } catch (err) {
    alert("Reflection failed: " + err.message);
  } finally {
    hideLoading();
  }
}


/* ──────────────────────────────────────────────────────────────
   WEEKLY RECAP

   AI-generated summary of the past week's journaling.
   Includes highlights, challenges, and suggested intentions.
   ────────────────────────────────────────────────────────────── */

// Generate weekly recap
async function generateRecap() {
  // Require account
  if (authState.isGuest) {
    showAuthModal("signup");
    return;
  }

  showLoading("Generating weekly recap...");

  try {
    // Call recap API
    const result = await api("/recap/weekly");

    // Display results
    const resultsContainer = document.getElementById("recapResults");

    // Set stats
    document.getElementById("recapEntryCount").textContent = result.stats?.entryCount || 0;
    document.getElementById("recapDateRange").textContent = result.stats?.dateRange
      ? `${result.stats.dateRange.start.slice(5)} - ${result.stats.dateRange.end.slice(5)}`
      : "-";

    // Set recap text
    document.getElementById("recapContent").textContent = result.recap;

    // Render highlights
    document.getElementById("recapHighlights").innerHTML = (result.highlights || [])
      .map((h) => `<li>${escapeHtml(h)}</li>`)
      .join("") || "<li>No highlights this week</li>";

    // Render challenges
    document.getElementById("recapChallenges").innerHTML = (result.challenges || [])
      .map((c) => `<li>${escapeHtml(c)}</li>`)
      .join("") || "<li>No challenges noted</li>";

    // Render intentions
    document.getElementById("recapIntentions").innerHTML = (result.intentions || [])
      .map((i) => `<li>${escapeHtml(i)}</li>`)
      .join("") || "<li>No intentions set</li>";

    // Render tags
    document.getElementById("recapTags").innerHTML = (result.stats?.topTags || [])
      .map(([tag, count]) => `<span class="tag">${escapeHtml(tag)} (${count})</span>`)
      .join("") || "<span class='no-data'>No tags</span>";

    // Render moods
    document.getElementById("recapMoods").innerHTML = Object.entries(result.stats?.moods || {})
      .map(([mood, count]) => `<span class="mood-item">${escapeHtml(mood)}<span class="count">x${count}</span></span>`)
      .join("") || "<span class='no-data'>No moods tracked</span>";

    resultsContainer.classList.remove("hidden");
  } catch (err) {
    alert("Recap failed: " + err.message);
  } finally {
    hideLoading();
  }
}

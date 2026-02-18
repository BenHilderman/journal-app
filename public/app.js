const API = '';
let currentUser = null;
let currentView = 'journal';
let currentEntryId = null;

// handles streaming responses from the server (SSE)

function fetchStream(url, body, { onToken, onParsed, onDone, onError }) {
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Stream request failed' }));
      if (onError) onError(err.error || 'Stream request failed');
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') { if (onDone) onDone(); return; }
        try {
          const data = JSON.parse(payload);
          if (data.error) { if (onError) onError(data.error); return; }
          if (data.token !== undefined) { if (onToken) onToken(data.token); }
          else if (data.parsed !== undefined) { if (onParsed) onParsed(data.parsed); }
          else if (data.response !== undefined) { if (onParsed) onParsed(data.response); }
        } catch {}
      }
    }
    if (onDone) onDone();
  }).catch((err) => {
    if (onError) onError(err.message);
  });
}

function showStreamingResult() {
  const container = document.getElementById('aiResults');
  const card = document.createElement('div');
  card.className = 'stream-card';
  const cursor = document.createElement('span');
  cursor.className = 'stream-cursor';
  card.appendChild(cursor);
  container.innerHTML = '';
  container.appendChild(card);

  return {
    append(token) {
      card.insertBefore(document.createTextNode(token), cursor);
    },
    finalize(html) {
      card.remove();
      container.innerHTML = html;
    }
  };
}

// mood detection — scans text for keywords to guess how you're feeling

const MOOD_KEYWORDS = {
  excited: ['aced', 'passed', 'accepted', 'graduated', 'launch', 'released', 'awesome', 'amazing', 'breakthrough', 'nailed', 'crushed'],
  confident: ['confident', 'solid', 'strong', 'ready', 'prepared', 'capable', 'skilled', 'mastered'],
  happy: ['happy', 'great', 'good', 'enjoy', 'love', 'fun', 'pleased', 'glad', 'nice', 'wonderful'],
  focused: ['focused', 'deep work', 'flow', 'zone', 'productive', 'grinding', 'heads down', 'locked in'],
  calm: ['calm', 'peaceful', 'relaxed', 'steady', 'balanced', 'content', 'quiet'],
  curious: ['curious', 'exploring', 'researching', 'wondering', 'interesting', 'learning', 'discovered', 'investigated'],
  anxious: ['anxious', 'worried', 'nervous', 'deadline', 'pressure', 'stress', 'overwhelm', 'behind'],
  frustrated: ['frustrated', 'stuck', 'broken', 'assignment', 'midterm', 'rejection', 'annoying', 'struggling', 'impossible', 'hate', 'ugh', 'terrible'],
  tired: ['tired', 'exhausted', 'drained', 'burnout', 'long day', 'burned out', 'fatigued', 'sleepy'],
  uncertain: ['uncertain', 'confused', 'unclear', 'unsure', 'doubt', 'maybe', 'not sure', 'lost'],
};

const MOOD_COLORS = {
  excited:   { bg: 'rgba(95, 138, 78, 0.12)',  text: '#3d6b2e', label: 'Excited' },
  confident: { bg: 'rgba(95, 138, 78, 0.12)',  text: '#3d6b2e', label: 'Confident' },
  happy:     { bg: 'rgba(95, 138, 78, 0.10)',  text: '#4a7a38', label: 'Happy' },
  focused:   { bg: 'rgba(139, 111, 78, 0.10)', text: '#6b5430', label: 'Focused' },
  calm:      { bg: 'rgba(139, 111, 78, 0.08)', text: '#7a6340', label: 'Calm' },
  curious:   { bg: 'rgba(139, 122, 158, 0.12)', text: '#5e5070', label: 'Curious' },
  anxious:   { bg: 'rgba(184, 144, 58, 0.12)', text: '#8a6d1c', label: 'Anxious' },
  frustrated:{ bg: 'rgba(194, 101, 85, 0.12)', text: '#9b4030', label: 'Frustrated' },
  tired:     { bg: 'rgba(184, 144, 58, 0.10)', text: '#8a6d1c', label: 'Tired' },
  uncertain: { bg: 'rgba(139, 122, 158, 0.10)', text: '#6b5e7a', label: 'Uncertain' },
};

function detectMood(text) {
  const lower = text.toLowerCase();
  let best = null;
  let bestCount = 0;
  for (const [mood, keywords] of Object.entries(MOOD_KEYWORDS)) {
    let count = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) count++;
    }
    if (count > bestCount) { bestCount = count; best = mood; }
  }
  return bestCount > 0 ? best : null;
}

(function initMoodRing() {
  const editor = document.querySelector('.editor-wrap');
  if (!editor) return;
  const ring = document.createElement('div');
  ring.className = 'mood-ring';
  editor.style.position = 'relative';
  editor.appendChild(ring);

  let debounceTimer;
  let currentMood = null;
  const entryEl = document.getElementById('entryContent');

  entryEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const mood = detectMood(entryEl.value);
      if (mood && mood !== currentMood) {
        currentMood = mood;
        const colors = MOOD_COLORS[mood];
        ring.textContent = colors.label;
        ring.style.background = colors.bg;
        ring.style.color = colors.text;
        ring.classList.add('visible');
        ring.classList.remove('mood-ring-pop');
        void ring.offsetWidth;
        ring.classList.add('mood-ring-pop');
      } else if (!mood) {
        currentMood = null;
        ring.classList.remove('visible');
      }
    }, 500);
  });
})();

// login / signup handling

let isSignUp = false;
const authForm = document.getElementById('authForm');
const authToggle = document.getElementById('authToggle');
const authToggleText = document.getElementById('authToggleText');
const authSubmit = document.getElementById('authSubmit');
const authName = document.getElementById('authName');
const authError = document.getElementById('authError');

authToggle.addEventListener('click', (e) => {
  e.preventDefault();
  isSignUp = !isSignUp;
  authSubmit.textContent = isSignUp ? 'Sign Up' : 'Sign In';
  authToggleText.textContent = isSignUp ? 'Already have an account?' : "Don't have an account?";
  authToggle.textContent = isSignUp ? 'Sign In' : 'Sign Up';
  authName.style.display = isSignUp ? 'block' : 'none';
  authError.textContent = '';
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  const email = document.getElementById('authEmail').value;
  const password = document.getElementById('authPassword').value;
  const name = authName.value;

  try {
    const endpoint = isSignUp ? '/api/auth/signup' : '/api/auth/signin';
    const body = isSignUp ? { email, password, name } : { email, password };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    currentUser = data.user;
    showMainScreen();
  } catch (err) {
    authError.textContent = err.message;
  }
});

document.getElementById('signOutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/signout', { method: 'POST' });
  currentUser = null;
  document.getElementById('authScreen').classList.add('active');
  document.getElementById('mainScreen').classList.remove('active');
});

// typing effect on login screen

const typingPhrases = [
  "Had a breakthrough moment today — everything just clicked...",
  "Feeling grateful for the progress I've made this week...",
  "Tough day, but writing it out helps me see it more clearly...",
  "Set a new goal today. Nervous but excited to start...",
  "Sometimes the smallest wins matter the most..."
];

let phraseIndex = 0;
let charIndex = 0;
let isDeleting = false;
const typingDemo = document.getElementById('typingDemo');

function typePhrase() {
  const phrase = typingPhrases[phraseIndex];
  if (!isDeleting) {
    typingDemo.textContent = phrase.substring(0, charIndex + 1);
    charIndex++;
    if (charIndex === phrase.length) {
      setTimeout(() => { isDeleting = true; typePhrase(); }, 2000);
      return;
    }
    setTimeout(typePhrase, 40 + Math.random() * 30);
  } else {
    typingDemo.textContent = phrase.substring(0, charIndex - 1);
    charIndex--;
    if (charIndex === 0) {
      isDeleting = false;
      phraseIndex = (phraseIndex + 1) % typingPhrases.length;
      setTimeout(typePhrase, 500);
      return;
    }
    setTimeout(typePhrase, 20);
  }
}
typePhrase();

// tab navigation + sliding indicator

const navIndicator = document.querySelector('.nav-indicator');

function moveIndicator(btn) {
  if (!navIndicator || !btn) return;
  const nav = btn.parentElement;
  const navRect = nav.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  navIndicator.style.left = (btnRect.left - navRect.left) + 'px';
  navIndicator.style.width = btnRect.width + 'px';
}

// position indicator on the initial active tab once layout is ready
requestAnimationFrame(() => {
  const activeBtn = document.querySelector('.nav-btn.active');
  if (activeBtn) moveIndicator(activeBtn);
});
window.addEventListener('resize', () => {
  const activeBtn = document.querySelector('.nav-btn.active');
  if (activeBtn) moveIndicator(activeBtn);
});

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    switchView(view);
  });
});

const viewOrder = { journal: 0, entries: 1, search: 2, recap: 3, insights: 4 };

function switchView(view) {
  const oldIndex = viewOrder[currentView] || 0;
  const newIndex = viewOrder[view] || 0;
  const direction = newIndex > oldIndex ? 'right' : 'left';

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active', 'slide-from-left', 'slide-from-right'));
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.nav-btn[data-view="${view}"]`);
  activeBtn.classList.add('active');
  moveIndicator(activeBtn);

  const el = document.getElementById(`${view}View`);
  el.classList.add('active', `slide-from-${direction}`);
  if (view === 'entries') loadEntries();
}

async function showMainScreen() {
  document.getElementById('authScreen').classList.remove('active');
  document.getElementById('mainScreen').classList.add('active');
  document.getElementById('userName').textContent = currentUser.name;
  // reposition indicator after main screen becomes visible
  requestAnimationFrame(() => {
    const activeBtn = document.querySelector('.nav-btn.active');
    if (activeBtn) moveIndicator(activeBtn);
  });
  // check if the user needs to set up their api key
  if (window._checkApiKey) window._checkApiKey();
}

// tracks whether the user has a groq api key configured
let hasApiKey = false;

// all the buttons that need an api key to work
const AI_BUTTONS = ['analyzeBtn', 'clarityBtn', 'reflectBtn', 'generateRecapBtn', 'generateInsightsBtn', 'generateTimeCapsuleBtn'];

function updateAIButtonStates() {
  for (const id of AI_BUTTONS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    if (hasApiKey) {
      btn.disabled = false;
      btn.title = '';
      btn.classList.remove('ai-disabled');
    } else {
      btn.disabled = true;
      btn.title = 'Set up your API key to use AI features';
      btn.classList.add('ai-disabled');
    }
  }

  // show/hide the "API Key" button in the header
  const headerBtn = document.getElementById('apiKeyHeaderBtn');
  if (headerBtn) headerBtn.style.display = hasApiKey ? 'none' : 'inline-flex';
}

function openApiKeyModal() {
  const overlay = document.getElementById('apiKeyOverlay');
  if (overlay) overlay.style.display = 'flex';
}

function closeApiKeyModal() {
  const overlay = document.getElementById('apiKeyOverlay');
  if (overlay) overlay.style.display = 'none';
}

// opens the api key modal if you try to use an ai feature without a key
function requireApiKey() {
  if (!hasApiKey) {
    openApiKeyModal();
    return false;
  }
  return true;
}

// api key setup modal
(function initApiKeySetup() {
  const overlay = document.getElementById('apiKeyOverlay');
  const input = document.getElementById('apiKeyInput');
  const saveBtn = document.getElementById('apiKeySaveBtn');
  const skipBtn = document.getElementById('apiKeySkip');
  const closeBtn = document.getElementById('apiModalClose');
  const errorEl = document.getElementById('apiKeyError');
  const headerBtn = document.getElementById('apiKeyHeaderBtn');
  if (!overlay) return;

  async function checkApiKey() {
    try {
      const res = await fetch('/api/settings/has-key');
      const data = await res.json();
      hasApiKey = !!data.hasKey;
    } catch {
      hasApiKey = false;
    }
    updateAIButtonStates();
  }

  saveBtn.addEventListener('click', async () => {
    const key = input.value.trim();
    if (!key) { errorEl.textContent = 'Please paste your API key'; return; }
    errorEl.textContent = '';
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;

    try {
      const res = await fetch('/api/settings/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      hasApiKey = true;
      updateAIButtonStates();
      closeApiKeyModal();
      showNotification('API key saved — AI features are now active!');
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      saveBtn.textContent = 'Save Key';
      saveBtn.disabled = false;
    }
  });

  skipBtn.addEventListener('click', () => {
    closeApiKeyModal();
  });

  closeBtn.addEventListener('click', () => {
    closeApiKeyModal();
  });

  // clicking the header "API Key" button opens the modal
  if (headerBtn) {
    headerBtn.addEventListener('click', openApiKeyModal);
  }

  // clicking overlay background closes the modal
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeApiKeyModal();
  });

  window._checkApiKey = checkApiKey;
})();

// check if already logged in on page load
(async () => {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.user) {
      currentUser = data.user;
      showMainScreen();
    }
  } catch (e) {
    // not logged in, that's fine
  }
})();

// save particle burst

function spawnParticles(originEl) {
  const rect = originEl.getBoundingClientRect();
  const colors = ['var(--brown)', 'var(--green)', 'var(--amber)', 'var(--purple)'];
  for (let i = 0; i < 7; i++) {
    const p = document.createElement('div');
    p.className = 'save-particle';
    p.style.left = rect.left + rect.width / 2 + (Math.random() - 0.5) * 40 + 'px';
    p.style.top = rect.top + 'px';
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--dx', (Math.random() - 0.5) * 80 + 'px');
    p.style.setProperty('--dy', -(60 + Math.random() * 60) + 'px');
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1000);
  }
}

// persist journal entry (create or update)

document.getElementById('saveEntryBtn').addEventListener('click', async () => {
  const content = document.getElementById('entryContent').value.trim();
  const title = document.getElementById('entryTitle').value.trim();
  if (!content) return;

  const saveBtn = document.getElementById('saveEntryBtn');
  try {
    const method = currentEntryId ? 'PUT' : 'POST';
    const url = currentEntryId ? `/api/entries/${currentEntryId}` : '/api/entries';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, title: title || undefined })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentEntryId = data.entry.id;
    spawnParticles(saveBtn);
    showNotification('Entry saved!');
  } catch (err) {
    showNotification(err.message, 'error');
  }
});

// ai analysis / clarity / reflect buttons

document.getElementById('analyzeBtn').addEventListener('click', async () => {
  if (!requireApiKey()) return;
  const content = document.getElementById('entryContent').value.trim();
  if (!content) return;

  const stream = showStreamingResult();
  fetchStream('/api/stream/analyze', { content, entryId: currentEntryId }, {
    onToken(token) { stream.append(token); },
    onParsed(a) {
      setMoodOrbs(a.mood);
      stream.finalize(`
        <div class="analysis-card">
          <div class="analysis-mood">Mood: <span class="mood-badge mood-${a.mood}">${a.mood}</span></div>
          <div class="analysis-tags">${(a.tags || []).map(t => `<span class="tag">${t}</span>`).join('')}</div>
          <div class="analysis-summary"><strong>Summary:</strong> ${a.summary}</div>
          <div class="analysis-encouragement">${a.encouragement}</div>
        </div>
      `);
    },
    onError(msg) { showAIResult(`<div class="error-card">Analysis failed: ${msg}</div>`); },
  });
});

document.getElementById('clarityBtn').addEventListener('click', async () => {
  if (!requireApiKey()) return;
  const content = document.getElementById('entryContent').value.trim();
  if (!content) return;

  const stream = showStreamingResult();
  fetchStream('/api/stream/clarity', { content }, {
    onToken(token) { stream.append(token); },
    onParsed(c) {
      stream.finalize(`
        <div class="clarity-card">
          <div class="clarity-reflection"><strong>Reflection:</strong> ${c.reflection}</div>
          <div class="clarity-questions">
            <strong>Questions to explore:</strong>
            <ol>${(c.questions || []).map(q => `<li>${q}</li>`).join('')}</ol>
          </div>
        </div>
      `);
    },
    onError(msg) { showAIResult(`<div class="error-card">Clarity failed: ${msg}</div>`); },
  });
});

document.getElementById('reflectBtn').addEventListener('click', async () => {
  if (!requireApiKey()) return;
  const content = document.getElementById('entryContent').value.trim();
  if (!content) return;

  const stream = showStreamingResult();
  let relatedCount = 0;
  fetchStream('/api/stream/reflect', { content }, {
    onToken(token) { stream.append(token); },
    onParsed(data) {
      const r = data.reflection || data;
      relatedCount = data.relatedEntries || 0;
      stream.finalize(`
        <div class="reflect-card">
          <div class="reflect-text"><strong>Reflection:</strong> ${r.reflection}</div>
          <div class="reflect-patterns">
            <strong>Patterns noticed:</strong>
            <ul>${(r.patterns || []).map(p => `<li>${p}</li>`).join('')}</ul>
          </div>
          <div class="reflect-growth"><strong>Growth:</strong> ${r.growth}</div>
          <div class="reflect-meta">Based on ${relatedCount} related entries</div>
        </div>
      `);
    },
    onError(msg) { showAIResult(`<div class="error-card">Reflection failed: ${msg}</div>`); },
  });
});

function skeletonHTML() {
  return `
    <div class="ai-loading" style="flex-direction: column; align-items: stretch; gap: 0;">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line"></div>
    </div>`;
}

function showAILoading() {
  document.getElementById('aiResults').innerHTML = skeletonHTML();
}

function showAIResult(html) {
  document.getElementById('aiResults').innerHTML = html;
}

// load and render all journal entries

async function loadEntries() {
  const container = document.getElementById('entriesList');
  try {
    const res = await fetch('/api/entries');
    const data = await res.json();
    if (!data.entries || data.entries.length === 0) {
      container.innerHTML = emptyStateHTML('✒️', 'No entries yet.', 'Start journaling to see your entries here');
      return;
    }
    container.innerHTML = data.entries.map(e => `
      <div class="entry-card" data-id="${e.id}">
        <div class="entry-card-header">
          <h4>${e.title || 'Untitled'}</h4>
          <span class="entry-date">${new Date(e.createdAt).toLocaleDateString()}</span>
        </div>
        <p class="entry-preview">${e.content.substring(0, 150)}${e.content.length > 150 ? '...' : ''}</p>
        ${e.mood ? `<span class="mood-badge mood-${e.mood}">${e.mood}</span>` : ''}
        ${e.tags ? `<div class="entry-tags">${e.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>` : ''}
        <div class="entry-card-actions">
          <button class="btn btn-ghost btn-sm" onclick="editEntry('${e.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm btn-danger" onclick="deleteEntry('${e.id}')">Delete</button>
          <button class="btn btn-ghost btn-sm" onclick="exportEntry('${e.id}','pdf')" title="Export as PDF">PDF</button>
          <button class="btn btn-ghost btn-sm" onclick="exportEntry('${e.id}','markdown')" title="Export as Markdown">MD</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p class="empty-state error-text">Failed to load entries</p>`;
  }
}

window.editEntry = async function(id) {
  try {
    const res = await fetch(`/api/entries/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentEntryId = id;
    document.getElementById('entryTitle').value = data.entry.title || '';
    document.getElementById('entryContent').value = data.entry.content;
    switchView('journal');
  } catch (err) {
    showNotification(err.message, 'error');
  }
};

window.deleteEntry = async function(id) {
  if (!confirm('Delete this entry?')) return;
  try {
    const res = await fetch(`/api/entries/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    loadEntries();
    showNotification('Entry deleted');
  } catch (err) {
    showNotification(err.message, 'error');
  }
};

// semantic search through entries

document.getElementById('searchBtn').addEventListener('click', async () => {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;

  const container = document.getElementById('searchResults');
  container.innerHTML = skeletonHTML();

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      container.innerHTML = emptyStateHTML('🔍', 'No matching entries found', 'Try different search terms');
      return;
    }
    container.innerHTML = data.results.map(r => `
      <div class="search-result-card">
        <div class="search-result-header">
          <h4>${r.title || 'Untitled'}</h4>
          <span class="similarity-badge">${(r.similarity * 100).toFixed(0)}% match</span>
        </div>
        <p>${r.content}</p>
        <span class="entry-date">${new Date(r.createdAt).toLocaleDateString()}</span>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p class="empty-state error-text">Search failed: ${err.message}</p>`;
  }
});

document.getElementById('searchInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('searchBtn').click();
});

// weekly recap generation

document.getElementById('generateRecapBtn').addEventListener('click', async () => {
  if (!requireApiKey()) return;
  const container = document.getElementById('recapResults');
  container.innerHTML = skeletonHTML();

  try {
    const res = await fetch('/api/recap');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const r = data.recap;
    container.innerHTML = `
      <div class="recap-card">
        <div class="recap-summary"><strong>This Week:</strong> ${r.summary}</div>
        ${r.highlights ? `<div class="recap-section"><strong>Highlights:</strong><ul>${r.highlights.map(h => `<li>${h}</li>`).join('')}</ul></div>` : ''}
        ${r.mood ? `<div class="recap-mood">Overall Mood: <span class="mood-badge mood-${r.mood}">${r.mood}</span></div>` : ''}
        ${r.focusAreas ? `<div class="recap-section"><strong>Focus Areas:</strong><ul>${r.focusAreas.map(f => `<li>${f}</li>`).join('')}</ul></div>` : ''}
        ${r.suggestion ? `<div class="recap-suggestion"><strong>Next Week:</strong> ${r.suggestion}</div>` : ''}
      </div>
      ${data.entryCount ? `<p class="recap-meta">Based on ${data.entryCount} entries this week</p>` : ''}
    `;
    document.getElementById('recapExportPdf').style.display = 'inline-flex';
    document.getElementById('recapExportMd').style.display = 'inline-flex';
  } catch (err) {
    container.innerHTML = `<p class="empty-state error-text">Recap failed: ${err.message}</p>`;
  }
});

// insights tab — mood trends + growth patterns

document.getElementById('generateInsightsBtn').addEventListener('click', generateInsights);

async function generateInsights() {
  if (!requireApiKey()) return;
  const moodContainer = document.getElementById('moodChart');
  const growthContainer = document.getElementById('growthResults');

  moodContainer.innerHTML = skeletonHTML();
  growthContainer.innerHTML = skeletonHTML();

  // kick off both requests at once
  const [moodRes, growthRes] = await Promise.allSettled([
    fetchMoodTrends(),
    fetchGrowthPatterns()
  ]);

  if (moodRes.status === 'fulfilled') {
    renderMoodChart(moodRes.value);
  } else {
    moodContainer.innerHTML = `<p class="empty-state error-text">Failed to load mood trends</p>`;
  }

  if (growthRes.status === 'fulfilled') {
    renderGrowthPatterns(growthRes.value);
  } else {
    growthContainer.innerHTML = `<p class="empty-state error-text">Failed to load growth patterns</p>`;
  }
}

async function fetchMoodTrends() {
  const res = await fetch('/api/insights/mood-trends');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

async function fetchGrowthPatterns() {
  const res = await fetch('/api/insights/growth-patterns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

// mood chart — hand-rolled SVG because pulling in chart.js for one
// line chart felt like overkill

const moodScores = {
  'excited': 5, 'confident': 5, 'proud': 5,
  'happy': 4, 'focused': 4, 'motivated': 4, 'productive': 4, 'energized': 4,
  'neutral': 3, 'calm': 3, 'reflective': 3, 'curious': 3, 'thoughtful': 3,
  'anxious': 2, 'tired': 2, 'uncertain': 2, 'overwhelmed': 2, 'stressed': 2,
  'frustrated': 1, 'burned out': 1, 'stuck': 1, 'discouraged': 1
};

function getMoodScore(mood) {
  return moodScores[mood.toLowerCase()] || 3;
}

function renderMoodChart(data) {
  const container = document.getElementById('moodChart');

  if (!data.timeline || data.timeline.length === 0) {
    container.innerHTML = '<p class="empty-state">No mood data yet. Analyze some entries first!</p>';
    return;
  }

  const points = data.timeline.map(t => ({
    date: new Date(t.date),
    mood: t.mood,
    score: getMoodScore(t.mood)
  }));

  const width = 600;
  const height = 300;
  const padding = { top: 30, right: 30, bottom: 60, left: 70 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const xStep = points.length > 1 ? chartW / (points.length - 1) : chartW / 2;
  const yScale = (score) => padding.top + chartH - ((score - 1) / 4) * chartH;

  const moodLabels = ['Frustrated', 'Anxious', 'Neutral', 'Happy', 'Excited'];
  let svg = `<svg viewBox="0 0 ${width} ${height}" class="mood-svg">`;

  // y-axis grid + labels
  for (let i = 1; i <= 5; i++) {
    const y = yScale(i);
    svg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="grid-line"/>`;
    svg += `<text x="${padding.left - 10}" y="${y + 4}" class="y-label">${moodLabels[i - 1]}</text>`;
  }

  // connecting line
  if (points.length > 1) {
    let pathD = '';
    points.forEach((p, i) => {
      const x = padding.left + (i * xStep);
      const y = yScale(p.score);
      pathD += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });
    svg += `<path d="${pathD}" class="mood-line" fill="none"/>`;
  }

  // dots
  points.forEach((p, i) => {
    const x = padding.left + (points.length > 1 ? i * xStep : chartW / 2);
    const y = yScale(p.score);
    const moodColor = p.score >= 4 ? 'var(--color-success)' : p.score <= 2 ? 'var(--color-warning)' : 'var(--color-primary)';

    svg += `<circle cx="${x}" cy="${y}" r="5" fill="${moodColor}" class="mood-dot">
      <title>${p.mood} — ${p.date.toLocaleDateString()}</title>
    </circle>`;

    // don't show every date label if there are tons of entries
    if (points.length <= 10 || i % Math.ceil(points.length / 10) === 0) {
      svg += `<text x="${x}" y="${height - 15}" class="x-label" transform="rotate(-30 ${x} ${height - 15})">${p.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>`;
    }
  });

  svg += '</svg>';

  const freqHtml = Object.entries(data.frequency)
    .sort((a, b) => b[1] - a[1])
    .map(([mood, count]) => `<span class="mood-freq-item"><span class="mood-badge mood-${mood}">${mood}</span> ${count}x</span>`)
    .join('');

  container.innerHTML = `
    ${svg}
    <div class="mood-summary">
      <strong>Mood Distribution:</strong>
      <div class="mood-freq">${freqHtml}</div>
      <p class="mood-total">${data.total} analyzed entries</p>
    </div>
  `;
}

// growth pattern cards

function renderGrowthPatterns(data) {
  const container = document.getElementById('growthResults');
  const p = data.patterns;

  if (!p) {
    container.innerHTML = '<p class="empty-state">No patterns detected yet.</p>';
    return;
  }

  container.innerHTML = `
    <div class="growth-cards">
      <div class="recap-card growth-card growth-areas">
        <h4>🌱 Growth Areas</h4>
        <ul>${(p.growthAreas || []).map(g => `<li>${g}</li>`).join('')}</ul>
      </div>
      <div class="recap-card growth-card blind-spots">
        <h4>🔍 Blind Spots</h4>
        <ul>${(p.blindSpots || []).map(b => `<li>${b}</li>`).join('')}</ul>
      </div>
      <div class="recap-card growth-card recurring-themes">
        <h4>🔄 Recurring Themes</h4>
        <ul>${(p.recurringThemes || []).map(t => `<li>${t}</li>`).join('')}</ul>
      </div>
      <div class="recap-card growth-card suggestion-card">
        <h4>💡 Suggested Next Topic</h4>
        <p>${p.suggestion || 'Keep journaling to get personalized suggestions.'}</p>
      </div>
    </div>
  `;
}

// voice input (speech-to-text)

const micBtn = document.getElementById('micBtn');
const voiceStatus = document.getElementById('voiceStatus');
let recognition = null;
let isRecording = false;

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  let finalTranscript = '';

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += t + ' ';
      } else {
        interim = t;
      }
    }
    const editor = document.getElementById('entryContent');
    const before = editor.value.endsWith(' ') || editor.value === '' ? editor.value : editor.value + ' ';
    editor.value = before + finalTranscript + interim;
  };

  recognition.onend = () => {
    // if still supposed to be recording (browser auto-stops sometimes), restart
    if (isRecording) {
      finalTranscript = '';
      recognition.start();
      return;
    }
    micBtn.classList.remove('recording');
    voiceStatus.innerHTML = '';
  };

  recognition.onerror = (e) => {
    if (e.error === 'no-speech') return; // ignore silence
    isRecording = false;
    micBtn.classList.remove('recording');
    voiceStatus.innerHTML = '';
    showNotification('Mic error: ' + e.error, 'error');
  };

  micBtn.addEventListener('click', () => {
    if (isRecording) {
      isRecording = false;
      recognition.stop();
      micBtn.classList.remove('recording');
      voiceStatus.innerHTML = '';
      showNotification('Voice input stopped');
    } else {
      isRecording = true;
      finalTranscript = '';
      recognition.start();
      micBtn.classList.add('recording');
      voiceStatus.innerHTML = '<span class="voice-status"><span class="voice-dot"></span>Listening... click mic again to stop</span>';
    }
  });
} else {
  // browser doesn't support speech recognition
  micBtn.style.display = 'none';
}

// background orbs react when you're typing

let typingTimer;
const entryContent = document.getElementById('entryContent');
const appOrbs = document.querySelector('.app-orbs');

entryContent.addEventListener('input', () => {
  if (appOrbs) appOrbs.classList.add('orbs-active');
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (appOrbs) appOrbs.classList.remove('orbs-active');
  }, 1500);
});

// animated SVG border that traces around the editor on focus

const editorWrap = document.querySelector('.editor-wrap');

(function initEditorTrace() {
  if (!editorWrap) return;

  // create SVG overlay with two rects (glow + line) and a dot
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'editor-trace-svg');
  svg.setAttribute('preserveAspectRatio', 'none');

  const glowRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  glowRect.setAttribute('class', 'trace-glow');
  glowRect.setAttribute('x', '1');
  glowRect.setAttribute('y', '1');
  glowRect.setAttribute('width', 'calc(100% - 2px)');
  glowRect.setAttribute('height', 'calc(100% - 2px)');

  const lineRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  lineRect.setAttribute('class', 'trace-line');
  lineRect.setAttribute('x', '1');
  lineRect.setAttribute('y', '1');
  lineRect.setAttribute('width', 'calc(100% - 2px)');
  lineRect.setAttribute('height', 'calc(100% - 2px)');

  svg.appendChild(glowRect);
  svg.appendChild(lineRect);
  editorWrap.appendChild(svg);

  const dot = document.createElement('div');
  dot.className = 'editor-trace-dot';
  editorWrap.appendChild(dot);

  let perimeter = 0;
  let dotAnimFrame = null;
  let loopTimer = null;
  let isFocused = false;

  function measurePerimeter() {
    const w = svg.clientWidth - 2;
    const h = svg.clientHeight - 2;
    const r = 32;
    perimeter = 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
    lineRect.style.strokeDasharray = perimeter;
    glowRect.style.strokeDasharray = perimeter;
    return perimeter;
  }

  function getDotPos(progress) {
    const w = svg.clientWidth - 2;
    const h = svg.clientHeight - 2;
    const r = 32;
    let d = progress * perimeter;
    let x = 0, y = 0;

    const topStraight = w - 2 * r;
    if (d < topStraight) { x = r + d; y = 0; }
    else { d -= topStraight;
      const cornerLen = Math.PI * r / 2;
      if (d < cornerLen) { const a = d / r; x = w - r + Math.sin(a) * r; y = r - Math.cos(a) * r; }
      else { d -= cornerLen;
        const rightStraight = h - 2 * r;
        if (d < rightStraight) { x = w; y = r + d; }
        else { d -= rightStraight;
          if (d < Math.PI * r / 2) { const a = d / r; x = w - r + Math.cos(a) * r; y = h - r + Math.sin(a) * r; }
          else { d -= Math.PI * r / 2;
            if (d < topStraight) { x = w - r - d; y = h; }
            else { d -= topStraight;
              if (d < Math.PI * r / 2) { const a = d / r; x = r - Math.sin(a) * r; y = h - r + Math.cos(a) * r; }
              else { d -= Math.PI * r / 2;
                const leftStraight = h - 2 * r;
                if (d < leftStraight) { x = 0; y = h - r - d; }
                else { d -= leftStraight;
                  const a = d / r;
                  x = r - Math.cos(a) * r; y = r - Math.sin(a) * r;
                }
              }
            }
          }
        }
      }
    }
    return { x, y };
  }

  function animateDot() {
    const currentOffset = parseFloat(getComputedStyle(lineRect).strokeDashoffset) || 0;
    const progress = 1 - (currentOffset / perimeter);
    const pos = getDotPos(Math.min(progress, 1));

    dot.style.left = pos.x + 'px';
    dot.style.top = pos.y + 'px';

    if (currentOffset > 1) {
      dotAnimFrame = requestAnimationFrame(animateDot);
    } else {
      // trace complete — hide dot, wait, then restart
      dot.style.opacity = '0';
      editorWrap.classList.add('trace-complete');
      if (isFocused) {
        loopTimer = setTimeout(() => {
          if (isFocused) startTrace();
        }, 1500);
      }
    }
  }

  function startTrace() {
    editorWrap.classList.remove('trace-complete');
    measurePerimeter();
    // reset to hidden
    lineRect.style.transition = 'none';
    glowRect.style.transition = 'none';
    lineRect.style.strokeDashoffset = perimeter;
    glowRect.style.strokeDashoffset = perimeter;
    dot.style.opacity = '0.5';

    // force reflow then animate — smooth ease
    void lineRect.getBoundingClientRect();
    lineRect.style.transition = 'stroke-dashoffset 2s cubic-bezier(0.4, 0, 0.2, 1)';
    glowRect.style.transition = 'stroke-dashoffset 2s cubic-bezier(0.4, 0, 0.2, 1)';
    lineRect.style.strokeDashoffset = '0';
    glowRect.style.strokeDashoffset = '0';

    cancelAnimationFrame(dotAnimFrame);
    dotAnimFrame = requestAnimationFrame(animateDot);
  }

  entryContent.addEventListener('focus', () => {
    isFocused = true;
    editorWrap.classList.add('focused');
    startTrace();
  });

  entryContent.addEventListener('blur', () => {
    isFocused = false;
    editorWrap.classList.remove('focused');
    editorWrap.classList.remove('trace-complete');
    clearTimeout(loopTimer);
    cancelAnimationFrame(dotAnimFrame);
    lineRect.style.transition = 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
    glowRect.style.transition = 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
    lineRect.style.strokeDashoffset = perimeter;
    glowRect.style.strokeDashoffset = perimeter;
    dot.style.opacity = '0';
  });

  window.addEventListener('resize', () => { if (isFocused) measurePerimeter(); });
})();

// save button lights up when there's text

const saveBtn = document.getElementById('saveEntryBtn');

function updateSaveGlow() {
  if (!saveBtn) return;
  const hasContent = entryContent.value.trim().length > 0;
  saveBtn.classList.toggle('has-content', hasContent);
}

entryContent.addEventListener('input', updateSaveGlow);
entryContent.addEventListener('change', updateSaveGlow);

// tiny particles float up as you type

(function initKeystrokeParticles() {
  let lastParticle = 0;
  entryContent.addEventListener('input', () => {
    const now = Date.now();
    if (now - lastParticle < 120) return; // throttle
    lastParticle = now;

    const rect = editorWrap.getBoundingClientRect();
    const p = document.createElement('div');
    p.className = 'keystroke-particle';
    const x = rect.left + 20 + Math.random() * (rect.width - 40);
    const y = rect.bottom - 10;
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.setProperty('--float-x', (Math.random() - 0.5) * 30 + 'px');
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 800);
  });
})();

// character count removed — felt cluttery

// toast notifications

function showNotification(msg, type = 'success') {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = `notification notification-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// soft glow that follows the mouse around

(function initCursorGlow() {
  if (window.matchMedia('(hover: none)').matches) return;

  const glow = document.createElement('div');
  glow.className = 'cursor-glow';
  document.body.appendChild(glow);

  let targetX = -500, targetY = -500;
  let curX = -500, curY = -500;

  document.addEventListener('mousemove', (e) => {
    targetX = e.clientX;
    targetY = e.clientY;
  });

  function animate() {
    curX += (targetX - curX) * 0.08;
    curY += (targetY - curY) * 0.08;
    glow.style.left = curX + 'px';
    glow.style.top = curY + 'px';
    requestAnimationFrame(animate);
  }
  animate();
})();

// ripple effect when you click a button

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn) return;

  // ink ripple from click point
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'ink-ripple';
  const size = Math.max(rect.width, rect.height) * 2;
  ripple.style.width = size + 'px';
  ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
});

// draws a hand-drawn underline under section titles

function injectHandUnderlines() {
  const headers = document.querySelectorAll('.section-header h3, .bookshelf-header h3');
  headers.forEach(h3 => {
    if (h3.parentElement.classList.contains('hand-underline-wrap')) return;

    const wrapper = document.createElement('span');
    wrapper.className = 'hand-underline-wrap';
    h3.parentNode.insertBefore(wrapper, h3);
    wrapper.appendChild(h3);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('hand-underline');
    svg.setAttribute('viewBox', '0 0 200 8');
    svg.setAttribute('preserveAspectRatio', 'none');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M0 5 Q25 2, 50 5 T100 4 T150 5 T200 3');
    svg.appendChild(path);
    wrapper.appendChild(svg);
  });
}

injectHandUnderlines();

// wrap switchView to trigger underline draw on view change
const _origSwitchView = switchView;
switchView = function(view) {
  // reset ALL underlines before switching
  document.querySelectorAll('.hand-underline-wrap.drawn').forEach(w => {
    w.classList.remove('drawn');
    // also reset the path animation
    const path = w.querySelector('.hand-underline path');
    if (path) { path.style.animation = 'none'; void path.offsetWidth; path.style.animation = ''; }
  });

  _origSwitchView(view);

  // draw underlines in the newly active view after a frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const activeView = document.getElementById(`${view}View`);
      if (activeView) {
        activeView.querySelectorAll('.hand-underline-wrap').forEach(w => {
          w.classList.add('drawn');
        });
      }
    });
  });
};

// tilts cards slightly when you hover over them

document.addEventListener('mousemove', (e) => {
  const card = e.target.closest('.entry-card, .search-result-card, .recap-card, .growth-card, .analysis-card, .clarity-card, .reflect-card');
  if (!card) return;

  const rect = card.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const rotateX = ((y - centerY) / centerY) * -3;
  const rotateY = ((x - centerX) / centerX) * 3;

  card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-3px)`;
});

document.addEventListener('mouseout', (e) => {
  const card = e.target.closest('.entry-card, .search-result-card, .recap-card, .growth-card, .analysis-card, .clarity-card, .reflect-card');
  if (card) {
    card.style.transform = '';
  }
});

// animated placeholder for when there's nothing to show

function emptyStateHTML(emoji, text, hint) {
  return `<div class="empty-state-animated">
    <span class="empty-state-icon">${emoji}</span>
    <div class="empty-state-text">${text}</div>
    ${hint ? `<div class="empty-state-hint">${hint}</div>` : ''}
  </div>`;
}

// words fade in one by one when ai results appear

function wrapWordsForReveal(html) {
  const container = document.createElement('div');
  container.innerHTML = html;

  let wordIndex = 0;

  function walkNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (!text.trim()) return;
      const words = text.split(/(\s+)/);
      const frag = document.createDocumentFragment();
      words.forEach(word => {
        if (/^\s+$/.test(word)) {
          frag.appendChild(document.createTextNode(word));
        } else {
          const span = document.createElement('span');
          span.className = 'word-reveal';
          span.style.animationDelay = (wordIndex * 25) + 'ms';
          span.textContent = word;
          frag.appendChild(span);
          wordIndex++;
        }
      });
      node.parentNode.replaceChild(frag, node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // work on a copy of childNodes since we modify the DOM as we go
      Array.from(node.childNodes).forEach(walkNode);
    }
  }

  Array.from(container.childNodes).forEach(walkNode);
  return container.innerHTML;
}

// Override showAIResult to use word reveal
const _origShowAIResult = showAIResult;
showAIResult = function(html) {
  _origShowAIResult(wrapWordsForReveal(html));
};

// changes the background orb colors based on detected mood

let moodOrbTimer = null;

function setMoodOrbs(mood) {
  if (!appOrbs) return;
  const normalizedMood = (mood || '').toLowerCase();
  appOrbs.setAttribute('data-mood', normalizedMood);

  clearTimeout(moodOrbTimer);
  moodOrbTimer = setTimeout(() => {
    appOrbs.removeAttribute('data-mood');
  }, 30000);
}

// word-by-word reveal for recap cards

(function enhanceRecap() {
  const recapBtn = document.getElementById('generateRecapBtn');
  const origClick = recapBtn.onclick;

  // Observe recap results for new content
  const recapContainer = document.getElementById('recapResults');
  const observer = new MutationObserver(() => {
    const card = recapContainer.querySelector('.recap-card');
    if (card && !card.dataset.revealed) {
      card.dataset.revealed = 'true';
      card.innerHTML = wrapWordsForReveal(card.innerHTML);
    }
  });
  observer.observe(recapContainer, { childList: true, subtree: true });
})();

// same word reveal for search results

(function enhanceSearch() {
  const searchContainer = document.getElementById('searchResults');
  const observer = new MutationObserver(() => {
    searchContainer.querySelectorAll('.search-result-card').forEach(card => {
      if (card.dataset.revealed) return;
      card.dataset.revealed = 'true';
      const p = card.querySelector('p');
      if (p) p.innerHTML = wrapWordsForReveal(p.innerHTML);
    });
  });
  observer.observe(searchContainer, { childList: true, subtree: true });
})();

// badge showing how many entries you have

(function enhanceEntries() {
  const entriesContainer = document.getElementById('entriesList');
  const observer = new MutationObserver(() => {
    const cards = entriesContainer.querySelectorAll('.entry-card');
    if (cards.length > 0) {
      // add or update count badge in bookshelf header
      const header = document.querySelector('.bookshelf-header h3');
      if (header) {
        let badge = header.querySelector('.entry-count-badge');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'entry-count-badge';
          header.appendChild(badge);
        }
        badge.textContent = cards.length;
      }
    }
  });
  observer.observe(entriesContainer, { childList: true });
})();

// subtle parallax on entry cards as you scroll

(function initScrollParallax() {
  let ticking = false;

  function updateParallax() {
    const cards = document.querySelectorAll('.entry-card');
    cards.forEach((card, i) => {
      const rect = card.getBoundingClientRect();
      if (rect.top > window.innerHeight || rect.bottom < 0) return;
      // don't override if user is hovering (card tilt active)
      if (card.matches(':hover')) return;

      const scrollFactor = i % 2 === 0 ? 3 : 6;
      const offset = (rect.top - window.innerHeight / 2) / window.innerHeight * scrollFactor;
      card.style.transform = `translateY(${offset}px)`;
    });
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(updateParallax);
      ticking = true;
    }
  }, { passive: true });
})();

// coach chat panel — slide-out AI conversation

(function initCoachPanel() {
  const panel = document.getElementById('coachPanel');
  const toggle = document.getElementById('coachToggle');
  const closeBtn = document.getElementById('coachClose');
  const messagesEl = document.getElementById('coachMessages');
  const input = document.getElementById('coachInput');
  const sendBtn = document.getElementById('coachSendBtn');
  if (!panel || !toggle) return;

  let coachMessages = [];
  let coachOpen = false;
  let firstOpen = true;

  function togglePanel() {
    if (!coachOpen && !requireApiKey()) return;
    coachOpen = !coachOpen;
    panel.classList.toggle('open', coachOpen);
    toggle.classList.toggle('active', coachOpen);
    if (coachOpen && firstOpen) {
      firstOpen = false;
      messagesEl.innerHTML = `<div class="coach-welcome">
        Welcome! I'm your AI growth coach. I have access to your journal history and can help you reflect on patterns, set goals, or work through challenges.<br><br>
        What's on your mind?
      </div>`;
    }
    if (coachOpen) input.focus();
  }

  toggle.addEventListener('click', togglePanel);
  closeBtn.addEventListener('click', togglePanel);

  function appendBubble(role, content, streaming) {
    // remove welcome message on first real message
    const welcome = messagesEl.querySelector('.coach-welcome');
    if (welcome) welcome.remove();

    const bubble = document.createElement('div');
    bubble.className = `coach-bubble coach-${role}`;
    if (!streaming) {
      bubble.textContent = content;
    }
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (streaming) {
      const cursor = document.createElement('span');
      cursor.className = 'stream-cursor';
      bubble.appendChild(cursor);
      return {
        append(token) { bubble.insertBefore(document.createTextNode(token), cursor); messagesEl.scrollTop = messagesEl.scrollHeight; },
        finalize() { cursor.remove(); }
      };
    }
    return null;
  }

  async function sendCoachMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    coachMessages.push({ role: 'user', content: text });
    appendBubble('user', text);

    const streamCtrl = appendBubble('assistant', '', true);
    let fullResponse = '';

    fetchStream('/api/stream/coach', { messages: coachMessages }, {
      onToken(token) {
        fullResponse += token;
        streamCtrl.append(token);
      },
      onParsed() {
        streamCtrl.finalize();
        coachMessages.push({ role: 'assistant', content: fullResponse });
      },
      onDone() {
        if (fullResponse) {
          streamCtrl.finalize();
          if (!coachMessages.find(m => m.role === 'assistant' && m.content === fullResponse)) {
            coachMessages.push({ role: 'assistant', content: fullResponse });
          }
        }
      },
      onError(msg) {
        streamCtrl.finalize();
        appendBubble('assistant', 'Sorry, something went wrong. Please try again.');
      },
    });
  }

  sendBtn.addEventListener('click', sendCoachMessage);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendCoachMessage();
  });
})();

// writing prompt suggestions when the editor is empty

(function initWritingPrompts() {
  const container = document.getElementById('writingPrompts');
  const editorEl = document.getElementById('entryContent');
  if (!container || !editorEl) return;

  let promptsLoaded = false;

  async function loadWritingPrompts() {
    if (promptsLoaded) return;
    promptsLoaded = true;

    try {
      const res = await fetch('/api/prompts');
      const data = await res.json();
      if (!res.ok || !data.prompts) return;

      container.innerHTML = `<div class="prompts-grid">${data.prompts.map(p => `
        <div class="prompt-card" data-prompt="${p.text.replace(/"/g, '&quot;')}">
          <span class="prompt-category">${p.category}</span>
          <div class="prompt-text">${p.text}</div>
        </div>
      `).join('')}</div>`;

      container.classList.add('visible');

      container.querySelectorAll('.prompt-card').forEach(card => {
        card.addEventListener('click', () => {
          editorEl.value = card.dataset.prompt + '\n\n';
          editorEl.focus();
          container.classList.remove('visible');
          // trigger input event for mood ring + char counter
          editorEl.dispatchEvent(new Event('input'));
        });
      });
    } catch {}
  }

  function checkShowPrompts() {
    if (!currentEntryId && editorEl.value.trim() === '' && !promptsLoaded && hasApiKey) {
      loadWritingPrompts();
    }
  }

  editorEl.addEventListener('focus', checkShowPrompts);

  // hide prompts when user starts typing
  editorEl.addEventListener('input', () => {
    if (editorEl.value.trim().length > 0 && container.classList.contains('visible')) {
      container.classList.remove('visible');
    }
  });
})();

// export — trigger file download for PDF or Markdown

function triggerExport(format, scope, options = {}) {
  const params = new URLSearchParams({ scope });
  if (options.start) params.set('start', options.start);
  if (options.end) params.set('end', options.end);
  if (options.id) params.set('id', options.id);
  if (options.includeSummary) params.set('includeSummary', 'true');

  const url = `/api/export/${format}?${params.toString()}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function getExportToolbarOptions() {
  const start = document.getElementById('exportStartDate').value;
  const end = document.getElementById('exportEndDate').value;
  const includeSummary = document.getElementById('exportIncludeSummary').checked;
  const scope = (start && end) ? 'range' : 'all';
  return { scope, start, end, includeSummary };
}

document.getElementById('exportPdfBtn').addEventListener('click', () => {
  const { scope, start, end, includeSummary } = getExportToolbarOptions();
  triggerExport('pdf', scope, { start, end, includeSummary });
});

document.getElementById('exportMdBtn').addEventListener('click', () => {
  const { scope, start, end, includeSummary } = getExportToolbarOptions();
  triggerExport('markdown', scope, { start, end, includeSummary });
});

window.exportEntry = function(id, format) {
  triggerExport(format, 'entry', { id });
};

// recap export buttons
document.getElementById('recapExportPdf').addEventListener('click', () => {
  const now = new Date();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  triggerExport('pdf', 'range', {
    start: weekAgo.toISOString().split('T')[0],
    end: now.toISOString().split('T')[0],
    includeSummary: true
  });
});

document.getElementById('recapExportMd').addEventListener('click', () => {
  const now = new Date();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  triggerExport('markdown', 'range', {
    start: weekAgo.toISOString().split('T')[0],
    end: now.toISOString().split('T')[0],
    includeSummary: true
  });
});

// time capsule — compare past you vs present you

(function initTimeCapsule() {
  const btn = document.getElementById('generateTimeCapsuleBtn');
  const container = document.getElementById('timeCapsuleResults');
  const periodSelect = document.getElementById('capsulePeriod');
  if (!btn || !container) return;

  btn.addEventListener('click', async () => {
    if (!requireApiKey()) return;
    const daysAgo = parseInt(periodSelect.value, 10);
    container.innerHTML = skeletonHTML();

    try {
      const res = await fetch('/api/time-capsule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysAgo })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.empty) {
        container.innerHTML = `<div class="capsule-card"><p class="empty-state">${data.narrative}</p></div>`;
        return;
      }

      container.innerHTML = `
        <div class="capsule-card">
          <div class="capsule-periods">
            <div class="capsule-then">
              <div class="capsule-period-label">Then</div>
              <div class="capsule-period-count">${data.then.entries} entries</div>
              <div style="font-size:0.75rem;color:var(--text-3)">${data.then.period}</div>
            </div>
            <div class="capsule-arrow">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
            </div>
            <div class="capsule-now">
              <div class="capsule-period-label">Now</div>
              <div class="capsule-period-count">${data.now.entries} entries</div>
              <div style="font-size:0.75rem;color:var(--text-3)">${data.now.period}</div>
            </div>
          </div>
          <div class="capsule-narrative">${data.narrative}</div>
          ${data.changes ? `<div class="capsule-section"><h5>What Changed</h5><ul>${data.changes.map(c => `<li>${c}</li>`).join('')}</ul></div>` : ''}
          ${data.constants ? `<div class="capsule-section"><h5>What Stayed Consistent</h5><ul>${data.constants.map(c => `<li>${c}</li>`).join('')}</ul></div>` : ''}
          ${data.moodShift ? `<div class="capsule-section"><h5>Mood Shift</h5><p style="font-size:0.9rem;color:var(--text-2)">${data.moodShift}</p></div>` : ''}
          ${data.advice ? `<div class="capsule-advice"><strong>Looking Ahead:</strong> ${data.advice}</div>` : ''}
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<p class="empty-state error-text">Time capsule failed: ${err.message}</p>`;
    }
  });
})();

const API = '';
let currentUser = null;
let currentView = 'journal';
let currentEntryId = null;

// auth

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
  "Finally figured out that race condition — the mutex was never released...",
  "Mock interview went well today. System design is clicking...",
  "Spent 3 hours debugging a CORS issue. Turned out to be one missing header...",
  "Paired with a senior dev today. Learned so much about code review...",
  "Shipped my first feature to production. Feels surreal..."
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

// nav

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    switchView(view);
  });
});

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-view="${view}"]`).classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`${view}View`).classList.add('active');

  if (view === 'entries') loadEntries();
}

async function showMainScreen() {
  document.getElementById('authScreen').classList.remove('active');
  document.getElementById('mainScreen').classList.add('active');
  document.getElementById('userName').textContent = currentUser.name;
}

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

// save entry

document.getElementById('saveEntryBtn').addEventListener('click', async () => {
  const content = document.getElementById('entryContent').value.trim();
  const title = document.getElementById('entryTitle').value.trim();
  if (!content) return;

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
    showNotification('Entry saved!');
  } catch (err) {
    showNotification(err.message, 'error');
  }
});

// ai buttons

document.getElementById('analyzeBtn').addEventListener('click', async () => {
  const content = document.getElementById('entryContent').value.trim();
  if (!content) return;

  showAILoading('Analyzing your entry...');
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, entryId: currentEntryId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const a = data.analysis;
    showAIResult(`
      <div class="analysis-card">
        <div class="analysis-mood">Mood: <span class="mood-badge mood-${a.mood}">${a.mood}</span></div>
        <div class="analysis-tags">${(a.tags || []).map(t => `<span class="tag">${t}</span>`).join('')}</div>
        <div class="analysis-summary"><strong>Summary:</strong> ${a.summary}</div>
        <div class="analysis-encouragement">${a.encouragement}</div>
      </div>
    `);
  } catch (err) {
    showAIResult(`<div class="error-card">Analysis failed: ${err.message}</div>`);
  }
});

document.getElementById('clarityBtn').addEventListener('click', async () => {
  const content = document.getElementById('entryContent').value.trim();
  if (!content) return;

  showAILoading('Generating clarity questions...');
  try {
    const res = await fetch('/api/clarity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const c = data.clarity;
    showAIResult(`
      <div class="clarity-card">
        <div class="clarity-reflection"><strong>Reflection:</strong> ${c.reflection}</div>
        <div class="clarity-questions">
          <strong>Questions to explore:</strong>
          <ol>${(c.questions || []).map(q => `<li>${q}</li>`).join('')}</ol>
        </div>
      </div>
    `);
  } catch (err) {
    showAIResult(`<div class="error-card">Clarity failed: ${err.message}</div>`);
  }
});

document.getElementById('reflectBtn').addEventListener('click', async () => {
  const content = document.getElementById('entryContent').value.trim();
  if (!content) return;

  showAILoading('Finding patterns in your journal...');
  try {
    const res = await fetch('/api/reflect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const r = data.reflection;
    showAIResult(`
      <div class="reflect-card">
        <div class="reflect-text"><strong>Reflection:</strong> ${r.reflection}</div>
        <div class="reflect-patterns">
          <strong>Patterns noticed:</strong>
          <ul>${(r.patterns || []).map(p => `<li>${p}</li>`).join('')}</ul>
        </div>
        <div class="reflect-growth"><strong>Growth:</strong> ${r.growth}</div>
        <div class="reflect-meta">Based on ${data.relatedEntries} related entries</div>
      </div>
    `);
  } catch (err) {
    showAIResult(`<div class="error-card">Reflection failed: ${err.message}</div>`);
  }
});

function showAILoading(msg) {
  document.getElementById('aiResults').innerHTML = `<div class="ai-loading"><div class="spinner"></div>${msg}</div>`;
}

function showAIResult(html) {
  document.getElementById('aiResults').innerHTML = html;
}

// entries list

async function loadEntries() {
  const container = document.getElementById('entriesList');
  try {
    const res = await fetch('/api/entries');
    const data = await res.json();
    if (!data.entries || data.entries.length === 0) {
      container.innerHTML = '<p class="empty-state">No entries yet. Start journaling!</p>';
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

// search

document.getElementById('searchBtn').addEventListener('click', async () => {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;

  const container = document.getElementById('searchResults');
  container.innerHTML = '<div class="ai-loading"><div class="spinner"></div>Searching...</div>';

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      container.innerHTML = '<p class="empty-state">No matching entries found</p>';
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

// weekly recap

document.getElementById('generateRecapBtn').addEventListener('click', async () => {
  const container = document.getElementById('recapResults');
  container.innerHTML = '<div class="ai-loading"><div class="spinner"></div>Generating weekly recap...</div>';

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
  } catch (err) {
    container.innerHTML = `<p class="empty-state error-text">Recap failed: ${err.message}</p>`;
  }
});

// insights tab

document.getElementById('generateInsightsBtn').addEventListener('click', generateInsights);

async function generateInsights() {
  const moodContainer = document.getElementById('moodChart');
  const growthContainer = document.getElementById('growthResults');

  moodContainer.innerHTML = '<div class="ai-loading"><div class="spinner"></div>Loading mood trends...</div>';
  growthContainer.innerHTML = '<div class="ai-loading"><div class="spinner"></div>Analyzing growth patterns...</div>';

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

// growth patterns

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

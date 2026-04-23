// ─── CONFIG ──────────────────────────────────────────────────────────────────
const API_URL = '';
let token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let pollInterval = null, logsInterval = null, qrInterval = null;

// ─── API HELPERS ─────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API_URL + path, { ...options, headers: { ...headers, ...(options.headers||{}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── AUTH ────────────────────────────────────────────────────────────────────
function logout() {
  clearInterval(pollInterval); clearInterval(logsInterval); clearInterval(qrInterval);
  token = null; currentUser = null;
  localStorage.removeItem('token'); localStorage.removeItem('user');
  renderLogin();
}

function renderLogin() {
  document.getElementById('app').innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4" style="background:radial-gradient(ellipse at top,#1e1b4b 0%,#0f172a 60%)">
      <div class="glass glow rounded-2xl p-8 w-full max-w-md fade-in">
        <div class="text-center mb-8">
          <div class="text-5xl mb-3">🤖</div>
          <h1 class="text-3xl font-bold text-white">ClockBot</h1>
          <p class="text-slate-400 mt-1 text-sm">WhatsApp Auto Clock-In/Out</p>
        </div>
        <div id="login-error" class="hidden bg-red-900/30 border border-red-500/30 text-red-400 rounded-lg p-3 mb-4 text-sm"></div>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Email</label>
            <input id="login-email" type="email" placeholder="admin@example.com"
              class="w-full bg-slate-800/60 border border-slate-600/50 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition"/>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Password</label>
            <input id="login-password" type="password" placeholder="••••••••"
              class="w-full bg-slate-800/60 border border-slate-600/50 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition"/>
          </div>
          <button id="login-btn" onclick="doLogin()"
            class="btn-primary w-full text-white font-semibold py-3 px-6 rounded-xl mt-2">
            Sign In <i class="fa-solid fa-arrow-right ml-2"></i>
          </button>
        </div>
        <p class="text-center text-slate-600 text-xs mt-6">Powered by Baileys + Turso</p>
      </div>
    </div>`;
  document.getElementById('login-password').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  errEl.classList.add('hidden');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const data = await apiFetch('/api/auth/login', { method:'POST', body:JSON.stringify({email,password}) });
    token = data.token; currentUser = data.user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(currentUser));
    renderApp();
  } catch(err) {
    errEl.textContent = err.message; errEl.classList.remove('hidden');
    btn.disabled = false; btn.innerHTML = 'Sign In <i class="fa-solid fa-arrow-right ml-2"></i>';
  }
}

// ─── LAYOUT + NAVIGATION ─────────────────────────────────────────────────────
function renderApp() {
  const isAdmin = currentUser?.role === 'admin';
  document.getElementById('app').innerHTML = `
    <div class="flex min-h-screen">
      <aside class="w-64 flex-shrink-0 glass-light border-r border-slate-700/40 flex flex-col fixed h-full z-10">
        <div class="p-5 border-b border-slate-700/40">
          <div class="flex items-center gap-3">
            <span class="text-2xl">🤖</span>
            <div><div class="font-bold text-white text-lg leading-tight">ClockBot</div>
            <div class="text-xs text-slate-500">Auto Clock-In/Out</div></div>
          </div>
        </div>
        <nav class="flex-1 p-3 space-y-1">
          <button id="nav-dashboard" onclick="navigate('dashboard')" class="sidebar-item w-full text-left px-4 py-3 rounded-xl text-slate-300 font-medium flex items-center gap-3">
            <i class="fa-solid fa-house w-4"></i> Dashboard</button>
          <button id="nav-schedule" onclick="navigate('schedule')" class="sidebar-item w-full text-left px-4 py-3 rounded-xl text-slate-300 font-medium flex items-center gap-3">
            <i class="fa-solid fa-calendar-days w-4"></i> My Schedule</button>
          <button id="nav-logs" onclick="navigate('logs')" class="sidebar-item w-full text-left px-4 py-3 rounded-xl text-slate-300 font-medium flex items-center gap-3">
            <i class="fa-solid fa-list w-4"></i> My Logs</button>
          ${isAdmin ? `<button id="nav-admin" onclick="navigate('admin')" class="sidebar-item w-full text-left px-4 py-3 rounded-xl text-slate-300 font-medium flex items-center gap-3">
            <i class="fa-solid fa-users w-4"></i> Admin Panel</button>` : ''}
        </nav>
        <div class="p-4 border-t border-slate-700/40">
          <div class="text-xs text-slate-500 mb-1">${isAdmin ? '👑 Admin' : '👤 User'}</div>
          <div class="text-sm font-medium text-slate-300 truncate mb-3">${currentUser?.name || currentUser?.email}</div>
          <button onclick="logout()" class="w-full text-left text-xs text-slate-500 hover:text-red-400 transition flex items-center gap-2">
            <i class="fa-solid fa-right-from-bracket"></i> Logout</button>
        </div>
      </aside>
      <main class="flex-1 ml-64 p-6 min-h-screen">
        <div id="section-content" class="max-w-4xl mx-auto"></div>
      </main>
    </div>`;
  navigate('dashboard');
}

function setActiveNav(section) {
  ['dashboard','schedule','logs','admin'].forEach(s => {
    const el = document.getElementById(`nav-${s}`);
    if (el) el.classList.toggle('active', s === section);
  });
}

function navigate(section) {
  clearInterval(pollInterval); clearInterval(logsInterval); clearInterval(qrInterval);
  pollInterval = null; logsInterval = null; qrInterval = null;
  setActiveNav(section);
  const el = document.getElementById('section-content');
  if (!el) return;
  el.innerHTML = '<div class="flex justify-center items-center h-32"><i class="fa-solid fa-spinner fa-spin text-brand-400 text-2xl"></i></div>';
  if (section === 'dashboard') renderDashboard();
  else if (section === 'schedule') renderSchedule();
  else if (section === 'logs') renderLogs();
  else if (section === 'admin') renderAdmin();
}

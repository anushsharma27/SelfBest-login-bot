
// ─── DASHBOARD ───────────────────────────────────────────────────────────────
async function renderDashboard() {
  const el = document.getElementById('section-content');
  el.innerHTML = `
    <div class="fade-in space-y-5">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-2xl font-bold text-white">Dashboard</h2>
        <span class="text-sm text-slate-500">${new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</span>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <!-- WhatsApp Card -->
        <div id="wa-card" class="glass glow-sm rounded-2xl p-5 col-span-1 lg:col-span-2">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold text-white flex items-center gap-2"><i class="fa-brands fa-whatsapp text-green-400"></i> WhatsApp Connection</h3>
            <span id="wa-status-badge" class="badge badge-gray">Checking…</span>
          </div>
          <div id="wa-body" class="flex items-center justify-center min-h-[80px]">
            <i class="fa-solid fa-spinner fa-spin text-brand-400 text-xl"></i>
          </div>
          <div class="flex gap-3 mt-4">
            <button onclick="waReconnect()" class="btn-primary text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2">
              <i class="fa-solid fa-rotate-right"></i> Reconnect
            </button>
            <button onclick="waDisconnect()" class="bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition flex items-center gap-2">
              <i class="fa-solid fa-link-slash"></i> Disconnect
            </button>
          </div>
        </div>
        <!-- Schedule Summary -->
        <div id="sched-card" class="glass-light rounded-2xl p-5 border border-slate-700/40">
          <h3 class="font-semibold text-white mb-4 flex items-center gap-2"><i class="fa-solid fa-calendar-check text-brand-400"></i> My Schedule</h3>
          <div id="sched-body"><i class="fa-solid fa-spinner fa-spin text-slate-500"></i></div>
        </div>
        <!-- Pause Today -->
        <div id="pause-card" class="glass-light rounded-2xl p-5 border border-slate-700/40">
          <h3 class="font-semibold text-white mb-4 flex items-center gap-2"><i class="fa-solid fa-pause-circle text-yellow-400"></i> Today's Status</h3>
          <div id="pause-body"><i class="fa-solid fa-spinner fa-spin text-slate-500"></i></div>
        </div>
      </div>
      <!-- Recent Activity -->
      <div class="glass-light rounded-2xl p-5 border border-slate-700/40">
        <h3 class="font-semibold text-white mb-4 flex items-center gap-2"><i class="fa-solid fa-clock-rotate-left text-brand-400"></i> Recent Activity</h3>
        <div id="recent-logs"><i class="fa-solid fa-spinner fa-spin text-slate-500"></i></div>
      </div>
    </div>`;

  await loadDashboardData();
  pollInterval = setInterval(pollStatus, 5000);
}

async function loadDashboardData() {
  await Promise.all([pollStatus(), loadScheduleSummary(), loadPauseCard(), loadRecentLogs()]);
}

async function pollStatus() {
  try {
    const { status } = await apiFetch('/api/whatsapp/status');
    const badge = document.getElementById('wa-status-badge');
    const body = document.getElementById('wa-body');
    if (!badge || !body) return;

    if (status === 'connected') {
      badge.className = 'badge badge-green';
      badge.innerHTML = '<span class="pulse-dot inline-block w-2 h-2 bg-green-400 rounded-full mr-1.5"></span>Connected';
      body.innerHTML = `<div class="flex items-center gap-3 text-green-400">
        <i class="fa-solid fa-circle-check text-3xl"></i>
        <div><div class="font-semibold text-white">Connected & Ready</div><div class="text-sm text-slate-400">ClockBot will send messages automatically</div></div>
      </div>`;
      clearInterval(qrInterval);
    } else if (status === 'connecting') {
      badge.className = 'badge badge-yellow';
      badge.textContent = 'Connecting…';
      loadQR();
    } else if (status === 'loading') {
      badge.className = 'badge badge-blue';
      badge.textContent = 'Loading…';
      body.innerHTML = `<div class="text-slate-400 text-sm flex items-center gap-2"><i class="fa-solid fa-spinner fa-spin"></i> WhatsApp Web is loading…</div>`;
    } else {
      badge.className = 'badge badge-red';
      badge.textContent = 'Disconnected';
      loadQR();
      if (!qrInterval) qrInterval = setInterval(loadQR, 60000);
    }
  } catch (e) {}
}

async function loadQR() {
  try {
    const { qr } = await apiFetch('/api/whatsapp/qr');
    const body = document.getElementById('wa-body');
    if (!body) return;
    if (qr) {
      body.innerHTML = `<div class="flex flex-col sm:flex-row items-center gap-6">
        <img src="${qr}" alt="WhatsApp QR Code" class="w-44 h-44 rounded-xl border-2 border-brand-500/30">
        <div class="text-sm text-slate-400 space-y-1.5">
          <div class="font-semibold text-white mb-2">Scan to connect WhatsApp</div>
          <div class="flex items-center gap-2"><span class="text-brand-400 font-bold">1.</span> Open WhatsApp on your phone</div>
          <div class="flex items-center gap-2"><span class="text-brand-400 font-bold">2.</span> Tap ⋮ → Linked Devices</div>
          <div class="flex items-center gap-2"><span class="text-brand-400 font-bold">3.</span> Tap "Link a Device"</div>
          <div class="flex items-center gap-2"><span class="text-brand-400 font-bold">4.</span> Point camera at QR code</div>
          <div class="text-xs text-slate-600 mt-2">QR refreshes every 60s</div>
        </div>
      </div>`;
    } else {
      body.innerHTML = `<div class="text-slate-500 text-sm flex items-center gap-2"><i class="fa-solid fa-spinner fa-spin"></i> Generating QR code…</div>`;
    }
  } catch (e) {}
}

async function waReconnect() {
  try { await apiFetch('/api/whatsapp/reconnect', { method: 'POST' }); await pollStatus(); } catch (e) {}
}
async function waDisconnect() {
  if (!confirm('Disconnect your WhatsApp session?')) return;
  try { await apiFetch('/api/whatsapp/disconnect', { method: 'POST' }); await pollStatus(); } catch (e) {}
}

async function loadScheduleSummary() {
  const el = document.getElementById('sched-body');
  if (!el) return;
  try {
    const s = await apiFetch('/api/schedule');
    if (!s) {
      el.innerHTML = `<p class="text-slate-500 text-sm">No schedule set yet. <button onclick="navigate('schedule')" class="text-brand-400 underline">Set it up →</button></p>`;
    } else {
      let days = []; try { days = JSON.parse(s.days); } catch {}
      el.innerHTML = `<div class="space-y-3">
        <div class="flex justify-between text-sm"><span class="text-slate-400">Clock In</span><span class="font-semibold text-white">${s.clock_in_time}</span></div>
        <div class="flex justify-between text-sm"><span class="text-slate-400">Clock Out</span><span class="font-semibold text-white">${s.clock_out_time}</span></div>
        <div class="flex justify-between text-sm"><span class="text-slate-400">Days</span><span class="font-semibold text-white">${days.join(', ')}</span></div>
        <div class="flex justify-between text-sm"><span class="text-slate-400">Status</span>
          <span class="badge ${s.is_active ? 'badge-green' : 'badge-red'}">${s.is_active ? 'Active' : 'Inactive'}</span></div>
      </div>`;
    }
  } catch (e) { el.innerHTML = `<p class="text-red-400 text-sm">Failed to load schedule</p>`; }
}

async function loadPauseCard() {
  const el = document.getElementById('pause-body');
  if (!el) return;
  const today = new Date().toISOString().slice(0,10);
  try {
    const s = await apiFetch('/api/schedule');
    if (!s) { el.innerHTML = `<p class="text-slate-500 text-sm">No schedule configured.</p>`; return; }
    let paused = []; try { paused = JSON.parse(s.paused_dates); } catch {}
    const isPaused = paused.includes(today);
    el.innerHTML = `<p class="text-slate-400 text-sm mb-4">Today: <span class="text-white font-medium">${new Date().toLocaleDateString('en-IN',{weekday:'long',month:'short',day:'numeric'})}</span></p>
      ${isPaused
        ? `<button onclick="resumeToday()" class="btn-warning w-full text-white text-sm font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2">
            <i class="fa-solid fa-play"></i> Paused Today — Click to Resume</button>`
        : `<button onclick="pauseToday()" class="btn-primary w-full text-white text-sm font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2">
            <i class="fa-solid fa-pause"></i> Pause Today</button>`}`;
  } catch (e) { el.innerHTML = `<p class="text-red-400 text-sm">Failed to load</p>`; }
}

async function pauseToday() {
  try { await apiFetch('/api/schedule/pause-today', { method: 'POST' }); await loadPauseCard(); } catch (e) { alert(e.message); }
}
async function resumeToday() {
  try { await apiFetch('/api/schedule/pause-today', { method: 'DELETE' }); await loadPauseCard(); } catch (e) { alert(e.message); }
}

async function loadRecentLogs() {
  const el = document.getElementById('recent-logs');
  if (!el) return;
  try {
    const logs = await apiFetch('/api/logs');
    const recent = logs.slice(0, 10);
    if (recent.length === 0) { el.innerHTML = `<p class="text-slate-500 text-sm">No activity yet.</p>`; return; }
    el.innerHTML = `<div class="overflow-x-auto"><table class="w-full text-sm">
      <thead><tr class="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700/40">
        <th class="pb-2 pr-4">Time</th><th class="pb-2 pr-4">Type</th><th class="pb-2">Status</th>
      </tr></thead>
      <tbody>${recent.map(l => `<tr class="table-row border-b border-slate-800/60">
        <td class="py-2.5 pr-4 text-slate-400">${new Date(l.timestamp).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</td>
        <td class="py-2.5 pr-4"><span class="badge ${l.type === 'clock_in' ? 'badge-blue' : 'badge-yellow'}">${l.type === 'clock_in' ? 'Clock In' : 'Clock Out'}</span></td>
        <td class="py-2.5"><span class="badge ${l.status === 'sent' ? 'badge-green' : l.status === 'skipped' ? 'badge-yellow' : 'badge-red'}">${l.status}</span></td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch (e) { el.innerHTML = `<p class="text-red-400 text-sm">Failed to load logs</p>`; }
}

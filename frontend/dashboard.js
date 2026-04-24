// ─── DASHBOARD ───────────────────────────────────────────────────────────────
async function renderDashboard() {
  const el = document.getElementById('section-content');
  el.innerHTML = `<div class="fade-in space-y-5">
    <div class="flex items-center justify-between mb-2">
      <h2 class="text-2xl font-bold text-white">Dashboard</h2>
      <span class="text-sm text-slate-500">${new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</span>
    </div>
    <div id="wa-card" class="glass glow-sm rounded-2xl p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold text-white flex items-center gap-2"><i class="fa-brands fa-whatsapp text-green-400"></i> WhatsApp</h3>
        <span id="wa-badge" class="badge badge-gray">Checking…</span>
      </div>
      <div id="wa-body" class="min-h-[80px] flex items-center justify-center"><i class="fa-solid fa-spinner fa-spin text-brand-400 text-xl"></i></div>
      <div class="flex gap-3 mt-4">
        <button onclick="waReconnect()" class="btn-primary text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2"><i class="fa-solid fa-rotate-right"></i> Reconnect</button>
        <button onclick="waDisconnect()" class="bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition flex items-center gap-2"><i class="fa-solid fa-link-slash"></i> Disconnect</button>
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div class="glass-light rounded-2xl p-5 border border-slate-700/40">
        <h3 class="font-semibold text-white mb-4 flex items-center gap-2"><i class="fa-solid fa-calendar-check text-brand-400"></i> My Schedule</h3>
        <div id="sched-body"><i class="fa-solid fa-spinner fa-spin text-slate-500"></i></div>
      </div>
      <div class="glass-light rounded-2xl p-5 border border-slate-700/40">
        <h3 class="font-semibold text-white mb-4 flex items-center gap-2"><i class="fa-solid fa-pause-circle text-yellow-400"></i> Today's Status</h3>
        <div id="pause-body"><i class="fa-solid fa-spinner fa-spin text-slate-500"></i></div>
      </div>
    </div>
    <div class="glass-light rounded-2xl p-5 border border-slate-700/40">
      <h3 class="font-semibold text-white mb-4 flex items-center gap-2"><i class="fa-solid fa-clock-rotate-left text-brand-400"></i> Recent Activity</h3>
      <div id="recent-logs"><i class="fa-solid fa-spinner fa-spin text-slate-500"></i></div>
    </div>
  </div>`;
  await Promise.all([pollStatus(), loadScheduleSummary(), loadPauseCard(), loadRecentLogs()]);
  pollInterval = setInterval(pollStatus, 5000);
}

function stopWALoop() {
  clearInterval(qrInterval);
  qrInterval = null;
}

function startWALoop() {
  if (qrInterval) return;
  qrInterval = setInterval(async () => {
    await loadQR();
    await pollStatus();
  }, 2500);
}

async function pollStatus() {
  try {
    const { status, qr, manuallyDisconnected } = await apiFetch('/api/whatsapp/status');
    const badge = document.getElementById('wa-badge');
    const body = document.getElementById('wa-body');
    if (!badge || !body) return;
    if (status === 'connected') {
      badge.className = 'badge badge-green';
      badge.innerHTML = '<span class="pulse-dot inline-block w-2 h-2 bg-green-400 rounded-full mr-1.5"></span>Connected';
      body.innerHTML = `<div class="flex items-center gap-3 text-green-400"><i class="fa-solid fa-circle-check text-3xl"></i>
        <div><div class="font-semibold text-white">Connected & Ready</div><div class="text-sm text-slate-400">Messages will send automatically</div></div></div>`;
      stopWALoop();
    } else if (status === 'initializing') {
      badge.className = 'badge badge-yellow';
      badge.textContent = 'Starting…';
      body.innerHTML = `<div class="text-slate-400 text-sm flex items-center gap-2"><i class="fa-solid fa-spinner fa-spin"></i> Starting WhatsApp session…</div>`;
      startWALoop();
    } else if (status === 'loading') {
      badge.className = 'badge badge-blue';
      badge.textContent = 'Loading…';
      body.innerHTML = `<div class="text-slate-400 text-sm flex items-center gap-2"><i class="fa-solid fa-spinner fa-spin"></i> WhatsApp Web is loading…</div>`;
      startWALoop();
    } else if (status === 'connecting') {
      badge.className = 'badge badge-yellow';
      badge.textContent = 'Connecting…';
      renderQR(qr, { manuallyDisconnected, status });
      startWALoop();
    } else {
      badge.className = 'badge badge-red';
      badge.textContent = 'Disconnected';
      renderQR(qr, { manuallyDisconnected, status });
      if (manuallyDisconnected) stopWALoop();
      else startWALoop();
    }
  } catch(e) {}
}

async function loadQR() {
  try {
    const { qr, status, manuallyDisconnected } = await apiFetch('/api/whatsapp/qr');
    renderQR(qr, { status, manuallyDisconnected });
  } catch(e) {}
}

function renderQR(qr, { status, manuallyDisconnected } = {}) {
  const body = document.getElementById('wa-body');
  if (!body) return;
  if (!qr && manuallyDisconnected) {
    body.innerHTML = `<div class="text-slate-500 text-sm flex items-center gap-2"><i class="fa-solid fa-circle-xmark"></i> WhatsApp is disconnected. Click Reconnect to generate a fresh QR.</div>`;
    return;
  }

  if (!qr && status && status !== 'connecting' && status !== 'disconnected') {
    body.innerHTML = `<div class="text-slate-400 text-sm flex items-center gap-2"><i class="fa-solid fa-spinner fa-spin"></i> Preparing WhatsApp session…</div>`;
    return;
  }

  body.innerHTML = qr
    ? `<div class="flex flex-col sm:flex-row items-center gap-6">
        <img src="${qr}" alt="QR" class="w-44 h-44 rounded-xl border-2 border-brand-500/30"/>
        <div class="text-sm text-slate-400 space-y-1.5">
          <div class="font-semibold text-white mb-2">Scan to connect WhatsApp</div>
          <div><span class="text-brand-400 font-bold">1.</span> Open WhatsApp</div>
          <div><span class="text-brand-400 font-bold">2.</span> ⋮ → Linked Devices</div>
          <div><span class="text-brand-400 font-bold">3.</span> Link a Device → Scan QR</div>
          <div class="text-xs text-slate-600 mt-2">Auto-refreshes every few seconds</div>
        </div></div>`
    : `<div class="text-slate-500 text-sm flex items-center gap-2"><i class="fa-solid fa-spinner fa-spin"></i> Generating QR…</div>`;
}

async function waReconnect() {
  try {
    const badge = document.getElementById('wa-badge');
    const body = document.getElementById('wa-body');
    if (badge) {
      badge.className = 'badge badge-yellow';
      badge.textContent = 'Starting…';
    }
    if (body) {
      body.innerHTML = `<div class="text-slate-400 text-sm flex items-center gap-2"><i class="fa-solid fa-spinner fa-spin"></i> Restarting WhatsApp session…</div>`;
    }
    startWALoop();
    await apiFetch('/api/whatsapp/reconnect',{method:'POST'});
    await pollStatus();
  } catch(e){alert(e.message);}
}
async function waDisconnect() {
  if (!confirm('Disconnect WhatsApp?')) return;
  try {
    stopWALoop();
    await apiFetch('/api/whatsapp/disconnect',{method:'POST'});
    await pollStatus();
  } catch(e){alert(e.message);}
}

async function loadScheduleSummary() {
  const el = document.getElementById('sched-body'); if(!el) return;
  try {
    const s = await apiFetch('/api/schedule');
    if (!s) { el.innerHTML=`<p class="text-slate-500 text-sm">No schedule yet. <button onclick="navigate('schedule')" class="text-brand-400 underline">Set it up →</button></p>`; return; }
    let days=[]; try{days=JSON.parse(s.days);}catch{}
    el.innerHTML=`<div class="space-y-3 text-sm">
      <div class="flex justify-between"><span class="text-slate-400">Clock In</span><span class="font-semibold text-white">${s.clock_in_time}</span></div>
      <div class="flex justify-between"><span class="text-slate-400">Clock Out</span><span class="font-semibold text-white">${s.clock_out_time}</span></div>
      <div class="flex justify-between"><span class="text-slate-400">Days</span><span class="font-semibold text-white">${days.join(', ')}</span></div>
      <div class="flex justify-between"><span class="text-slate-400">Status</span><span class="badge ${s.is_active?'badge-green':'badge-red'}">${s.is_active?'Active':'Inactive'}</span></div>
    </div>`;
  } catch(e){el.innerHTML=`<p class="text-red-400 text-sm">Failed to load</p>`;}
}

async function loadPauseCard() {
  const el=document.getElementById('pause-body'); if(!el) return;
  const today=new Date().toISOString().slice(0,10);
  const label=new Date().toLocaleDateString('en-IN',{weekday:'long',month:'short',day:'numeric'});
  try {
    const s=await apiFetch('/api/schedule');
    if(!s){el.innerHTML=`<p class="text-slate-500 text-sm">No schedule configured.</p>`;return;}
    let paused=[]; try{paused=JSON.parse(s.paused_dates);}catch{}
    const isPaused=paused.includes(today);
    el.innerHTML=`<p class="text-slate-400 text-sm mb-4">Today: <span class="text-white font-medium">${label}</span></p>
      ${isPaused
        ?`<button onclick="resumeToday()" class="btn-warning w-full text-white text-sm font-semibold py-3 rounded-xl flex items-center justify-center gap-2"><i class="fa-solid fa-play"></i> Paused — Click to Resume</button>`
        :`<button onclick="pauseToday()" class="btn-primary w-full text-white text-sm font-semibold py-3 rounded-xl flex items-center justify-center gap-2"><i class="fa-solid fa-pause"></i> Pause Today</button>`}`;
  } catch(e){el.innerHTML=`<p class="text-red-400 text-sm">Failed to load</p>`;}
}

async function pauseToday(){try{await apiFetch('/api/schedule/pause-today',{method:'POST'});await loadPauseCard();}catch(e){alert(e.message);}}
async function resumeToday(){try{await apiFetch('/api/schedule/pause-today',{method:'DELETE'});await loadPauseCard();}catch(e){alert(e.message);}}

async function loadRecentLogs() {
  const el=document.getElementById('recent-logs'); if(!el) return;
  try {
    const logs=(await apiFetch('/api/logs')).slice(0,10);
    if(!logs.length){el.innerHTML=`<p class="text-slate-500 text-sm">No activity yet.</p>`;return;}
    el.innerHTML=`<div class="overflow-x-auto"><table class="w-full text-sm">
      <thead><tr class="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700/40">
        <th class="pb-2 pr-4">Time</th><th class="pb-2 pr-4">Type</th><th class="pb-2">Status</th></tr></thead>
      <tbody>${logs.map(l=>`<tr class="table-row border-b border-slate-800/60">
        <td class="py-2.5 pr-4 text-slate-400">${new Date(l.timestamp).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</td>
        <td class="py-2.5 pr-4"><span class="badge ${l.type==='clock_in'?'badge-blue':'badge-yellow'}">${l.type==='clock_in'?'Clock In':'Clock Out'}</span></td>
        <td class="py-2.5"><span class="badge ${l.status==='sent'?'badge-green':l.status==='skipped'?'badge-yellow':'badge-red'}">${l.status}</span></td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch(e){el.innerHTML=`<p class="text-red-400 text-sm">Failed to load</p>`;}
}

// ─── SCHEDULE ────────────────────────────────────────────────────────────────
function addHours(t, h) {
  const [hh, mm] = t.split(':').map(Number);
  const total = (hh + h) * 60 + mm;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function renderSchedule() {
  const el = document.getElementById('section-content');
  el.innerHTML = `<div class="fade-in space-y-5">
    <h2 class="text-2xl font-bold text-white">My Schedule</h2>
    <div class="glass glow-sm rounded-2xl p-6">
      <div id="sched-msg" class="hidden mb-4 p-3 rounded-lg text-sm font-medium"></div>
      <div class="space-y-5">
        <div>
          <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Bot Number <span class="text-slate-600 normal-case font-normal">(company WhatsApp bot, no + sign)</span></label>
          <input id="bot-number" type="text" value="917042759091" placeholder="919876543210"
            class="w-full bg-slate-800/60 border border-slate-600/50 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition"/>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Clock-In Time</label>
            <input id="clock-in" type="time"
              class="w-full bg-slate-800/60 border border-slate-600/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-500 transition"
              oninput="updateClockOut()"/>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Clock-Out Time <span class="text-slate-600 normal-case font-normal">(auto +9h, editable)</span></label>
            <input id="clock-out" type="time"
              class="w-full bg-slate-800/60 border border-slate-600/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-500 transition"/>
          </div>
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Clock-In Message</label>
          <textarea id="in-msg" rows="3" placeholder="e.g. in"
            class="w-full bg-slate-800/60 border border-slate-600/50 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition resize-none"></textarea>
          <p class="text-xs text-slate-500 mt-1">This is the exact keyword your company bot expects</p>
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Clock-Out Message</label>
          <textarea id="out-msg" rows="2" placeholder="e.g. out"
            class="w-full bg-slate-800/60 border border-slate-600/50 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition resize-none"></textarea>
          <p class="text-xs text-slate-500 mt-1">This is the exact keyword your company bot expects</p>
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Working Days</label>
          <div class="flex flex-wrap gap-2" id="days-picker">
            ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `
              <label class="cursor-pointer">
                <input type="checkbox" value="${d}" class="hidden day-check"/>
                <span class="day-btn px-4 py-2 rounded-lg text-sm font-medium border border-slate-600/50 text-slate-400 hover:border-brand-500/50 transition select-none">${d}</span>
              </label>`).join('')}
          </div>
        </div>
        <div class="flex items-center gap-3">
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" id="is-active" class="sr-only peer" checked/>
            <div class="w-11 h-6 bg-slate-700 rounded-full peer peer-checked:bg-brand-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5"></div>
          </label>
          <span class="text-sm text-slate-300 font-medium">Schedule Active</span>
        </div>
        <button onclick="saveSchedule()" class="btn-primary w-full text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2">
          <i class="fa-solid fa-floppy-disk"></i> Save Schedule</button>

        <!-- Manual Clock In/Out Buttons -->
        <div class="grid grid-cols-2 gap-4 pt-2">
          <button onclick="triggerClockIn()" id="clock-in-btn" class="btn-secondary w-full text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2">
            <i class="fa-solid fa-right-to-bracket"></i> Clock In
          </button>
          <button onclick="triggerClockOut()" id="clock-out-btn" class="btn-secondary w-full text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2">
            <i class="fa-solid fa-right-from-bracket"></i> Clock Out
          </button>
        </div>
        <div id="manual-result" class="hidden p-3 rounded-lg text-sm font-medium"></div>
      </div>
    </div>

    <!-- Test Message Section -->
    <div class="glass glow-sm rounded-2xl p-6">
      <h3 class="text-lg font-bold text-white mb-4">Test Message</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Message</label>
          <textarea id="test-msg" rows="2" placeholder="Type a message to send now..."
            class="w-full bg-slate-800/60 border border-slate-600/50 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition resize-none"></textarea>
        </div>
        <button onclick="sendTestMessage()" id="test-btn" class="btn-primary w-full text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2">
          <i class="fa-solid fa-paper-plane"></i> Send Now</button>
        <div id="test-msg-result" class="hidden p-3 rounded-lg text-sm font-medium"></div>
      </div>
    </div>
  </div>`;

  // Wire up day checkboxes
  document.querySelectorAll('.day-check').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.nextElementSibling.classList.toggle('bg-brand-500/20', cb.checked);
      cb.nextElementSibling.classList.toggle('border-brand-500', cb.checked);
      cb.nextElementSibling.classList.toggle('text-brand-300', cb.checked);
    });
  });

  // Pre-fill from existing schedule
  try {
    const s = await apiFetch('/api/schedule');
    if (s) {
      document.getElementById('bot-number').value = s.bot_number || '';
      // Temporarily remove oninput to prevent auto-overwriting clock-out
      const ci = document.getElementById('clock-in');
      ci.removeAttribute('oninput');
      ci.value = s.clock_in_time || '';
      document.getElementById('clock-out').value = s.clock_out_time || '';
      ci.setAttribute('oninput', 'updateClockOut()');
      document.getElementById('in-msg').value = s.clock_in_message || '';
      document.getElementById('out-msg').value = s.clock_out_message || '';
      document.getElementById('is-active').checked = !!s.is_active;
      let days = []; try { days = JSON.parse(s.days); } catch { }
      document.querySelectorAll('.day-check').forEach(cb => {
        if (days.includes(cb.value)) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
      });
    } else {
      // Default Mon-Fri checked
      document.querySelectorAll('.day-check').forEach(cb => {
        if (['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(cb.value)) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
      });
    }
  } catch (e) { }
}

function updateClockOut() {
  const val = document.getElementById('clock-in').value;
  if (val) document.getElementById('clock-out').value = addHours(val, 9);
}

async function saveSchedule() {
  const bot_number = document.getElementById('bot-number').value.trim();
  const clock_in_time = document.getElementById('clock-in').value;
  const clock_out_time = document.getElementById('clock-out').value;
  const clock_in_message = document.getElementById('in-msg').value.trim();
  const clock_out_message = document.getElementById('out-msg').value.trim();
  const days = [...document.querySelectorAll('.day-check:checked')].map(c => c.value);
  const msgEl = document.getElementById('sched-msg');

  if (!bot_number) { showSchedMsg('Bot number is required', 'error'); return; }
  if (!clock_in_time) { showSchedMsg('Clock-in time is required', 'error'); return; }
  if (!clock_out_time) { showSchedMsg('Clock-out time is required', 'error'); return; }
  if (!clock_in_message) { showSchedMsg('Clock-in message is required', 'error'); return; }
  if (!clock_out_message) { showSchedMsg('Clock-out message is required', 'error'); return; }

  try {
    await apiFetch('/api/schedule', { method: 'POST', body: JSON.stringify({ bot_number, clock_in_time, clock_out_time, clock_in_message, clock_out_message, days }) });
    showSchedMsg('Schedule saved successfully! ✓', 'success');
  } catch (e) { showSchedMsg(e.message, 'error'); }
}

function showSchedMsg(msg, type) {
  const el = document.getElementById('sched-msg');
  el.textContent = msg;
  el.className = `mb-4 p-3 rounded-lg text-sm font-medium ${type === 'success' ? 'bg-green-900/30 border border-green-500/30 text-green-400' : 'bg-red-900/30 border border-red-500/30 text-red-400'}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

async function sendTestMessage() {
  const bot_number = document.getElementById('bot-number').value.trim();
  const message = document.getElementById('test-msg').value.trim();
  const btn = document.getElementById('test-btn');
  const resultEl = document.getElementById('test-msg-result');

  if (!message) {
    resultEl.textContent = 'Please enter a message';
    resultEl.className = 'p-3 rounded-lg text-sm font-medium bg-red-900/30 border border-red-500/30 text-red-400';
    resultEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

  try {
    await apiFetch('/api/schedule/test-message', {
      method: 'POST',
      body: JSON.stringify({ bot_number, message })
    });
    resultEl.textContent = 'Message sent successfully! ✓';
    resultEl.className = 'p-3 rounded-lg text-sm font-medium bg-green-900/30 border border-green-500/30 text-green-400';
    document.getElementById('test-msg').value = '';
  } catch (e) {
    resultEl.textContent = e.message || 'Failed to send message';
    resultEl.className = 'p-3 rounded-lg text-sm font-medium bg-red-900/30 border border-red-500/30 text-red-400';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Now';
    setTimeout(() => resultEl.classList.add('hidden'), 4000);
  }
}

async function triggerClockIn() {
  const btn = document.getElementById('clock-in-btn');
  const resultEl = document.getElementById('manual-result');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

  try {
    const res = await apiFetch('/api/schedule/clock-in', { method: 'POST' });
    resultEl.textContent = res.message || 'Clock-in initiated! Check WhatsApp.';
    resultEl.className = 'p-3 rounded-lg text-sm font-medium bg-green-900/30 border border-green-500/30 text-green-400';
  } catch (e) {
    resultEl.textContent = e.message || 'Failed to initiate clock-in';
    resultEl.className = 'p-3 rounded-lg text-sm font-medium bg-red-900/30 border border-red-500/30 text-red-400';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Clock In';
  }
  resultEl.classList.remove('hidden');
  setTimeout(() => resultEl.classList.add('hidden'), 5000);
}

async function triggerClockOut() {
  const btn = document.getElementById('clock-out-btn');
  const resultEl = document.getElementById('manual-result');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

  try {
    const res = await apiFetch('/api/schedule/clock-out', { method: 'POST' });
    resultEl.textContent = res.message || 'Clock-out initiated! Reply "confirm" on WhatsApp.';
    resultEl.className = 'p-3 rounded-lg text-sm font-medium bg-green-900/30 border border-green-500/30 text-green-400';
  } catch (e) {
    resultEl.textContent = e.message || 'Failed to initiate clock-out';
    resultEl.className = 'p-3 rounded-lg text-sm font-medium bg-red-900/30 border border-red-500/30 text-red-400';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> Clock Out';
  }
  resultEl.classList.remove('hidden');
  setTimeout(() => resultEl.classList.add('hidden'), 5000);
}

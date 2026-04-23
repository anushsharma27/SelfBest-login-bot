// ─── LOGS ─────────────────────────────────────────────────────────────────────
async function renderLogs() {
  const el = document.getElementById('section-content');
  el.innerHTML = `<div class="fade-in space-y-5">
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-bold text-white">My Logs</h2>
      <span class="text-xs text-slate-500">Auto-refreshes every 30s</span>
    </div>
    <div class="glass glow-sm rounded-2xl p-5">
      <div id="logs-table"><i class="fa-solid fa-spinner fa-spin text-brand-400 text-xl"></i></div>
    </div>
  </div>`;
  await fetchLogs();
  logsInterval = setInterval(fetchLogs, 30000);
}

async function fetchLogs() {
  const el = document.getElementById('logs-table');
  if (!el) return;
  try {
    const logs = await apiFetch('/api/logs');
    if (!logs.length) {
      el.innerHTML = `<div class="text-center py-12">
        <i class="fa-solid fa-inbox text-slate-600 text-4xl mb-3"></i>
        <p class="text-slate-500">No logs yet. Your activity will appear here after messages are sent.</p>
      </div>`;
      return;
    }
    el.innerHTML = `<div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700/40">
          <th class="pb-3 pr-4">Date & Time</th>
          <th class="pb-3 pr-4">Type</th>
          <th class="pb-3 pr-4">Status</th>
          <th class="pb-3">Reason</th>
        </tr></thead>
        <tbody>${logs.map(l => `
          <tr class="table-row border-b border-slate-800/60">
            <td class="py-3 pr-4 text-slate-400 whitespace-nowrap">
              <div>${new Date(l.timestamp).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</div>
              <div class="text-xs text-slate-600">${new Date(l.timestamp).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</div>
            </td>
            <td class="py-3 pr-4"><span class="badge ${l.type==='clock_in'?'badge-blue':'badge-yellow'}">${l.type==='clock_in'?'Clock In':'Clock Out'}</span></td>
            <td class="py-3 pr-4"><span class="badge ${l.status==='sent'?'badge-green':l.status==='skipped'?'badge-yellow':'badge-red'}">${l.status}</span></td>
            <td class="py-3 text-slate-500 text-xs">${l.reason||'—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  } catch(e) {
    el.innerHTML = `<p class="text-red-400 text-sm">Failed to load logs: ${e.message}</p>`;
  }
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
async function renderAdmin() {
  const el = document.getElementById('section-content');
  if (currentUser?.role !== 'admin') {
    el.innerHTML = `<div class="glass rounded-2xl p-8 text-center"><p class="text-red-400">Access denied.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="fade-in space-y-6">
    <h2 class="text-2xl font-bold text-white">Admin Panel</h2>
    <!-- Add Member -->
    <div class="glass glow-sm rounded-2xl p-5">
      <h3 class="font-semibold text-white mb-4 flex items-center gap-2"><i class="fa-solid fa-user-plus text-brand-400"></i> Add Team Member</h3>
      <div id="add-user-msg" class="hidden mb-3 p-3 rounded-lg text-sm font-medium"></div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input id="new-name" type="text" placeholder="Full Name"
          class="bg-slate-800/60 border border-slate-600/50 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition text-sm"/>
        <input id="new-email" type="email" placeholder="Email"
          class="bg-slate-800/60 border border-slate-600/50 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition text-sm"/>
        <input id="new-password" type="password" placeholder="Password"
          class="bg-slate-800/60 border border-slate-600/50 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition text-sm"/>
      </div>
      <button onclick="addUser()" class="btn-primary mt-3 text-white text-sm font-semibold px-5 py-2.5 rounded-xl flex items-center gap-2">
        <i class="fa-solid fa-plus"></i> Add Member</button>
    </div>
    <!-- Team Members Table -->
    <div class="glass-light rounded-2xl p-5 border border-slate-700/40">
      <h3 class="font-semibold text-white mb-4 flex items-center gap-2"><i class="fa-solid fa-users text-brand-400"></i> Team Members</h3>
      <div id="users-table"><i class="fa-solid fa-spinner fa-spin text-slate-500"></i></div>
    </div>
    <!-- All Logs -->
    <div class="glass-light rounded-2xl p-5 border border-slate-700/40">
      <h3 class="font-semibold text-white mb-4 flex items-center gap-2"><i class="fa-solid fa-list text-brand-400"></i> All Activity Logs</h3>
      <div id="all-logs-table"><i class="fa-solid fa-spinner fa-spin text-slate-500"></i></div>
    </div>
  </div>`;
  await Promise.all([loadUsers(), loadAllLogs()]);
}

async function loadUsers() {
  const el = document.getElementById('users-table'); if(!el) return;
  try {
    const users = await apiFetch('/api/admin/users');
    if (!users.length) { el.innerHTML=`<p class="text-slate-500 text-sm">No users yet.</p>`; return; }
    el.innerHTML = `<div class="overflow-x-auto"><table class="w-full text-sm">
      <thead><tr class="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700/40">
        <th class="pb-3 pr-4">Name</th><th class="pb-3 pr-4">Email</th>
        <th class="pb-3 pr-4">WhatsApp</th><th class="pb-3 pr-4">Schedule</th><th class="pb-3">Action</th>
      </tr></thead>
      <tbody>${users.map(u=>`
        <tr class="table-row border-b border-slate-800/60">
          <td class="py-3 pr-4 font-medium text-white">${u.name} ${u.role==='admin'?'<span class="badge badge-blue ml-1">admin</span>':''}</td>
          <td class="py-3 pr-4 text-slate-400">${u.email}</td>
          <td class="py-3 pr-4"><span class="badge ${u.whatsapp_status==='connected'?'badge-green':u.whatsapp_status==='connecting'?'badge-yellow':'badge-red'}">${u.whatsapp_status}</span></td>
          <td class="py-3 pr-4"><span class="badge ${u.has_schedule?'badge-green':'badge-gray'}">${u.has_schedule?'Set':'Not set'}</span></td>
          <td class="py-3">${u.role!=='admin'?`<button onclick="deleteUser(${u.id},'${u.name}')" class="btn-danger text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5"><i class="fa-solid fa-trash"></i> Delete</button>`:'—'}</td>
        </tr>`).join('')}
      </tbody></table></div>`;
  } catch(e){el.innerHTML=`<p class="text-red-400 text-sm">Failed to load users</p>`;}
}

async function loadAllLogs() {
  const el = document.getElementById('all-logs-table'); if(!el) return;
  try {
    const logs = await apiFetch('/api/admin/logs');
    if (!logs.length){el.innerHTML=`<p class="text-slate-500 text-sm">No logs yet.</p>`;return;}
    el.innerHTML=`<div class="overflow-x-auto"><table class="w-full text-sm">
      <thead><tr class="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700/40">
        <th class="pb-3 pr-4">User</th><th class="pb-3 pr-4">Date & Time</th>
        <th class="pb-3 pr-4">Type</th><th class="pb-3 pr-4">Status</th><th class="pb-3">Reason</th>
      </tr></thead>
      <tbody>${logs.map(l=>`
        <tr class="table-row border-b border-slate-800/60">
          <td class="py-2.5 pr-4 font-medium text-white">${l.user_name}</td>
          <td class="py-2.5 pr-4 text-slate-400 whitespace-nowrap text-xs">${new Date(l.timestamp).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</td>
          <td class="py-2.5 pr-4"><span class="badge ${l.type==='clock_in'?'badge-blue':'badge-yellow'}">${l.type==='clock_in'?'In':'Out'}</span></td>
          <td class="py-2.5 pr-4"><span class="badge ${l.status==='sent'?'badge-green':l.status==='skipped'?'badge-yellow':'badge-red'}">${l.status}</span></td>
          <td class="py-2.5 text-slate-500 text-xs">${l.reason||'—'}</td>
        </tr>`).join('')}
      </tbody></table></div>`;
  } catch(e){el.innerHTML=`<p class="text-red-400 text-sm">Failed to load logs</p>`;}
}

async function addUser() {
  const name=document.getElementById('new-name').value.trim();
  const email=document.getElementById('new-email').value.trim();
  const password=document.getElementById('new-password').value;
  if(!name||!email||!password){showAddMsg('All fields are required','error');return;}
  try {
    await apiFetch('/api/admin/users',{method:'POST',body:JSON.stringify({name,email,password})});
    document.getElementById('new-name').value='';
    document.getElementById('new-email').value='';
    document.getElementById('new-password').value='';
    showAddMsg('User created successfully ✓','success');
    await loadUsers();
  } catch(e){showAddMsg(e.message,'error');}
}

function showAddMsg(msg,type) {
  const el=document.getElementById('add-user-msg');
  el.textContent=msg;
  el.className=`mb-3 p-3 rounded-lg text-sm font-medium ${type==='success'?'bg-green-900/30 border border-green-500/30 text-green-400':'bg-red-900/30 border border-red-500/30 text-red-400'}`;
  el.classList.remove('hidden');
  setTimeout(()=>el.classList.add('hidden'),4000);
}

async function deleteUser(id, name) {
  if(!confirm(`Delete user "${name}" and all their data? This cannot be undone.`)) return;
  try { await apiFetch(`/api/admin/users/${id}`,{method:'DELETE'}); await loadUsers(); }
  catch(e){alert(e.message);}
}

'use strict';

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORE_TX   = 'buch_transactions';
const STORE_CATS = 'buch_categories';
const STORE_CUST = 'buch_customers';
const STORE_INV  = 'buch_invoices';
const STORE_SELF = 'buch_self';

const DEFAULT_CATS_EXPENSE = ['Miete / Raumkosten', 'Wareneinkauf', 'Verpackung', 'Marketing', 'Transport / Versand', 'Büro & Verwaltung', 'Versicherung', 'Löhne', 'Sonstiges'];
const DEFAULT_CATS_INCOME  = ['Verkauf', 'Dienstleistung', 'Sonstiges'];

const load = (k, d) => JSON.parse(localStorage.getItem(k) || JSON.stringify(d));
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

function loadCats() {
  const s = localStorage.getItem(STORE_CATS);
  if (s) return JSON.parse(s);
  const cats = { expense: [...DEFAULT_CATS_EXPENSE], income: [...DEFAULT_CATS_INCOME] };
  save(STORE_CATS, cats);
  return cats;
}

// ─── State ────────────────────────────────────────────────────────────────────

let transactions = load(STORE_TX,   []);
let categories   = loadCats();
let customers    = load(STORE_CUST, []);
let invoices     = load(STORE_INV,  []);
let selfData     = load(STORE_SELF, { firma: 'Zimtwelt', city: '', email: '', phone: '', street: '', zip: '', web: '', uid: '', iban: '' });

let currentType  = 'expense';
let quickType    = 'expense';
let editingId    = null;
let deleteTarget = null;
let deleteFn     = null;
let monthChart   = null;
let catChart     = null;
let statusTarget = null;

// ─── Utilities ────────────────────────────────────────────────────────────────

function uid()           { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function today()         { return new Date().toISOString().slice(0,10); }
function daysFromNow(n)  { const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function fmt(v)          { return 'CHF ' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'"); }
function fmtN(v)         { return v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'"); }
function esc(s)          { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function csvEsc(s)       { s=String(s||''); return s.includes(';')||s.includes('"') ? '"'+s.replace(/"/g,'""')+'"' : s; }

function formatDate(iso) {
  if (!iso) return '';
  const [y,m,d] = iso.split('-');
  return d+'.'+m+'.'+y;
}

function yearFilter(year) {
  if (year === 'all') return () => true;
  return tx => tx.date && tx.date.startsWith(year);
}

function customerShort(id) {
  if (!id) return '';
  const c = customers.find(x => x.id === id);
  if (!c) return '';
  return c.firma || [c.first, c.last].filter(Boolean).join(' ') || '';
}

function customerFull(id) {
  if (!id) return null;
  return customers.find(x => x.id === id) || null;
}

function nextInvNumber() {
  const y = new Date().getFullYear();
  const nums = invoices
    .filter(i => i.number && i.number.startsWith(y+'-'))
    .map(i => parseInt(i.number.split('-')[1])||0);
  return y + '-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3,'0');
}

function statusLabel(s) {
  return { draft:'Entwurf', sent:'Versendet', paid:'Bezahlt', overdue:'Überfällig' }[s] || s;
}
function statusClass(s) {
  return { draft:'badge-draft', sent:'badge-sent', paid:'badge-paid', overdue:'badge-overdue' }[s] || '';
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.view===name));
  if (name==='dashboard')    renderDashboard();
  if (name==='transactions') { renderAllTable(); }
  if (name==='customers')    renderCustomers();
  if (name==='invoices')     { document.getElementById('invFormCard').style.display='none'; renderInvoices(); }
  if (name==='settings')     loadSettings();
}

document.querySelectorAll('.nav-link').forEach(l =>
  l.addEventListener('click', e => { e.preventDefault(); showView(l.dataset.view); })
);

document.querySelectorAll('.link-sm[data-view]').forEach(l =>
  l.addEventListener('click', e => { e.preventDefault(); showView(l.dataset.view); })
);

document.getElementById('firstBookingLink')?.addEventListener('click', e => {
  e.preventDefault();
  openQuickAdd();
});

// ─── Sidebar company name ─────────────────────────────────────────────────────

function updateSidebarName() {
  document.getElementById('sidebarName').textContent = selfData.firma || 'Meine Firma';
}

// ─── Quick Add (Dashboard) ────────────────────────────────────────────────────

function openQuickAdd() {
  document.getElementById('quickAddCard').style.display = '';
  document.getElementById('qDate').value = today();
  document.getElementById('qAmount').value = '';
  document.getElementById('qDesc').value = '';
  populateQCatSelect();
  populateQCustomerSelect();
  setQuickType('expense');
}

document.getElementById('quickAddBtn').addEventListener('click', openQuickAdd);

document.getElementById('quickCancelBtn').addEventListener('click', () => {
  document.getElementById('quickAddCard').style.display = 'none';
});

function setQuickType(t) {
  quickType = t;
  document.querySelectorAll('.quick-toggle .toggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.type === t)
  );
  populateQCatSelect();
}

document.querySelectorAll('.quick-toggle .toggle-btn').forEach(b =>
  b.addEventListener('click', () => setQuickType(b.dataset.type))
);

function populateQCatSelect() {
  const sel = document.getElementById('qCat');
  sel.innerHTML = '';
  categories[quickType].forEach(c => {
    const o = document.createElement('option');
    o.value = o.textContent = c;
    sel.appendChild(o);
  });
}

function populateQCustomerSelect() {
  const sel = document.getElementById('qCustomer');
  sel.innerHTML = '<option value="">Kein Kunde</option>';
  customers.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = customerShort(c.id);
    sel.appendChild(o);
  });
}

document.getElementById('quickForm').addEventListener('submit', e => {
  e.preventDefault();
  const tx = {
    id:         uid(),
    type:       quickType,
    date:       document.getElementById('qDate').value,
    amount:     parseFloat(document.getElementById('qAmount').value),
    desc:       document.getElementById('qDesc').value.trim(),
    category:   document.getElementById('qCat').value,
    customerId: document.getElementById('qCustomer').value,
    note:       '',
  };
  transactions.unshift(tx);
  save(STORE_TX, transactions);
  document.getElementById('quickAddCard').style.display = 'none';
  document.getElementById('quickForm').reset();
  renderDashboard();
});

// ─── Tx Form ──────────────────────────────────────────────────────────────────

function resetTxForm() {
  editingId = null;
  document.getElementById('editId').value = '';
  document.getElementById('txFormTitle').textContent = 'Neue Buchung';
  document.getElementById('submitBtn').textContent = 'Speichern';
  document.getElementById('txForm').reset();
  document.getElementById('fDate').value = today();
  document.getElementById('fCustomer').value = '';
  setType('expense');
}

function setType(t) {
  currentType = t;
  document.querySelectorAll('#txFormCard .toggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.type === t)
  );
  populateCatSelect();
}

function populateCatSelect() {
  const sel = document.getElementById('fCat');
  sel.innerHTML = '';
  categories[currentType].forEach(c => {
    const o = document.createElement('option');
    o.value = o.textContent = c;
    sel.appendChild(o);
  });
}

function updateFilterCats() {
  const sel = document.getElementById('filterCat');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Alle Kategorien</option>';
  [...new Set([...categories.expense,...categories.income])].sort().forEach(c => {
    const o = document.createElement('option');
    o.value = o.textContent = c;
    sel.appendChild(o);
  });
  if (cur) sel.value = cur;
}

document.querySelectorAll('#txFormCard .toggle-btn').forEach(b =>
  b.addEventListener('click', () => setType(b.dataset.type))
);

document.getElementById('newCatBtn').addEventListener('click', () => {
  document.getElementById('newCatInput').value = '';
  document.getElementById('catDialog').style.display = 'flex';
  document.getElementById('newCatInput').focus();
});

document.getElementById('catDialogOk').addEventListener('click', () => {
  const name = document.getElementById('newCatInput').value.trim();
  if (!name) return;
  if (!categories[currentType].includes(name)) { categories[currentType].push(name); save(STORE_CATS, categories); }
  populateCatSelect();
  document.getElementById('fCat').value = name;
  document.getElementById('catDialog').style.display = 'none';
});

document.getElementById('catDialogCancel').addEventListener('click', () =>
  document.getElementById('catDialog').style.display = 'none'
);

document.getElementById('newTxBtn').addEventListener('click', () => {
  resetTxForm();
  document.getElementById('txFormCard').style.display = '';
  populateCustomerSelect('fCustomer');
  document.getElementById('fDate').focus();
  document.getElementById('txFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.getElementById('txForm').addEventListener('submit', e => {
  e.preventDefault();
  const tx = {
    id:         editingId || uid(),
    type:       currentType,
    date:       document.getElementById('fDate').value,
    amount:     parseFloat(document.getElementById('fAmount').value),
    desc:       document.getElementById('fDesc').value.trim(),
    category:   document.getElementById('fCat').value,
    customerId: document.getElementById('fCustomer').value,
    note:       document.getElementById('fNote').value.trim(),
  };
  if (editingId) {
    transactions[transactions.findIndex(t=>t.id===editingId)] = tx;
  } else {
    transactions.unshift(tx);
  }
  save(STORE_TX, transactions);
  document.getElementById('txFormCard').style.display = 'none';
  editingId = null;
  renderAllTable();
  renderDashboard();
});

document.getElementById('cancelEdit').addEventListener('click', () => {
  document.getElementById('txFormCard').style.display = 'none';
  editingId = null;
});

function editTx(id) {
  const tx = transactions.find(t=>t.id===id);
  if (!tx) return;
  editingId = id;
  setType(tx.type);
  document.getElementById('fDate').value     = tx.date;
  document.getElementById('fAmount').value   = tx.amount;
  document.getElementById('fDesc').value     = tx.desc;
  document.getElementById('fNote').value     = tx.note||'';
  populateCustomerSelect('fCustomer');
  document.getElementById('fCustomer').value = tx.customerId||'';
  if (!categories[tx.type].includes(tx.category)) { categories[tx.type].push(tx.category); save(STORE_CATS,categories); }
  populateCatSelect();
  document.getElementById('fCat').value = tx.category;
  document.getElementById('txFormTitle').textContent = 'Buchung bearbeiten';
  document.getElementById('submitBtn').textContent = 'Aktualisieren';
  document.getElementById('txFormCard').style.display = '';
  document.getElementById('txFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Delete dialog ────────────────────────────────────────────────────────────

function confirmDelete(id, fn) {
  deleteTarget = id; deleteFn = fn;
  document.getElementById('dialog').style.display = 'flex';
}

document.getElementById('dialogConfirm').addEventListener('click', () => {
  if (deleteFn) deleteFn(deleteTarget);
  document.getElementById('dialog').style.display = 'none';
  deleteTarget=null; deleteFn=null;
});
document.getElementById('dialogCancel').addEventListener('click', () => {
  document.getElementById('dialog').style.display = 'none';
  deleteTarget=null; deleteFn=null;
});

// ─── Render: Transactions ─────────────────────────────────────────────────────

function renderAllTable() {
  updateFilterCats();
  const search = document.getElementById('searchInput').value.toLowerCase();
  const typeF  = document.getElementById('filterType').value;
  const catF   = document.getElementById('filterCat').value;
  const year   = document.getElementById('filterYear').value;
  const month  = document.getElementById('filterMonth').value;
  const yf     = yearFilter(year);

  const filtered = transactions.filter(tx => {
    if (typeF && tx.type !== typeF) return false;
    if (catF  && tx.category !== catF) return false;
    if (!yf(tx)) return false;
    if (month && tx.date && tx.date.slice(5,7) !== month) return false;
    if (search) {
      const hay = (tx.desc+tx.category+customerShort(tx.customerId)).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  filtered.sort((a,b) => b.date.localeCompare(a.date));

  // Summary bar
  const inc = filtered.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const exp = filtered.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const bar = document.getElementById('txSummaryBar');
  bar.innerHTML = filtered.length
    ? `<span>${filtered.length} Buchungen &nbsp;·&nbsp;</span>
       <span class="summary-income">+${fmt(inc)}</span>
       <span style="color:#d1d5db">|</span>
       <span class="summary-expense">-${fmt(exp)}</span>
       <span style="color:#d1d5db">|</span>
       <span class="summary-balance">= ${fmt(inc-exp)}</span>`
    : '';

  const tbody = document.querySelector('#allTable tbody');
  tbody.innerHTML = '';
  const empty = document.getElementById('emptyState');
  empty.style.display = filtered.length ? 'none' : 'block';

  filtered.forEach(tx => {
    const tr = document.createElement('tr');
    const sign = tx.type==='income' ? '+' : '-';
    const cName = customerShort(tx.customerId);
    tr.innerHTML = `
      <td style="white-space:nowrap">${formatDate(tx.date)}</td>
      <td>${esc(tx.desc)}${tx.note?'<br><small style="color:#9ca3af">'+esc(tx.note)+'</small>':''}</td>
      <td><span class="cat-badge">${esc(tx.category)}</span></td>
      <td>${cName?'<span class="cat-badge">'+esc(cName)+'</span>':'—'}</td>
      <td class="num amount-${tx.type}">${sign}${fmt(tx.amount)}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-icon-sm" data-edit="${tx.id}" title="Bearbeiten">✏️</button>
        <button class="btn-icon-sm" data-del="${tx.id}"  title="Löschen">🗑️</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editTx(b.dataset.edit)));
  tbody.querySelectorAll('[data-del]').forEach(b  => b.addEventListener('click', () =>
    confirmDelete(b.dataset.del, id => {
      transactions = transactions.filter(t=>t.id!==id);
      save(STORE_TX, transactions);
      renderAllTable(); renderDashboard();
    })
  ));
}

['searchInput','filterType','filterCat','filterYear','filterMonth'].forEach(id =>
  document.getElementById(id).addEventListener('input', renderAllTable)
);

// ─── Render: Dashboard ────────────────────────────────────────────────────────

function renderDashboard() {
  const yf = yearFilter('2025');
  const all2025 = transactions.filter(yf);
  const inc = all2025.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const exp = all2025.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const bal = inc - exp;
  const openInv = invoices.filter(i=>i.status!=='paid').reduce((s,i)=>s+(i.total||0),0);
  const openCnt = invoices.filter(i=>i.status!=='paid').length;

  document.getElementById('kpiIncome').textContent   = fmt(inc);
  document.getElementById('kpiExpense').textContent  = fmt(exp);
  document.getElementById('kpiBalance').textContent  = fmt(bal);
  document.getElementById('kpiOpen').textContent     = fmt(openInv);

  const incTx  = all2025.filter(t=>t.type==='income').length;
  const expTx  = all2025.filter(t=>t.type==='expense').length;
  document.getElementById('kpiIncomeSub').textContent  = incTx + ' Buchungen';
  document.getElementById('kpiExpenseSub').textContent = expTx + ' Buchungen';
  document.getElementById('kpiBalanceSub').textContent = bal >= 0 ? 'Gewinn ✓' : 'Verlust';
  document.getElementById('kpiOpenSub').textContent    = openCnt + ' Rechnungen offen';

  // Recent table
  const tbody = document.querySelector('#recentTable tbody');
  const recentEmpty = document.getElementById('recentEmpty');
  tbody.innerHTML = '';
  const recent = [...transactions].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
  recentEmpty.style.display = recent.length ? 'none' : 'block';
  recent.forEach(tx => {
    const tr = document.createElement('tr');
    const sign = tx.type==='income' ? '+' : '-';
    const cName = customerShort(tx.customerId);
    tr.innerHTML = `
      <td style="white-space:nowrap">${formatDate(tx.date)}</td>
      <td>${esc(tx.desc)}</td>
      <td><span class="cat-badge">${esc(tx.category)}</span></td>
      <td>${cName?'<span class="cat-badge">'+esc(cName)+'</span>':'—'}</td>
      <td class="num amount-${tx.type}">${sign}${fmt(tx.amount)}</td>`;
    tbody.appendChild(tr);
  });

  renderMonthChart();
  renderCatChart(all2025);
}

// ─── Charts ───────────────────────────────────────────────────────────────────

function renderMonthChart() {
  const ctx = document.getElementById('monthChart').getContext('2d');
  if (monthChart) monthChart.destroy();
  const months = Array.from({length:12},(_,i) => ({
    label: new Date(2025,i,1).toLocaleDateString('de-CH',{month:'short'}),
    m: String(i+1).padStart(2,'0'),
  }));
  const inc = months.map(mo => transactions.filter(t=>t.type==='income' &&t.date?.startsWith('2025-'+mo.m)).reduce((s,t)=>s+t.amount,0));
  const exp = months.map(mo => transactions.filter(t=>t.type==='expense'&&t.date?.startsWith('2025-'+mo.m)).reduce((s,t)=>s+t.amount,0));
  monthChart = new Chart(ctx, {
    type:'bar',
    data:{ labels:months.map(m=>m.label), datasets:[
      {label:'Einnahmen',data:inc,backgroundColor:'#16a34a33',borderColor:'#16a34a',borderWidth:2,borderRadius:4},
      {label:'Ausgaben', data:exp,backgroundColor:'#dc262633',borderColor:'#dc2626',borderWidth:2,borderRadius:4},
    ]},
    options:{responsive:true,plugins:{legend:{position:'bottom'},tooltip:{callbacks:{label:c=>' CHF '+c.raw.toFixed(2)}}},scales:{y:{beginAtZero:true,ticks:{callback:v=>'CHF '+v}}}},
  });
}

function renderCatChart(data) {
  const ctx = document.getElementById('catChart').getContext('2d');
  if (catChart) catChart.destroy();
  const bycat={};
  data.filter(t=>t.type==='expense').forEach(t=>{ bycat[t.category]=(bycat[t.category]||0)+t.amount; });
  const labels=Object.keys(bycat), vals=labels.map(k=>bycat[k]);
  const palette=['#4f6ef7','#16a34a','#f59e0b','#dc2626','#8b5cf6','#06b6d4','#ec4899','#14b8a6','#f97316'];
  catChart = new Chart(ctx, {
    type:'doughnut',
    data:{labels,datasets:[{data:vals,backgroundColor:palette.slice(0,labels.length),borderWidth:2,borderColor:'#fff'}]},
    options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:11}}},tooltip:{callbacks:{label:c=>' CHF '+c.raw.toFixed(2)}}}},
  });
}

// ─── Customers ────────────────────────────────────────────────────────────────

function populateCustomerSelect(selId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = selId==='invCustomer'
    ? '<option value="">— Kunde wählen —</option>'
    : '<option value="">— kein —</option>';
  customers.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = customerShort(c.id);
    sel.appendChild(o);
  });
  if (cur) sel.value = cur;
}

function renderCustomers() {
  const tbody = document.querySelector('#customerTable tbody');
  tbody.innerHTML = '';
  document.getElementById('custEmptyState').style.display = customers.length ? 'none' : 'block';
  customers.forEach(c => {
    const tr = document.createElement('tr');
    const name = [c.first,c.last].filter(Boolean).join(' ')||'—';
    tr.innerHTML = `
      <td><strong>${esc(c.firma||'—')}</strong>${c.uid?'<br><small style="color:#9ca3af">'+esc(c.uid)+'</small>':''}</td>
      <td>${esc(name)}</td>
      <td>${c.email?'<a href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a>':'—'}</td>
      <td>${esc(c.phone||'—')}</td>
      <td>${esc([c.zip,c.city].filter(Boolean).join(' ')||'—')}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-icon-sm" data-cedit="${c.id}">✏️</button>
        <button class="btn-icon-sm" data-cdel="${c.id}">🗑️</button>
      </td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-cedit]').forEach(b => b.addEventListener('click', () => openCustDialog(b.dataset.cedit)));
  tbody.querySelectorAll('[data-cdel]').forEach(b  => b.addEventListener('click', () =>
    confirmDelete(b.dataset.cdel, id => {
      customers = customers.filter(c=>c.id!==id);
      save(STORE_CUST, customers);
      renderCustomers(); populateCustomerSelect('fCustomer'); populateCustomerSelect('invCustomer');
    })
  ));
}

document.getElementById('newCustomerBtn').addEventListener('click', () => openCustDialog(null));

function openCustDialog(id) {
  const c = id ? customers.find(x=>x.id===id) : null;
  document.getElementById('custDialogTitle').textContent = c ? 'Kunde bearbeiten' : 'Neuer Kunde';
  document.getElementById('custEditId').value  = c?.id||'';
  document.getElementById('cFirma').value   = c?.firma  ||'';
  document.getElementById('cFirst').value   = c?.first  ||'';
  document.getElementById('cLast').value    = c?.last   ||'';
  document.getElementById('cStreet').value  = c?.street ||'';
  document.getElementById('cZip').value     = c?.zip    ||'';
  document.getElementById('cCity').value    = c?.city   ||'';
  document.getElementById('cCountry').value = c?.country||'Schweiz';
  document.getElementById('cPhone').value   = c?.phone  ||'';
  document.getElementById('cEmail').value   = c?.email  ||'';
  document.getElementById('cUid').value     = c?.uid    ||'';
  document.getElementById('custDialog').style.display = 'flex';
  document.getElementById('cFirma').focus();
}

document.getElementById('custDialogOk').addEventListener('click', () => {
  const id = document.getElementById('custEditId').value;
  const c = {
    id:      id||uid(),
    firma:   document.getElementById('cFirma').value.trim(),
    first:   document.getElementById('cFirst').value.trim(),
    last:    document.getElementById('cLast').value.trim(),
    street:  document.getElementById('cStreet').value.trim(),
    zip:     document.getElementById('cZip').value.trim(),
    city:    document.getElementById('cCity').value.trim(),
    country: document.getElementById('cCountry').value.trim(),
    phone:   document.getElementById('cPhone').value.trim(),
    email:   document.getElementById('cEmail').value.trim(),
    uid:     document.getElementById('cUid').value.trim(),
  };
  if (!c.firma && !c.first && !c.last) { alert('Bitte Firma oder Name angeben.'); return; }
  if (id) { customers[customers.findIndex(x=>x.id===id)] = c; } else { customers.push(c); }
  save(STORE_CUST, customers);
  populateCustomerSelect('fCustomer');
  populateCustomerSelect('invCustomer');
  populateQCustomerSelect();
  renderCustomers();
  document.getElementById('custDialog').style.display = 'none';
});
document.getElementById('custDialogCancel').addEventListener('click', () =>
  document.getElementById('custDialog').style.display = 'none'
);

// ─── Invoices ─────────────────────────────────────────────────────────────────

function renderInvoices() {
  const tbody = document.querySelector('#invoiceTable tbody');
  tbody.innerHTML = '';
  document.getElementById('invEmptyState').style.display = invoices.length ? 'none' : 'block';
  [...invoices].sort((a,b)=>b.date.localeCompare(a.date)).forEach(inv => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(inv.number)}</strong></td>
      <td style="white-space:nowrap">${formatDate(inv.date)}</td>
      <td>${esc(customerShort(inv.customerId)||'—')}</td>
      <td>${esc(inv.subject)}</td>
      <td style="white-space:nowrap">${formatDate(inv.due)}</td>
      <td class="num">${fmt(inv.total||0)}</td>
      <td><span class="status-badge ${statusClass(inv.status)}" data-sinv="${inv.id}" title="Klicken zum Ändern">${statusLabel(inv.status)}</span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-icon-sm" data-iedit="${inv.id}" title="Bearbeiten">✏️</button>
        <button class="btn-icon-sm" data-ipdf="${inv.id}"  title="PDF">📄</button>
        <button class="btn-icon-sm" data-idel="${inv.id}"  title="Löschen">🗑️</button>
      </td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-sinv]').forEach(b => b.addEventListener('click', () => openStatusDialog(b.dataset.sinv)));
  tbody.querySelectorAll('[data-iedit]').forEach(b => b.addEventListener('click', () => editInvoice(b.dataset.iedit)));
  tbody.querySelectorAll('[data-ipdf]').forEach(b  => b.addEventListener('click', () => downloadInvPdf(b.dataset.ipdf)));
  tbody.querySelectorAll('[data-idel]').forEach(b  => b.addEventListener('click', () =>
    confirmDelete(b.dataset.idel, id => {
      invoices = invoices.filter(i=>i.id!==id);
      save(STORE_INV, invoices);
      renderInvoices(); renderDashboard();
    })
  ));
}

document.getElementById('newInvoiceBtn').addEventListener('click', () => {
  document.getElementById('invEditId').value = '';
  resetInvForm();
  document.getElementById('invFormCard').style.display = '';
  document.getElementById('invFormCard').scrollIntoView({ behavior:'smooth', block:'start' });
});

function resetInvForm() {
  document.getElementById('invNumber').value   = nextInvNumber();
  document.getElementById('invDate').value     = today();
  document.getElementById('invDue').value      = daysFromNow(30);
  document.getElementById('invSubject').value  = '';
  document.getElementById('invNotes').value    = 'Zahlbar innerhalb 30 Tagen. Vielen Dank für Ihren Auftrag.';
  document.getElementById('invFormTitle').textContent = 'Neue Rechnung';
  document.getElementById('invSubmitBtn').textContent = 'Speichern';
  populateCustomerSelect('invCustomer');
  document.getElementById('lineItems').innerHTML = '';
  addLineItem();
  calcInvTotals();
}

function addLineItem(desc='', qty=1, price=0, vat=0) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text"   class="li-desc"  value="${esc(desc)}"  placeholder="Beschreibung" /></td>
    <td><input type="number" class="li-qty"   value="${qty}"   step="0.01" min="0" style="text-align:right" /></td>
    <td><input type="number" class="li-price" value="${price}" step="0.01" min="0" style="text-align:right" /></td>
    <td><input type="number" class="li-vat"   value="${vat}"   step="0.1"  min="0" max="100" style="text-align:right" /></td>
    <td class="num li-total" style="white-space:nowrap">CHF 0.00</td>
    <td><button type="button" class="btn-icon-sm li-remove">✕</button></td>`;
  document.getElementById('lineItems').appendChild(tr);
  tr.querySelectorAll('input').forEach(i => i.addEventListener('input', calcInvTotals));
  tr.querySelector('.li-remove').addEventListener('click', () => { tr.remove(); calcInvTotals(); });
  calcInvTotals();
}

document.getElementById('addLineBtn').addEventListener('click', () => addLineItem());

function calcInvTotals() {
  let net=0, vatAmt=0;
  document.querySelectorAll('#lineItems tr').forEach(tr => {
    const qty=parseFloat(tr.querySelector('.li-qty').value)||0;
    const price=parseFloat(tr.querySelector('.li-price').value)||0;
    const vat=parseFloat(tr.querySelector('.li-vat').value)||0;
    const ln = qty*price;
    net += ln; vatAmt += ln*vat/100;
    tr.querySelector('.li-total').textContent = fmt(ln);
  });
  document.getElementById('invNet').textContent   = fmt(net);
  document.getElementById('invVat').textContent   = fmt(vatAmt);
  document.getElementById('invTotal').textContent = fmtN(net+vatAmt);
}

document.getElementById('invForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('invEditId').value;
  const lines = [...document.querySelectorAll('#lineItems tr')].map(tr => ({
    desc: tr.querySelector('.li-desc').value.trim(),
    qty:  parseFloat(tr.querySelector('.li-qty').value)||0,
    price:parseFloat(tr.querySelector('.li-price').value)||0,
    vat:  parseFloat(tr.querySelector('.li-vat').value)||0,
  }));
  const net   = lines.reduce((s,l)=>s+l.qty*l.price,0);
  const vat   = lines.reduce((s,l)=>s+l.qty*l.price*l.vat/100,0);
  const inv = {
    id:         id||uid(),
    number:     document.getElementById('invNumber').value.trim(),
    date:       document.getElementById('invDate').value,
    due:        document.getElementById('invDue').value,
    customerId: document.getElementById('invCustomer').value,
    subject:    document.getElementById('invSubject').value.trim(),
    notes:      document.getElementById('invNotes').value.trim(),
    lines, net, vat, total: net+vat,
    status: id ? (invoices.find(i=>i.id===id)?.status||'draft') : 'draft',
  };
  if (id) { invoices[invoices.findIndex(i=>i.id===id)]=inv; } else { invoices.unshift(inv); }
  save(STORE_INV, invoices);
  document.getElementById('invFormCard').style.display = 'none';
  document.getElementById('invEditId').value = '';
  renderInvoices(); renderDashboard();
});

document.getElementById('invCancelBtn').addEventListener('click', () => {
  document.getElementById('invFormCard').style.display = 'none';
  document.getElementById('invEditId').value = '';
});

function editInvoice(id) {
  const inv = invoices.find(i=>i.id===id);
  if (!inv) return;
  document.getElementById('invEditId').value   = inv.id;
  document.getElementById('invNumber').value   = inv.number;
  document.getElementById('invDate').value     = inv.date;
  document.getElementById('invDue').value      = inv.due;
  document.getElementById('invSubject').value  = inv.subject;
  document.getElementById('invNotes').value    = inv.notes||'';
  document.getElementById('invFormTitle').textContent = 'Rechnung bearbeiten';
  document.getElementById('invSubmitBtn').textContent = 'Aktualisieren';
  populateCustomerSelect('invCustomer');
  document.getElementById('invCustomer').value = inv.customerId||'';
  document.getElementById('lineItems').innerHTML = '';
  (inv.lines||[]).forEach(l => addLineItem(l.desc,l.qty,l.price,l.vat));
  calcInvTotals();
  document.getElementById('invFormCard').style.display = '';
  document.getElementById('invFormCard').scrollIntoView({ behavior:'smooth', block:'start' });
}

// ─── Invoice Status ───────────────────────────────────────────────────────────

function openStatusDialog(id) {
  statusTarget = id;
  document.getElementById('invStatusDialog').style.display = 'flex';
}

document.querySelectorAll('.status-pick').forEach(b =>
  b.addEventListener('click', () => {
    if (!statusTarget) return;
    const inv = invoices.find(i=>i.id===statusTarget);
    if (inv) { inv.status = b.dataset.status; save(STORE_INV, invoices); renderInvoices(); renderDashboard(); }
    document.getElementById('invStatusDialog').style.display = 'none';
    statusTarget = null;
  })
);
document.getElementById('invStatusCancel').addEventListener('click', () => {
  document.getElementById('invStatusDialog').style.display = 'none';
  statusTarget = null;
});

// ─── Settings ─────────────────────────────────────────────────────────────────

function loadSettings() {
  document.getElementById('sFirma').value  = selfData.firma  ||'';
  document.getElementById('sStreet').value = selfData.street ||'';
  document.getElementById('sZip').value    = selfData.zip    ||'';
  document.getElementById('sCity').value   = selfData.city   ||'';
  document.getElementById('sEmail').value  = selfData.email  ||'';
  document.getElementById('sPhone').value  = selfData.phone  ||'';
  document.getElementById('sWeb').value    = selfData.web    ||'';
  document.getElementById('sUid').value    = selfData.uid    ||'';
  document.getElementById('sIban').value   = selfData.iban   ||'';
}

document.getElementById('settingsForm').addEventListener('submit', e => {
  e.preventDefault();
  selfData = {
    firma:  document.getElementById('sFirma').value.trim(),
    street: document.getElementById('sStreet').value.trim(),
    zip:    document.getElementById('sZip').value.trim(),
    city:   document.getElementById('sCity').value.trim(),
    email:  document.getElementById('sEmail').value.trim(),
    phone:  document.getElementById('sPhone').value.trim(),
    web:    document.getElementById('sWeb').value.trim(),
    uid:    document.getElementById('sUid').value.trim(),
    iban:   document.getElementById('sIban').value.trim(),
  };
  save(STORE_SELF, selfData);
  updateSidebarName();
  const toast = document.getElementById('settingsSaved');
  toast.style.display = 'block';
  setTimeout(() => toast.style.display='none', 2500);
});

// ─── Jahresabschluss PDF ──────────────────────────────────────────────────────

document.getElementById('closingBtn').addEventListener('click', () => generateClosingPdf('2025'));

function generateClosingPdf(year) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const W=210, ml=20, mr=20, cw=W-ml-mr;
  let y=20;

  const yf = yearFilter(year);
  const data = transactions.filter(yf).sort((a,b)=>a.date.localeCompare(b.date));
  const inc  = data.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const exp  = data.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);

  // Header stripe
  doc.setFillColor(79,110,247);
  doc.rect(0,0,W,3,'F');

  // Title
  doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(17,24,39);
  doc.text('Jahresabschluss '+year, ml, y+10);

  doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(107,114,128);
  doc.text(selfData.firma||'', W-mr, y+4,  {align:'right'});
  doc.text('Erstellt: '+formatDate(today()), W-mr, y+10, {align:'right'});
  y += 22;

  // Summary box
  doc.setFillColor(248,250,252);
  doc.roundedRect(ml, y, cw, 30, 2, 2, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(17,24,39);

  doc.setTextColor(22,163,74);
  doc.text('Einnahmen', ml+8, y+10);
  doc.text('CHF '+fmtN(inc), ml+8, y+20);

  doc.setTextColor(220,38,38);
  doc.text('Ausgaben', ml+60, y+10);
  doc.text('CHF '+fmtN(exp), ml+60, y+20);

  const balColor = inc-exp >= 0 ? [79,110,247] : [220,38,38];
  doc.setTextColor(...balColor);
  doc.text(inc-exp>=0?'Gewinn':'Verlust', ml+115, y+10);
  doc.text('CHF '+fmtN(Math.abs(inc-exp)), ml+115, y+20);

  y += 38;

  // Category breakdown
  const bycat = {};
  data.forEach(t => {
    if (!bycat[t.type]) bycat[t.type] = {};
    bycat[t.type][t.category] = (bycat[t.type][t.category]||0) + t.amount;
  });

  const drawSection = (title, map, color) => {
    if (!map || !Object.keys(map).length) return;
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(...color);
    doc.text(title, ml, y); y+=6;
    doc.setDrawColor(...color); doc.line(ml, y, ml+cw, y); y+=5;
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(55,65,81);
    Object.entries(map).sort((a,b)=>b[1]-a[1]).forEach(([cat, amt]) => {
      doc.text(cat, ml+4, y);
      doc.text('CHF '+fmtN(amt), ml+cw, y, {align:'right'});
      y+=6;
      if (y>270) { doc.addPage(); y=20; }
    });
    y+=4;
  };

  drawSection('Einnahmen', bycat['income'],  [22,163,74]);
  drawSection('Ausgaben',  bycat['expense'], [220,38,38]);

  // Monthly table
  y += 2;
  if (y > 220) { doc.addPage(); y=20; }
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(79,110,247);
  doc.text('Monatsverlauf', ml, y); y+=6;
  doc.setDrawColor(79,110,247); doc.line(ml, y, ml+cw, y); y+=5;

  const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(107,114,128);
  doc.text('Monat', ml+4, y); doc.text('Einnahmen', ml+70, y, {align:'right'});
  doc.text('Ausgaben', ml+120, y, {align:'right'}); doc.text('Saldo', ml+cw, y, {align:'right'});
  y+=5; doc.setDrawColor(229,231,235); doc.line(ml,y,ml+cw,y); y+=4;

  months.forEach((mname, idx) => {
    const mm = String(idx+1).padStart(2,'0');
    const mi = data.filter(t=>t.type==='income' &&t.date?.startsWith(year+'-'+mm)).reduce((s,t)=>s+t.amount,0);
    const me = data.filter(t=>t.type==='expense'&&t.date?.startsWith(year+'-'+mm)).reduce((s,t)=>s+t.amount,0);
    if (mi===0 && me===0) return;
    if (idx%2===0) { doc.setFillColor(249,250,251); doc.rect(ml,y-3,cw,6.5,'F'); }
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(17,24,39);
    doc.text(mname, ml+4, y);
    doc.setTextColor(22,163,74);  doc.text(fmtN(mi), ml+70, y, {align:'right'});
    doc.setTextColor(220,38,38);  doc.text(fmtN(me), ml+120, y, {align:'right'});
    const sal = mi-me;
    doc.setTextColor(...(sal>=0?[79,110,247]:[220,38,38]));
    doc.text(fmtN(sal), ml+cw, y, {align:'right'});
    y+=7;
    if (y>270) { doc.addPage(); y=20; }
  });

  // Footer
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(156,163,175);
  const pages = doc.internal.getNumberOfPages();
  for (let p=1;p<=pages;p++) {
    doc.setPage(p);
    doc.text((selfData.firma||'')+' · Jahresabschluss '+year+' · Seite '+p+'/'+pages, W/2, 290, {align:'center'});
  }

  doc.save('Jahresabschluss_'+year+'.pdf');
}

// ─── Invoice PDF ──────────────────────────────────────────────────────────────

function downloadInvPdf(id) {
  const inv = invoices.find(i=>i.id===id);
  if (!inv) return;
  const c = customerFull(inv.customerId);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const W=210, ml=20, mr=20, cw=W-ml-mr;
  let y=20;

  doc.setFillColor(79,110,247);
  doc.rect(0,0,W,3,'F');

  doc.setFont('helvetica','bold'); doc.setFontSize(22); doc.setTextColor(17,24,39);
  doc.text('RECHNUNG', ml, y+10);

  doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(107,114,128);
  doc.text('Nr. '+inv.number,               W-mr, y+4,  {align:'right'});
  doc.text('Datum: '+formatDate(inv.date),   W-mr, y+10, {align:'right'});
  doc.text('Fällig: '+formatDate(inv.due),   W-mr, y+16, {align:'right'});
  y+=30;

  // Sender (own company) — top left small
  if (selfData.firma) {
    doc.setFontSize(8); doc.setTextColor(150,150,150);
    const sender = [selfData.firma, selfData.street, [selfData.zip,selfData.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    doc.text(sender, ml, y);
    y+=6;
  }

  // Customer address
  if (c) {
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(17,24,39);
    if (c.firma)  { doc.text(c.firma, ml, y); y+=5; }
    const name=[c.first,c.last].filter(Boolean).join(' ');
    if (name)     { doc.text(name, ml, y); y+=5; }
    doc.setFont('helvetica','normal'); doc.setTextColor(55,65,81);
    if (c.street) { doc.text(c.street, ml, y); y+=5; }
    const loc=[c.zip,c.city].filter(Boolean).join(' ');
    if (loc)      { doc.text(loc, ml, y); y+=5; }
  }
  y+=8;

  doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(17,24,39);
  doc.text(inv.subject, ml, y); y+=10;

  // Table header
  doc.setFillColor(243,244,246); doc.rect(ml, y-4, cw, 7, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(107,114,128);
  doc.text('Beschreibung', ml+2, y);
  doc.text('Menge',     ml+100, y, {align:'right'});
  doc.text('Preis',     ml+130, y, {align:'right'});
  doc.text('MwSt',      ml+152, y, {align:'right'});
  doc.text('Total',     ml+cw,  y, {align:'right'});
  y+=6;
  doc.setDrawColor(229,231,235); doc.line(ml, y-2, ml+cw, y-2);

  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(17,24,39);
  (inv.lines||[]).forEach((l,i) => {
    if (i%2===0) { doc.setFillColor(249,250,251); doc.rect(ml, y-3, cw, 6.5, 'F'); }
    doc.text(l.desc||'', ml+2, y);
    doc.text(String(l.qty),      ml+100, y, {align:'right'});
    doc.text(l.price.toFixed(2), ml+130, y, {align:'right'});
    doc.text((l.vat||0)+'%',     ml+152, y, {align:'right'});
    doc.text((l.qty*l.price).toFixed(2), ml+cw, y, {align:'right'});
    y+=7;
    if (y>260) { doc.addPage(); y=20; }
  });

  y+=2; doc.setDrawColor(229,231,235); doc.line(ml, y, ml+cw, y); y+=7;

  // Totals
  const tx=ml+cw-60;
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(107,114,128);
  doc.text('Netto:',  tx, y); doc.text('CHF '+inv.net.toFixed(2),   ml+cw, y, {align:'right'}); y+=6;
  doc.text('MwSt:',   tx, y); doc.text('CHF '+inv.vat.toFixed(2),   ml+cw, y, {align:'right'}); y+=2;
  doc.setDrawColor(79,110,247); doc.line(tx, y, ml+cw, y); y+=5;
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(17,24,39);
  doc.text('Total CHF', tx, y); doc.text(inv.total.toFixed(2), ml+cw, y, {align:'right'}); y+=12;

  // IBAN
  if (selfData.iban) {
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(107,114,128);
    doc.text('Zahlung an: '+selfData.iban, ml, y); y+=6;
  }

  if (inv.notes) {
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(107,114,128);
    doc.text(inv.notes, ml, y, {maxWidth: cw});
  }

  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(156,163,175);
  doc.text('Rechnung '+inv.number+' · '+formatDate(inv.date)+(selfData.firma?' · '+selfData.firma:''), W/2, 290, {align:'center'});

  doc.save('Rechnung_'+inv.number+'.pdf');
}

// ─── CSV Export / Import ──────────────────────────────────────────────────────

document.getElementById('exportBtn').addEventListener('click', () => {
  const rows = [['id','type','date','amount','category','customerId','desc','note']];
  transactions.forEach(t => rows.push([t.id,t.type,t.date,t.amount,t.category,t.customerId||'',csvEsc(t.desc),csvEsc(t.note||'')]));
  const csv = rows.map(r=>r.join(';')).join('\n');
  const blob = new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='buchhaltung_'+new Date().getFullYear()+'.csv'; a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());

document.getElementById('importFile').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const text = ev.target.result.replace(/^﻿/,'');
    const lines = text.trim().split('\n');
    const header = lines[0].split(';');
    const idx = f => header.indexOf(f);
    let n=0;
    lines.slice(1).forEach(line => {
      const cols = line.split(';');
      const id = cols[idx('id')]?.trim();
      if (!id || transactions.find(t=>t.id===id)) return;
      transactions.push({
        id, type:cols[idx('type')]?.trim(), date:cols[idx('date')]?.trim(),
        amount:parseFloat(cols[idx('amount')]), category:cols[idx('category')]?.trim(),
        customerId:cols[idx('customerId')]?.trim()||'',
        desc:cols[idx('desc')]?.trim(), note:cols[idx('note')]?.trim()||'',
      });
      n++;
    });
    save(STORE_TX, transactions);
    e.target.value = '';
    alert(n+' Buchungen importiert.');
    renderDashboard(); renderAllTable();
  };
  reader.readAsText(file,'utf-8');
});

// ─── Init ─────────────────────────────────────────────────────────────────────

updateSidebarName();
populateCatSelect();
updateFilterCats();
populateCustomerSelect('fCustomer');
populateCustomerSelect('invCustomer');
document.getElementById('fDate').value = today();
renderDashboard();
showView('dashboard');

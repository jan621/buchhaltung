'use strict';

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORE_TX      = 'buch_transactions';
const STORE_CATS    = 'buch_categories';
const STORE_CUST    = 'buch_customers';
const STORE_INV     = 'buch_invoices';
const STORE_SELF    = 'buch_self';

const DEFAULT_CATS_EXPENSE = ['Miete', 'Lebensmittel', 'Transport', 'Versicherung', 'Büro', 'Sonstiges'];
const DEFAULT_CATS_INCOME  = ['Lohn', 'Freiberuflich', 'Sonstiges'];

const load  = (k, def) => JSON.parse(localStorage.getItem(k) || JSON.stringify(def));
const save  = (k, v)   => localStorage.setItem(k, JSON.stringify(v));

function loadCats() {
  const stored = localStorage.getItem(STORE_CATS);
  if (stored) return JSON.parse(stored);
  const cats = { expense: [...DEFAULT_CATS_EXPENSE], income: [...DEFAULT_CATS_INCOME] };
  save(STORE_CATS, cats);
  return cats;
}

// ─── State ────────────────────────────────────────────────────────────────────

let transactions = load(STORE_TX,   []);
let categories   = loadCats();
let customers    = load(STORE_CUST, []);
let invoices     = load(STORE_INV,  []);

let currentType  = 'expense';
let editingId    = null;
let deleteTarget = null;
let deleteFn     = null;
let monthChart   = null;
let catChart     = null;
let statusTarget = null;

// ─── Utilities ────────────────────────────────────────────────────────────────

function uid()       { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function today()     { return new Date().toISOString().slice(0,10); }
function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }

function fmt(amount) {
  return 'CHF ' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

function formatDate(iso) {
  if (!iso) return '';
  const [y,m,d] = iso.split('-');
  return d+'.'+m+'.'+y;
}

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function csvEsc(str) {
  const s = String(str||'');
  return s.includes(';')||s.includes('"') ? '"'+s.replace(/"/g,'""')+'"' : s;
}

function periodFilter(period) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  return tx => {
    const d = new Date(tx.date);
    if (period === 'month')   return d.getFullYear()===y && d.getMonth()===m;
    if (period === 'quarter') { const q=Math.floor(m/3); return d.getFullYear()===y && Math.floor(d.getMonth()/3)===q; }
    if (period === 'year')    return d.getFullYear()===y;
    return true;
  };
}

function customerName(id) {
  if (!id) return '';
  const c = customers.find(x => x.id === id);
  if (!c) return '';
  return c.firma ? c.firma + (c.first||c.last ? ' / '+(c.first+' '+c.last).trim() : '') : (c.first+' '+c.last).trim();
}

function customerShort(id) {
  if (!id) return '—';
  const c = customers.find(x => x.id === id);
  if (!c) return '—';
  return c.firma || (c.first+' '+c.last).trim() || '—';
}

function nextInvNumber() {
  const year = new Date().getFullYear();
  const existing = invoices.filter(i => i.number && i.number.startsWith(year+'-'))
    .map(i => parseInt(i.number.split('-')[1])||0);
  const max = existing.length ? Math.max(...existing) : 0;
  return year + '-' + String(max+1).padStart(3,'0');
}

function statusLabel(s) {
  const map = { draft:'Entwurf', sent:'Versendet', paid:'Bezahlt', overdue:'Überfällig' };
  return map[s] || s;
}
function statusClass(s) {
  const map = { draft:'badge-draft', sent:'badge-sent', paid:'badge-paid', overdue:'badge-overdue' };
  return map[s] || '';
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.view===name));
  if (name==='dashboard')    renderDashboard();
  if (name==='transactions') renderAllTable();
  if (name==='customers')    renderCustomers();
  if (name==='invoices')     renderInvoices();
  if (name==='new' && !editingId) resetForm();
  if (name==='new-invoice' && !document.getElementById('invEditId').value) resetInvForm();
}

document.querySelectorAll('.nav-link').forEach(link =>
  link.addEventListener('click', e => { e.preventDefault(); showView(link.dataset.view); })
);

// ─── Customer select helpers ──────────────────────────────────────────────────

function populateCustomerSelects() {
  ['fCustomer','invCustomer'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = id === 'fCustomer'
      ? '<option value="">— kein Kunde —</option>'
      : '<option value="">— Kunde auswählen —</option>';
    customers.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = customerName(c.id);
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  });
}

// ─── Transaction Form ─────────────────────────────────────────────────────────

function resetForm() {
  editingId = null;
  document.getElementById('editId').value = '';
  document.getElementById('formTitle').textContent = 'Neue Buchung';
  document.getElementById('submitBtn').textContent = 'Speichern';
  document.getElementById('cancelEdit').style.display = 'none';
  document.getElementById('txForm').reset();
  document.getElementById('fDate').value = today();
  document.getElementById('fCustomer').value = '';
  setType('expense');
}

function setType(type) {
  currentType = type;
  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.type===type));
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

document.querySelectorAll('.toggle-btn').forEach(btn =>
  btn.addEventListener('click', () => setType(btn.dataset.type))
);

document.getElementById('newCatBtn').addEventListener('click', () => {
  document.getElementById('catDialog').style.display = 'flex';
  document.getElementById('newCatInput').value = '';
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
  resetForm();
  showView('transactions');
});

document.getElementById('cancelEdit').addEventListener('click', () => { resetForm(); showView('transactions'); });

function editTx(id) {
  const tx = transactions.find(t=>t.id===id);
  if (!tx) return;
  editingId = id;
  setType(tx.type);
  document.getElementById('fDate').value   = tx.date;
  document.getElementById('fAmount').value = tx.amount;
  document.getElementById('fDesc').value   = tx.desc;
  document.getElementById('fNote').value   = tx.note||'';
  document.getElementById('fCustomer').value = tx.customerId||'';
  if (!categories[tx.type].includes(tx.category)) { categories[tx.type].push(tx.category); save(STORE_CATS, categories); }
  populateCatSelect();
  document.getElementById('fCat').value = tx.category;
  document.getElementById('formTitle').textContent = 'Buchung bearbeiten';
  document.getElementById('submitBtn').textContent = 'Aktualisieren';
  document.getElementById('cancelEdit').style.display = '';
  showView('new');
}

// ─── Delete dialog ────────────────────────────────────────────────────────────

function confirmDelete(id, fn) {
  deleteTarget = id;
  deleteFn = fn;
  document.getElementById('dialog').style.display = 'flex';
}

document.getElementById('dialogConfirm').addEventListener('click', () => {
  if (deleteFn) deleteFn(deleteTarget);
  document.getElementById('dialog').style.display = 'none';
  deleteTarget = null; deleteFn = null;
});

document.getElementById('dialogCancel').addEventListener('click', () => {
  document.getElementById('dialog').style.display = 'none';
  deleteTarget = null; deleteFn = null;
});

// ─── Render: All Transactions ─────────────────────────────────────────────────

function renderAllTable() {
  updateFilterCats();
  const search  = document.getElementById('searchInput').value.toLowerCase();
  const typeF   = document.getElementById('filterType').value;
  const catF    = document.getElementById('filterCat').value;
  const periodF = document.getElementById('filterPeriod').value;
  const pf      = periodFilter(periodF);

  const filtered = transactions.filter(tx => {
    if (typeF && tx.type !== typeF) return false;
    if (catF  && tx.category !== catF) return false;
    if (!pf(tx)) return false;
    if (search && !tx.desc.toLowerCase().includes(search) &&
        !tx.category.toLowerCase().includes(search) &&
        !customerShort(tx.customerId).toLowerCase().includes(search)) return false;
    return true;
  });

  const tbody = document.querySelector('#allTable tbody');
  tbody.innerHTML = '';
  document.getElementById('emptyState').style.display = filtered.length ? 'none' : 'block';

  filtered.sort((a,b)=>b.date.localeCompare(a.date)).forEach(tx => {
    const tr = document.createElement('tr');
    const sign = tx.type==='income' ? '+' : '-';
    const cust = tx.customerId ? `<span class="cat-badge">${esc(customerShort(tx.customerId))}</span>` : '—';
    tr.innerHTML = `
      <td>${formatDate(tx.date)}</td>
      <td>${esc(tx.desc)}${tx.note?'<br><small style="color:#9ca3af">'+esc(tx.note)+'</small>':''}</td>
      <td>${cust}</td>
      <td><span class="cat-badge">${esc(tx.category)}</span></td>
      <td class="num amount-${tx.type}">${sign}${fmt(tx.amount)}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-icon-sm" data-edit="${tx.id}" title="Bearbeiten">✏️</button>
        <button class="btn-icon-sm" data-del="${tx.id}"  title="Löschen">🗑️</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editTx(b.dataset.edit)));
  tbody.querySelectorAll('[data-del]').forEach(b  => b.addEventListener('click', () => {
    confirmDelete(b.dataset.del, id => {
      transactions = transactions.filter(t=>t.id!==id);
      save(STORE_TX, transactions);
      renderAllTable(); renderDashboard();
    });
  }));
}

['searchInput','filterType','filterCat','filterPeriod'].forEach(id =>
  document.getElementById(id).addEventListener('input', renderAllTable)
);

// ─── Render: Dashboard ────────────────────────────────────────────────────────

function renderDashboard() {
  const period = document.getElementById('dashPeriod').value;
  const pf = periodFilter(period);
  const filtered = transactions.filter(pf);

  const income  = filtered.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const expense = filtered.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);

  document.getElementById('kpiIncome').textContent  = fmt(income);
  document.getElementById('kpiExpense').textContent = fmt(expense);
  document.getElementById('kpiBalance').textContent = fmt(income - expense);

  const tbody = document.querySelector('#recentTable tbody');
  tbody.innerHTML = '';
  [...transactions].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8).forEach(tx => {
    const tr = document.createElement('tr');
    const sign = tx.type==='income' ? '+' : '-';
    const cust = tx.customerId ? `<span class="cat-badge">${esc(customerShort(tx.customerId))}</span>` : '—';
    tr.innerHTML = `
      <td>${formatDate(tx.date)}</td>
      <td>${esc(tx.desc)}</td>
      <td>${cust}</td>
      <td><span class="cat-badge">${esc(tx.category)}</span></td>
      <td class="num amount-${tx.type}">${sign}${fmt(tx.amount)}</td>`;
    tbody.appendChild(tr);
  });

  renderMonthChart(period);
  renderCatChart(filtered);
}

document.getElementById('dashPeriod').addEventListener('change', renderDashboard);

// ─── Charts ───────────────────────────────────────────────────────────────────

function renderMonthChart(period) {
  const ctx = document.getElementById('monthChart').getContext('2d');
  if (monthChart) monthChart.destroy();
  const months = [], now = new Date();
  const n = period==='year'||period==='all' ? 12 : period==='quarter' ? 3 : 6;
  for (let i=n-1;i>=0;i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push({ label: d.toLocaleDateString('de-CH',{month:'short',year:'2-digit'}), y:d.getFullYear(), m:d.getMonth() });
  }
  const inc = months.map(mo => transactions.filter(t=>t.type==='income' &&new Date(t.date).getFullYear()===mo.y&&new Date(t.date).getMonth()===mo.m).reduce((s,t)=>s+t.amount,0));
  const exp = months.map(mo => transactions.filter(t=>t.type==='expense'&&new Date(t.date).getFullYear()===mo.y&&new Date(t.date).getMonth()===mo.m).reduce((s,t)=>s+t.amount,0));
  monthChart = new Chart(ctx, {
    type:'bar',
    data:{ labels:months.map(m=>m.label), datasets:[
      {label:'Einnahmen',data:inc,backgroundColor:'#22c55e44',borderColor:'#22c55e',borderWidth:2,borderRadius:4},
      {label:'Ausgaben', data:exp,backgroundColor:'#ef444444',borderColor:'#ef4444',borderWidth:2,borderRadius:4},
    ]},
    options:{responsive:true,plugins:{legend:{position:'bottom'},tooltip:{callbacks:{label:ctx=>' CHF '+ctx.raw.toFixed(2)}}},scales:{y:{beginAtZero:true,ticks:{callback:v=>'CHF '+v}}}},
  });
}

function renderCatChart(filtered) {
  const ctx = document.getElementById('catChart').getContext('2d');
  if (catChart) catChart.destroy();
  const bycat = {};
  filtered.filter(t=>t.type==='expense').forEach(t=>{ bycat[t.category]=(bycat[t.category]||0)+t.amount; });
  const labels = Object.keys(bycat), data = labels.map(k=>bycat[k]);
  const palette = ['#4f6ef7','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6'];
  catChart = new Chart(ctx, {
    type:'doughnut',
    data:{labels,datasets:[{data,backgroundColor:palette.slice(0,labels.length),borderWidth:2,borderColor:'#fff'}]},
    options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:12}}},tooltip:{callbacks:{label:ctx=>' CHF '+ctx.raw.toFixed(2)}}}},
  });
}

// ─── Customers ────────────────────────────────────────────────────────────────

function renderCustomers() {
  const tbody = document.querySelector('#customerTable tbody');
  tbody.innerHTML = '';
  document.getElementById('custEmptyState').style.display = customers.length ? 'none' : 'block';
  customers.forEach(c => {
    const tr = document.createElement('tr');
    const name = [c.first, c.last].filter(Boolean).join(' ') || '—';
    tr.innerHTML = `
      <td><strong>${esc(c.firma||'—')}</strong></td>
      <td>${esc(name)}</td>
      <td>${c.email ? '<a href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a>' : '—'}</td>
      <td>${esc(c.phone||'—')}</td>
      <td>${esc([c.zip,c.city].filter(Boolean).join(' ')||'—')}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-icon-sm" data-cedit="${c.id}" title="Bearbeiten">✏️</button>
        <button class="btn-icon-sm" data-cdel="${c.id}"  title="Löschen">🗑️</button>
      </td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-cedit]').forEach(b => b.addEventListener('click', () => openCustDialog(b.dataset.cedit)));
  tbody.querySelectorAll('[data-cdel]').forEach(b  => b.addEventListener('click', () => {
    confirmDelete(b.dataset.cdel, id => {
      customers = customers.filter(c=>c.id!==id);
      save(STORE_CUST, customers);
      populateCustomerSelects();
      renderCustomers();
    });
  }));
}

document.getElementById('newCustomerBtn').addEventListener('click', () => openCustDialog(null));

function openCustDialog(id) {
  const c = id ? customers.find(x=>x.id===id) : null;
  document.getElementById('custDialogTitle').textContent = c ? 'Kunde bearbeiten' : 'Neuer Kunde';
  document.getElementById('custEditId').value  = c ? c.id : '';
  document.getElementById('cFirma').value   = c?.firma   || '';
  document.getElementById('cFirst').value   = c?.first   || '';
  document.getElementById('cLast').value    = c?.last    || '';
  document.getElementById('cStreet').value  = c?.street  || '';
  document.getElementById('cZip').value     = c?.zip     || '';
  document.getElementById('cCity').value    = c?.city    || '';
  document.getElementById('cCountry').value = c?.country || 'Schweiz';
  document.getElementById('cPhone').value   = c?.phone   || '';
  document.getElementById('cEmail').value   = c?.email   || '';
  document.getElementById('cUid').value     = c?.uid     || '';
  document.getElementById('custDialog').style.display = 'flex';
  document.getElementById('cFirma').focus();
}

document.getElementById('custDialogOk').addEventListener('click', () => {
  const id = document.getElementById('custEditId').value;
  const c = {
    id:      id || uid(),
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
  if (!c.firma && !c.first && !c.last) { alert('Bitte mindestens Firma oder Name angeben.'); return; }
  if (id) {
    customers[customers.findIndex(x=>x.id===id)] = c;
  } else {
    customers.push(c);
  }
  save(STORE_CUST, customers);
  populateCustomerSelects();
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
      <td>${formatDate(inv.date)}</td>
      <td>${esc(customerShort(inv.customerId))}</td>
      <td>${esc(inv.subject)}</td>
      <td>${formatDate(inv.due)}</td>
      <td class="num">${fmt(inv.total||0)}</td>
      <td><span class="status-badge ${statusClass(inv.status)}" data-sinv="${inv.id}" style="cursor:pointer" title="Status ändern">${statusLabel(inv.status)}</span></td>
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
  tbody.querySelectorAll('[data-idel]').forEach(b  => b.addEventListener('click', () => {
    confirmDelete(b.dataset.idel, id => {
      invoices = invoices.filter(i=>i.id!==id);
      save(STORE_INV, invoices);
      renderInvoices();
    });
  }));
}

document.getElementById('newInvoiceNavBtn').addEventListener('click', () => {
  document.getElementById('invEditId').value = '';
  resetInvForm();
  showView('new-invoice');
});

// ─── Invoice Status Dialog ────────────────────────────────────────────────────

function openStatusDialog(id) {
  statusTarget = id;
  document.getElementById('invStatusDialog').style.display = 'flex';
}

document.querySelectorAll('.status-pick').forEach(btn =>
  btn.addEventListener('click', () => {
    if (!statusTarget) return;
    const inv = invoices.find(i=>i.id===statusTarget);
    if (inv) { inv.status = btn.dataset.status; save(STORE_INV, invoices); renderInvoices(); }
    document.getElementById('invStatusDialog').style.display = 'none';
    statusTarget = null;
  })
);

document.getElementById('invStatusCancel').addEventListener('click', () => {
  document.getElementById('invStatusDialog').style.display = 'none';
  statusTarget = null;
});

// ─── Invoice Form ─────────────────────────────────────────────────────────────

function resetInvForm() {
  document.getElementById('invEditId').value   = '';
  document.getElementById('invNumber').value   = nextInvNumber();
  document.getElementById('invDate').value     = today();
  document.getElementById('invDue').value      = daysFromNow(30);
  document.getElementById('invCustomer').value = '';
  document.getElementById('invSubject').value  = '';
  document.getElementById('invNotes').value    = 'Zahlbar innerhalb 30 Tagen. Vielen Dank für Ihren Auftrag.';
  document.getElementById('invFormTitle').textContent = 'Neue Rechnung';
  document.getElementById('invSubmitBtn').textContent = 'Speichern';
  document.getElementById('invCancelBtn').style.display = 'none';
  document.getElementById('lineItems').innerHTML = '';
  addLineItem();
  calcInvTotals();
}

function addLineItem(desc='', qty=1, price=0, vat=0) {
  const tbody = document.getElementById('lineItems');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="li-desc" value="${esc(desc)}" placeholder="Leistung / Artikel" style="width:100%" /></td>
    <td><input type="number" class="li-qty"   value="${qty}"   step="0.01" min="0" style="width:70px;text-align:right" /></td>
    <td><input type="number" class="li-price" value="${price}" step="0.01" min="0" style="width:100px;text-align:right" /></td>
    <td><input type="number" class="li-vat"   value="${vat}"   step="0.1"  min="0" max="100" style="width:60px;text-align:right" /></td>
    <td class="num li-total">CHF 0.00</td>
    <td><button type="button" class="btn-icon-sm li-remove" title="Entfernen">✕</button></td>`;
  tbody.appendChild(tr);
  tr.querySelectorAll('input').forEach(i => i.addEventListener('input', calcInvTotals));
  tr.querySelector('.li-remove').addEventListener('click', () => { tr.remove(); calcInvTotals(); });
  calcInvTotals();
}

document.getElementById('addLineBtn').addEventListener('click', () => addLineItem());

function getLineItems() {
  return [...document.querySelectorAll('#lineItems tr')].map(tr => ({
    desc:  tr.querySelector('.li-desc').value.trim(),
    qty:   parseFloat(tr.querySelector('.li-qty').value)||0,
    price: parseFloat(tr.querySelector('.li-price').value)||0,
    vat:   parseFloat(tr.querySelector('.li-vat').value)||0,
  }));
}

function calcInvTotals() {
  let net=0, vatAmt=0;
  document.querySelectorAll('#lineItems tr').forEach(tr => {
    const qty   = parseFloat(tr.querySelector('.li-qty').value)||0;
    const price = parseFloat(tr.querySelector('.li-price').value)||0;
    const vat   = parseFloat(tr.querySelector('.li-vat').value)||0;
    const lineNet = qty * price;
    net    += lineNet;
    vatAmt += lineNet * vat / 100;
    tr.querySelector('.li-total').textContent = fmt(lineNet);
  });
  document.getElementById('invNet').textContent   = fmt(net);
  document.getElementById('invVat').textContent   = fmt(vatAmt);
  document.getElementById('invTotal').textContent = fmt(net + vatAmt);
}

document.getElementById('invForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('invEditId').value;
  const lines = getLineItems();
  const net   = lines.reduce((s,l)=>s+l.qty*l.price, 0);
  const vat   = lines.reduce((s,l)=>s+l.qty*l.price*l.vat/100, 0);
  const inv = {
    id:         id || uid(),
    number:     document.getElementById('invNumber').value.trim(),
    date:       document.getElementById('invDate').value,
    due:        document.getElementById('invDue').value,
    customerId: document.getElementById('invCustomer').value,
    subject:    document.getElementById('invSubject').value.trim(),
    notes:      document.getElementById('invNotes').value.trim(),
    lines,
    net, vat,
    total: net + vat,
    status: id ? (invoices.find(i=>i.id===id)?.status||'draft') : 'draft',
  };
  if (id) {
    invoices[invoices.findIndex(i=>i.id===id)] = inv;
  } else {
    invoices.unshift(inv);
  }
  save(STORE_INV, invoices);
  showView('invoices');
});

document.getElementById('invCancelBtn').addEventListener('click', () => {
  document.getElementById('invEditId').value = '';
  showView('invoices');
});

function editInvoice(id) {
  const inv = invoices.find(i=>i.id===id);
  if (!inv) return;
  document.getElementById('invEditId').value   = inv.id;
  document.getElementById('invNumber').value   = inv.number;
  document.getElementById('invDate').value     = inv.date;
  document.getElementById('invDue').value      = inv.due;
  document.getElementById('invCustomer').value = inv.customerId;
  document.getElementById('invSubject').value  = inv.subject;
  document.getElementById('invNotes').value    = inv.notes||'';
  document.getElementById('lineItems').innerHTML = '';
  (inv.lines||[]).forEach(l => addLineItem(l.desc, l.qty, l.price, l.vat));
  calcInvTotals();
  document.getElementById('invFormTitle').textContent = 'Rechnung bearbeiten';
  document.getElementById('invSubmitBtn').textContent = 'Aktualisieren';
  document.getElementById('invCancelBtn').style.display = '';
  showView('new-invoice');
}

// ─── PDF Generation ───────────────────────────────────────────────────────────

function downloadInvPdf(id) {
  const inv = invoices.find(i=>i.id===id);
  if (!inv) return;
  const c = customers.find(x=>x.id===inv.customerId);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });

  const W = 210, ml = 20, mr = 20, cw = W - ml - mr;
  let y = 20;

  // header accent bar
  doc.setFillColor(79,110,247);
  doc.rect(0, 0, W, 3, 'F');

  // title
  doc.setFont('helvetica','bold');
  doc.setFontSize(22);
  doc.setTextColor(17,24,39);
  doc.text('RECHNUNG', ml, y+10);

  // invoice number + date block (right side)
  doc.setFont('helvetica','normal');
  doc.setFontSize(10);
  doc.setTextColor(107,114,128);
  const rightX = W - mr;
  doc.text('Nr.: ' + inv.number,              rightX, y+4,  {align:'right'});
  doc.text('Datum: ' + formatDate(inv.date),   rightX, y+10, {align:'right'});
  doc.text('Fällig: ' + formatDate(inv.due),   rightX, y+16, {align:'right'});

  y += 30;

  // customer address block
  if (c) {
    doc.setFont('helvetica','bold');
    doc.setFontSize(10);
    doc.setTextColor(17,24,39);
    if (c.firma)  { doc.text(c.firma, ml, y); y += 5; }
    const name = [c.first,c.last].filter(Boolean).join(' ');
    if (name)     { doc.text(name, ml, y); y += 5; }
    doc.setFont('helvetica','normal');
    doc.setTextColor(55,65,81);
    if (c.street) { doc.text(c.street, ml, y); y += 5; }
    const loc = [c.zip, c.city].filter(Boolean).join(' ');
    if (loc)      { doc.text(loc, ml, y); y += 5; }
    if (c.country && c.country !== 'Schweiz') { doc.text(c.country, ml, y); y += 5; }
    if (c.uid)    { doc.setTextColor(107,114,128); doc.text('UID: '+c.uid, ml, y); y += 5; }
  }

  y += 8;

  // subject
  doc.setFont('helvetica','bold');
  doc.setFontSize(13);
  doc.setTextColor(17,24,39);
  doc.text(inv.subject, ml, y);
  y += 10;

  // table header
  doc.setFillColor(243,244,246);
  doc.rect(ml, y-4, cw, 7, 'F');
  doc.setFont('helvetica','bold');
  doc.setFontSize(9);
  doc.setTextColor(107,114,128);
  doc.text('Beschreibung',  ml+2,   y);
  doc.text('Menge',         ml+100, y, {align:'right'});
  doc.text('Einzelpreis',   ml+130, y, {align:'right'});
  doc.text('MwSt',          ml+152, y, {align:'right'});
  doc.text('Total',         ml+cw,  y, {align:'right'});
  y += 6;

  doc.setDrawColor(229,231,235);
  doc.line(ml, y-2, ml+cw, y-2);

  // line items
  doc.setFont('helvetica','normal');
  doc.setFontSize(9);
  doc.setTextColor(17,24,39);
  (inv.lines||[]).forEach((l,i) => {
    if (i%2===0) { doc.setFillColor(249,250,251); doc.rect(ml, y-3, cw, 6.5, 'F'); }
    const lineTotal = l.qty * l.price;
    doc.text(l.desc||'', ml+2, y);
    doc.text(String(l.qty),               ml+100, y, {align:'right'});
    doc.text(l.price.toFixed(2),          ml+130, y, {align:'right'});
    doc.text((l.vat||0)+'%',              ml+152, y, {align:'right'});
    doc.text(lineTotal.toFixed(2),        ml+cw,  y, {align:'right'});
    y += 7;
    if (y > 260) { doc.addPage(); y = 20; }
  });

  // separator
  y += 2;
  doc.setDrawColor(229,231,235);
  doc.line(ml, y, ml+cw, y);
  y += 7;

  // totals
  const totX = ml + cw - 60;
  doc.setFont('helvetica','normal');
  doc.setFontSize(9);
  doc.setTextColor(107,114,128);
  doc.text('Netto:',   totX, y);
  doc.text('CHF '+inv.net.toFixed(2), ml+cw, y, {align:'right'});
  y += 6;
  doc.text('MwSt:',    totX, y);
  doc.text('CHF '+inv.vat.toFixed(2), ml+cw, y, {align:'right'});
  y += 2;
  doc.setDrawColor(79,110,247);
  doc.line(totX, y, ml+cw, y);
  y += 5;
  doc.setFont('helvetica','bold');
  doc.setFontSize(11);
  doc.setTextColor(17,24,39);
  doc.text('Total CHF', totX, y);
  doc.text(inv.total.toFixed(2), ml+cw, y, {align:'right'});
  y += 12;

  // notes
  if (inv.notes) {
    doc.setFont('helvetica','normal');
    doc.setFontSize(9);
    doc.setTextColor(107,114,128);
    doc.text(inv.notes, ml, y, {maxWidth: cw});
  }

  // footer
  doc.setFont('helvetica','normal');
  doc.setFontSize(8);
  doc.setTextColor(156,163,175);
  doc.text('Rechnung '+inv.number+' · '+formatDate(inv.date), W/2, 290, {align:'center'});

  doc.save('Rechnung_'+inv.number+'.pdf');
}

// ─── Export / Import CSV ──────────────────────────────────────────────────────

document.getElementById('exportBtn').addEventListener('click', () => {
  const rows = [['id','type','date','amount','category','customerId','desc','note']];
  transactions.forEach(t => rows.push([t.id,t.type,t.date,t.amount,t.category,t.customerId||'',csvEsc(t.desc),csvEsc(t.note||'')]));
  const csv = rows.map(r=>r.join(';')).join('\n');
  const blob = new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='buchhaltung.csv'; a.click();
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
    let imported = 0;
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
      imported++;
    });
    save(STORE_TX, transactions);
    e.target.value = '';
    alert(imported+' Buchungen importiert.');
    renderDashboard(); renderAllTable();
  };
  reader.readAsText(file,'utf-8');
});

// ─── Init ─────────────────────────────────────────────────────────────────────

document.getElementById('fDate').value = today();
populateCatSelect();
updateFilterCats();
populateCustomerSelects();
renderDashboard();
showView('dashboard');

'use strict';

// ─── Storage helpers ────────────────────────────────────────────────────────

const STORE_TX   = 'buch_transactions';
const STORE_CATS = 'buch_categories';

const DEFAULT_CATS_EXPENSE = ['Miete', 'Lebensmittel', 'Transport', 'Versicherung', 'Büro', 'Sonstiges'];
const DEFAULT_CATS_INCOME  = ['Lohn', 'Freiberuflich', 'Sonstiges'];

function loadTx()   { return JSON.parse(localStorage.getItem(STORE_TX)   || '[]'); }
function saveTx(d)  { localStorage.setItem(STORE_TX, JSON.stringify(d)); }
function loadCats() {
  const stored = localStorage.getItem(STORE_CATS);
  if (stored) return JSON.parse(stored);
  const cats = {
    expense: [...DEFAULT_CATS_EXPENSE],
    income:  [...DEFAULT_CATS_INCOME],
  };
  saveCats(cats);
  return cats;
}
function saveCats(c) { localStorage.setItem(STORE_CATS, JSON.stringify(c)); }

// ─── State ───────────────────────────────────────────────────────────────────

let transactions = loadTx();
let categories   = loadCats();
let currentType  = 'expense';
let editingId    = null;
let deleteTarget = null;
let monthChart   = null;
let catChart     = null;

// ─── Utilities ───────────────────────────────────────────────────────────────

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmt(amount) {
  return 'CHF ' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function periodFilter(period) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return tx => {
    const d = new Date(tx.date);
    if (period === 'month')   return d.getFullYear() === y && d.getMonth() === m;
    if (period === 'quarter') {
      const q = Math.floor(m / 3);
      return d.getFullYear() === y && Math.floor(d.getMonth() / 3) === q;
    }
    if (period === 'year')    return d.getFullYear() === y;
    return true;
  };
}

// ─── Navigation ──────────────────────────────────────────────────────────────

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.view === name);
  });
  if (name === 'dashboard') renderDashboard();
  if (name === 'transactions') renderAllTable();
  if (name === 'new' && !editingId) resetForm();
}

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => { e.preventDefault(); showView(link.dataset.view); });
});

// ─── Category select helpers ──────────────────────────────────────────────────

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
  const all = [...new Set([...categories.expense, ...categories.income])].sort();
  all.forEach(c => {
    const o = document.createElement('option');
    o.value = o.textContent = c;
    sel.appendChild(o);
  });
  if (cur) sel.value = cur;
}

// ─── Form ─────────────────────────────────────────────────────────────────────

function resetForm() {
  editingId = null;
  document.getElementById('editId').value = '';
  document.getElementById('formTitle').textContent = 'Neue Buchung';
  document.getElementById('submitBtn').textContent = 'Speichern';
  document.getElementById('cancelEdit').style.display = 'none';
  document.getElementById('txForm').reset();
  document.getElementById('fDate').value = today();
  setType('expense');
}

function setType(type) {
  currentType = type;
  document.querySelectorAll('.toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
  populateCatSelect();
}

document.querySelectorAll('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => setType(btn.dataset.type));
});

document.getElementById('newCatBtn').addEventListener('click', () => {
  document.getElementById('catDialog').style.display = 'flex';
  document.getElementById('newCatInput').value = '';
  document.getElementById('newCatInput').focus();
});

document.getElementById('catDialogOk').addEventListener('click', () => {
  const name = document.getElementById('newCatInput').value.trim();
  if (!name) return;
  if (!categories[currentType].includes(name)) {
    categories[currentType].push(name);
    saveCats(categories);
  }
  populateCatSelect();
  document.getElementById('fCat').value = name;
  document.getElementById('catDialog').style.display = 'none';
});

document.getElementById('catDialogCancel').addEventListener('click', () => {
  document.getElementById('catDialog').style.display = 'none';
});

document.getElementById('txForm').addEventListener('submit', e => {
  e.preventDefault();
  const tx = {
    id:       editingId || uid(),
    type:     currentType,
    date:     document.getElementById('fDate').value,
    amount:   parseFloat(document.getElementById('fAmount').value),
    desc:     document.getElementById('fDesc').value.trim(),
    category: document.getElementById('fCat').value,
    note:     document.getElementById('fNote').value.trim(),
  };

  if (editingId) {
    const idx = transactions.findIndex(t => t.id === editingId);
    transactions[idx] = tx;
  } else {
    transactions.unshift(tx);
  }
  saveTx(transactions);
  resetForm();
  showView('transactions');
});

document.getElementById('cancelEdit').addEventListener('click', () => {
  resetForm();
  showView('transactions');
});

// ─── Delete dialog ────────────────────────────────────────────────────────────

function confirmDelete(id) {
  deleteTarget = id;
  document.getElementById('dialog').style.display = 'flex';
}

document.getElementById('dialogConfirm').addEventListener('click', () => {
  transactions = transactions.filter(t => t.id !== deleteTarget);
  saveTx(transactions);
  document.getElementById('dialog').style.display = 'none';
  deleteTarget = null;
  renderAllTable();
  renderDashboard();
});

document.getElementById('dialogCancel').addEventListener('click', () => {
  document.getElementById('dialog').style.display = 'none';
  deleteTarget = null;
});

// ─── Edit ─────────────────────────────────────────────────────────────────────

function editTx(id) {
  const tx = transactions.find(t => t.id === id);
  if (!tx) return;
  editingId = id;
  setType(tx.type);
  document.getElementById('fDate').value   = tx.date;
  document.getElementById('fAmount').value = tx.amount;
  document.getElementById('fDesc').value   = tx.desc;
  document.getElementById('fNote').value   = tx.note || '';
  // ensure category is in list
  if (!categories[tx.type].includes(tx.category)) {
    categories[tx.type].push(tx.category);
    saveCats(categories);
  }
  populateCatSelect();
  document.getElementById('fCat').value = tx.category;
  document.getElementById('formTitle').textContent = 'Buchung bearbeiten';
  document.getElementById('submitBtn').textContent = 'Aktualisieren';
  document.getElementById('cancelEdit').style.display = '';
  showView('new');
}

// ─── Render: All Transactions ─────────────────────────────────────────────────

function renderAllTable() {
  updateFilterCats();
  const search    = document.getElementById('searchInput').value.toLowerCase();
  const typeF     = document.getElementById('filterType').value;
  const catF      = document.getElementById('filterCat').value;
  const periodF   = document.getElementById('filterPeriod').value;
  const pf        = periodFilter(periodF);

  const filtered = transactions.filter(tx => {
    if (typeF && tx.type !== typeF) return false;
    if (catF  && tx.category !== catF) return false;
    if (!pf(tx)) return false;
    if (search && !tx.desc.toLowerCase().includes(search) &&
        !tx.category.toLowerCase().includes(search)) return false;
    return true;
  });

  const tbody = document.querySelector('#allTable tbody');
  tbody.innerHTML = '';
  document.getElementById('emptyState').style.display = filtered.length ? 'none' : 'block';

  filtered.sort((a, b) => b.date.localeCompare(a.date)).forEach(tx => {
    const tr = document.createElement('tr');
    const sign = tx.type === 'income' ? '+' : '-';
    tr.innerHTML = `
      <td>${formatDate(tx.date)}</td>
      <td>${esc(tx.desc)}${tx.note ? '<br><small style="color:#9ca3af">' + esc(tx.note) + '</small>' : ''}</td>
      <td><span class="cat-badge">${esc(tx.category)}</span></td>
      <td class="num amount-${tx.type}">${sign}${fmt(tx.amount)}</td>
      <td style="text-align:right">
        <button class="btn-icon-sm" data-edit="${tx.id}" title="Bearbeiten">✏️</button>
        <button class="btn-icon-sm" data-del="${tx.id}"  title="Löschen">🗑️</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editTx(b.dataset.edit)));
  tbody.querySelectorAll('[data-del]').forEach(b  => b.addEventListener('click', () => confirmDelete(b.dataset.del)));
}

['searchInput','filterType','filterCat','filterPeriod'].forEach(id => {
  document.getElementById(id).addEventListener('input', renderAllTable);
});

// ─── Render: Dashboard ────────────────────────────────────────────────────────

function renderDashboard() {
  const period = document.getElementById('dashPeriod').value;
  const pf = periodFilter(period);
  const filtered = transactions.filter(pf);

  const income  = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;

  document.getElementById('kpiIncome').textContent  = fmt(income);
  document.getElementById('kpiExpense').textContent = fmt(expense);
  document.getElementById('kpiBalance').textContent = fmt(balance);

  // Recent table (last 8)
  const tbody = document.querySelector('#recentTable tbody');
  tbody.innerHTML = '';
  const recent = [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  recent.forEach(tx => {
    const tr = document.createElement('tr');
    const sign = tx.type === 'income' ? '+' : '-';
    tr.innerHTML = `
      <td>${formatDate(tx.date)}</td>
      <td>${esc(tx.desc)}</td>
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

  // Build last N months
  const months = [];
  const now = new Date();
  const n = period === 'year' || period === 'all' ? 12 : period === 'quarter' ? 3 : 6;
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ label: d.toLocaleDateString('de-CH', { month: 'short', year: '2-digit' }), y: d.getFullYear(), m: d.getMonth() });
  }

  const incomeData  = months.map(mo => transactions.filter(t => t.type === 'income'  && new Date(t.date).getFullYear() === mo.y && new Date(t.date).getMonth() === mo.m).reduce((s, t) => s + t.amount, 0));
  const expenseData = months.map(mo => transactions.filter(t => t.type === 'expense' && new Date(t.date).getFullYear() === mo.y && new Date(t.date).getMonth() === mo.m).reduce((s, t) => s + t.amount, 0));

  monthChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: [
        { label: 'Einnahmen', data: incomeData,  backgroundColor: '#22c55e44', borderColor: '#22c55e', borderWidth: 2, borderRadius: 4 },
        { label: 'Ausgaben',  data: expenseData, backgroundColor: '#ef444444', borderColor: '#ef4444', borderWidth: 2, borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: ctx => ' CHF ' + ctx.raw.toFixed(2) } } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => 'CHF ' + v } } },
    },
  });
}

function renderCatChart(filtered) {
  const ctx = document.getElementById('catChart').getContext('2d');
  if (catChart) catChart.destroy();

  const expenses = filtered.filter(t => t.type === 'expense');
  const bycat = {};
  expenses.forEach(t => { bycat[t.category] = (bycat[t.category] || 0) + t.amount; });
  const labels = Object.keys(bycat);
  const data   = labels.map(k => bycat[k]);

  const palette = ['#4f6ef7','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6'];

  catChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: palette.slice(0, labels.length), borderWidth: 2, borderColor: '#fff' }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 12 } } },
        tooltip: { callbacks: { label: ctx => ' CHF ' + ctx.raw.toFixed(2) } },
      },
    },
  });
}

// ─── Export / Import CSV ──────────────────────────────────────────────────────

document.getElementById('exportBtn').addEventListener('click', () => {
  const rows = [['id','type','date','amount','category','desc','note']];
  transactions.forEach(t => rows.push([t.id, t.type, t.date, t.amount, t.category, csvEsc(t.desc), csvEsc(t.note || '')]));
  const csv = rows.map(r => r.join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'buchhaltung.csv'; a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const text = ev.target.result.replace(/^﻿/, '');
    const lines = text.trim().split('\n');
    const header = lines[0].split(';');
    const idx = f => header.indexOf(f);
    let imported = 0;
    lines.slice(1).forEach(line => {
      const cols = line.split(';');
      const id   = cols[idx('id')]?.trim();
      if (!id || transactions.find(t => t.id === id)) return;
      transactions.push({
        id,
        type:     cols[idx('type')]?.trim(),
        date:     cols[idx('date')]?.trim(),
        amount:   parseFloat(cols[idx('amount')]),
        category: cols[idx('category')]?.trim(),
        desc:     cols[idx('desc')]?.trim(),
        note:     cols[idx('note')]?.trim() || '',
      });
      imported++;
    });
    saveTx(transactions);
    e.target.value = '';
    alert(imported + ' Buchungen importiert.');
    renderDashboard();
    renderAllTable();
  };
  reader.readAsText(file, 'utf-8');
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function csvEsc(str) {
  const s = String(str || '');
  return s.includes(';') || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d + '.' + m + '.' + y;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.getElementById('fDate').value = today();
populateCatSelect();
updateFilterCats();
renderDashboard();
showView('dashboard');

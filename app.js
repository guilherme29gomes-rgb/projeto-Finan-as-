'use strict';

// ---------- Dados ----------
const STORAGE_KEY = 'financas.v1';

const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#0891b2',
  '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#be123c', '#a16207', '#6b7280'];

const DEFAULT_CATEGORIES = {
  expense: ['Moradia', 'Alimentação', 'Mercado', 'Transporte', 'Saúde', 'Educação', 'Lazer',
    'Assinaturas', 'Contas (luz, água, internet)', 'Compras', 'Cartão de crédito', 'Outros'],
  income: ['Salário', 'Freelance', 'Investimentos', 'Vendas', 'Outros'],
};

function defaultState() {
  return {
    transactions: [],
    categories: {
      expense: DEFAULT_CATEGORIES.expense.map((name, i) => ({ name, color: PALETTE[i % PALETTE.length] })),
      income: DEFAULT_CATEGORIES.income.map((name, i) => ({ name, color: PALETTE[(i + 2) % PALETTE.length] })),
    },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn('Falha ao ler dados', e); }
  return defaultState();
}

let state = loadState();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Não foi possível salvar neste navegador');
  }
}

// ---------- Utilidades ----------
const $ = (sel) => document.querySelector(sel);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (cents) => brl.format(cents / 100);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function parseAmount(text) {
  let s = String(text).trim().replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : NaN;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthKey(date) { return date.slice(0, 7); }

function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthName(key, short = false) {
  const [y, m] = key.split('-').map(Number);
  const opts = short ? { month: 'short' } : { month: 'long', year: 'numeric' };
  return capitalize(new Date(y, m - 1, 1).toLocaleDateString('pt-BR', opts).replace('.', ''));
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function catColor(type, name) {
  const c = state.categories[type].find((c) => c.name === name);
  return c ? c.color : '#9ca3af';
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- Estado da tela ----------
let currentMonth = monthKey(todayISO());
let editingId = null;

function txOfMonth(key = currentMonth) {
  return state.transactions.filter((t) => monthKey(t.date) === key);
}

function sumBy(list, pred) {
  return list.reduce((acc, t) => (pred(t) ? acc + t.amount : acc), 0);
}

// ---------- Resumo ----------
function renderBreakdown(el, list, type) {
  const totals = {};
  list.filter((t) => t.type === type).forEach((t) => { totals[t.category] = (totals[t.category] || 0) + t.amount; });
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, v]) => a + v, 0);

  if (!entries.length) {
    el.innerHTML = `<li class="empty">Nenhum lançamento neste mês.</li>`;
    return entries;
  }
  el.innerHTML = entries.map(([name, value]) => {
    const pct = total ? (value / total) * 100 : 0;
    const color = catColor(type, name);
    return `<li>
      <div class="row"><span>${escapeHtml(name)}</span><b>${money(value)} · ${pct.toFixed(1).replace('.', ',')}%</b></div>
      <div class="bar"><div style="width:${pct}%;background:${color}"></div></div>
    </li>`;
  }).join('');
  return entries.map(([name, value]) => ({ name, value, pct: (value / total) * 100 }));
}

function renderResumo() {
  const list = txOfMonth();
  const income = sumBy(list, (t) => t.type === 'income');
  const expense = sumBy(list, (t) => t.type === 'expense');
  const fixed = sumBy(list, (t) => t.type === 'expense' && t.nature === 'fixed');
  const variable = expense - fixed;
  const balance = income - expense;

  $('#totIncome').textContent = money(income);
  $('#totExpense').textContent = money(expense);
  $('#totBalance').textContent = money(balance);
  $('#totBalance').classList.toggle('neg', balance < 0);
  $('#totFixed').textContent = money(fixed);
  $('#totVariable').textContent = money(variable);
  $('#fixedBar').style.width = expense ? `${(fixed / expense) * 100}%` : '0';
  $('#varBar').style.width = expense ? `${(variable / expense) * 100}%` : '0';

  const top = renderBreakdown($('#categoryBreakdown'), list, 'expense');
  renderBreakdown($('#incomeBreakdown'), list, 'income');

  const insight = $('#topInsight');
  if (top.length) {
    const first = top[0];
    let msg = `Seu maior gasto está em <b>${escapeHtml(first.name)}</b>: ${first.pct.toFixed(0)}% das saídas.`;
    if (income > 0) msg += ` Você já gastou ${((expense / income) * 100).toFixed(0)}% do que entrou.`;
    insight.innerHTML = msg;
  } else {
    insight.innerHTML = '';
  }

  // Histórico de 6 meses
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(shiftMonth(currentMonth, -i));
  const data = months.map((k) => {
    const l = txOfMonth(k);
    return { k, inc: sumBy(l, (t) => t.type === 'income'), out: sumBy(l, (t) => t.type === 'expense') };
  });
  const max = Math.max(1, ...data.map((d) => Math.max(d.inc, d.out)));
  $('#history').innerHTML = data.map((d) => `
    <div class="col" title="${monthName(d.k)}: entradas ${money(d.inc)}, saídas ${money(d.out)}">
      <div class="bars">
        <div class="in" style="height:${(d.inc / max) * 100}%"></div>
        <div class="out" style="height:${(d.out / max) * 100}%"></div>
      </div>
      <small>${monthName(d.k, true)}</small>
    </div>`).join('');
}

// ---------- Lançamentos ----------
function renderList() {
  const type = $('#filterType').value;
  const cat = $('#filterCategory').value;
  const q = $('#search').value.trim().toLowerCase();

  let list = txOfMonth();
  if (type === 'income' || type === 'expense') list = list.filter((t) => t.type === type);
  if (type === 'fixed' || type === 'variable') list = list.filter((t) => t.type === 'expense' && t.nature === type);
  if (cat) list = list.filter((t) => t.category === cat);
  if (q) list = list.filter((t) => (t.description || '').toLowerCase().includes(q) || t.category.toLowerCase().includes(q));

  list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  if (!list.length) {
    $('#txList').innerHTML = `<p class="muted" style="text-align:center;margin-top:24px">Nenhum lançamento encontrado.<br>Toque em <b>+</b> para registrar.</p>`;
    return;
  }

  let html = '';
  let lastDate = '';
  for (const t of list) {
    if (t.date !== lastDate) {
      lastDate = t.date;
      const [y, m, d] = t.date.split('-').map(Number);
      html += `<li class="tx-day">${capitalize(new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' }))}</li>`;
    }
    const tag = t.type === 'expense'
      ? `<span class="tag ${t.nature}">${t.nature === 'fixed' ? 'fixa' : 'variável'}</span>` : '';
    html += `<li class="tx" data-id="${t.id}">
      <div class="swatch" style="background:${catColor(t.type, t.category)}"></div>
      <div class="info">
        <strong>${escapeHtml(t.description || t.category)}</strong>
        <small>${escapeHtml(t.category)}${tag}</small>
      </div>
      <div class="val ${t.type}">${t.type === 'expense' ? '−' : '+'} ${money(t.amount)}</div>
      <div class="tx-actions"><button data-del="${t.id}" aria-label="Excluir">🗑</button></div>
    </li>`;
  }
  $('#txList').innerHTML = html;
}

function renderCategoryFilter() {
  const sel = $('#filterCategory');
  const current = sel.value;
  const opts = [...state.categories.expense.map((c) => c.name), ...state.categories.income.map((c) => c.name)];
  sel.innerHTML = `<option value="">Todas as categorias</option>` +
    [...new Set(opts)].map((n) => `<option>${escapeHtml(n)}</option>`).join('');
  sel.value = current;
}

// ---------- Ajustes ----------
function renderCategories() {
  for (const kind of ['expense', 'income']) {
    const el = kind === 'expense' ? $('#expenseCats') : $('#incomeCats');
    el.innerHTML = state.categories[kind].map((c, i) => `
      <li><i class="dot" style="background:${c.color}"></i>${escapeHtml(c.name)}
        <button data-kind="${kind}" data-idx="${i}" aria-label="Remover">✕</button></li>`).join('');
  }
}

// ---------- Formulário ----------
function fillCategorySelect(type, selected) {
  const sel = $('#category');
  sel.innerHTML = state.categories[type].map((c) => `<option>${escapeHtml(c.name)}</option>`).join('');
  if (selected) {
    if (![...sel.options].some((o) => o.value === selected)) sel.add(new Option(selected));
    sel.value = selected;
  }
  $('#natureRow').style.display = type === 'expense' ? '' : 'none';
}

function openForm(tx) {
  const form = $('#txForm');
  form.reset();
  editingId = tx ? tx.id : null;
  $('#txTitle').textContent = tx ? 'Editar lançamento' : 'Novo lançamento';
  const type = tx ? tx.type : 'expense';
  form.type.value = type;
  fillCategorySelect(type, tx && tx.category);
  form.date.value = tx ? tx.date : todayISO();
  if (tx) {
    form.amount.value = (tx.amount / 100).toFixed(2).replace('.', ',');
    form.description.value = tx.description || '';
    form.nature.value = tx.nature || 'variable';
  }
  $('#txDialog').showModal();
  setTimeout(() => $('#amount').focus(), 50);
}

function submitForm(e) {
  e.preventDefault();
  const form = e.target;
  const amount = parseAmount(form.amount.value);
  if (!amount || Number.isNaN(amount)) {
    toast('Informe um valor válido');
    form.amount.focus();
    return;
  }
  const type = form.type.value;
  const data = {
    type,
    amount,
    description: form.description.value.trim(),
    category: form.category.value,
    nature: type === 'expense' ? form.nature.value : null,
    date: form.date.value || todayISO(),
  };

  if (editingId) {
    Object.assign(state.transactions.find((t) => t.id === editingId), data);
    toast('Lançamento atualizado');
  } else {
    state.transactions.push({ id: uid(), createdAt: Date.now(), ...data });
    toast(`${type === 'expense' ? 'Gasto' : 'Entrada'} de ${money(amount)} registrado`);
  }
  save();
  currentMonth = monthKey(data.date);
  $('#txDialog').close();
  renderAll();
}

function copyFixedFromPrevious() {
  const prev = shiftMonth(currentMonth, -1);
  const fixed = txOfMonth(prev).filter((t) => t.type === 'expense' && t.nature === 'fixed');
  if (!fixed.length) {
    toast(`Nenhuma despesa fixa em ${monthName(prev)}`);
    return;
  }
  const existing = txOfMonth();
  const [y, m] = currentMonth.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  let added = 0;
  for (const t of fixed) {
    const dup = existing.some((e) => e.type === 'expense' && e.nature === 'fixed' &&
      e.category === t.category && e.description === t.description);
    if (dup) continue;
    const day = Math.min(Number(t.date.slice(8, 10)), lastDay);
    state.transactions.push({
      ...t, id: uid(), createdAt: Date.now(),
      date: `${currentMonth}-${String(day).padStart(2, '0')}`,
    });
    added++;
  }
  save();
  renderAll();
  toast(added ? `${added} despesa(s) fixa(s) copiada(s)` : 'As despesas fixas já estão lançadas');
}

// ---------- Backup ----------
function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportCsv() {
  const header = ['Data', 'Tipo', 'Natureza', 'Categoria', 'Descrição', 'Valor'];
  const rows = [...state.transactions].sort((a, b) => a.date.localeCompare(b.date)).map((t) => [
    t.date, t.type === 'income' ? 'Entrada' : 'Saída',
    t.type === 'expense' ? (t.nature === 'fixed' ? 'Fixa' : 'Variável') : '',
    t.category, t.description || '',
    (t.amount / 100).toFixed(2).replace('.', ','),
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
  download(`financas-${todayISO()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.transactions) || !data.categories) throw new Error('formato');
      if (!confirm('Substituir os dados atuais pelo backup?')) return;
      state = data;
      save();
      renderAll();
      toast('Backup importado');
    } catch {
      toast('Arquivo de backup inválido');
    }
  };
  reader.readAsText(file);
}

// ---------- Render geral ----------
function renderAll() {
  $('#monthLabel').textContent = monthName(currentMonth);
  renderResumo();
  renderCategoryFilter();
  renderList();
  renderCategories();
}

// ---------- Eventos ----------
$('#prevMonth').onclick = () => { currentMonth = shiftMonth(currentMonth, -1); renderAll(); };
$('#nextMonth').onclick = () => { currentMonth = shiftMonth(currentMonth, 1); renderAll(); };

document.querySelectorAll('.tabbar button').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${btn.dataset.view}`));
    window.scrollTo(0, 0);
  };
});

$('#fab').onclick = () => openForm();
$('#cancelTx').onclick = () => $('#txDialog').close();
$('#txForm').addEventListener('submit', submitForm);
document.querySelectorAll('#txForm input[name="type"]').forEach((r) => {
  r.onchange = () => fillCategorySelect(r.value);
});

$('#txList').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    if (confirm('Excluir este lançamento?')) {
      state.transactions = state.transactions.filter((t) => t.id !== del.dataset.del);
      save();
      renderAll();
      toast('Lançamento excluído');
    }
    return;
  }
  const item = e.target.closest('.tx');
  if (item) openForm(state.transactions.find((t) => t.id === item.dataset.id));
});

['#filterType', '#filterCategory'].forEach((s) => $(s).addEventListener('change', renderList));
$('#search').addEventListener('input', renderList);
$('#copyFixed').onclick = copyFixedFromPrevious;

document.querySelectorAll('.inline-form').forEach((form) => {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const kind = form.dataset.kind;
    const name = form.catName.value.trim();
    if (!name) return;
    if (state.categories[kind].some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast('Essa categoria já existe');
      return;
    }
    const used = new Set(state.categories[kind].map((c) => c.color));
    const color = PALETTE.find((p) => !used.has(p)) || PALETTE[state.categories[kind].length % PALETTE.length];
    state.categories[kind].push({ name, color });
    form.reset();
    save();
    renderAll();
  });
});

document.querySelector('#view-config').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-kind]');
  if (!btn) return;
  const { kind, idx } = btn.dataset;
  const cat = state.categories[kind][idx];
  if (confirm(`Remover a categoria "${cat.name}"? Os lançamentos já feitos continuam salvos.`)) {
    state.categories[kind].splice(idx, 1);
    save();
    renderAll();
  }
});

$('#exportJson').onclick = () =>
  download(`financas-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
$('#exportCsv').onclick = exportCsv;
$('#importJson').onchange = (e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; };

// Atalho: abrir direto o formulário via ?novo (usado pelo atalho do app instalado)
if (new URLSearchParams(location.search).has('novo')) setTimeout(() => openForm(), 100);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

renderAll();

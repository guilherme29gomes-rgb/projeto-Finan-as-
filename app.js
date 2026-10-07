'use strict';

// ---------- Dados ----------
const STORAGE_KEY = 'financas.v1';

// Paleta categórica (ordem fixa; as 8 primeiras validadas para daltonismo).
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948',
  '#184f95', '#a8461f', '#0f7a54', '#8a5d00', '#9c3b63', '#6b6a65'];
const OTHER_COLOR = '#b9b8b2';

const DELIVERY = 'Delivery';
const CARD = 'Cartão de crédito';
const SCHEMA_VERSION = 4;
const SNAPSHOT_KEY = `${STORAGE_KEY}.copia-automatica`;

const DEFAULT_CATEGORIES = {
  expense: ['Moradia', 'Alimentação', DELIVERY, 'Mercado', 'Transporte', 'Saúde', 'Educação', 'Lazer',
    'Assinaturas', 'Contas (luz, água, internet)', 'Compras online', 'Compras', 'Cartão de crédito', 'Outros'],
  income: ['Salário', 'Adiantamento salarial', 'Férias', '13º salário', 'Bônus/PLR', 'Freelance', 'Investimentos', 'Vendas', 'Outros'],
};

// Cores fixas das categorias padrão: as mais usadas no cartão (Delivery, Compras online,
// Mercado, Transporte) ficam em tons bem diferentes entre si.
const DEFAULT_COLORS = {
  Moradia: '#2a78d6', 'Alimentação': '#eb6834', [DELIVERY]: '#e87ba4', Mercado: '#1baf7a', Transporte: '#eda100',
  'Saúde': '#008300', 'Educação': '#8a5d00', Lazer: '#e34948', Assinaturas: '#184f95',
  'Contas (luz, água, internet)': '#a8461f', 'Compras online': '#4a3aa7', Compras: '#0f7a54', [CARD]: '#6b6a65', Outros: '#b9b8b2',
};

function defaultState() {
  return {
    version: SCHEMA_VERSION,
    transactions: [],
    recurring: [],
    settings: {},
    rules: {},
    categories: {
      expense: DEFAULT_CATEGORIES.expense.map((name, i) => ({ name, color: DEFAULT_COLORS[name] || PALETTE[i % PALETTE.length] })),
      income: DEFAULT_CATEGORIES.income.map((name, i) => ({ name, color: PALETTE[(i + 2) % PALETTE.length] })),
    },
  };
}

// Os dados ficam no localStorage com a mesma chave desde a primeira versão:
// atualizar o app nunca apaga nada. Antes de qualquer migração guardamos uma cópia.
function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if ((data.version || 1) < SCHEMA_VERSION) {
        localStorage.setItem(`${STORAGE_KEY}.antes-v${SCHEMA_VERSION}`, raw);
      }
      return migrate(data);
    }
  } catch (e) {
    console.warn('Falha ao ler dados', e);
    // Nunca sobrescreve dados que não conseguimos ler: guarda o conteúdo original à parte.
    try { if (raw) localStorage.setItem(`${STORAGE_KEY}.ilegivel.${Date.now()}`, raw); } catch { /* sem espaço */ }
    const snap = readSnapshot();
    if (snap) return migrate(snap.data);
  }
  return defaultState();
}

function readSnapshot() {
  try {
    const s = JSON.parse(localStorage.getItem(SNAPSHOT_KEY));
    return s && s.data && Array.isArray(s.data.transactions) ? s : null;
  } catch { return null; }
}

// Garante que dados antigos ganhem as novidades (ex.: categoria Delivery).
function migrate(s) {
  s.rules = s.rules || {};
  s.settings = s.settings || {};
  for (const name of ['Adiantamento salarial', 'Férias', '13º salário', 'Bônus/PLR']) {
    if (!s.categories.income.some((c) => c.name === name)) {
      const used = new Set(s.categories.income.map((c) => c.color));
      const idx = Math.min(1 + s.categories.income.findIndex((c) => c.name === 'Salário'), s.categories.income.length);
      s.categories.income.splice(Math.max(idx, 0), 0, { name, color: PALETTE.find((p) => !used.has(p)) || '#1baf7a' });
    }
  }
  if (!s.recurring) migrateFixedToRecurring(s);
  s.version = SCHEMA_VERSION;
  if (!s.categories.expense.some((c) => c.name === CARD)) {
    const used = new Set(s.categories.expense.map((c) => c.color));
    s.categories.expense.push({ name: CARD, color: PALETTE.find((p) => !used.has(p)) || '#6b6a65' });
  }
  if (!s.categories.expense.some((c) => c.name === 'Compras online')) {
    const used = new Set(s.categories.expense.map((c) => c.color));
    const idx = s.categories.expense.findIndex((c) => c.name === 'Compras');
    s.categories.expense.splice(idx > -1 ? idx : s.categories.expense.length, 0,
      { name: 'Compras online', color: used.has('#4a3aa7') ? (PALETTE.find((p) => !used.has(p)) || '#9c3b63') : '#4a3aa7' });
  }
  if (!s.categories.expense.some((c) => c.name === DELIVERY)) {
    const used = new Set(s.categories.expense.map((c) => c.color));
    s.categories.expense.splice(2, 0, { name: DELIVERY, color: PALETTE.find((p) => !used.has(p)) || '#e87ba4' });
  }
  return s;
}

// Converte despesas fixas antigas (lançadas mês a mês ou copiadas) em recorrências.
function migrateFixedToRecurring(s) {
  s.recurring = [];
  const groups = {};
  for (const t of s.transactions) {
    if (t.type !== 'expense' || t.nature !== 'fixed' || t.card || t.category === CARD) continue;
    const key = `${t.category}|${normalizeText(t.description)}`;
    (groups[key] = groups[key] || []).push(t);
  }
  for (const list of Object.values(groups)) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const last = list[list.length - 1];
    const rule = {
      id: uid(), description: last.description, category: last.category, amount: last.amount,
      day: Number(last.date.slice(8, 10)), startMonth: monthKey(list[0].date), endMonth: null, skipped: [],
    };
    const had = new Set(list.map((t) => monthKey(t.date)));
    // meses do passado sem lançamento não são inventados
    for (let m = rule.startMonth; m < monthKey(last.date); m = shiftMonth(m, 1)) if (!had.has(m)) rule.skipped.push(m);
    list.forEach((t) => { t.recurringId = rule.id; });
    s.recurring.push(rule);
  }
}


function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    syncBillsForWorker();
    // Cópia automática diária (protege contra erro de digitação/exclusão sem querer)
    const snap = readSnapshot();
    if (!snap || snap.date !== todayISO()) {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ date: todayISO(), data: state }));
    }
  } catch (e) {
    toast('Não foi possível salvar neste navegador');
  }
}

// Se o app estiver aberto em duas abas, uma não apaga o que a outra salvou.
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  try { state = migrate(JSON.parse(e.newValue)); renderAll(); } catch { /* ignora */ }
});

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
function toast(msg, action) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('has-action', !!action);
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { el.classList.remove('show'); action.fn(); };
    el.appendChild(b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2200);
}

// Carrega os dados (depois das utilidades, que a migração usa)
let state = loadState();
save(); // grava já no formato atual (inclusive dados convertidos de versões antigas)

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
    return `<li class="clickable" data-cat="${escapeHtml(name)}" data-cat-type="${type}">
      <div class="row"><span>${escapeHtml(name)} <i class="chev">›</i></span><b>${money(value)} · ${pct.toFixed(1).replace('.', ',')}%</b></div>
      <div class="bar"><div style="width:${pct}%;background:${color}"></div></div>
    </li>`;
  }).join('');
  return entries.map(([name, value]) => ({ name, value, pct: (value / total) * 100 }));
}

function renderResumo() {
  const list = expand(txOfMonth());
  const income = sumBy(list, (t) => t.type === 'income');
  const expense = sumBy(list, (t) => t.type === 'expense');
  const fixed = sumBy(list, (t) => t.type === 'expense' && t.nature === 'fixed');
  const variable = expense - fixed;
  const balance = income - expense;

  $('#totIncome').textContent = money(income);
  const expectedSum = sumBy(txOfMonth(), (t) => t.type === 'income' && t.expected);
  $('#totExpected').textContent = expectedSum ? `+ ${money(expectedSum)} a receber` : '';
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
  const pending = sumBy(list, (t) => t.cardId && t.category === CARD);
  const pend = $('#cardPending');
  pend.hidden = !pending;
  if (pending) {
    const firstCard = list.find((t) => t.cardId && t.category === CARD);
    pend.dataset.card = firstCard.cardId;
    pend.innerHTML = `💳 <b>${money(pending)}</b> da fatura do cartão ainda sem categoria. <u>Detalhar fatura</u>`;
  }

  if (top.length) {
    const first = top[0];
    let msg = `Seu maior gasto está em <b>${escapeHtml(first.name)}</b>: ${first.pct.toFixed(0)}% das saídas.`;
    if (income > 0) msg += ` Você já gastou ${((expense / income) * 100).toFixed(0)}% do que entrou.`;
    insight.innerHTML = msg;
  } else {
    insight.innerHTML = '';
  }

}

// ---------- Insights (gráficos) ----------
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function compactMoney(cents) {
  const v = cents / 100;
  if (Math.abs(v) >= 1000) return `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
}

function pct(n) { return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`; }

// Escala "bonita" para o eixo Y: devolve [máximo, passo]
function niceScale(max, ticks = 4) {
  if (max <= 0) return [100, 25];
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return [step * Math.ceil(max / step), step];
}

function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// Tooltip compartilhado (mouse e toque)
const tip = $('#tooltip');
function showTip(html, ev) {
  tip.innerHTML = html;
  tip.classList.add('show');
  const pad = 12;
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + pad;
  let y = ev.clientY - r.height - pad;
  if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y < 60) y = ev.clientY + pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${y}px`;
}
function hideTip() { tip.classList.remove('show'); }
window.addEventListener('scroll', hideTip, { passive: true });

function tipRow(color, label, value, dashed) {
  const key = color
    ? `<i class="${dashed ? 'line-key dashed' : 'dot'}" style="background:${color}"></i>` : '';
  return `<div class="t-row">${key}${escapeHtml(label)}<b>${value}</b></div>`;
}

// Liga hover/toque: cada elemento com data-tip-idx chama getHtml(idx)
function bindTips(root, getHtml, onIdx) {
  const handler = (ev) => {
    const target = ev.target.closest('[data-tip-idx]');
    if (!target || !root.contains(target)) { hideTip(); onIdx && onIdx(null); return; }
    const idx = Number(target.dataset.tipIdx);
    showTip(getHtml(idx), ev);
    onIdx && onIdx(idx);
  };
  root.onpointermove = handler;
  root.onpointerdown = handler;
  root.onpointerleave = () => { hideTip(); onIdx && onIdx(null); };
}

function chartWidth(el) {
  return Math.max(260, Math.min(el.clientWidth || 340, 680));
}

// Gráfico de barras (agrupadas ou empilhadas), um único eixo Y
function barChart(el, { labels, series, stacked = false, height = 180, tipTitle }) {
  const W = chartWidth(el);
  const H = height;
  const m = { top: 8, right: 4, bottom: 22, left: 52 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
  const rawMax = stacked ? Math.max(0, ...totals) : Math.max(0, ...series.flatMap((s) => s.values));
  const [max, step] = niceScale(rawMax);
  const y = (v) => m.top + ih - (v / max) * ih;
  const band = iw / labels.length;
  const groupW = Math.min(band * 0.7, stacked ? 28 : 40);
  const barW = stacked ? groupW : Math.max(4, (groupW - 2 * (series.length - 1)) / series.length);

  let svg = '';
  for (let v = 0; v <= max; v += step) {
    svg += `<line class="gridline" x1="${m.left}" x2="${W - m.right}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${m.left - 6}" y="${y(v) + 4}" text-anchor="end">${compactMoney(v)}</text>`;
  }
  labels.forEach((lab, i) => {
    const cx = m.left + band * i + band / 2;
    let acc = 0;
    series.forEach((s, j) => {
      const v = s.values[i];
      if (v <= 0) return;
      let x, top, bottom;
      if (stacked) {
        x = cx - barW / 2; bottom = y(acc); acc += v; top = y(acc);
        if (j > 0) bottom -= 2; // espaço de 2px entre segmentos
      } else {
        x = cx - groupW / 2 + j * (barW + 2); bottom = y(0); top = y(v);
      }
      const h = Math.max(1, bottom - top);
      const isTop = !stacked || series.slice(j + 1).every((t) => t.values[i] <= 0);
      const r = isTop ? Math.min(4, barW / 2, h) : 0;
      svg += `<path style="fill:${s.color}" d="M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z"/>`;
    });
    svg += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${escapeHtml(lab)}</text>`;
    svg += `<rect class="hit" data-tip-idx="${i}" x="${m.left + band * i}" y="${m.top}" width="${band}" height="${ih + 4}"/>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img">${svg}</svg>`;
  bindTips(el, (i) => {
    let html = `<div class="t-title">${escapeHtml(tipTitle ? tipTitle(i) : labels[i])}</div>`;
    series.forEach((s) => { html += tipRow(s.color, s.name, money(s.values[i])); });
    if (stacked && series.length > 1) html += tipRow(null, 'Total', money(totals[i]));
    return html;
  });
}

// Linhas de gasto acumulado: mês atual x mês anterior
function paceChart(el, cur, prev, curKey, prevKey) {
  const W = chartWidth(el);
  const H = 190;
  const m = { top: 10, right: 8, bottom: 22, left: 52 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const days = Math.max(cur.length, prev.length);
  const [max, step] = niceScale(Math.max(1, ...cur, ...prev));
  const x = (d) => m.left + (d / (days - 1 || 1)) * iw;
  const y = (v) => m.top + ih - (v / max) * ih;
  const line = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const curColor = 'var(--primary)';

  let svg = '';
  for (let v = 0; v <= max; v += step) {
    svg += `<line class="gridline" x1="${m.left}" x2="${W - m.right}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${m.left - 6}" y="${y(v) + 4}" text-anchor="end">${compactMoney(v)}</text>`;
  }
  [1, 8, 15, 22, days].forEach((d) => {
    svg += `<text x="${x(d - 1)}" y="${H - 6}" text-anchor="middle">${d}</text>`;
  });
  if (prev.length) svg += `<path d="${line(prev)}" style="fill:none;stroke:var(--prev)" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>`;
  if (cur.length) {
    svg += `<path d="${line(cur)}" style="fill:none;stroke:${curColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = cur.length - 1;
    svg += `<circle cx="${x(last)}" cy="${y(cur[last])}" r="4" style="fill:${curColor};stroke:var(--surface)" stroke-width="2"/>`;
  }
  svg += `<g id="paceHover" style="display:none"><line class="hover-line" y1="${m.top}" y2="${m.top + ih}"/>
    <circle class="hc" r="4" style="fill:${curColor};stroke:var(--surface)" stroke-width="2"/>
    <circle class="hp" r="4" style="fill:var(--prev);stroke:var(--surface)" stroke-width="2"/></g>`;
  for (let d = 0; d < days; d++) {
    const w = iw / (days - 1 || 1);
    svg += `<rect class="hit" data-tip-idx="${d}" x="${x(d) - w / 2}" y="${m.top}" width="${w}" height="${ih}"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img">${svg}</svg>`;

  const g = el.querySelector('#paceHover');
  bindTips(el, (d) => {
    let html = `<div class="t-title">Dia ${d + 1}</div>`;
    if (d < cur.length) html += tipRow(curColor, monthName(curKey), money(cur[d]));
    if (d < prev.length) html += tipRow('var(--prev)', monthName(prevKey), money(prev[d]), true);
    return html;
  }, (d) => {
    if (d === null) { g.style.display = 'none'; return; }
    g.style.display = '';
    g.querySelector('line').setAttribute('x1', x(d));
    g.querySelector('line').setAttribute('x2', x(d));
    const hc = g.querySelector('.hc');
    const hp = g.querySelector('.hp');
    hc.style.display = d < cur.length ? '' : 'none';
    hp.style.display = d < prev.length ? '' : 'none';
    if (d < cur.length) { hc.setAttribute('cx', x(d)); hc.setAttribute('cy', y(cur[d])); }
    if (d < prev.length) { hp.setAttribute('cx', x(d)); hp.setAttribute('cy', y(prev[d])); }
  });

  $('#paceLegend').innerHTML =
    `<li><i class="line-key" style="background:${curColor}"></i>${monthName(curKey)}</li>` +
    `<li><i class="line-key dashed"></i>${monthName(prevKey)}</li>`;
}

function donutChart(el, legendEl, items, total) {
  if (!items.length) {
    el.innerHTML = '';
    legendEl.innerHTML = `<li class="empty-msg">Nenhum gasto neste mês.</li>`;
    return;
  }
  const R = 80, r = 54, C = 84;
  let a0 = -Math.PI / 2;
  const gap = items.length > 1 ? 0.025 : 0;
  const arc = (a, rad) => [C + rad * Math.cos(a), C + rad * Math.sin(a)];
  let paths = '';
  items.forEach((it, i) => {
    const sweep = (it.value / total) * Math.PI * 2;
    const s = a0 + gap / 2;
    const e = a0 + sweep - gap / 2;
    a0 += sweep;
    if (sweep >= Math.PI * 2 - 0.001) {
      paths += `<path data-tip-idx="${i}" fill="${it.color}" fill-rule="evenodd" d="M${C - R},${C} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0 M${C - r},${C} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0"/>`;
      return;
    }
    if (e <= s) return;
    const large = e - s > Math.PI ? 1 : 0;
    const [x1, y1] = arc(s, R), [x2, y2] = arc(e, R), [x3, y3] = arc(e, r), [x4, y4] = arc(s, r);
    paths += `<path data-tip-idx="${i}" fill="${it.color}" d="M${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${large} 0 ${x4},${y4} Z"/>`;
  });
  el.innerHTML = `<svg viewBox="0 0 168 168" role="img" aria-label="Gastos por categoria">${paths}
    <text x="${C}" y="${C - 4}" text-anchor="middle" font-size="11" style="fill:var(--text-2)">Total</text>
    <text x="${C}" y="${C + 14}" text-anchor="middle" font-size="15" font-weight="700" style="fill:var(--text)">${compactMoney(total)}</text></svg>`;
  legendEl.innerHTML = items.map((it, i) => `<li data-tip-idx="${i}" ${it.other ? '' : `class="clickable" data-cat="${escapeHtml(it.name)}"`}><i class="dot" style="background:${it.color}"></i>
    <span class="name">${escapeHtml(it.name)}</span><b>${money(it.value)}</b><em>${pct((it.value / total) * 100)}</em></li>`).join('');
  const html = (i) => `<div class="t-title">${escapeHtml(items[i].name)}</div>` +
    tipRow(items[i].color, 'Valor', money(items[i].value)) +
    tipRow(null, 'Participação', pct((items[i].value / total) * 100));
  bindTips(el, html);
  el.onclick = (e) => {
    const seg = e.target.closest('[data-tip-idx]');
    if (seg && !items[seg.dataset.tipIdx].other) openCategory(items[seg.dataset.tipIdx].name);
  };
}

function kpi(label, value, sub = '') {
  return `<div class="kpi"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
}

function renderInsights() {
  renderCardsHistory();
  const list = expand(txOfMonth());
  const expenses = list.filter((t) => t.type === 'expense');
  const income = sumBy(list, (t) => t.type === 'income');
  const spent = sumBy(expenses, () => true);
  const nDays = daysInMonth(currentMonth);
  const today = todayISO();
  const isCurrent = currentMonth === monthKey(today);
  const isFuture = currentMonth > monthKey(today);
  const elapsed = isCurrent ? Number(today.slice(8, 10)) : nDays;
  const prevKey = shiftMonth(currentMonth, -1);
  const prevList = expand(txOfMonth(prevKey)).filter((t) => t.type === 'expense');
  const prevSpent = sumBy(prevList, () => true);

  // KPIs — a média usa só gastos variáveis já ocorridos; as fixas entram inteiras na projeção
  const toDate = isCurrent ? expenses.filter((t) => t.date <= today) : expenses;
  const variableToDate = sumBy(toDate, (t) => t.nature !== 'fixed');
  const fixedTotal = sumBy(expenses, (t) => t.nature === 'fixed');
  const avg = elapsed ? variableToDate / elapsed : 0;
  const saving = income ? ((income - spent) / income) * 100 : null;
  const diff = prevSpent ? ((spent - prevSpent) / prevSpent) * 100 : null;
  $('#kpis').innerHTML = [
    kpi('Gasto variável por dia', money(Math.round(avg)), isCurrent ? `média até o dia ${elapsed}` : `média em ${nDays} dias`),
    isCurrent
      ? kpi('Projeção para o mês', money(Math.max(spent, Math.round(fixedTotal + avg * nDays))), 'fixas + variáveis no ritmo atual')
      : kpi('Total gasto no mês', money(spent), diff === null ? '' : `${diff >= 0 ? '+' : ''}${pct(diff)} vs mês anterior`),
    kpi('Quanto sobrou', saving === null ? '—' : pct(saving), saving === null ? 'sem entradas no mês' : `${money(income - spent)} das entradas`),
    kpi('Lançamentos', String(expenses.length), `${list.length - expenses.length} entrada(s)`),
  ].join('');

  // Donut por categoria (as 6 maiores + "Outras")
  const byCat = {};
  expenses.forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value, color: catColor('expense', name) }));
  let items = sorted;
  if (sorted.length > 7) {
    const rest = sorted.slice(6).reduce((a, it) => a + it.value, 0);
    items = [...sorted.slice(0, 6), { name: `Outras (${sorted.length - 6})`, value: rest, color: OTHER_COLOR, other: true }];
  }
  donutChart($('#donut'), $('#donutLegend'), items, spent);

  // Ritmo de gastos (acumulado por dia)
  const cumulative = (txs, key, upTo) => {
    const daily = new Array(daysInMonth(key)).fill(0);
    txs.forEach((t) => { daily[Number(t.date.slice(8, 10)) - 1] += t.amount; });
    let acc = 0;
    return daily.slice(0, upTo).map((v) => (acc += v));
  };
  paceChart($('#paceChart'),
    isFuture ? [] : cumulative(expenses, currentMonth, elapsed),
    cumulative(prevList, prevKey, daysInMonth(prevKey)),
    currentMonth, prevKey);

  // Delivery
  const deliv = expenses.filter((t) => t.category === DELIVERY);
  const dTotal = sumBy(deliv, () => true);
  const dFees = deliv.reduce((a, t) => a + (t.fee || 0), 0);
  const dPrev = sumBy(prevList, (t) => t.category === DELIVERY);
  $('#deliveryKpis').innerHTML = [
    kpi('Gasto com delivery', money(dTotal)),
    kpi('Pedidos', String(deliv.length)),
    kpi('Ticket médio', deliv.length ? money(Math.round(dTotal / deliv.length)) : '—'),
    kpi('Taxas de entrega', money(dFees), dTotal ? `${pct((dFees / dTotal) * 100)} do gasto com delivery` : ''),
  ].join('');
  const food = sumBy(expenses, (t) => ['Alimentação', DELIVERY, 'Mercado'].includes(t.category));
  let dMsg = '';
  if (dTotal) {
    dMsg = `Delivery representa <b>${pct((dTotal / spent) * 100)}</b> das suas saídas`;
    if (food > dTotal) dMsg += ` e <b>${pct((dTotal / food) * 100)}</b> do que você gasta com comida`;
    dMsg += '.';
    if (dPrev) {
      const dd = ((dTotal - dPrev) / dPrev) * 100;
      dMsg += ` Em relação ao mês anterior: <b>${dd >= 0 ? '+' : ''}${pct(dd)}</b>.`;
    }
  } else {
    dMsg = 'Nenhum delivery registrado neste mês. Use a categoria <b>Delivery</b> ao lançar pedidos (iFood, Rappi etc.).';
  }
  $('#deliveryInsight').innerHTML = dMsg;

  const months = [];
  for (let i = 5; i >= 0; i--) months.push(shiftMonth(currentMonth, -i));
  const monthTx = months.map((k) => expand(txOfMonth(k)));
  const dColor = catColor('expense', DELIVERY);
  barChart($('#deliveryChart'), {
    labels: months.map((k) => monthName(k, true)),
    series: [
      { name: 'Pedidos (sem taxa)', color: dColor, values: monthTx.map((l) => l.filter((t) => t.type === 'expense' && t.category === DELIVERY).reduce((a, t) => a + t.amount - (t.fee || 0), 0)) },
      { name: 'Taxas de entrega', color: '#4a3aa7', values: monthTx.map((l) => l.filter((t) => t.type === 'expense' && t.category === DELIVERY).reduce((a, t) => a + (t.fee || 0), 0)) },
    ],
    stacked: true,
    height: 160,
    tipTitle: (i) => monthName(months[i]),
  });

  // Comparação com o mês anterior
  const prevByCat = {};
  prevList.forEach((t) => { prevByCat[t.category] = (prevByCat[t.category] || 0) + t.amount; });
  const cats = [...new Set([...Object.keys(byCat), ...Object.keys(prevByCat)])]
    .map((name) => ({ name, now: byCat[name] || 0, before: prevByCat[name] || 0 }))
    .sort((a, b) => Math.abs(b.now - b.before) - Math.abs(a.now - a.before));
  $('#compareList').innerHTML = cats.length ? cats.map((c) => {
    const d = c.now - c.before;
    const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'same';
    const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '=';
    return `<li class="clickable" data-cat="${escapeHtml(c.name)}"><span class="name"><i class="dot" style="background:${catColor('expense', c.name)}"></i>${escapeHtml(c.name)}</span>
      <span class="val">${compactMoney(c.now)}</span>
      <span class="delta ${cls}">${arrow} ${d ? money(Math.abs(d)) : ''}</span></li>`;
  }).join('') : `<li class="empty-msg">Sem gastos neste mês nem no anterior.</li>`;

  // Entradas x Saídas
  barChart($('#historyChart'), {
    labels: months.map((k) => monthName(k, true)),
    series: [
      { name: 'Entradas', color: 'var(--income)', values: monthTx.map((l) => sumBy(l, (t) => t.type === 'income')) },
      { name: 'Saídas', color: 'var(--expense)', values: monthTx.map((l) => sumBy(l, (t) => t.type === 'expense')) },
    ],
    tipTitle: (i) => monthName(months[i]),
  });

  // Dia da semana
  const wd = new Array(7).fill(0);
  const wdCount = new Array(7).fill(0);
  expenses.forEach((t) => {
    const [y, mo, d] = (t.purchaseDate || t.date).split('-').map(Number);
    const w = new Date(y, mo - 1, d).getDay();
    wd[w] += t.amount;
    wdCount[w]++;
  });
  barChart($('#weekdayChart'), {
    labels: WEEKDAYS,
    series: [{ name: 'Gasto', color: 'var(--primary)', values: wd }],
    height: 150,
    tipTitle: (i) => `${WEEKDAYS[i]} · ${wdCount[i]} lançamento(s)`,
  });

  // Maiores gastos
  const top = [...expenses].sort((a, b) => b.amount - a.amount).slice(0, 5);
  $('#topExpenses').innerHTML = top.length ? top.map((t) => {
    const [, mo, d] = (t.purchaseDate || t.date).split('-');
    return `<li><div class="info"><strong>${escapeHtml(t.description || t.category)}</strong>
      <small>${escapeHtml(t.category)} · ${d}/${mo}${t.cardId ? ' · 💳' : ''}</small></div><span class="amt">${money(t.amount)}</span></li>`;
  }).join('') : `<li class="empty-msg">Nenhum gasto neste mês.</li>`;
}

// ---------- Fatura do cartão ----------
// Uma fatura é um lançamento de saída na categoria "Cartão de crédito" com o valor total.
// Dentro dela ficam os itens (compras), cada um com sua categoria. Nos resumos e gráficos
// a fatura é "aberta": cada item conta na sua categoria e só a parte não detalhada fica
// como "Cartão de crédito".

// Regras automáticas: palavra-chave na descrição -> categoria (e se é fixa).
// A ordem importa: as mais específicas vêm antes (ex.: "uber eats" antes de "uber").
const CARD_RULES = [
  [DELIVERY, ['ifood', 'ifd*', 'rappi', 'uber eats', 'ubereats', 'aiqfome', 'ze delivery', 'zedelivery', 'james delivery', '99food', 'delivery']],
  ['Assinaturas', ['netflix', 'spotify', 'amazon prime', 'primevideo', 'prime video', 'disney', 'hbo', 'max.com', 'globoplay', 'youtube', 'google one', 'google storage', 'apple.com', 'apple com', 'icloud', 'deezer', 'paramount', 'crunchyroll', 'chatgpt', 'openai', 'claude.ai', 'anthropic', 'microsoft', 'xbox', 'playstation', 'psn', 'smart fit', 'smartfit', 'gympass', 'wellhub', 'totalpass', 'mubi', 'tidal', 'kindle unltd', 'audible'], true],
  ['Transporte', ['uber', '99app', '99 app', '99pop', '99 pop', '99 taxi', 'cabify', 'indriver', 'posto', 'shell', 'ipiranga', 'petrobras', 'br mania', 'combust', 'estacion', 'sem parar', 'semparar', 'conectcar', 'veloe', 'pedagio', 'metro', 'bilhete unico', 'cptm', 'buser', 'clickbus', 'zul digital']],
  ['Compras online', ['mercadolivre', 'mercado livre', 'meli', 'mercado pago', 'amazon', 'amzn', 'shopee', 'shein', 'aliexpress', 'temu', 'magalu', 'magazine luiza', 'americanas.com', 'netshoes', 'kabum', 'dafiti', 'zattini', 'submarino', 'olist', 'pagseguro', 'paypal', 'hotmart', 'online', '.com']],
  ['Compras', ['mercadolivre', 'mercado livre', 'meli', 'amazon', 'amzn', 'shopee', 'shein', 'aliexpress', 'magalu', 'magazine luiza', 'americanas', 'casas bahia', 'renner', 'riachuelo', 'c&a', 'cea ', 'zara', 'centauro', 'netshoes', 'kabum', 'leroy', 'decathlon', 'nike', 'adidas', 'havan', 'tok&stok', 'tokstok', 'ikea', 'temu']],
  ['Mercado', ['supermerc', 'mercado', 'carrefour', 'assai', 'atacad', 'pao de acucar', 'paodeacucar', 'extra hiper', 'hortifruti', 'sacolao', 'sams club', 'makro', 'oba horti', 'st marche', 'zaffari', 'guanabara', 'prezunic', 'mambo', 'dia brasil', 'emporio', 'acougue', 'hiper']],
  ['Alimentação', ['restaurante', 'rest ', 'lanchonete', 'lanches', 'padaria', 'panific', 'burger', 'mcdonald', 'mc donald', 'bk brasil', 'burger king', 'subway', 'starbucks', 'cafe', 'cafeteria', 'pizzaria', 'pizza', 'sushi', 'outback', 'coco bambu', 'habib', 'spoleto', 'giraffas', 'madero', 'churrasc', 'bar ', 'boteco', 'sorvet', 'acai', 'doceria', 'food']],
  ['Saúde', ['farmacia', 'drogasil', 'droga raia', 'drogaraia', 'raia', 'drogaria', 'pague menos', 'panvel', 'pacheco', 'hospital', 'clinica', 'laborat', 'odonto', 'unimed', 'amil', 'sulamerica', 'bradesco saude', 'dr consulta', 'fleury', 'dasa', 'otica']],
  ['Educação', ['udemy', 'alura', 'coursera', 'escola', 'colegio', 'faculdade', 'universidade', 'curso', 'livraria', 'saraiva', 'duolingo', 'hotmart']],
  ['Lazer', ['cinema', 'cinemark', 'kinoplex', 'ingresso', 'sympla', 'eventim', 'ticket', 'steam', 'show', 'teatro', 'parque', 'airbnb', 'booking', 'hotel', 'pousada', 'decolar', 'latam', 'gol linhas', 'azul linhas', 'voeazul', '123milhas', 'nintendo', 'epic games']],
  ['Contas (luz, água, internet)', ['vivo', 'claro', 'tim ', 'oi fibra', 'net servicos', 'enel', 'sabesp', 'cemig', 'light s', 'copel', 'comgas', 'celesc', 'cpfl', 'embasa', 'compesa', 'sanepar', 'energia', 'telefonica']],
  ['Moradia', ['condominio', 'aluguel', 'quintoandar', 'quinto andar', 'imobiliaria']],
];

function normalizeText(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Chave do estabelecimento, usada para "aprender" a categoria escolhida pelo usuário.
function merchantKey(desc) {
  return normalizeText(desc)
    .replace(/parcela\s*\d+\s*(de|\/)\s*\d+/g, ' ')
    .replace(/\d+\s*\/\s*\d+/g, ' ')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

function hasCategory(name) {
  return state.categories.expense.some((c) => c.name === name);
}

function classify(desc) {
  const key = merchantKey(desc);
  const learned = state.rules && state.rules[key];
  if (learned && hasCategory(learned.category)) return { ...learned, auto: true };
  const text = ` ${normalizeText(desc)} `;
  for (const [category, words, fixed] of CARD_RULES) {
    if (!hasCategory(category)) continue;
    if (words.some((w) => text.includes(w))) return { category, nature: fixed ? 'fixed' : 'variable', auto: true };
  }
  return { category: CARD, nature: 'variable', auto: false };
}

function installmentOf(desc) {
  const m = normalizeText(desc).match(/(?:parcela\s*)?(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})(?!\d)/);
  if (!m) return null;
  const [n, total] = [Number(m[1]), Number(m[2])];
  return n >= 1 && total >= 2 && n <= total && total <= 48 ? `${n}/${total}` : null;
}

let openCardId = null;

function cardTx() { return state.transactions.find((t) => t.id === openCardId); }

function ensureCard(tx) {
  if (!tx.card) tx.card = { items: [] };
  return tx.card;
}

// Nome do cartão = descrição da fatura (ex.: "Nubank"). Agrupa ignorando maiúsculas/acentos.
function cardName(tx) { return (tx.description || 'Cartão').trim(); }

function cardsSummary(months) {
  const map = new Map();
  for (const m of months) {
    for (const t of txOfMonth(m)) {
      if (!(t.type === 'expense' && t.card)) continue;
      const key = normalizeText(cardName(t));
      if (!map.has(key)) map.set(key, { name: cardName(t), total: 0, byCat: {}, faturas: [], topByMonth: {} });
      const c = map.get(key);
      const { items, remainder } = cardStats(t);
      c.total += t.amount;
      c.faturas.push(t.id);
      const monthCats = {};
      items.forEach((it) => {
        const cat = it.category === CARD ? 'Sem categoria' : it.category;
        c.byCat[cat] = (c.byCat[cat] || 0) + it.amount;
        monthCats[cat] = (monthCats[cat] || 0) + it.amount;
      });
      if (remainder > 0) c.byCat['Falta lançar'] = (c.byCat['Falta lançar'] || 0) + remainder;
      const top = Object.entries(monthCats).sort((a, b) => b[1] - a[1])[0];
      if (top) c.topByMonth[m] = top[0];
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function segColor(name) {
  if (name === 'Falta lançar') return OTHER_COLOR;
  if (name === 'Sem categoria') return '#f3c44b';
  return catColor('expense', name);
}

// Bloco de um cartão: barra empilhada por categoria + as principais categorias
function cardBlock(c, i, segs, extraFoot = '', months = 1) {
  const base = Object.values(c.byCat).reduce((a, v) => a + Math.max(0, v), 0) || 1;
  const entries = Object.entries(c.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const real = entries.filter(([n]) => n !== 'Falta lançar' && n !== 'Sem categoria');
  let insight;
  if (real.length) {
    const [n1, v1] = real[0];
    insight = `Você mais gasta com <b>${escapeHtml(n1)}</b> neste cartão: <b>${pct((v1 / base) * 100)}</b>`;
    if (real[1]) insight += `, depois <b>${escapeHtml(real[1][0])}</b> (${pct((real[1][1] / base) * 100)})`;
    insight += '.';
  } else {
    insight = 'Adicione os gastos da fatura para ver as categorias deste cartão.';
  }
  const bar = entries.map(([name, v]) => {
    segs.push({ card: c.name, name, v, p: (v / base) * 100 });
    return `<div data-tip-idx="${segs.length - 1}" style="width:${(v / base) * 100}%;background:${segColor(name)}"></div>`;
  }).join('');
  const legend = entries.slice(0, 4).map(([name, v]) => `<li ${name === 'Falta lançar' ? '' : `class="clickable" data-cat="${escapeHtml(name === 'Sem categoria' ? CARD : name)}" data-card="${escapeHtml(c.name)}" data-months="${months}"`}><i class="dot" style="background:${segColor(name)}"></i>
    <span class="name">${escapeHtml(name)}</span><b>${money(v)}</b><em>${pct((v / base) * 100)}</em></li>`).join('');
  const more = entries.length > 4 ? `<li class="muted" style="font-size:.78rem">+ ${entries.length - 4} outra(s) categoria(s)</li>` : '';
  return `<div class="cc" data-open-card="${c.faturas[c.faturas.length - 1]}">
    <div class="cc-head"><strong>💳 ${escapeHtml(c.name)}</strong><b>${money(c.total)}</b></div>
    <p class="cc-insight">${insight}</p>
    <div class="stack-bar">${bar}</div>
    <ul class="cc-legend">${legend}${more}</ul>
    ${extraFoot}
  </div>`;
}

function bindCardTips(root, segs) {
  bindTips(root, (i) => `<div class="t-title">${escapeHtml(segs[i].card)}</div>` +
    tipRow(segColor(segs[i].name), segs[i].name, money(segs[i].v)) + tipRow(null, 'Participação', pct(segs[i].p)));
}

function renderCardsMonth() {
  const cards = cardsSummary([currentMonth]);
  $('#cardsPanel').hidden = !cards.length;
  if (!cards.length) return;
  const segs = [];
  $('#cardsList').innerHTML = cards.map((c, i) => cardBlock(c, i, segs)).join('');
  bindCardTips($('#cardsList'), segs);
}

function renderCardsHistory() {
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(shiftMonth(currentMonth, -i));
  const cards = cardsSummary(months);
  $('#cardsHistoryPanel').hidden = !cards.length;
  if (!cards.length) return;
  const segs = [];
  $('#cardsHistory').innerHTML = cards.map((c, i) => {
    const tops = Object.values(c.topByMonth);
    const counts = {};
    tops.forEach((n) => { counts[n] = (counts[n] || 0) + 1; });
    const lead = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const foot = lead && tops.length > 1
      ? `<p class="cc-foot">${escapeHtml(lead[0])} foi a maior categoria em <b>${lead[1]} de ${tops.length}</b> fatura(s) · média de ${money(Math.round(c.total / c.faturas.length))} por fatura</p>`
      : `<p class="cc-foot">${c.faturas.length} fatura(s) no período</p>`;
    return cardBlock(c, i, segs, foot, 6);
  }).join('');
  bindCardTips($('#cardsHistory'), segs);
}

function cardStats(tx) {
  const items = (tx.card && tx.card.items) || [];
  const detailed = items.reduce((a, it) => a + it.amount, 0);
  const classified = items.filter((it) => it.category !== CARD).reduce((a, it) => a + it.amount, 0);
  return { items, detailed, classified, remainder: tx.amount - detailed };
}

// Abre as faturas em seus itens para os resumos e gráficos.
function expand(list) {
  const out = [];
  for (const t of list) {
    if (t.expected) continue; // entrada prevista ainda não recebida: fica fora dos totais reais
    if (!(t.type === 'expense' && t.card && t.card.items.length)) { out.push(t); continue; }
    const { remainder } = cardStats(t);
    for (const it of t.card.items) {
      out.push({ ...it, type: 'expense', date: t.date, purchaseDate: it.date, cardId: t.id, nature: it.nature || 'variable' });
    }
    if (remainder > 0) {
      out.push({ id: `${t.id}-rest`, type: 'expense', category: CARD, amount: remainder, nature: t.nature,
        date: t.date, description: `${t.description || 'Fatura'} (falta lançar)`, cardId: t.id });
    }
  }
  return out;
}

function expenseOptions(selected, withPlaceholder) {
  const names = state.categories.expense.map((c) => c.name).filter((n) => n !== CARD);
  if (selected && selected !== CARD && !names.includes(selected)) names.push(selected);
  const head = withPlaceholder || selected === CARD
    ? `<option value="" ${!selected || selected === CARD ? 'selected' : ''} disabled>Escolha a categoria</option>` : '';
  return head + names.map((n) => `<option${n === selected ? ' selected' : ''} value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
}

function openCard(id) {
  openCardId = id;
  ensureCard(cardTx());
  renderCard();
  if (!$('#cardDialog').open) $('#cardDialog').showModal();
}

function renderCard() {
  const tx = cardTx();
  if (!tx) return;
  const { items, detailed, classified, remainder } = cardStats(tx);
  const [y, m, d] = tx.date.split('-');
  $('#cardTitle').textContent = tx.description || 'Fatura do cartão';
  $('#cardSub').textContent = `Lançada em ${d}/${m}/${y}`;
  $('#cardTotal').textContent = money(tx.amount);
  $('#cardDone').textContent = money(detailed);
  const prog = tx.amount ? Math.min(100, (detailed / tx.amount) * 100) : 0;
  $('#cardProgress').style.width = `${prog}%`;
  $('#cardProgress').parentElement.classList.toggle('over', remainder < 0);

  const todo = items.filter((it) => it.category === CARD);
  let status;
  if (remainder > 0) {
    status = `<span class="big">Falta lançar ${money(remainder)}</span>${items.length ? 'Continue adicionando os gastos da fatura.' : 'Toque em “Adicionar gasto da fatura” para começar.'}`;
  } else if (remainder < 0) {
    status = `<span class="big">${money(-remainder)} acima do total</span>Os gastos lançados passam do valor da fatura. Confira os valores.`;
  } else {
    status = '<span class="big">✅ Fatura completa</span>Os gastos lançados fecham com o total.';
  }
  if (todo.length) status += ` ${todo.length} gasto(s) sem categoria.`;
  $('#cardStatus').innerHTML = status;
  const useSum = $('#useSum');
  useSum.hidden = remainder >= 0;
  useSum.textContent = `Corrigir o total da fatura para ${money(detailed)}`;

  // Racional: para onde foi o dinheiro da fatura
  const byCat = {};
  items.forEach((it) => { byCat[it.category] = (byCat[it.category] || 0) + it.amount; });
  if (remainder > 0 && items.length) byCat['Falta lançar'] = remainder;
  const base = Math.max(tx.amount, detailed);
  const entries = Object.entries(byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  $('#cardBreakdown').innerHTML = entries.length ? entries.map(([name, value]) => {
    const p = (value / base) * 100;
    const label = name === CARD ? 'Sem categoria' : name;
    const color = name === 'Falta lançar' ? OTHER_COLOR : name === CARD ? '#f3c44b' : catColor('expense', name);
    return `<li><div class="row"><span>${escapeHtml(label)}</span><b>${money(value)} · ${p.toFixed(1).replace('.', ',')}%</b></div>
      <div class="bar"><div style="width:${p}%;background:${color}"></div></div></li>`;
  }).join('') : `<li class="empty">Sem itens ainda.</li>`;

  const real = entries.filter(([n]) => n !== CARD && n !== 'Falta lançar');
  let insight = '';
  if (real.length) {
    const [topName, topVal] = real[0];
    insight = `A maior parte da fatura foi para <b>${escapeHtml(topName)}</b> (${pct((topVal / base) * 100)}).`;
    if (real[1]) insight += ` Depois vem <b>${escapeHtml(real[1][0])}</b> (${pct((real[1][1] / base) * 100)}).`;
  }
  $('#cardInsight').innerHTML = insight;

  const parcelas = items.filter((it) => it.installment);
  const fixed = items.filter((it) => it.nature === 'fixed' && it.amount > 0);
  const credits = items.filter((it) => it.amount < 0);
  const purchases = items.filter((it) => it.amount > 0);
  const facts = [];
  if (items.length) {
    facts.push(kpi('Classificado', pct(base ? (classified / base) * 100 : 0), `${money(classified)} com categoria`));
    facts.push(kpi('Compras', String(purchases.length), purchases.length ? `média ${money(Math.round(purchases.reduce((a, it) => a + it.amount, 0) / purchases.length))}` : ''));
    facts.push(kpi('Parcelados', money(parcelas.reduce((a, it) => a + it.amount, 0)), `${parcelas.length} compra(s) em parcelas`));
    facts.push(kpi('Fixos no cartão', money(fixed.reduce((a, it) => a + it.amount, 0)), `${fixed.length} assinatura(s)/fixo(s)`));
    if (credits.length) facts.push(kpi('Estornos/créditos', money(-credits.reduce((a, it) => a + it.amount, 0)), `${credits.length} lançamento(s)`));
  }
  $('#cardFacts').innerHTML = facts.join('');

  // Itens
  const shown = items.slice().sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
  $('#itemCount').textContent = `(${items.length})`;
  $('#cardItems').innerHTML = shown.length ? shown.map((it) => {
    const [, im, idd] = it.date.split('-');
    return `<li class="${it.category === CARD ? 'todo' : ''}" data-item="${it.id}">
      <div class="info"><strong>${escapeHtml(it.description || 'Sem descrição')}</strong>
        <small>${idd}/${im}${it.installment ? ` · parcela ${it.installment}` : ''}</small></div>
      <div class="amt ${it.amount < 0 ? 'credit' : ''}">${it.amount < 0 ? '+ ' : ''}${money(Math.abs(it.amount))}</div>
      <div class="controls">
        <select data-item-cat>${expenseOptions(it.category)}</select>
        <button data-item-nature class="${it.nature === 'fixed' ? 'fixed' : ''}">${it.nature === 'fixed' ? 'fixa' : 'variável'}</button>
        <button data-item-del class="del" aria-label="Remover item">✕</button>
      </div></li>`;
  }).join('') : `<li class="empty-msg">Nenhum gasto lançado ainda.</li>`;
}

function setItemCategory(itemId, category) {
  const tx = cardTx();
  const item = tx.card.items.find((it) => it.id === itemId);
  if (!item) return;
  item.category = category;
  if (category === 'Assinaturas') item.nature = 'fixed';
  // Aprende: próximas compras do mesmo estabelecimento já vêm classificadas
  const key = merchantKey(item.description);
  let same = 0;
  if (key && category !== CARD) {
    state.rules = state.rules || {};
    state.rules[key] = { category, nature: item.nature };
    for (const t of state.transactions) {
      if (!t.card) continue;
      for (const it of t.card.items) {
        if (it !== item && it.category === CARD && merchantKey(it.description) === key) {
          it.category = category;
          it.nature = item.nature;
          same++;
        }
      }
    }
  }
  save();
  renderCard();
  renderAll();
  if (same) toast(`Também classifiquei ${same} compra(s) igual(is) como ${category}`);
}

// ---------- Despesas fixas mensais (recorrências) ----------
// Cada despesa fixa é uma regra que gera um lançamento por mês, do mês em que foi criada
// até o mês em que foi encerrada. Encerrar remove só os meses seguintes; o passado fica.
function recurringDate(rule, month) {
  return `${month}-${String(Math.min(rule.day, daysInMonth(month))).padStart(2, '0')}`;
}

function ensureRecurring(upTo) {
  let changed = false;
  for (const rule of state.recurring) {
    const last = rule.endMonth && rule.endMonth < upTo ? rule.endMonth : upTo;
    for (let m = rule.startMonth; m <= last; m = shiftMonth(m, 1)) {
      if (rule.skipped.includes(m)) continue;
      if (state.transactions.some((t) => t.recurringId === rule.id && monthKey(t.date) === m)) continue;
      const isIncome = rule.type === 'income';
      state.transactions.push({
        id: uid(), createdAt: Date.now(), type: isIncome ? 'income' : 'expense', amount: rule.amount, description: rule.description,
        category: rule.category, nature: isIncome ? null : 'fixed', date: recurringDate(rule, m), fee: null, recurringId: rule.id,
        ...(isIncome ? { expected: true } : {}),
      });
      changed = true;
    }
  }
  if (changed) save();
}

function recurringHorizon() {
  const real = monthKey(todayISO());
  return currentMonth > real ? currentMonth : real;
}

// Encerra a recorrência: o último mês com a despesa passa a ser `lastMonth`.
function endRecurring(rule, lastMonth) {
  state.transactions = state.transactions.filter((t) => !(t.recurringId === rule.id && monthKey(t.date) > lastMonth));
  if (lastMonth < rule.startMonth) state.recurring = state.recurring.filter((r) => r !== rule);
  else rule.endMonth = lastMonth;
}

function findRule(id) { return state.recurring.find((r) => r.id === id); }

function renderRecurring() {
  const active = state.recurring.filter((r) => !r.endMonth);
  const ended = state.recurring.filter((r) => !active.includes(r));
  const total = active.filter((r) => r.type !== 'income').reduce((a, r) => a + r.amount, 0);
  const totalIn = active.filter((r) => r.type === 'income').reduce((a, r) => a + r.amount, 0);
  const row = (r, isEnded) => `<li class="${isEnded ? 'ended' : ''}">
      <i class="dot" style="background:${catColor(r.type === 'income' ? 'income' : 'expense', r.category)}"></i>
      <div class="info"><strong>${escapeHtml(r.description || r.category)}</strong>
        <small>${escapeHtml(r.category)} · todo dia ${r.day} · desde ${monthName(r.startMonth, true)}/${r.startMonth.slice(0, 4)}${
          r.endMonth ? ` · até ${monthName(r.endMonth, true)}/${r.endMonth.slice(0, 4)}` : ''}</small></div>
      <span class="amt" ${r.type === 'income' ? 'style="color:var(--income-text)"' : ''}>${r.type === 'income' ? '+ ' : ''}${money(r.amount)}</span>
      ${isEnded ? '' : `<button data-end-rule="${r.id}">Encerrar</button>`}
    </li>`;
  $('#recurringList').innerHTML = active.length || ended.length
    ? active.map((r) => row(r, false)).join('') +
      (total ? `<li><div class="info"><strong>Total de despesas fixas por mês</strong></div><span class="amt">${money(total)}</span></li>` : '') +
      (totalIn ? `<li><div class="info"><strong>Total de entradas recorrentes</strong></div><span class="amt" style="color:var(--income-text)">+ ${money(totalIn)}</span></li>` : '') +
      ended.map((r) => row(r, true)).join('')
    : `<li class="empty-msg">Nenhum ainda. Ao lançar um gasto como <b>Fixa</b> ou uma entrada com <b>Repetir todo mês</b>, ele aparece aqui.</li>`;
}

// ---------- Contas fixas: vencimento, pagamento e lembretes ----------
function isBill(t) { return t.type === 'expense' && !!t.recurringId; }

function daysUntil(date) {
  const [y, m, d] = date.split('-').map(Number);
  const [ty, tm, td] = todayISO().split('-').map(Number);
  return Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000);
}

function billStatus(t) {
  if (t.paid) {
    const pd = t.paidDate ? ` em ${t.paidDate.slice(8, 10)}/${t.paidDate.slice(5, 7)}` : '';
    return { key: 'paid', text: `Paga${pd}` };
  }
  const n = daysUntil(t.date);
  if (n < 0) return { key: 'late', text: `Atrasada há ${-n} dia(s)` };
  if (n === 0) return { key: 'today', text: 'Vence hoje' };
  if (n === 1) return { key: 'soon', text: 'Vence amanhã' };
  return { key: 'soon', text: `Vence em ${n} dias` };
}

// Contas não pagas que pedem atenção agora (atrasadas recentes, hoje e, se ativado, amanhã)
function billsNeedingAttention() {
  const from = `${shiftMonth(monthKey(todayISO()), -1)}-01`;
  const ahead = state.settings.remindBefore ? 1 : 0;
  return state.transactions
    .filter((t) => isBill(t) && !t.paid && t.date >= from && daysUntil(t.date) <= ahead)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function togglePaid(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return;
  t.paid = !t.paid;
  t.paidDate = t.paid ? todayISO() : null;
  save();
  renderAll();
  toast(t.paid ? `✓ ${t.description || t.category} marcada como paga` : 'Marcada como não paga');
}

function renderBills() {
  const bills = txOfMonth().filter(isBill).sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description));
  $('#billsPanel').hidden = !bills.length;
  if (!bills.length) return;
  const paid = bills.filter((t) => t.paid);
  const total = bills.reduce((a, t) => a + t.amount, 0);
  const paidSum = paid.reduce((a, t) => a + t.amount, 0);
  $('#billsCount').textContent = `${paid.length} de ${bills.length} pagas`;
  $('#billsProgress').style.width = `${total ? (paidSum / total) * 100 : 0}%`;
  $('#billsSummary').innerHTML = paidSum === total
    ? `✅ Todas as contas do mês pagas (${money(total)}).`
    : `Pago <b>${money(paidSum)}</b> · falta pagar <b>${money(total - paidSum)}</b>`;
  $('#billsSummary').innerHTML += '<br><span class="muted">Marcar como paga é só controle: o valor já está nas Saídas do mês.</span>';
  $('#billsList').innerHTML = bills.map((t) => {
    const st = billStatus(t);
    const [, m, d] = t.date.split('-');
    return `<li class="${st.key}">
      <div class="day"><b>${d}</b><small>${monthName(`2000-${m}`, true)}</small></div>
      <div class="info"><strong>${escapeHtml(t.description || t.category)}</strong><small class="st-${st.key}">${st.text}</small></div>
      <span class="amt">${money(t.amount)}</span>
      <button class="pay ${t.paid ? 'done' : ''}" data-pay="${t.id}">${t.paid ? '✓ Paga' : 'Pagar'}</button>
    </li>`;
  }).join('');
}

// ---------- Projeção do fim do mês ----------
function renderProjection() {
  const list = txOfMonth();
  const real = expand(list);
  const received = sumBy(real, (t) => t.type === 'income');
  const expected = list.filter((t) => t.type === 'income' && t.expected).sort((a, b) => a.date.localeCompare(b.date));
  const toReceive = expected.reduce((a, t) => a + t.amount, 0);
  const expenses = real.filter((t) => t.type === 'expense');
  const bills = list.filter(isBill);
  const unpaidBills = bills.filter((t) => !t.paid).reduce((a, t) => a + t.amount, 0);
  const billsTotal = bills.reduce((a, t) => a + t.amount, 0);
  const spentPaid = sumBy(expenses, () => true) - unpaidBills;
  const today = todayISO();
  const isCurrent = currentMonth === monthKey(today);
  const isFuture = currentMonth > monthKey(today);

  // Estimativa do dia a dia: média diária dos gastos variáveis já feitos × dias que faltam
  const nDays = daysInMonth(currentMonth);
  let estimate = 0;
  let estimateNote = '';
  if (isCurrent) {
    const day = Number(today.slice(8, 10));
    const variableToDate = sumBy(expenses, (t) => t.nature !== 'fixed' && t.date <= today && t.category !== CARD);
    estimate = Math.round((variableToDate / day) * (nDays - day));
    estimateNote = `média de ${money(Math.round(variableToDate / day))}/dia × ${nDays - day} dias`;
  } else if (isFuture) {
    const prev = expand(txOfMonth(shiftMonth(monthKey(today), -1))).filter((t) => t.type === 'expense' && t.nature !== 'fixed');
    estimate = sumBy(prev, () => true);
    estimateNote = 'igual aos gastos variáveis do mês passado';
  }
  const useEstimate = !!state.settings.projEstimate && !!estimate;
  $('#projEstimate').checked = !!state.settings.projEstimate;
  $('#projEstimate').parentElement.hidden = !estimate;

  const now = received - spentPaid;
  const end = received + toReceive - spentPaid - unpaidBills - (useEstimate ? estimate : 0);
  $('#projNow').textContent = money(now);
  $('#projNow').className = now < 0 ? 'neg' : '';
  $('#projEnd').textContent = money(end);
  $('#projEnd').className = end < 0 ? 'neg' : 'pos';
  $('#projEndLabel').textContent = isCurrent || isFuture ? 'Previsto no fim do mês' : 'Fechou o mês com';

  // Cada linha abre o que compõe aquele valor
  const row = (label, sub, value, extra = '') => `<li><span>${escapeHtml(label)}${sub ? `<small>${sub}</small>` : ''}</span>${extra}<b>${value}</b></li>`;
  const line = (label, value, sign, note, details) => details
    ? `<li class="expand"><details><summary><span>${label}${note ? `<small>${note}</small>` : ''}</span><b>${sign}${money(value)}</b></summary><ul class="proj-detail">${details}</ul></details></li>`
    : `<li><span>${label}${note ? `<small>${note}</small>` : ''}</span><b>${sign}${money(value)}</b></li>`;
  const dm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const byCategory = (items) => {
    const g = {};
    items.forEach((t) => {
      const k = t.category === CARD ? 'Cartão (falta lançar)' : t.category;
      (g[k] = g[k] || { total: 0, n: 0, items: [] });
      g[k].total += t.amount; g[k].n++; g[k].items.push(t);
    });
    return Object.entries(g).sort((a, b) => b[1].total - a[1].total);
  };

  const receivedList = list.filter((t) => t.type === 'income' && !t.expected).sort((a, b) => a.date.localeCompare(b.date));
  const recvDetails = receivedList.map((t) => row(t.description || t.category, `${t.category} · ${dm(t.receivedDate || t.date)}`, `+ ${money(t.amount)}`,
    `<button class="undo-recv" data-unrecv="${t.id}" title="Voltar para a receber">↩ Não recebi</button>`)).join('')
    || '<li class="muted">Nenhuma entrada recebida ainda.</li>';
  const expDetails = expected.map((t) => row(t.description || t.category, `${t.category} · previsto ${dm(t.date)}`, `+ ${money(t.amount)}`)).join('');

  const others = expenses.filter((t) => !(t.recurringId && t.type === 'expense' && !t.cardId));
  const othersTotal = spentPaid - (billsTotal - unpaidBills);
  const otherDetails = byCategory(others).map(([cat, g]) => {
    const top = g.items.slice().sort((a, b) => b.amount - a.amount).slice(0, 3)
      .map((t) => `${escapeHtml(t.description || t.category)} ${money(t.amount)}`).join(' · ');
    return `<li class="clickable" data-cat="${escapeHtml(g.items[0].category)}"><span>${escapeHtml(cat)} <em>${g.n}×</em><small>${top}${g.n > 3 ? ' …' : ''}</small></span><b>− ${money(g.total)}</b></li>`;
  }).join('') || '<li class="muted">Nenhum outro gasto lançado.</li>';
  const billDetails = bills.slice().sort((a, b) => a.date.localeCompare(b.date)).map((t) =>
    row(t.description || t.category, `vence ${dm(t.date)} · ${t.paid ? '✓ paga' : 'a pagar'}`, `− ${money(t.amount)}`)).join('');

  let html = line('Recebido', received, '+ ', receivedList.length ? `${receivedList.length} entrada(s) · toque para ver` : '', recvDetails);
  if (toReceive) html += line('A receber', toReceive, '+ ', `${expected.length} entrada(s) prevista(s)`, expDetails);
  // As contas fixas ficam numa linha só: pagar uma conta não muda os totais,
  // só move o valor de "a pagar" para "pagas" (e reduz o saldo de hoje).
  html += line('Outros gastos do mês', othersTotal, '− ', others.length ? `${others.length} lançamento(s) · toque para ver por categoria` : '', otherDetails);
  if (billsTotal) {
    html += line('Contas fixas do mês', billsTotal, '− ',
      unpaidBills ? `${money(billsTotal - unpaidBills)} pagas · ${money(unpaidBills)} a pagar` : 'todas pagas', billDetails);
  }
  if (useEstimate) {
    html += line('Gastos do dia a dia (estimativa)', estimate, '− ', estimateNote,
      `<li class="muted">${isCurrent
        ? 'Previsão do que você ainda deve gastar até o fim do mês com gastos variáveis (mercado, delivery, transporte…), pela média diária até hoje. Fixas e cartão ficam de fora. Desmarque a opção abaixo para tirar da conta.'
        : 'Para meses futuros, usa o total de gastos variáveis do mês passado.'}</li>`);
  }
  html += `<li class="total"><span>Saldo ${isCurrent || isFuture ? 'previsto' : 'final'}</span><b>${money(end)}</b></li>`;
  // mantém abertas as linhas que o usuário tinha aberto
  const open = [...$('#projLines').querySelectorAll('details[open] summary span')].map((s) => s.firstChild.textContent);
  $('#projLines').innerHTML = html;
  $('#projLines').querySelectorAll('details').forEach((d) => {
    if (open.includes(d.querySelector('summary span').firstChild.textContent)) d.open = true;
  });

  $('#expectedTitle').hidden = !expected.length;
  $('#expectedList').innerHTML = expected.map((t) => {
    const [, m, d] = t.date.split('-');
    const n = daysUntil(t.date);
    const when = n > 1 ? `previsto em ${n} dias` : n === 1 ? 'previsto para amanhã' : n === 0 ? 'previsto para hoje' : `previsto há ${-n} dia(s)`;
    return `<li class="expected">
      <div class="day"><b>${d}</b><small>${monthName(`2000-${m}`, true)}</small></div>
      <div class="info"><strong>${escapeHtml(t.description || t.category)}</strong><small class="st-soon">${when}</small></div>
      <span class="amt in">+ ${money(t.amount)}</span>
      <button class="recv" data-recv="${t.id}">Recebi</button>
    </li>`;
  }).join('');
}

function markNotReceived(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return;
  t.expected = true;
  delete t.receivedDate;
  save();
  renderAll();
  toast(`${t.description || t.category} voltou para "a receber"`);
}

function markReceived(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return;
  t.expected = false;
  t.receivedDate = todayISO();
  save();
  renderAll();
  toast(`+ ${money(t.amount)} de ${t.description || t.category} recebido`, { label: 'Desfazer', fn: () => markNotReceived(id) });
}

function renderDueAlert() {
  const list = billsNeedingAttention();
  const el = $('#dueAlert');
  el.hidden = !list.length;
  if (!list.length) return;
  const late = list.filter((t) => daysUntil(t.date) < 0);
  el.classList.toggle('today', !late.length);
  const title = late.length ? `⚠️ Você tem ${late.length} conta(s) atrasada(s)` : '🔔 Contas para pagar';
  el.innerHTML = `<b>${title}</b><ul>${list.map((t) => `<li>${escapeHtml(t.description || t.category)} — ${money(t.amount)} · ${billStatus(t).text.toLowerCase()}</li>`).join('')}</ul>
    <button data-alert-month="${monthKey(list[0].date)}">Ver contas</button>`;
}

// O service worker não lê o localStorage: guardamos as próximas contas num cache
// para ele poder avisar em segundo plano (Android, app instalado).
function syncBillsForWorker() {
  if (!('caches' in window)) return;
  const bills = state.transactions
    .filter((t) => isBill(t) && !t.paid && daysUntil(t.date) >= -1 && daysUntil(t.date) <= 62)
    .map((t) => ({ id: t.id, description: t.description || t.category, amount: t.amount, date: t.date }));
  const body = JSON.stringify({ bills, remindBefore: !!state.settings.remindBefore });
  caches.open('fingui-dados').then((c) => c.put('./contas.json', new Response(body, { headers: { 'Content-Type': 'application/json' } }))).catch(() => {});
  if (navigator.setAppBadge) {
    const n = billsNeedingAttention().filter((t) => daysUntil(t.date) <= 0).length;
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  }
}

async function notifyDueBills() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const today = todayISO();
  const sent = state.settings.notified && state.settings.notified.date === today ? state.settings.notified.ids : [];
  const pending = billsNeedingAttention().filter((t) => !sent.includes(t.id));
  if (!pending.length) return;
  const reg = await navigator.serviceWorker?.getRegistration();
  for (const t of pending) {
    const title = `${billStatus(t).text}: ${t.description || t.category}`;
    const opts = { body: `${money(t.amount)} · toque para abrir o FinGui`, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: `conta-${t.id}` };
    try { if (reg) await reg.showNotification(title, opts); else new Notification(title, opts); } catch { /* ignora */ }
  }
  state.settings.notified = { date: today, ids: [...sent, ...pending.map((t) => t.id)] };
  save();
}

async function setupBackgroundCheck() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.periodicSync) await reg.periodicSync.register('fingui-contas', { minInterval: 12 * 60 * 60 * 1000 });
  } catch { /* não suportado: os avisos ficam ao abrir o app e pelo calendário */ }
}

function renderNotifStatus() {
  const el = $('#notifStatus');
  const btn = $('#enableNotif');
  $('#remindBefore').checked = !!state.settings.remindBefore;
  if (!('Notification' in window)) {
    el.textContent = 'Este navegador não permite notificações. No iPhone, instale o app na tela inicial (iOS 16.4+) ou use o calendário.';
    btn.hidden = true;
    return;
  }
  const p = Notification.permission;
  btn.hidden = p === 'granted';
  btn.textContent = 'Ativar';
  el.textContent = p === 'granted'
    ? '✅ Ativadas. Você é avisado ao abrir o app; com o app instalado no Android, também em segundo plano.'
    : p === 'denied'
      ? 'Bloqueadas no navegador. Libere em Configurações do site → Notificações.'
      : 'Avisa quando você abre o app e, no Android com o app instalado, também em segundo plano.';
}

// Arquivo .ics: um evento mensal por conta fixa, com alarme às 9h do vencimento
function exportIcs() {
  const rules = state.recurring.filter((r) => !r.endMonth && r.type !== 'income');
  if (!rules.length) { toast('Nenhuma despesa fixa ativa'); return; }
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, ' ');
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FinGui//Contas//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:FinGui - Contas'];
  for (const r of rules) {
    let m = monthKey(todayISO());
    if (r.startMonth > m) m = r.startMonth;
    const day = r.day;
    const first = `${m.replace('-', '')}${pad(Math.min(day, daysInMonth(m)))}`;
    const name = r.description || r.category;
    lines.push('BEGIN:VEVENT', `UID:fingui-${r.id}@fingui`, `DTSTAMP:${stamp}`,
      `DTSTART:${first}T090000`, `DTEND:${first}T093000`,
      day > 28 ? 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1' : `RRULE:FREQ=MONTHLY;BYMONTHDAY=${day}`,
      `SUMMARY:${esc(`💰 Vence: ${name} (${money(r.amount)})`)}`,
      `DESCRIPTION:${esc(`Conta fixa do FinGui - ${r.category}. Depois de pagar\, marque como paga no app.`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Vence hoje: ${name}`)}`, 'TRIGGER:PT0M', 'END:VALARM');
    if (state.settings.remindBefore) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Vence amanhã: ${name}`)}`, 'TRIGGER:-P1D', 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  download('fingui-contas.ics', lines.join('\r\n'), 'text/calendar;charset=utf-8');
  toast('Abra o arquivo baixado para adicionar ao calendário');
}

let recurTarget = null;
function askDeleteRecurring(tx) {
  recurTarget = tx;
  const m = monthKey(tx.date);
  $('#recurTitle').textContent = tx.type === 'income' ? 'Excluir entrada mensal' : 'Excluir despesa fixa';
  $('#recurText').innerHTML = `<b>${escapeHtml(tx.description || tx.category)}</b> (${money(tx.amount)}) se repete todo mês. ` +
    `Se ela deixou de existir, será removida de ${monthName(m)} em diante; os meses anteriores continuam registrados.`;
  $('#recurDialog').showModal();
}

// ---------- Compras de uma categoria ----------
// Abre a lista de lançamentos de uma categoria no mês (inclui os gastos de dentro das faturas).
// Com `card`, mostra só os gastos daquele cartão; com `months`, soma os últimos N meses.
let catView = null;

function openCategory(category, opts = {}) {
  catView = { category, type: opts.type || 'expense', card: opts.card || null, months: Number(opts.months) || 1 };
  renderCategory();
  if (!$('#catDialog').open) $('#catDialog').showModal();
}

function categoryItems(view, endMonth) {
  const months = [];
  for (let i = view.months - 1; i >= 0; i--) months.push(shiftMonth(endMonth, -i));
  const cardKey = view.card && normalizeText(view.card);
  const out = [];
  for (const m of months) {
    for (const t of expand(txOfMonth(m))) {
      if (t.type !== view.type || t.category !== view.category) continue;
      if (cardKey) {
        const fat = t.cardId && state.transactions.find((x) => x.id === t.cardId);
        if (!fat || normalizeText(cardName(fat)) !== cardKey) continue;
      }
      out.push(t);
    }
  }
  return out;
}

function renderCategory() {
  const v = catView;
  if (!v) return;
  const items = categoryItems(v, currentMonth).sort((a, b) => (b.purchaseDate || b.date).localeCompare(a.purchaseDate || a.date) || b.amount - a.amount);
  const total = items.reduce((a, t) => a + t.amount, 0);
  const prevTotal = categoryItems(v, shiftMonth(currentMonth, -v.months)).reduce((a, t) => a + t.amount, 0);
  const label = v.category === CARD ? 'Cartão (sem categoria / falta lançar)' : v.category;
  const period = v.months > 1 ? `últimos ${v.months} meses` : monthName(currentMonth);
  $('#catTitle').innerHTML = `<i class="dot" style="background:${v.category === CARD ? '#f3c44b' : catColor(v.type, v.category)}"></i>${escapeHtml(label)}`;
  $('#catSub').textContent = `${period}${v.card ? ` · 💳 ${v.card}` : ''}`;

  const sign = v.type === 'income' ? '+ ' : '';
  let diff = '';
  if (prevTotal) {
    const d = ((total - prevTotal) / prevTotal) * 100;
    diff = `${d >= 0 ? '▲' : '▼'} ${pct(Math.abs(d))} vs ${v.months > 1 ? 'período anterior' : 'mês anterior'}`;
  }
  $('#catKpis').innerHTML = [
    kpi('Total', sign + money(total), diff),
    kpi(v.type === 'income' ? 'Entradas' : 'Compras', String(items.length), items.length ? `média ${money(Math.round(total / items.length))}` : ''),
  ].join('');

  // Onde mais gastou: agrupa pelo estabelecimento (descrição)
  const byPlace = {};
  items.forEach((t) => {
    // agrupa pela primeira palavra (a marca): "iFood Japa" e "iFood Pizza" viram "iFood"
    const key = merchantKey(t.description).split(' ')[0] || normalizeText(t.category);
    const brand = (t.description || '').trim().split(/[\s*\-]+/)[0];
    const g = byPlace[key] || (byPlace[key] = { name: brand || t.category, full: t.description || t.category, total: 0, n: 0 });
    g.total += t.amount; g.n++;
  });
  const places = Object.values(byPlace).sort((a, b) => b.total - a.total);
  $('#catPlacesWrap').hidden = places.length < 2;
  $('#catPlaces').innerHTML = places.slice(0, 5).map((g) => {
    const p = total ? (g.total / total) * 100 : 0;
    return `<li><div class="row"><span>${escapeHtml(g.n === 1 ? g.full : g.name)} <em class="muted">${g.n}×</em></span><b>${money(g.total)} · ${pct(p)}</b></div>
      <div class="bar"><div style="width:${p}%;background:${v.category === CARD ? '#f3c44b' : catColor(v.type, v.category)}"></div></div></li>`;
  }).join('');

  const dm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}${v.months > 1 ? `/${d.slice(2, 4)}` : ''}`;
  $('#catItems').innerHTML = items.length ? items.map((t) => {
    const fat = t.cardId && state.transactions.find((x) => x.id === t.cardId);
    const where = fat ? `💳 ${escapeHtml(cardName(fat))}` : (t.nature === 'fixed' ? '🔁 fixa' : '');
    return `<li data-cat-item="${t.cardId ? `card:${t.cardId}` : t.id}">
      <div class="day"><b>${(t.purchaseDate || t.date).slice(8, 10)}</b><small>${monthName(`2000-${(t.purchaseDate || t.date).slice(5, 7)}`, true)}</small></div>
      <div class="info"><strong>${escapeHtml(t.description || t.category)}</strong><small>${[dm(t.purchaseDate || t.date), where, t.installment ? `parcela ${t.installment}` : ''].filter(Boolean).join(' · ')}</small></div>
      <span class="amt">${sign}${money(t.amount)}</span></li>`;
  }).join('') : '<li class="empty-msg">Nenhum lançamento nesta categoria no período.</li>';
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
    let tag = t.type === 'expense'
      ? `<span class="tag ${t.nature}">${t.nature === 'fixed' ? 'fixa' : 'variável'}</span>` : '';
    if (t.fee) tag += `<span class="tag fee">taxa ${money(t.fee)}</span>`;
    if (t.type === 'income') {
      if (t.recurringId) tag += '<span class="tag recur">🔁 mensal</span>';
      if (t.expected) tag += `<span class="tag expected">a receber ${t.date.slice(8, 10)}/${t.date.slice(5, 7)}</span>`;
    } else if (t.recurringId) {
      tag = tag.replace('>fixa<', '>🔁 fixa mensal<');
      const st = billStatus(t);
      const cls = st.key === 'paid' ? 'paid' : st.key === 'late' ? 'late' : 'due';
      tag += `<span class="tag ${cls}">${st.key === 'paid' ? '✓ paga' : `vence ${t.date.slice(8, 10)}/${t.date.slice(5, 7)}`}</span>`;
    }
    if (t.card) {
      const st = cardStats(t);
      const done = t.amount ? Math.min(100, Math.round((st.classified / t.amount) * 100)) : 0;
      tag += `<span class="tag card ${done < 100 ? 'todo' : ''}">💳 ${st.items.length} itens · ${done}% classificado</span>`;
    }
    html += `<li class="tx" data-id="${t.id}">
      <div class="swatch" style="background:${catColor(t.type, t.category)}"></div>
      <div class="info">
        <strong>${escapeHtml(t.description || t.category)}</strong>
        <small>${escapeHtml(t.category)}${tag}</small>
      </div>
      <div class="val ${t.type} ${t.expected ? 'expected' : ''}">${t.type === 'expense' ? '−' : '+'} ${money(t.amount)}</div>
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
  updateFeeRow();
  updateRepeatRow();
}

function updateFeeRow() {
  const isExpense = $('#txForm').type.value === 'expense';
  $('#feeRow').hidden = !(isExpense && $('#category').value === DELIVERY);
  const isCard = isExpense && $('#category').value === CARD;
  $('#cardHint').hidden = !isCard;
  $('#txForm').description.placeholder = isCard ? 'Nome do cartão (ex.: Nubank, Itaú Visa)' : 'Ex.: Mercado, Uber, iFood';
  if (isCard) {
    const names = [...new Set(state.transactions.filter((t) => t.card).map(cardName))];
    $('#cardNames').innerHTML = names.map((n) => `<option value="${escapeHtml(n)}">`).join('');
    $('#txForm').description.setAttribute('list', 'cardNames');
  } else {
    $('#txForm').description.removeAttribute('list');
  }
}

function updateRepeatRow() {
  const f = $('#txForm');
  const isIncome = f.type.value === 'income';
  const show = isIncome || (f.nature.value === 'fixed' && $('#category').value !== CARD);
  $('#repeatRow').hidden = !show;
  $('#statusRow').hidden = !isIncome;
  const editingRecurring = editingId && state.transactions.find((t) => t.id === editingId)?.recurringId;
  $('#repeatHint').textContent = editingRecurring
    ? '— alterações valem para este mês e os próximos'
    : isIncome ? '— ex.: salário, adiantamento (entra como “a receber” todo mês)' : '— entra automaticamente nos próximos meses';
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
    if (tx.fee) form.fee.value = (tx.fee / 100).toFixed(2).replace('.', ',');
    form.repeat.checked = tx.type === 'income' ? !!tx.recurringId : (!!tx.recurringId || !(tx.nature === 'fixed'));
    form.status.value = tx.expected ? 'expected' : 'received';
  } else {
    form.repeat.checked = type === 'expense';
  }
  updateFeeRow();
  updateRepeatRow();
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
  let fee = null;
  if (type === 'expense' && form.category.value === DELIVERY && form.fee.value.trim()) {
    fee = parseAmount(form.fee.value);
    if (Number.isNaN(fee) || fee > amount) {
      toast('A taxa de entrega deve ser menor que o valor total');
      form.fee.focus();
      return;
    }
  }
  const data = {
    type,
    amount,
    description: form.description.value.trim(),
    category: form.category.value,
    nature: type === 'expense' ? form.nature.value : null,
    date: form.date.value || todayISO(),
    fee,
  };

  if (type === 'income') data.expected = form.status.value === 'expected';
  const wantsRepeat = form.repeat.checked &&
    (type === 'income' || (data.nature === 'fixed' && data.category !== CARD));
  let openCardAfter = null;
  if (editingId) {
    const tx = state.transactions.find((t) => t.id === editingId);
    const rule = tx.recurringId && findRule(tx.recurringId);
    const month = monthKey(data.date);
    Object.assign(tx, data);
    if (rule && wantsRepeat) {
      // A alteração vale deste mês em diante; os meses anteriores ficam como estavam
      Object.assign(rule, { amount: data.amount, description: data.description, category: data.category, day: Number(data.date.slice(8, 10)) });
      state.transactions.forEach((t) => {
        if (t.recurringId === rule.id && t !== tx && monthKey(t.date) > month) {
          Object.assign(t, { amount: rule.amount, description: rule.description, category: rule.category, date: recurringDate(rule, monthKey(t.date)) });
        }
      });
    } else if (rule && !wantsRepeat) {
      endRecurring(rule, month); // parou de repetir: fica só até este mês
    } else if (!rule && wantsRepeat) {
      const r = newRule(data);
      tx.recurringId = r.id;
    }
    if (data.category !== CARD && tx.card && !tx.card.items.length) delete tx.card;
    toast('Lançamento atualizado');
    if (tx.card && $('#cardDialog').open) openCardAfter = tx.id;
  } else {
    const tx = { id: uid(), createdAt: Date.now(), ...data };
    if (wantsRepeat) tx.recurringId = newRule(data).id;
    if (type === 'expense' && data.category === CARD) {
      tx.card = { items: [] };
      openCardAfter = tx.id;
    }
    state.transactions.push(tx);
    toast(`${type === 'expense' ? 'Gasto' : 'Entrada'} de ${money(amount)} registrado`);
  }
  save();
  currentMonth = monthKey(data.date);
  $('#txDialog').close();
  renderAll();
  if (openCardAfter) openCard(openCardAfter);
}

function newRule(data) {
  const rule = {
    id: uid(), type: data.type, description: data.description, category: data.category, amount: data.amount,
    day: Number(data.date.slice(8, 10)), startMonth: monthKey(data.date), endMonth: null, skipped: [],
  };
  state.recurring.push(rule);
  return rule;
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
  const header = ['Data', 'Tipo', 'Natureza', 'Categoria', 'Descrição', 'Valor', 'Taxa de entrega'];
  const fmt = (c) => (c / 100).toFixed(2).replace('.', ',');
  const rows = [];
  [...state.transactions].sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => {
    rows.push([
      t.date, t.type === 'income' ? 'Entrada' : 'Saída',
      t.type === 'expense' ? (t.nature === 'fixed' ? 'Fixa' : 'Variável') : '',
      t.category, t.description || '', fmt(t.amount), t.fee ? fmt(t.fee) : '',
    ]);
    (t.card ? t.card.items : []).forEach((it) => rows.push([
      it.date, 'Item da fatura', it.nature === 'fixed' ? 'Fixa' : 'Variável',
      it.category === CARD ? 'A classificar' : it.category, `↳ ${it.description}${it.installment ? ` (${it.installment})` : ''}`, fmt(it.amount), '',
    ]));
  });
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
      state = migrate(data);
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
  ensureRecurring(recurringHorizon());
  $('#monthLabel').textContent = monthName(currentMonth);
  renderResumo();
  renderCardsMonth();
  renderProjection();
  renderBills();
  renderDueAlert();
  renderInsights();
  renderCategoryFilter();
  renderList();
  renderCategories();
  renderRecurring();
  renderNotifStatus();
  renderBackupBanner();
  if (catView && $('#catDialog').open) renderCategory();
}

// ---------- Eventos ----------
$('#prevMonth').onclick = () => { currentMonth = shiftMonth(currentMonth, -1); renderAll(); };
$('#nextMonth').onclick = () => { currentMonth = shiftMonth(currentMonth, 1); renderAll(); };

document.querySelectorAll('.tabbar button').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${btn.dataset.view}`));
    window.scrollTo(0, 0);
    if (btn.dataset.view === 'insights') renderInsights();
  };
});

$('#fab').onclick = () => openForm();
$('#cancelTx').onclick = () => $('#txDialog').close();
$('#txForm').addEventListener('submit', submitForm);
$('#category').addEventListener('change', () => { updateFeeRow(); updateRepeatRow(); });
document.querySelectorAll('#txForm input[name="type"]').forEach((r) => {
  r.onchange = () => {
    fillCategorySelect(r.value);
    if (!editingId) $('#txForm').repeat.checked = r.value === 'expense';
    updateRepeatRow();
  };
});

$('#txList').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    const target = state.transactions.find((t) => t.id === del.dataset.del);
    if (target && target.recurringId) { askDeleteRecurring(target); return; }
    if (confirm('Excluir este lançamento?')) {
      state.transactions = state.transactions.filter((t) => t.id !== del.dataset.del);
      save();
      renderAll();
      toast('Lançamento excluído');
    }
    return;
  }
  const item = e.target.closest('.tx');
  if (!item) return;
  const tx = state.transactions.find((t) => t.id === item.dataset.id);
  if (tx.card) openCard(tx.id); else openForm(tx);
});

['#filterType', '#filterCategory'].forEach((s) => $(s).addEventListener('change', renderList));
$('#search').addEventListener('input', renderList);
$('#recurringList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-end-rule]');
  if (!btn) return;
  const rule = findRule(btn.dataset.endRule);
  const real = monthKey(todayISO());
  const next = shiftMonth(real, 1);
  if (!confirm(`Encerrar "${rule.description || rule.category}"?\n\nEla continua registrada até ${monthName(real)} e some a partir de ${monthName(next)}.`)) return;
  endRecurring(rule, real);
  save();
  renderAll();
  toast('Despesa fixa encerrada');
});
$('#recurOnlyThis').onclick = () => {
  const tx = recurTarget;
  const rule = findRule(tx.recurringId);
  if (rule) rule.skipped.push(monthKey(tx.date));
  state.transactions = state.transactions.filter((t) => t !== tx);
  $('#recurDialog').close();
  save(); renderAll();
  toast(`Removida só de ${monthName(monthKey(tx.date))}`);
};
$('#recurFromHere').onclick = () => {
  const tx = recurTarget;
  const rule = findRule(tx.recurringId);
  const m = monthKey(tx.date);
  if (rule) endRecurring(rule, shiftMonth(m, -1));
  else state.transactions = state.transactions.filter((t) => t !== tx);
  $('#recurDialog').close();
  save(); renderAll();
  toast(`Removida de ${monthName(m)} em diante`);
};
$('#recurCancel').onclick = () => $('#recurDialog').close();
document.querySelectorAll('#txForm input[name="nature"]').forEach((r) => r.addEventListener('change', updateRepeatRow));

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

$('#exportJson').onclick = backupNow;
$('#exportCsv').onclick = exportCsv;
$('#importJson').onchange = (e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; };

// Fatura do cartão
$('#newCard').onclick = () => {
  openForm();
  fillCategorySelect('expense', CARD);
  $('#txTitle').textContent = 'Nova fatura do cartão';
};
$('#cardPending').onclick = () => { if ($('#cardPending').dataset.card) openCard($('#cardPending').dataset.card); };
$('#closeCard').onclick = () => $('#cardDialog').close();
$('#editCard').onclick = () => openForm(cardTx());
$('#useSum').onclick = () => {
  const tx = cardTx();
  tx.amount = cardStats(tx).detailed;
  save(); renderCard(); renderAll();
  toast('Total da fatura atualizado');
};

function remainingText() {
  const r = cardStats(cardTx()).remainder;
  return r > 0 ? `Falta lançar <b>${money(r)}</b> desta fatura.` : r === 0 ? 'A fatura já está completa.' : `Já passou <b>${money(-r)}</b> do total.`;
}

let itemCategoryTouched = false;
function openItemForm() {
  const f = $('#itemForm');
  const keepDate = f.date.value;
  f.reset();
  itemCategoryTouched = false;
  $('#itemCategory').innerHTML = expenseOptions(null, true);
  f.date.value = keepDate || cardTx().date;
  $('#itemRemaining').innerHTML = remainingText();
  if (!$('#itemDialog').open) $('#itemDialog').showModal();
  setTimeout(() => $('#itemAmount').focus(), 50);
}

$('#addItemBtn').onclick = () => { $('#itemForm').date.value = ''; openItemForm(); };
$('#cancelItem').onclick = () => $('#itemDialog').close();
$('#itemCategory').addEventListener('change', () => {
  itemCategoryTouched = true;
  if ($('#itemCategory').value === 'Assinaturas') $('#itemForm').nature.value = 'fixed';
});
// Sugere a categoria pela descrição (ex.: "Uber" -> Transporte), sem sobrescrever a escolha do usuário
$('#itemForm').description.addEventListener('input', (e) => {
  if (itemCategoryTouched) return;
  const c = classify(e.target.value);
  if (c.auto) {
    $('#itemCategory').value = c.category;
    $('#itemForm').nature.value = c.nature || 'variable';
  }
});
$('#itemForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const amount = parseAmount(f.amount.value);
  if (!amount) { toast('Informe um valor válido'); f.amount.focus(); return; }
  if (!f.category.value) { toast('Escolha a categoria'); f.category.focus(); return; }
  const tx = cardTx();
  const desc = f.description.value.trim();
  const item = {
    id: uid(), date: f.date.value || tx.date, description: desc, amount,
    category: f.category.value, nature: f.nature.value, installment: installmentOf(desc),
  };
  ensureCard(tx).items.push(item);
  const key = merchantKey(desc);
  if (key) state.rules[key] = { category: item.category, nature: item.nature };
  save(); renderCard(); renderAll();
  toast(`${money(amount)} em ${item.category} adicionado`);
  openItemForm(); // já deixa pronto para o próximo gasto
});
$('#cardItems').addEventListener('change', (e) => {
  const sel = e.target.closest('[data-item-cat]');
  if (sel) setItemCategory(sel.closest('[data-item]').dataset.item, sel.value);
});
$('#cardItems').addEventListener('click', (e) => {
  const li = e.target.closest('[data-item]');
  if (!li) return;
  const tx = cardTx();
  const item = tx.card.items.find((it) => it.id === li.dataset.item);
  if (e.target.closest('[data-item-nature]')) {
    item.nature = item.nature === 'fixed' ? 'variable' : 'fixed';
  } else if (e.target.closest('[data-item-del]')) {
    tx.card.items = tx.card.items.filter((it) => it !== item);
  } else return;
  save(); renderCard(); renderAll();
});

// Backup e proteção dos dados
function backupNow() {
  download(`fingui-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
  state.lastBackup = todayISO();
  save();
  renderBackupBanner();
}

function renderBackupBanner() {
  const has = state.transactions.length > 0;
  const last = state.lastBackup;
  const days = last ? Math.floor((new Date(todayISO()) - new Date(last)) / 86400000) : null;
  const show = has && (days === null ? state.transactions.length >= 10 : days >= 7);
  $('#backupBanner').hidden = !show;
  $('#backupDays').textContent = days === null ? 'tempo' : `${days} dias`;
}

$('#bannerBackup').onclick = backupNow;
$('#restoreSnapshot').onclick = () => {
  const snap = readSnapshot();
  if (!snap) { toast('Nenhuma cópia automática encontrada'); return; }
  const [y, m, d] = snap.date.split('-');
  if (!confirm(`Voltar os dados para a cópia automática de ${d}/${m}/${y}? (${snap.data.transactions.length} lançamentos)`)) return;
  state = migrate(snap.data);
  save();
  renderAll();
  toast('Cópia restaurada');
};

async function protectStorage() {
  const el = $('#storageStatus');
  if (!navigator.storage || !navigator.storage.persist) return;
  try {
    const persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    el.textContent = persisted
      ? '🔒 Armazenamento protegido: o navegador não apaga estes dados para liberar espaço.'
      : 'ℹ️ Para proteger melhor os dados, instale o app na tela inicial ("Adicionar à tela inicial").';
  } catch { /* navegador sem suporte */ }
}
protectStorage();

// Tocar em qualquer categoria (Resumo, Insights, cartões, projeção) abre as compras dela
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-cat]');
  if (!el || el.closest('#catDialog')) return;
  e.preventDefault();
  openCategory(el.dataset.cat, { type: el.dataset.catType, card: el.dataset.card, months: el.dataset.months });
});
$('#closeCat').onclick = () => { $('#catDialog').close(); catView = null; };
$('#catItems').addEventListener('click', (e) => {
  const li = e.target.closest('[data-cat-item]');
  if (!li) return;
  const ref = li.dataset.catItem;
  if (ref.startsWith('card:')) openCard(ref.slice(5));
  else openForm(state.transactions.find((t) => t.id === ref));
});

['#cardsList', '#cardsHistory'].forEach((sel) => $(sel).addEventListener('click', (e) => {
  if (e.target.closest('[data-cat]')) return; // categoria abre a lista de compras
  const c = e.target.closest('[data-open-card]');
  if (c) openCard(c.dataset.openCard);
}));

$('#projLines').addEventListener('click', (e) => {
  const b = e.target.closest('[data-unrecv]');
  if (!b) return;
  e.preventDefault();
  const t = state.transactions.find((x) => x.id === b.dataset.unrecv);
  if (t && confirm(`Voltar "${t.description || t.category}" (${money(t.amount)}) para "a receber"?`)) markNotReceived(t.id);
});

$('#expectedList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-recv]');
  if (b) markReceived(b.dataset.recv);
});
$('#projEstimate').onchange = (e) => { state.settings.projEstimate = e.target.checked; save(); renderAll(); };
$('#addExpected').onclick = () => {
  openForm();
  const f = $('#txForm');
  f.type.value = 'income';
  fillCategorySelect('income');
  f.repeat.checked = false;
  f.status.value = 'expected';
  const t = todayISO();
  f.date.value = currentMonth === monthKey(t) ? t : `${currentMonth}-05`;
  $('#txTitle').textContent = 'Entrada a receber';
  updateRepeatRow();
};
// Data futura numa entrada nova: já sugere "a receber"
$('#txForm').date.addEventListener('change', (e) => {
  const f = $('#txForm');
  if (!editingId && f.type.value === 'income') f.status.value = e.target.value > todayISO() ? 'expected' : 'received';
});

$('#billsList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pay]');
  if (b) togglePaid(b.dataset.pay);
});
$('#dueAlert').addEventListener('click', (e) => {
  const b = e.target.closest('[data-alert-month]');
  if (!b) return;
  currentMonth = b.dataset.alertMonth;
  renderAll();
  $('#billsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#exportIcs').onclick = exportIcs;
$('#remindBefore').onchange = (e) => {
  state.settings.remindBefore = e.target.checked;
  save();
  renderAll();
};
$('#enableNotif').onclick = async () => {
  if (!('Notification' in window)) return;
  const p = await Notification.requestPermission();
  renderNotifStatus();
  if (p === 'granted') {
    setupBackgroundCheck();
    toast('Notificações ativadas');
    notifyDueBills();
  }
};
// Ao abrir o app (ou voltar para ele) confere o que vence hoje
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  renderAll();
  notifyDueBills();
});

// Atalho: abrir direto o formulário via ?novo (usado pelo atalho do app instalado)
if (new URLSearchParams(location.search).has('novo')) setTimeout(() => openForm(), 100);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if ($('#view-insights').classList.contains('active')) renderInsights(); }, 150);
});

renderAll();
if ('Notification' in window && Notification.permission === 'granted') {
  notifyDueBills();
  setupBackgroundCheck();
}

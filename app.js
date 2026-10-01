'use strict';

// ---------- Dados ----------
const STORAGE_KEY = 'financas.v1';

// Paleta categórica (ordem fixa; as 8 primeiras validadas para daltonismo).
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948',
  '#184f95', '#a8461f', '#0f7a54', '#8a5d00', '#9c3b63', '#6b6a65'];
const OTHER_COLOR = '#b9b8b2';

const DELIVERY = 'Delivery';

const DEFAULT_CATEGORIES = {
  expense: ['Moradia', 'Alimentação', DELIVERY, 'Mercado', 'Transporte', 'Saúde', 'Educação', 'Lazer',
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
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { console.warn('Falha ao ler dados', e); }
  return defaultState();
}

// Garante que dados antigos ganhem as novidades (ex.: categoria Delivery).
function migrate(s) {
  if (!s.categories.expense.some((c) => c.name === DELIVERY)) {
    const used = new Set(s.categories.expense.map((c) => c.color));
    s.categories.expense.splice(2, 0, { name: DELIVERY, color: PALETTE.find((p) => !used.has(p)) || '#e87ba4' });
  }
  return s;
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
  legendEl.innerHTML = items.map((it, i) => `<li data-tip-idx="${i}"><i class="dot" style="background:${it.color}"></i>
    <span class="name">${escapeHtml(it.name)}</span><b>${money(it.value)}</b><em>${pct((it.value / total) * 100)}</em></li>`).join('');
  const html = (i) => `<div class="t-title">${escapeHtml(items[i].name)}</div>` +
    tipRow(items[i].color, 'Valor', money(items[i].value)) +
    tipRow(null, 'Participação', pct((items[i].value / total) * 100));
  bindTips(el, html);
}

function kpi(label, value, sub = '') {
  return `<div class="kpi"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
}

function renderInsights() {
  const list = txOfMonth();
  const expenses = list.filter((t) => t.type === 'expense');
  const income = sumBy(list, (t) => t.type === 'income');
  const spent = sumBy(expenses, () => true);
  const nDays = daysInMonth(currentMonth);
  const today = todayISO();
  const isCurrent = currentMonth === monthKey(today);
  const isFuture = currentMonth > monthKey(today);
  const elapsed = isCurrent ? Number(today.slice(8, 10)) : nDays;
  const prevKey = shiftMonth(currentMonth, -1);
  const prevList = txOfMonth(prevKey).filter((t) => t.type === 'expense');
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
    items = [...sorted.slice(0, 6), { name: `Outras (${sorted.length - 6})`, value: rest, color: OTHER_COLOR }];
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
  const monthTx = months.map((k) => txOfMonth(k));
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
    return `<li><span class="name"><i class="dot" style="background:${catColor('expense', c.name)}"></i>${escapeHtml(c.name)}</span>
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
    const [y, mo, d] = t.date.split('-').map(Number);
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
    const [, mo, d] = t.date.split('-');
    return `<li><div class="info"><strong>${escapeHtml(t.description || t.category)}</strong>
      <small>${escapeHtml(t.category)} · ${d}/${mo}</small></div><span class="amt">${money(t.amount)}</span></li>`;
  }).join('') : `<li class="empty-msg">Nenhum gasto neste mês.</li>`;
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
  updateFeeRow();
}

function updateFeeRow() {
  const isDelivery = $('#txForm').type.value === 'expense' && $('#category').value === DELIVERY;
  $('#feeRow').hidden = !isDelivery;
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
  }
  updateFeeRow();
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
  const header = ['Data', 'Tipo', 'Natureza', 'Categoria', 'Descrição', 'Valor', 'Taxa de entrega'];
  const rows = [...state.transactions].sort((a, b) => a.date.localeCompare(b.date)).map((t) => [
    t.date, t.type === 'income' ? 'Entrada' : 'Saída',
    t.type === 'expense' ? (t.nature === 'fixed' ? 'Fixa' : 'Variável') : '',
    t.category, t.description || '',
    (t.amount / 100).toFixed(2).replace('.', ','),
    t.fee ? (t.fee / 100).toFixed(2).replace('.', ',') : '',
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
  $('#monthLabel').textContent = monthName(currentMonth);
  renderResumo();
  renderInsights();
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
    if (btn.dataset.view === 'insights') renderInsights();
  };
});

$('#fab').onclick = () => openForm();
$('#cancelTx').onclick = () => $('#txDialog').close();
$('#txForm').addEventListener('submit', submitForm);
$('#category').addEventListener('change', updateFeeRow);
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

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if ($('#view-insights').classList.contains('active')) renderInsights(); }, 150);
});

renderAll();

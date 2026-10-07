// Service worker: permite usar o app offline e avisa sobre contas a vencer.
const CACHE = 'fingui-v12';
const DATA_CACHE = 'fingui-dados'; // contas para os avisos (nunca é apagado nas atualizações)
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.json', './icons/icon.svg', './icons/icon-192.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k !== CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)),
  )));
  self.clients.claim();
});

// Rede primeiro (pega atualizações), cache como reserva quando offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// ---------- Avisos de vencimento em segundo plano ----------
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysUntil(date) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date();
  return Math.round((new Date(y, m - 1, d) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
}

async function checkBills() {
  const cache = await caches.open(DATA_CACHE);
  const res = await cache.match('./contas.json');
  if (!res) return;
  const { bills = [], remindBefore } = await res.json();
  const sentRes = await cache.match('./avisados.json');
  const sent = sentRes ? await sentRes.json() : {};
  const today = todayISO();
  const already = sent.date === today ? sent.ids : [];
  const due = bills.filter((b) => {
    const n = daysUntil(b.date);
    return (n === 0 || (remindBefore && n === 1)) && !already.includes(b.id);
  });
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  for (const b of due) {
    const when = daysUntil(b.date) === 0 ? 'Vence hoje' : 'Vence amanhã';
    await self.registration.showNotification(`${when}: ${b.description}`, {
      body: `${brl.format(b.amount / 100)} · toque para abrir o FinGui`,
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: `conta-${b.id}`,
    });
  }
  await cache.put('./avisados.json', new Response(JSON.stringify({ date: today, ids: [...already, ...due.map((b) => b.id)] })));
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'fingui-contas') e.waitUntil(checkBills());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => 'focus' in c);
    return open ? open.focus() : self.clients.openWindow('./index.html');
  }));
});

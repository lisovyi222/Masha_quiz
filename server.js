// Квіз «Хто така Марія Брицька?» — без залежностей, лише Node 18+.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const HOST_KEY = process.env.HOST_KEY || "masha";
const T = 20000;

const Q = [
  ["З якого фільму почався Найгірший клуб у світі?", ["Учительська","Найгірша людина у світі","Lost in Translation","Гаррі Поттер"], 2],
  ["Який улюблений фільм Марії Брицької?", ["Найгірша людина у світі","Френсіс Ха","Одна битва за іншою","Сентиментальна цінність"], 0],
  ["Улюблений актор?", ["Ді Капріо","Метт Деймон","Сталлоне","Мадс Міккельсен"], 3],
  ["Улюблена актриса?", ["Зої Кравіц","Рая Раінцева","Ніколь Кідман","Ренате Реінсве"], 3],
  ["За кого вона б вийшла заміж?", ["Паттінсон","Пітт","Лісовий","Міккельсен"], 0],
  ["Улюблений режисер?", ["Кубрік","Нолан","Трієр","Кемерон"], 2],
  ["Який фільм Маша не перетравлює?", ["Сутінки","Ла-Ла Ленд","Інтерстеллар","Диявол носить Prada"], 1],
  ["На що Маша витратить останні гроші?", ["Квитки на літак","Одяг","Книжки","Вечерю в ресторані"], 0],
  ["Яка фраза — це Марія?", ["Я тобі казала","Я так і знала","Мені треба подумати","Ти мене ніколи не слухаєш"], 3],
  ["Улюблений мультик Марії?", ["Мадагаскар","Думками навиворіт","Принцеса і жаба","Зоотрополіс"], 2],
  ["Улюблений бренд?", ["Cher17","Ganni","Bimba y Lola","Uniqlo"], 1],
  ["З ким із присутніх Маша знайома найдавніше?", ["Олексій","Альона","Інна","Андрій"], 2],
  ["Який предмет Маша найбільше ненавиділа в школі?", ["Хімія","Фізика","Алгебра","Геометрія"], 1],
  ["Яке улюблене місто Маші?", ["Барса","Токіо","Прага","Копен"], 3],
  ["Який улюблений серіал Маші?", ["Офіс","Друзі","Гра престолів","H2O"], 0],
  ["Яку їжу Маша категорично не їсть?", ["Кефір","Помідори","Хамон","Перець"], 1],
  ["Ким Маша хотіла стати в дитинстві?", ["Художницею","Пілоткою","Політологинею","Дизайнеркою"], 0],
  ["Як Маша назве доньку?", ["Емілія","Юстина","Габріела","Уляна"], 1],
  ["На концерт якого виконавця Маша мріє потрапити?", ["Mac DeMarco","Стрикало","The Blaze","A$AP Rocky"], 0],
  ["Яке погоняло було в першого хлопця Маші?", ["Растішка","Барсік","Клітор","Коврік"], 3],
  ["Який вид активності Маша вибере?", ["Серфінг на Шрі-Ланці","Виноробня в Новій Зеландії","Новий рік у Лапландії","Чаювання в юрті з казахами"], 1],
];

// ---------- стан гри ----------
const G = { ph: "lobby", qi: -1, qStart: 0, cnt: [0, 0, 0, 0] };
const players = new Map(); // id -> {id,name,score,streak,ans:{c,t}|null,d,ok}
let revealTimer = null, allTimer = null;

const points = t => Math.round(1000 * (1 - Math.min(Math.max(t, 0), T) / T / 2));

function snapshot() {
  const list = [...players.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "uk"))
    .map(p => ({
      id: p.id, name: p.name, score: p.score, streak: p.streak,
      answered: !!p.ans,
      d: G.ph === "reveal" || G.ph === "board" || G.ph === "end" ? p.d : 0,
      ok: G.ph === "reveal" || G.ph === "board" || G.ph === "end" ? p.ok : null,
    }));
  const inQ = G.ph === "q" || G.ph === "reveal";
  return {
    ph: G.ph, qi: G.qi, total: Q.length,
    rem: G.ph === "q" ? Math.max(0, G.qStart + T - Date.now()) : 0,
    q: inQ ? { text: Q[G.qi][0], options: Q[G.qi][1] } : null,
    correct: G.ph === "reveal" ? Q[G.qi][2] : null,
    cnt: G.ph === "reveal" ? G.cnt : null,
    players: list,
  };
}

// ---------- SSE ----------
const clients = new Set();
let pending = false;
function broadcast() {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    const data = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of clients) res.write(data);
  }, 40);
}
setInterval(() => { for (const res of clients) res.write(": ping\n\n"); }, 20000);

// ---------- логіка ----------
function clearTimers() { clearTimeout(revealTimer); clearTimeout(allTimer); revealTimer = allTimer = null; }

function startQ() {
  clearTimers();
  G.ph = "q"; G.qStart = Date.now(); G.cnt = [0, 0, 0, 0];
  for (const p of players.values()) { p.ans = null; p.d = 0; p.ok = false; }
  revealTimer = setTimeout(reveal, T + 300);
  broadcast();
}

function reveal() {
  if (G.ph !== "q") return;
  clearTimers();
  const right = Q[G.qi][2];
  G.cnt = [0, 0, 0, 0];
  for (const p of players.values()) {
    if (p.ans) {
      G.cnt[p.ans.c]++;
      if (p.ans.c === right) { p.d = points(p.ans.t); p.score += p.d; p.streak++; p.ok = true; }
      else { p.d = 0; p.streak = 0; p.ok = false; }
    } else { p.d = 0; p.streak = 0; p.ok = false; }
  }
  G.ph = "reveal";
  broadcast();
}

function resetGame() {
  clearTimers();
  G.ph = "lobby"; G.qi = -1; G.cnt = [0, 0, 0, 0];
  for (const p of players.values()) { p.score = 0; p.streak = 0; p.ans = null; p.d = 0; p.ok = false; }
  broadcast();
}

const hostActions = {
  start() { if (G.ph === "lobby") { G.qi = 0; startQ(); } },
  reveal,
  board() { if (G.ph === "reveal") { G.ph = "board"; broadcast(); } },
  next() {
    if (G.ph !== "board") return;
    if (G.qi < Q.length - 1) { G.qi++; startQ(); } else { G.ph = "end"; broadcast(); }
  },
  reset: resetGame,
};

// ---------- HTTP ----------
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
function readJson(req) {
  return new Promise(resolve => {
    let b = "";
    req.on("data", c => { b += c; if (b.length > 4096) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
  });
}
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (p === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "POST" && p === "/api/join") {
    const b = await readJson(req);
    let name = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 18);
    if (!name) return send(res, 400, { error: "name" });
    const existing = typeof b.id === "string" && players.get(b.id);
    if (existing) { existing.name = name; broadcast(); return send(res, 200, { id: existing.id, name }); }
    const taken = new Set([...players.values()].map(x => x.name.toLowerCase()));
    let base = name, n = 2;
    while (taken.has(name.toLowerCase())) name = `${base} ${n++}`;
    const id = crypto.randomBytes(6).toString("hex");
    players.set(id, { id, name, score: 0, streak: 0, ans: null, d: 0, ok: false });
    broadcast();
    return send(res, 200, { id, name });
  }

  if (req.method === "POST" && p === "/api/answer") {
    const b = await readJson(req);
    const pl = players.get(b.id);
    if (!pl || G.ph !== "q" || pl.ans || ![0, 1, 2, 3].includes(b.c)) return send(res, 200, { ok: false });
    pl.ans = { c: b.c, t: Date.now() - G.qStart };
    if ([...players.values()].every(x => x.ans)) { clearTimeout(allTimer); allTimer = setTimeout(reveal, 700); }
    broadcast();
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && p.startsWith("/api/host/")) {
    if (req.headers["x-host-key"] !== HOST_KEY) return send(res, 403, { error: "key" });
    const act = hostActions[p.slice("/api/host/".length)];
    if (!act) return send(res, 404, { error: "action" });
    act();
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET") {
    const file = p === "/" || p === "/host" ? "index.html" : p.slice(1);
    const full = path.join(__dirname, "public", path.normalize(file));
    if (!full.startsWith(path.join(__dirname, "public"))) { res.writeHead(403); return res.end(); }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); return res.end("Not found"); }
      res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream", "cache-control": "no-cache" });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log(`Квіз запущено на порту ${PORT}`);
  console.log(`Сторінка ведучого: /host?key=${HOST_KEY}`);
});

'use strict';
/**
 * 🎮 بوت صالة الألعاب — 10 ألعاب تلكرام بالأزرار
 * إكس أو • حجرة ورقة مقص • خمّن الرقم • سؤال وجواب • رتّب الكلمة
 * المشنقة • الذاكرة • كاسحة الألغام • 2048 • تحدّي الحساب
 */
const fs = require('fs');
const path = require('path');
const { Bot } = require('grammy');

/* ================== أدوات عامة ================== */
const btn = (text, data) => ({ text, callback_data: data });
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const toEnDigits = s => s.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const normCh = c => ({ 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ئ': 'ي', 'ؤ': 'و' }[c] || c);
const norm = s => [...s.replace(/[ً-ْـ\s]/g, '')].map(normCh).join('');
const BACK = btn('🔙 القائمة', 'menu');
const again = id => [btn('🔄 العب مرة ثانية', `start:${id}`), BACK];
const NOOP = 'noop';

/* ================== قاعدة البيانات (JSON) ================== */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');
let db = { users: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { /* أول تشغيل */ }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (persist) return persist(db);
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(db)); }
    catch (e) { console.error('save error', e.message); }
  }, 1500);
}
let persist = null;
function setStore(data, fn) { if (data && data.users) db = data; persist = fn; }
function user(from) {
  const u = db.users[from.id] || (db.users[from.id] = { points: 0, played: 0, wins: 0, games: {} });
  u.name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'لاعب';
  return u;
}
function award(st, pts, won) {
  if (st.awarded) return;
  st.awarded = true;
  const u = user(st.from);
  u.points += pts; u.played++; if (won) u.wins++;
  const g = u.games[st.game] || (u.games[st.game] = { played: 0, wins: 0 });
  g.played++; if (won) g.wins++;
  st.gained = pts;
  save();
}
const gainLine = st => st.gained ? `\n\n⭐ +${st.gained} نقطة` : '';

/* ================== حالة الألعاب ================== */
const S = new Map(); // `${chat}:${msg}` → حالة لعبة الأزرار
const T = new Map(); // `${chat}:${user}` → لعبة تنتظر كتابة

/* ================== بيانات المحتوى ================== */
const WORDS = [
  ['مدرسة', 'مكان للدراسة'], ['برتقال', 'فاكهة'], ['حاسوب', 'جهاز إلكتروني'], ['مستشفى', 'مكان للعلاج'],
  ['سيارة', 'وسيلة نقل'], ['بغداد', 'عاصمة عربية'], ['زرافة', 'حيوان رقبته طويلة'], ['فراشة', 'حشرة ملونة'],
  ['مكتبة', 'بيها كتب'], ['ملعب', 'تلعب بيه كرة'], ['قهوة', 'مشروب'], ['تفاحة', 'فاكهة'],
  ['دجاجة', 'طير بالبيت'], ['كرسي', 'تكعد عليه'], ['نافذة', 'بالحايط'], ['مطبخ', 'مكان بالبيت'],
  ['بحيرة', 'ماي وطبيعة'], ['صحراء', 'رمل وحر'], ['هاتف', 'جهاز اتصال'], ['بطيخ', 'فاكهة صيفية'],
  ['حديقة', 'مكان بيه شجر'], ['طاولة', 'أثاث'], ['معلم', 'مهنة'], ['مهندس', 'مهنة'],
  ['طبيب', 'مهنة'], ['نخلة', 'شجرة عراقية'], ['دلفين', 'حيوان بحري'], ['مظلة', 'للمطر'],
  ['ساعة', 'للوقت'], ['دفتر', 'للكتابة'], ['حقيبة', 'تشيل بيها أغراضك'], ['طائرة', 'تطير بالسما'],
  ['قطار', 'وسيلة نقل على سكة'], ['شلال', 'ماي ينزل من فوق'], ['بركان', 'جبل يطلع نار'], ['كمان', 'آلة موسيقية'],
  ['عصفور', 'طير صغير'], ['تمساح', 'حيوان بالنهر'], ['خيمة', 'بيت بالبر'], ['مفتاح', 'يفتح الباب'],
];

const QUIZ = [ // [سؤال، الصح، غلط، غلط، غلط]
  ['شنو عاصمة العراق؟', 'بغداد', 'البصرة', 'الموصل', 'أربيل'],
  ['كم يوم بالسنة الكبيسة؟', '366', '365', '364', '360'],
  ['أكبر كوكب بالمجموعة الشمسية؟', 'المشتري', 'زحل', 'الأرض', 'المريخ'],
  ['كم عدد قارات العالم؟', '7', '5', '6', '8'],
  ['الرمز الكيميائي للذهب؟', 'Au', 'Ag', 'Fe', 'Gd'],
  ['أسرع حيوان بري؟', 'الفهد', 'الأسد', 'الحصان', 'الغزال'],
  ['كم ضلع للشكل السداسي؟', '6', '5', '7', '8'],
  ['أكبر محيط بالعالم؟', 'الهادي', 'الأطلسي', 'الهندي', 'المتجمد الشمالي'],
  ['شنو عاصمة اليابان؟', 'طوكيو', 'أوساكا', 'كيوتو', 'بكين'],
  ['كم عظمة بجسم الإنسان البالغ؟', '206', '300', '196', '212'],
  ['أصغر عدد أولي؟', '2', '1', '3', '0'],
  ['أكثر غاز موجود بالهواء؟', 'النيتروجين', 'الأوكسجين', 'ثاني أوكسيد الكربون', 'الهيدروجين'],
  ['درجة غليان الماي عند سطح البحر؟', '100°', '90°', '80°', '120°'],
  ['شنو عاصمة تركيا؟', 'أنقرة', 'إسطنبول', 'إزمير', 'بورصة'],
  ['كم لاعب لكل فريق كرة قدم داخل الملعب؟', '11', '10', '9', '12'],
  ['أعلى جبل بالعالم؟', 'إيفرست', 'كليمنجارو', 'مون بلان', 'K2'],
  ['أي كوكب يسمونه الكوكب الأحمر؟', 'المريخ', 'الزهرة', 'عطارد', 'زحل'],
  ['مدينة بابل الأثرية بيا دولة؟', 'العراق', 'سوريا', 'إيران', 'مصر'],
  ['الجذر التربيعي لـ 144؟', '12', '14', '11', '16'],
  ['أكبر دولة عربية مساحةً؟', 'الجزائر', 'السعودية', 'السودان', 'مصر'],
  ['أي عضو يضخ الدم بالجسم؟', 'القلب', 'الكبد', 'الرئة', 'الكلية'],
  ['شنو عاصمة فرنسا؟', 'باريس', 'ليون', 'مرسيليا', 'نيس'],
  ['أصغر قارة بالعالم؟', 'أستراليا', 'أوروبا', 'أنتاركتيكا', 'أمريكا الجنوبية'],
  ['الحيوان الملقب بسفينة الصحراء؟', 'الجمل', 'الحصان', 'الفيل', 'الزرافة'],
  ['أكبر عضو بجسم الإنسان؟', 'الجلد', 'الكبد', 'الدماغ', 'الرئة'],
  ['كم سن عند الإنسان البالغ؟', '32', '28', '30', '36'],
  ['الرمز الكيميائي للحديد؟', 'Fe', 'Ir', 'I', 'Fr'],
  ['أول إنسان صعد للفضاء؟', 'يوري غاغارين', 'نيل أرمسترونغ', 'باز ألدرن', 'جون غلين'],
  ['أول إنسان مشى على القمر؟', 'نيل أرمسترونغ', 'يوري غاغارين', 'باز ألدرن', 'مايكل كولينز'],
  ['أكبر صحراء حارة بالعالم؟', 'الصحراء الكبرى', 'الربع الخالي', 'صحراء غوبي', 'كالاهاري'],
  ['بيا سنة بدت الحرب العالمية الثانية؟', '1939', '1914', '1945', '1941'],
  ['شنو لون الزمرد؟', 'أخضر', 'أحمر', 'أزرق', 'أصفر'],
  ['كم دقيقة بالساعة؟', '60', '100', '30', '90'],
  ['شنو عاصمة مصر؟', 'القاهرة', 'الإسكندرية', 'الجيزة', 'أسوان'],
  ['النهرين اللي يمرون بالعراق؟', 'دجلة والفرات', 'النيل والأردن', 'دجلة والنيل', 'الفرات والعاصي'],
  ['كم سنة بالقرن؟', '100', '10', '1000', '50'],
  ['شنو أخف عنصر كيميائي؟', 'الهيدروجين', 'الهيليوم', 'الأوكسجين', 'الليثيوم'],
  ['كم ضلع للمثمن؟', '8', '6', '10', '7'],
  ['شنو أكبر حيوان على الأرض؟', 'الحوت الأزرق', 'الفيل', 'القرش', 'الزرافة'],
  ['شنو الكوكب الأقرب للشمس؟', 'عطارد', 'الزهرة', 'الأرض', 'المريخ'],
];

/* ================== الألعاب ================== */
const G = {};

/* ---------- 1) إكس أو ---------- */
const XO_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const xoWin = b => { for (const [a, c, d] of XO_LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]; return b.every(Boolean) ? 'draw' : null; };
function minimax(b, turn) {
  const w = xoWin(b);
  if (w === 'O') return { s: 1 }; if (w === 'X') return { s: -1 }; if (w === 'draw') return { s: 0 };
  let best = { s: turn === 'O' ? -2 : 2 };
  for (let i = 0; i < 9; i++) if (!b[i]) {
    b[i] = turn; const r = minimax(b, turn === 'O' ? 'X' : 'O'); b[i] = null;
    if (turn === 'O' ? r.s > best.s : r.s < best.s) best = { s: r.s, i };
  }
  return best;
}
G.xo = {
  name: 'إكس أو', emoji: '❌',
  init(st) { st.b = Array(9).fill(null); st.res = null; },
  act(st, a) {
    const i = +a;
    if (st.res || st.b[i]) return;
    st.b[i] = 'X';
    st.res = xoWin(st.b);
    if (!st.res) {
      const free = st.b.map((v, k) => v ? -1 : k).filter(k => k >= 0);
      st.b[Math.random() < 0.25 ? pick(free) : minimax(st.b, 'O').i] = 'O';
      st.res = xoWin(st.b);
    }
    if (st.res === 'X') award(st, 5, true);
    else if (st.res === 'draw') award(st, 2, false);
    else if (st.res === 'O') award(st, 0, false);
  },
  view(st) {
    const sym = { X: '❌', O: '⭕' };
    const rows = [0, 1, 2].map(r => [0, 1, 2].map(c => { const i = r * 3 + c; return btn(st.b[i] ? sym[st.b[i]] : '⬜', st.res || st.b[i] ? NOOP : `xo:${i}`); }));
    const status = { X: '🎉 <b>فزت!</b> عاش يا بطل', O: '🤖 <b>البوت فاز</b>، جرّب مرة ثانية', draw: '🤝 <b>تعادل!</b>' }[st.res] || 'دورك… انت ❌ والبوت ⭕';
    rows.push(st.res ? again('xo') : [BACK]);
    return { text: `❌⭕ <b>إكس أو</b>\n\n${status}${gainLine(st)}`, rows };
  },
};

/* ---------- 2) حجرة ورقة مقص ---------- */
const RPS = { r: '✊ حجرة', p: '✋ ورقة', s: '✌️ مقص' };
const BEATS = { r: 's', p: 'r', s: 'p' };
G.rps = {
  name: 'حجرة ورقة مقص', emoji: '✊',
  init(st) { st.me = 0; st.bot = 0; st.log = []; },
  act(st, a) {
    if (st.done || !RPS[a]) return;
    const b = pick(Object.keys(RPS));
    let r = '🤝 تعادل';
    if (BEATS[a] === b) { st.me++; r = '✅ ربحت الجولة'; } else if (BEATS[b] === a) { st.bot++; r = '❌ خسرت الجولة'; }
    st.log.unshift(`${RPS[a]}  ضد  ${RPS[b]}  ←  ${r}`);
    st.log = st.log.slice(0, 4);
    if (st.me === 3 || st.bot === 3) { st.done = true; award(st, st.me === 3 ? 3 : 0, st.me === 3); }
  },
  view(st) {
    const head = `✊✋✌️ <b>حجرة ورقة مقص</b>\nأول واحد يوصل 3 يفوز\n\n👤 انت <b>${st.me}</b>  —  <b>${st.bot}</b> البوت 🤖`;
    const log = st.log.length ? `\n\n${st.log.join('\n')}` : '\n\nاختار حركتك 👇';
    const end = st.done ? (st.me === 3 ? '\n\n🏆 <b>فزت بالمباراة!</b>' : '\n\n😅 <b>البوت فاز بالمباراة</b>') : '';
    const rows = st.done ? [again('rps')] : [Object.keys(RPS).map(k => btn(RPS[k], `rps:${k}`)), [BACK]];
    return { text: head + log + end + gainLine(st), rows };
  },
};

/* ---------- 3) خمّن الرقم (كتابة) ---------- */
G.gn = {
  name: 'خمّن الرقم', emoji: '🔢', text: true,
  init(st) { st.n = rnd(100) + 1; st.max = 7; st.hist = []; st.msg = 'فكرت برقم من 1 إلى 100 🤔\nاكتب تخمينك بالشات 👇'; },
  act(st, a) { if (a === 'q' && !st.done) { st.done = true; st.msg = `🏳️ استسلمت! الرقم كان <b>${st.n}</b>`; award(st, 0, false); } },
  onText(st, txt) {
    const g = parseInt(toEnDigits(txt.trim()), 10);
    if (isNaN(g) || g < 1 || g > 100) { st.msg = '⚠️ اكتب رقم من 1 إلى 100'; return; }
    st.hist.push(g);
    const left = st.max - st.hist.length;
    if (g === st.n) { st.done = true; st.msg = `🎉 <b>صح!</b> الرقم ${st.n} — عرفته بـ ${st.hist.length} محاولة`; award(st, Math.max(2, 10 - st.hist.length + 1), true); }
    else if (left <= 0) { st.done = true; st.msg = `💥 خلصت المحاولات! الرقم كان <b>${st.n}</b>`; award(st, 0, false); }
    else st.msg = `${g < st.n ? '⬆️ أكبر' : '⬇️ أصغر'} من ${g}`;
  },
  view(st) {
    const left = st.max - st.hist.length;
    const hist = st.hist.length ? `\nتخميناتك: ${st.hist.map(h => h < st.n ? `${h}⬆️` : h > st.n ? `${h}⬇️` : `${h}✅`).join('  ')}` : '';
    const rows = st.done ? [again('gn')] : [[btn('🏳️ استسلم', 'gn:q'), BACK]];
    return { text: `🔢 <b>خمّن الرقم</b>\n\n${st.msg}${hist}\n${st.done ? '' : `\n❤️ المحاولات الباقية: <b>${left}</b>`}${gainLine(st)}`, rows };
  },
};

/* ---------- 4) سؤال وجواب ---------- */
G.qz = {
  name: 'سؤال وجواب', emoji: '🧠',
  init(st) {
    st.qs = shuffle(QUIZ).slice(0, 7).map(([q, ok, ...w]) => { const opts = shuffle([ok, ...w]); return { q, opts, ok: opts.indexOf(ok) }; });
    st.i = 0; st.score = 0; st.fb = '';
  },
  act(st, a) {
    if (st.done) return;
    const cur = st.qs[st.i];
    if (+a === cur.ok) { st.score++; st.fb = '✅ <b>صح!</b>'; }
    else st.fb = `❌ <b>غلط</b> — الجواب: ${esc(cur.opts[cur.ok])}`;
    st.i++;
    if (st.i >= st.qs.length) { st.done = true; award(st, st.score * 2, st.score >= 5); }
  },
  view(st) {
    const fb = st.fb ? `${st.fb}\n\n` : '';
    if (st.done) {
      const stars = st.score === 7 ? '🏆 عبقري!' : st.score >= 5 ? '👏 ممتاز' : st.score >= 3 ? '🙂 مو بطال' : '📚 تحتاج تقرا أكثر';
      return { text: `🧠 <b>سؤال وجواب</b>\n\n${fb}النتيجة: <b>${st.score} / ${st.qs.length}</b>\n${stars}${gainLine(st)}`, rows: [again('qz')] };
    }
    const cur = st.qs[st.i];
    const rows = cur.opts.map((o, k) => [btn(o, `qz:${k}`)]);
    rows.push([BACK]);
    return { text: `🧠 <b>سؤال وجواب</b>  (${st.i + 1}/${st.qs.length})  •  ✅ ${st.score}\n\n${fb}❓ <b>${esc(cur.q)}</b>`, rows };
  },
};

/* ---------- 5) رتّب الكلمة (كتابة) ---------- */
G.sc = {
  name: 'رتّب الكلمة', emoji: '🔤', text: true,
  init(st) {
    const [w, h] = pick(WORDS);
    st.w = w; st.h = h; st.tries = 3; st.hint = false;
    const letters = [...w];
    let s; do { s = shuffle(letters); } while (s.join('') === w && new Set(letters).size > 1);
    st.mix = s.join('  ');
    st.msg = 'رتّب الحروف واكتب الكلمة بالشات 👇';
  },
  act(st, a) {
    if (st.done) return;
    if (a === 'h') { if (st.hint) return 'التلميح ظاهر 👆'; st.hint = true; }
    if (a === 'q') { st.done = true; st.msg = `🏳️ الكلمة كانت <b>${st.w}</b>`; award(st, 0, false); }
  },
  onText(st, txt) {
    if (norm(txt) === norm(st.w)) { st.done = true; st.msg = `🎉 <b>صح!</b> الكلمة: ${st.w}`; award(st, st.hint ? 3 : 5, true); return; }
    st.tries--;
    if (st.tries <= 0) { st.done = true; st.msg = `💥 خلصت المحاولات! الكلمة كانت <b>${st.w}</b>`; award(st, 0, false); }
    else st.msg = `❌ «${esc(txt.slice(0, 30))}» غلط، حاول مرة ثانية`;
  },
  view(st) {
    const hint = st.hint ? `\n💡 التلميح: ${st.h} — تبدي بحرف «${st.w[0]}»` : '';
    const rows = st.done ? [again('sc')] : [[btn('💡 تلميح', 'sc:h'), btn('🏳️ استسلم', 'sc:q')], [BACK]];
    return { text: `🔤 <b>رتّب الكلمة</b>\n\n<b>${st.mix}</b>\n${hint}\n\n${st.msg}${st.done ? '' : `\n❤️ المحاولات: <b>${st.tries}</b>`}${gainLine(st)}`, rows };
  },
};

/* ---------- 6) المشنقة ---------- */
const HM_LETTERS = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'];
const GALLOWS = [
  '  +---+\n  |   |\n      |\n      |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n      |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n  |   |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n /|   |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n=========',
  '  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n=========',
];
G.hm = {
  name: 'المشنقة', emoji: '🪢',
  init(st) { const [w, h] = pick(WORDS); st.w = w; st.h = h; st.used = []; st.wrong = 0; },
  act(st, a) {
    if (st.done) return;
    const L = HM_LETTERS[+a];
    if (!L || st.used.includes(L)) return;
    st.used.push(L);
    const chars = [...st.w].map(normCh).filter(c => HM_LETTERS.includes(c));
    if (!chars.includes(L)) st.wrong++;
    if (chars.every(c => st.used.includes(c))) { st.done = 'win'; award(st, Math.max(2, 7 - st.wrong), true); }
    else if (st.wrong >= 6) { st.done = 'lose'; award(st, 0, false); }
  },
  view(st) {
    const shown = [...st.w].map(c => st.done || !HM_LETTERS.includes(normCh(c)) || st.used.includes(normCh(c)) ? c : '＿').join(' ');
    const status = st.done === 'win' ? '🎉 <b>فزت!</b>' : st.done === 'lose' ? `💀 <b>خسرت</b> — الكلمة: ${st.w}` : `${'❤️'.repeat(6 - st.wrong)}${'🖤'.repeat(st.wrong)}`;
    const text = `🪢 <b>المشنقة</b>\n💡 ${st.h}\n<pre>${GALLOWS[st.wrong]}</pre>\n<b>${shown}</b>\n\n${status}${gainLine(st)}`;
    if (st.done) return { text, rows: [again('hm')] };
    const rows = [];
    for (let i = 0; i < HM_LETTERS.length; i += 7)
      rows.push(HM_LETTERS.slice(i, i + 7).map((L, k) => st.used.includes(L) ? btn('·', NOOP) : btn(L, `hm:${i + k}`)));
    rows.push([BACK]);
    return { text, rows };
  },
};

/* ---------- 7) لعبة الذاكرة ---------- */
const MM_ICONS = ['🍎', '🍌', '🍇', '🍓', '🍒', '🥝', '🍉', '🍍', '🥥', '🍑', '🫐', '🍋'];
G.mm = {
  name: 'لعبة الذاكرة', emoji: '🃏',
  init(st) { const icons = shuffle(MM_ICONS).slice(0, 8); st.cards = shuffle([...icons, ...icons]); st.open = []; st.matched = []; st.moves = 0; },
  act(st, a) {
    if (st.done) return;
    const i = +a;
    if (st.matched.includes(i) || st.open.includes(i)) return;
    if (st.open.length === 2) st.open = [];
    st.open.push(i);
    if (st.open.length === 2) {
      st.moves++;
      const [x, y] = st.open;
      if (st.cards[x] === st.cards[y]) { st.matched.push(x, y); st.open = []; }
    }
    if (st.matched.length === 16) { st.done = true; award(st, st.moves <= 12 ? 8 : st.moves <= 18 ? 5 : 3, true); }
  },
  view(st) {
    const rows = [0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => {
      const i = r * 4 + c; const vis = st.matched.includes(i) || st.open.includes(i);
      return btn(vis ? st.cards[i] : '❔', vis ? NOOP : `mm:${i}`);
    }));
    rows.push(st.done ? again('mm') : [BACK]);
    const status = st.done ? `🎉 <b>خلصتها بـ ${st.moves} حركة!</b>` : `اكشف كل زوج متشابه\nالأزواج: <b>${st.matched.length / 2}/8</b>  •  الحركات: <b>${st.moves}</b>`;
    return { text: `🃏 <b>لعبة الذاكرة</b>\n\n${status}${gainLine(st)}`, rows };
  },
};

/* ---------- 8) كاسحة الألغام ---------- */
const MS_W = 7, MS_N = 49, MS_MINES = 8;
const NUMS = ['▫️', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
const msNb = i => { const r = Math.floor(i / MS_W), c = i % MS_W, out = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < MS_W && cc >= 0 && cc < MS_W) out.push(rr * MS_W + cc); } return out; };
G.ms = {
  name: 'كاسحة الألغام', emoji: '💣',
  init(st) { st.mines = null; st.rev = Array(MS_N).fill(false); st.flag = Array(MS_N).fill(false); st.mode = 'dig'; },
  act(st, a) {
    if (st.done) return;
    if (a === 'm') { st.mode = st.mode === 'dig' ? 'flag' : 'dig'; return st.mode === 'flag' ? '🚩 وضع الأعلام' : '⛏ وضع الحفر'; }
    const i = +a;
    if (st.rev[i]) return;
    if (st.mode === 'flag') { st.flag[i] = !st.flag[i]; return; }
    if (st.flag[i]) return 'شيل العلم أول 🚩';
    if (!st.mines) {
      const safe = new Set([i, ...msNb(i)]);
      st.mines = new Set(shuffle([...Array(MS_N).keys()].filter(k => !safe.has(k))).slice(0, MS_MINES));
      st.cnt = [...Array(MS_N).keys()].map(k => msNb(k).filter(n => st.mines.has(n)).length);
    }
    if (st.mines.has(i)) { st.done = 'lose'; st.boom = i; award(st, 0, false); return '💥 انفجر!'; }
    const stack = [i];
    while (stack.length) {
      const k = stack.pop(); if (st.rev[k]) continue;
      st.rev[k] = true; st.flag[k] = false;
      if (st.cnt[k] === 0) for (const n of msNb(k)) if (!st.rev[n]) stack.push(n);
    }
    if (st.rev.filter(Boolean).length === MS_N - MS_MINES) { st.done = 'win'; award(st, 8, true); }
  },
  view(st) {
    const rows = [];
    for (let r = 0; r < MS_W; r++) rows.push([...Array(MS_W).keys()].map(c => {
      const i = r * MS_W + c;
      let t = '⬜';
      if (st.rev[i]) t = NUMS[st.cnt[i]];
      else if (st.done && st.mines && st.mines.has(i)) t = i === st.boom ? '💥' : st.done === 'win' ? '🚩' : '💣';
      else if (st.flag[i]) t = '🚩';
      return btn(t, st.done || st.rev[i] ? NOOP : `ms:${i}`);
    }));
    if (st.done) rows.push(again('ms'));
    else rows.push([btn(st.mode === 'dig' ? '⛏ حفر (اضغط للأعلام)' : '🚩 أعلام (اضغط للحفر)', 'ms:m'), BACK]);
    const flags = st.flag.filter(Boolean).length;
    const status = st.done === 'win' ? '🎉 <b>نظّفت الساحة! فزت</b>' : st.done === 'lose' ? '💥 <b>دست على لغم!</b>' : `💣 الألغام: <b>${MS_MINES}</b>  •  🚩 <b>${flags}</b>\nالوضع: ${st.mode === 'dig' ? '⛏ حفر' : '🚩 وضع علم'}`;
    return { text: `💣 <b>كاسحة الألغام</b>\n\n${status}${gainLine(st)}`, rows };
  },
};

/* ---------- 9) 2048 ---------- */
function slide(line) { const a = line.filter(v => v); let gained = 0; for (let i = 0; i < a.length - 1; i++) if (a[i] === a[i + 1]) { a[i] *= 2; gained += a[i]; a.splice(i + 1, 1); } while (a.length < 4) a.push(0); return { a, gained }; }
function move2048(g, dir) {
  const ng = g.slice(); let moved = false, gained = 0;
  for (let r = 0; r < 4; r++) {
    const idx = [0, 1, 2, 3].map(c => dir === 'L' ? r * 4 + c : dir === 'R' ? r * 4 + (3 - c) : dir === 'U' ? c * 4 + r : (3 - c) * 4 + r);
    const res = slide(idx.map(i => g[i])); gained += res.gained;
    idx.forEach((i, k) => { if (ng[i] !== res.a[k]) moved = true; ng[i] = res.a[k]; });
  }
  return { g: ng, moved, gained };
}
const addTile = g => { const free = g.map((v, i) => v ? -1 : i).filter(i => i >= 0); if (free.length) g[pick(free)] = Math.random() < 0.9 ? 2 : 4; };
const canMove = g => g.some((v, i) => !v || (i % 4 < 3 && v === g[i + 1]) || (i < 12 && v === g[i + 4]));
const TILE = { 0: '·', 2: '2', 4: '4', 8: '8', 16: '16', 32: '32', 64: '64', 128: '128🔸', 256: '256🔶', 512: '512🟠', 1024: '1024🔥', 2048: '2048👑' };
G.g2 = {
  name: '2048', emoji: '🧩',
  init(st) { st.g = Array(16).fill(0); addTile(st.g); addTile(st.g); st.score = 0; },
  act(st, a) {
    if (st.done) return;
    const end = won => { st.done = true; award(st, Math.floor(st.score / 200) + (won ? 20 : 1), won); };
    if (a === 'end') { end(false); return; }
    const r = move2048(st.g, a);
    if (!r.moved) return 'ما يتحرك هالاتجاه';
    st.g = r.g; st.score += r.gained; addTile(st.g);
    if (st.g.includes(2048)) { st.win = true; end(true); }
    else if (!canMove(st.g)) end(false);
  },
  view(st) {
    const rows = [0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => btn(TILE[st.g[r * 4 + c]] || String(st.g[r * 4 + c]), NOOP)));
    if (st.done) rows.push(again('g2'));
    else { rows.push([btn('⬅️', 'g2:L'), btn('⬆️', 'g2:U'), btn('⬇️', 'g2:D'), btn('➡️', 'g2:R')]); rows.push([btn('🏁 إنهاء وأخذ النقاط', 'g2:end'), BACK]); }
    const best = Math.max(...st.g);
    const status = st.done ? (st.win ? '👑 <b>وصلت 2048! أسطورة</b>' : '🏁 <b>انتهت اللعبة</b>') : 'حرّك بالأسهم وادمج الأرقام المتشابهة';
    return { text: `🧩 <b>2048</b>\n\n${status}\n🔢 النقاط: <b>${st.score}</b>  •  أعلى رقم: <b>${best}</b>${gainLine(st)}`, rows };
  },
};

/* ---------- 10) تحدّي الحساب ---------- */
function mathQ(i) {
  let a, b, op, ans;
  if (i < 3) { a = rnd(40) + 10; b = rnd(40) + 5; op = pick(['+', '−']); if (op === '−' && b > a) [a, b] = [b, a]; ans = op === '+' ? a + b : a - b; }
  else if (i < 6) { a = rnd(11) + 2; b = rnd(11) + 2; op = '×'; ans = a * b; }
  else if (i < 8) { b = rnd(10) + 2; ans = rnd(12) + 2; a = b * ans; op = '÷'; }
  else { a = rnd(15) + 6; b = rnd(9) + 3; const c = rnd(30) + 5; op = `× ${b} + `; ans = a * b + c; return { q: `${a} × ${b} + ${c}`, ...opts(ans) }; }
  return { q: `${a} ${op} ${b}`, ...opts(ans) };
  function opts(x) { const s = new Set([x]); while (s.size < 4) { const d = x + (rnd(2) ? 1 : -1) * (rnd(Math.max(3, Math.ceil(Math.abs(x) * 0.2))) + 1); if (d >= 0) s.add(d); } const o = shuffle([...s]); return { opts: o, ok: o.indexOf(x) }; }
}
G.mt = {
  name: 'تحدّي الحساب', emoji: '➗',
  init(st) { st.qs = [...Array(10).keys()].map(mathQ); st.i = 0; st.score = 0; st.t0 = Date.now(); st.fb = ''; },
  act(st, a) {
    if (st.done) return;
    const cur = st.qs[st.i];
    if (+a === cur.ok) { st.score++; st.fb = '✅ صح'; } else st.fb = `❌ غلط — ${cur.q} = ${cur.opts[cur.ok]}`;
    st.i++;
    if (st.i >= 10) { st.done = true; st.secs = Math.round((Date.now() - st.t0) / 1000); award(st, st.score + (st.score === 10 ? 5 : 0) + (st.score === 10 && st.secs < 60 ? 5 : 0), st.score >= 7); }
  },
  view(st) {
    if (st.done) return { text: `➗ <b>تحدّي الحساب</b>\n\n${st.fb}\n\nالنتيجة: <b>${st.score}/10</b>\n⏱ الوقت: <b>${st.secs} ثانية</b>${st.score === 10 ? '\n🔥 علامة كاملة!' : ''}${gainLine(st)}`, rows: [again('mt')] };
    const cur = st.qs[st.i];
    const rows = [cur.opts.slice(0, 2).map((o, k) => btn(String(o), `mt:${k}`)), cur.opts.slice(2).map((o, k) => btn(String(o), `mt:${k + 2}`)), [BACK]];
    return { text: `➗ <b>تحدّي الحساب</b>  (${st.i + 1}/10)  •  ✅ ${st.score}\n${st.fb ? `${st.fb}\n` : ''}\n<b>${cur.q} = ؟</b>`, rows };
  },
};

/* ================== الشاشات العامة ================== */
const ORDER = ['xo', 'rps', 'gn', 'qz', 'sc', 'hm', 'mm', 'ms', 'g2', 'mt'];
function menuView(from) {
  const u = user(from);
  const rows = [];
  for (let i = 0; i < ORDER.length; i += 2) rows.push(ORDER.slice(i, i + 2).map(id => btn(`${G[id].emoji} ${G[id].name}`, `start:${id}`)));
  rows.push([btn('🏆 المتصدرين', 'top'), btn('👤 ملفي', 'me')]);
  return { text: `🎮 <b>صالة الألعاب</b>\n\nهلا <b>${esc(u.name)}</b> 👋\nنقاطك: <b>${u.points}</b> ⭐\n\nاختار لعبة 👇`, rows };
}
function topView() {
  const list = Object.values(db.users).filter(u => u.played).sort((a, b) => b.points - a.points).slice(0, 10);
  const medal = ['🥇', '🥈', '🥉'];
  const body = list.length ? list.map((u, i) => `${medal[i] || `${i + 1}.`} ${esc(u.name)} — <b>${u.points}</b> ⭐`).join('\n') : 'بعد محد لعب… كون انت الأول 💪';
  return { text: `🏆 <b>المتصدرين</b>\n\n${body}`, rows: [[BACK]] };
}
function meView(from) {
  const u = user(from);
  const all = Object.values(db.users).sort((a, b) => b.points - a.points);
  const rank = all.indexOf(u) + 1;
  const per = ORDER.filter(id => u.games[id]).map(id => `${G[id].emoji} ${G[id].name}: ${u.games[id].played} لعبة • ${u.games[id].wins} فوز`).join('\n');
  return { text: `👤 <b>${esc(u.name)}</b>\n\n⭐ النقاط: <b>${u.points}</b>\n🏅 الترتيب: <b>${rank}</b> من ${all.length}\n🎮 لعبت: <b>${u.played}</b>  •  🏆 فزت: <b>${u.wins}</b>${per ? `\n\n${per}` : ''}`, rows: [[BACK]] };
}
const HELP = `🎮 <b>بوت صالة الألعاب</b>\n\n10 ألعاب بالأزرار، كل فوز يعطيك نقاط ⭐ وتنافس على لوحة المتصدرين.\n\n/games — قائمة الألعاب\n/top — المتصدرين\n/me — ملفي ونقاطي\n/help — المساعدة\n\n🔢 «خمّن الرقم» و 🔤 «رتّب الكلمة» تنلعب بالكتابة بالشات.`;

/* ================== التشغيل ================== */
async function show(ctx, { text, rows }) {
  const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } };
  if (ctx.callbackQuery?.message) {
    try { await ctx.editMessageText(text, opts); }
    catch (e) { if (!/not modified/.test(e.description || e.message)) throw e; }
    return ctx.callbackQuery.message;
  }
  return ctx.reply(text, opts);
}

function createBot(token, botOpts) {
  const bot = new Bot(token, botOpts);

  bot.command('start', ctx => show(ctx, menuView(ctx.from)));
  bot.command(['games', 'menu'], ctx => show(ctx, menuView(ctx.from)));
  bot.command('top', ctx => show(ctx, topView()));
  bot.command('me', ctx => show(ctx, meView(ctx.from)));
  bot.command('help', ctx => ctx.reply(HELP, { parse_mode: 'HTML' }));

  bot.on('callback_query:data', async ctx => {
    const data = ctx.callbackQuery.data;
    const msg = ctx.callbackQuery.message;
    if (data === NOOP || !msg) return ctx.answerCallbackQuery();
    const key = `${msg.chat.id}:${msg.message_id}`;
    let st = S.get(key);
    if (st && st.from.id !== ctx.from.id) return ctx.answerCallbackQuery({ text: 'هاي اللعبة مو إلك 😅 افتح لعبتك بـ /games' });

    const [cmd, arg] = data.split(':');
    let toast;
    const dropText = () => { const tk = `${msg.chat.id}:${ctx.from.id}`; const t = T.get(tk); if (t && t.key === key) T.delete(tk); };

    if (cmd === 'menu' || cmd === 'top' || cmd === 'me') {
      S.delete(key); dropText();
      await show(ctx, cmd === 'menu' ? menuView(ctx.from) : cmd === 'top' ? topView() : meView(ctx.from));
    } else if (cmd === 'start' && G[arg]) {
      dropText();
      st = { game: arg, from: ctx.from, chat: msg.chat.id, msgId: msg.message_id, t: Date.now() };
      G[arg].init(st);
      S.set(key, st);
      if (G[arg].text) T.set(`${msg.chat.id}:${ctx.from.id}`, { key });
      await show(ctx, G[arg].view(st));
    } else if (G[cmd]) {
      if (!st || st.game !== cmd) return ctx.answerCallbackQuery({ text: 'هاي اللعبة خلصت، ابدأ وحدة جديدة 🎮' });
      toast = G[cmd].act(st, arg);
      st.t = Date.now();
      if (st.done || st.res) dropText();
      await show(ctx, G[cmd].view(st));
    }
    await ctx.answerCallbackQuery(toast ? { text: toast } : undefined).catch(() => {});
  });

  bot.on('message:text', async ctx => {
    if (ctx.message.text.startsWith('/')) return;
    const tk = `${ctx.chat.id}:${ctx.from.id}`;
    const t = T.get(tk);
    const st = t && S.get(t.key);
    if (!st || st.done) { if (t) T.delete(tk); return; }
    G[st.game].onText(st, ctx.message.text);
    st.t = Date.now();
    if (st.done) T.delete(tk);
    const { text, rows } = G[st.game].view(st);
    await ctx.deleteMessage().catch(() => {}); // تنظيف الشات إذا مسموح
    await ctx.api.editMessageText(st.chat, st.msgId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } })
      .catch(async e => { if (!/not modified/.test(e.description || '')) await ctx.reply(text, { parse_mode: 'HTML' }); });
  });

  bot.catch(err => console.error('Bot error:', err.error?.description || err.error?.message || err.message));
  return bot;
}

// تنظيف الألعاب القديمة (أكثر من 6 ساعات)
setInterval(() => {
  const old = Date.now() - 6 * 3600e3;
  for (const [k, st] of S) if (st.t < old) S.delete(k);
  for (const [k, t] of T) if (!S.has(t.key)) T.delete(k);
}, 30 * 60e3).unref();

module.exports = { setStore, createBot, G, S, T, db, move2048, minimax, xoWin, norm };

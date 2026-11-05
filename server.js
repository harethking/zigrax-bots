'use strict';
/**
 * تشغيل البوتين سوا:
 *  - على Render (أو أي سيرفر عنده رابط): Webhook
 *  - على الحاسبة: Polling
 * التخزين: Supabase إذا موجود، وإلا ملفات محلية
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

// .env محلي (اختياري)
for (const f of ['.env', 'games-bot/.env', 'group-bot/.env']) {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let [, k, v] = m; v = v.replace(/^["']|["']$/g, '');
    if (f.startsWith('games') && k === 'BOT_TOKEN') k = 'GAMES_TOKEN';
    if (f.startsWith('group') && k === 'BOT_TOKEN') k = 'GUARD_TOKEN';
    if (!process.env[k]) process.env[k] = v;
  }
}

const { GAMES_TOKEN, GUARD_TOKEN, SUPABASE_URL, SUPABASE_KEY } = process.env;
const BASE_URL = (process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const SECRET = process.env.WEBHOOK_SECRET || require('crypto').createHash('sha256').update(String(GAMES_TOKEN) + GUARD_TOKEN).digest('hex').slice(0, 32);
const PORT = process.env.PORT || 3000;

/* ---------- التخزين ---------- */
const sb = (p, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${p}`, { ...opts, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...opts.headers } });
async function loadStore(key) {
  if (!SUPABASE_URL) return null;
  const r = await sb(`tg_bot_store?key=eq.${key}&select=data`);
  if (!r.ok) throw new Error(`Supabase load ${key}: ${r.status} ${await r.text()}`);
  return (await r.json())[0]?.data || null;
}
function saver(key) {
  let busy = false, again = false;
  return async function persist(data) {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const r = await sb('tg_bot_store?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ key, data, updated_at: new Date().toISOString() }) });
      if (!r.ok) console.error('Supabase save', key, r.status, await r.text());
    } catch (e) { console.error('Supabase save', key, e.message); }
    busy = false;
    if (again) { again = false; persist(data); }
  };
}

(async () => {
  const { webhookCallback } = require('./games-bot/node_modules/grammy');
  const bots = [];
  const defs = [
    { key: 'games', token: GAMES_TOKEN, mod: require('./games-bot/bot'), updates: ['message', 'callback_query'], cmds: [['games', '🎮 قائمة الألعاب'], ['top', '🏆 المتصدرين'], ['me', '👤 ملفي ونقاطي'], ['help', '❓ المساعدة']],
      desc: '🎮 صالة ألعاب فيها 10 ألعاب: إكس أو، حجرة ورقة مقص، خمّن الرقم، سؤال وجواب، رتّب الكلمة، المشنقة، الذاكرة، كاسحة الألغام، 2048، وتحدّي الحساب.\nاجمع نقاط ونافس على لوحة المتصدرين 🏆', short: '🎮 10 ألعاب ونقاط ولوحة متصدرين' },
    { key: 'guard', token: GUARD_TOKEN, mod: require('./group-bot/bot'), updates: ['message', 'edited_message', 'callback_query', 'my_chat_member', 'chat_member'], cmds: [['start', '🛡️ تشغيل البوت'], ['help', '📋 الأوامر'], ['id', '🆔 ايدي ومعلومات'], ['rules', '📜 القوانين']],
      desc: '🛡️ بوت حماية وإدارة المجموعات بأوامر عربية: طرد، حظر، كتم، تحذير، رتب، رفع مشرفين، عدد الرسائل، ايدي وبايو، أقفال، ترحيب، ردود، وتوب المتفاعلين.\n\nضيفني لمجموعتك وخليني مشرف، وبعدين اكتب «الاوامر»', short: '🛡️ حماية وإدارة المجموعات بأوامر عربية' },
  ];
  for (const d of defs) {
    if (!d.token) { console.log(`⏭ ${d.key}: ماكو توكن`); continue; }
    if (SUPABASE_URL) d.mod.setStore(await loadStore(d.key), saver(d.key));
    const bot = d.mod.createBot(d.token);
    await bot.init();
    bot.api.setMyCommands(d.cmds.map(([command, description]) => ({ command, description }))).catch(() => {});
    bot.api.setMyDescription(d.desc).catch(() => {});
    bot.api.setMyShortDescription(d.short).catch(() => {});
    // صورة البروفايل: تنحط إذا البوت ما عنده صورة (أو FORCE_AVATAR=1)
    const av = path.join(__dirname, 'avatars', `${d.key}.jpg`);
    if (fs.existsSync(av)) {
      const has = await bot.api.getUserProfilePhotos(bot.botInfo.id, { limit: 1 }).then(r => r.total_count > 0).catch(() => true);
      if (!has || process.env.FORCE_AVATAR === '1') {
        const { InputFile } = require('./games-bot/node_modules/grammy');
        await bot.api.setMyProfilePhoto({ type: 'static', photo: new InputFile(av) })
          .then(() => console.log(`🖼 avatar set: ${d.key}`))
          .catch(e => console.error(`avatar ${d.key}:`, e.description || e.message));
      }
    }
    bots.push({ ...d, bot });
    console.log(`✅ ${d.key}: @${bot.botInfo.username}`);
  }

  if (BASE_URL) {
    const handlers = Object.fromEntries(bots.map(b => [`/tg/${b.key}/${SECRET}`, webhookCallback(b.bot, 'http', { timeoutMilliseconds: 25000 })]));
    http.createServer((req, res) => {
      const h = req.method === 'POST' && handlers[req.url];
      if (h) return h(req, res).catch(e => { console.error(e); if (!res.headersSent) { res.statusCode = 200; res.end(); } });
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('🤖 Zigrax bots running');
    }).listen(PORT, () => console.log(`🌐 Webhook server on :${PORT}`));
    for (const b of bots) {
      await b.bot.api.setWebhook(`${BASE_URL}/tg/${b.key}/${SECRET}`, { allowed_updates: b.updates, drop_pending_updates: false });
      console.log(`🔗 webhook set: ${b.key}`);
    }
  } else {
    for (const b of bots) { await b.bot.api.deleteWebhook().catch(() => {}); b.bot.start({ allowed_updates: b.updates }); }
    console.log('🔄 Polling mode (محلي)');
  }
})().catch(e => { console.error('Startup failed:', e); process.exit(1); });

process.on('unhandledRejection', e => console.error(e));

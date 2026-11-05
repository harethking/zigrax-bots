'use strict';
/**
 * 🛡️ بوت حماية وإدارة المجموعات — أوامر عربية بدون سلاش
 */
const fs = require('fs');
const path = require('path');
const { Bot, InputFile } = require('grammy');

/* ================== أدوات ================== */
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const CH = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ؤ': 'و', 'ئ': 'ي' };
const norm = s => [...s].map(c => CH[c] || c).join('').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)); // حرف مقابل حرف
const fullName = u => [u.first_name, u.last_name].filter(Boolean).join(' ') || u.title || 'بدون اسم';
const mention = u => `<a href="tg://user?id=${u.id}">${esc(fullName(u))}</a>`;
const today = () => new Date().toISOString().slice(0, 10);
const btn = (text, data) => ({ text, callback_data: data });
const ANON_ADMIN = 1087968824;

/* ================== التخزين ================== */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
let db = { chats: {}, usernames: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch { /* جديد */ }
let saveT;
let persist = null;
function setStore(data, fn) { if (data && data.chats) db = { chats: {}, usernames: {}, ...data }; persist = fn; }
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { if (persist) return persist(db); try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); } catch (e) { console.error('save', e.message); } }, 1000); };
const C = id => db.chats[id] || (db.chats[id] = {
  ranks: {}, locks: {}, stats: {}, warns: {}, muted: {}, banned: {}, replies: {}, filters: [],
  welcome: 'أهلاً {الاسم} 🌹\nنورت مجموعة {المجموعة}\nأنت العضو رقم {العدد}',
  welcomeOn: true, rules: '',
});

/* ================== الرتب ================== */
const RANKS = ['عضو', 'مميز', 'ادمن', 'مدير', 'المالك', 'مطور البوت'];
const RANK_BY = { 'مميز': 1, 'ادمن': 2, 'مدير': 3 };
const RANK_PLURAL = { 1: 'المميزين', 2: 'الادمنيه', 3: 'المدراء' };
const DEVS = String(process.env.DEV_IDS || '').split(/[,\s]+/).filter(Boolean).map(Number);

const memberCache = new Map();
async function member(api, chat, uid) {
  const k = `${chat}:${uid}`, c = memberCache.get(k);
  if (c && Date.now() - c.t < 120e3) return c.m;
  const m = await api.getChatMember(chat, uid).catch(() => null);
  memberCache.set(k, { m, t: Date.now() });
  return m;
}
async function level(api, chat, uid) {
  if (DEVS.includes(uid)) return 5;
  if (uid === ANON_ADMIN) return 3;
  const m = await member(api, chat, uid);
  if (m?.status === 'creator') return 4;
  const r = C(chat).ranks[uid] || 0;
  return m?.status === 'administrator' ? Math.max(2, r) : r;
}

/* ================== الأقفال ================== */
const ents = m => [...(m.entities || []), ...(m.caption_entities || [])];
const LINK_RE = /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|\b[\w-]+\.(com|net|org|io|me|iq|xyz|info)\b)/i;
const LOCKS = {
  'الروابط': m => ents(m).some(e => e.type === 'url' || e.type === 'text_link') || LINK_RE.test(m.text || m.caption || ''),
  'المعرفات': m => ents(m).some(e => e.type === 'mention' || e.type === 'text_mention'),
  'الصور': m => !!m.photo,
  'الفيديو': m => !!(m.video || m.video_note),
  'الملصقات': m => !!m.sticker,
  'المتحركات': m => !!m.animation,
  'الصوت': m => !!(m.voice || m.audio),
  'الملفات': m => !!m.document && !m.animation,
  'التوجيه': m => !!(m.forward_origin || m.forward_date),
  'الكلايش': m => (m.text || m.caption || '').length > 700,
  'الانلاين': m => !!m.via_bot,
  'الجهات': m => !!m.contact,
  'الاستفتاء': m => !!m.poll,
  'الدردشه': () => true,
  'التعديل': null, 'البوتات': null, 'الاشعارات': null, 'التكرار': null,
};
const LOCK_LABEL = k => k.replace(/ه$/, 'ة').replace('الاشعارات', 'الإشعارات');
const flood = new Map();

/* ================== صلاحيات الكتم ================== */
const PERM_KEYS = ['can_send_messages', 'can_send_audios', 'can_send_documents', 'can_send_photos', 'can_send_videos', 'can_send_video_notes', 'can_send_voice_notes', 'can_send_polls', 'can_send_other_messages', 'can_add_web_page_previews'];
const NO_PERMS = Object.fromEntries(PERM_KEYS.map(k => [k, false]));
async function chatPerms(api, chat) {
  const c = await api.getChat(chat).catch(() => null);
  return c?.permissions || { ...Object.fromEntries(PERM_KEYS.map(k => [k, true])), can_invite_users: true };
}
function parseDur(s) {
  const m = norm(s || '').match(/(\d+)\s*(دقيقه|دقايق|دقائق|ثانيه|ساعه|ساعات|يوم|ايام|د|س|ي|m|h|d)/);
  if (!m) return 0;
  const u = m[2];
  const mult = /^(د|m)/.test(u) ? 60 : /^(س|h)/.test(u) ? 3600 : /^(ي|d|ا)/.test(u) ? 86400 : 60;
  return +m[1] * mult;
}
const fmtDur = s => s >= 86400 ? `${Math.round(s / 86400)} يوم` : s >= 3600 ? `${Math.round(s / 3600)} ساعة` : `${Math.round(s / 60)} دقيقة`;
const activity = n => n < 100 ? 'ضعيف 🥶' : n < 500 ? 'متوسط 🙂' : n < 2000 ? 'متفاعل 🔥' : n < 6000 ? 'نار 🚀' : 'أسطورة 👑';

/* ================== تحديد الهدف ================== */
async function target(ctx, rest) {
  const r = ctx.msg.reply_to_message;
  if (r && r.from && !r.forum_topic_created) {
    if (r.sender_chat && r.from.id === 136817688) return { err: 'هاي رسالة قناة، ما أكدر أطبق عليها 🙃' };
    return { user: r.from, rest };
  }
  const m = rest.match(/^(@[\w]{4,}|\d{5,})\s*([\s\S]*)$/);
  if (!m) return { err: '↩️ رد على رسالة الشخص أو اكتب معرفه / ايديه بعد الأمر' };
  let id = m[1][0] === '@' ? db.usernames[m[1].slice(1).toLowerCase()] : +m[1];
  if (!id) return { err: '❓ ما أعرف هذا المعرف، استخدم الرد على رسالته' };
  const mem = await member(ctx.api, ctx.chat.id, id);
  return { user: mem?.user || { id, first_name: String(id) }, rest: m[2] };
}
// يتأكد إن المنفّذ أعلى من الهدف
async function guard(ctx, me, t) {
  if (t.user.id === ctx.me.id) return 'ما أكدر أسويها على نفسي 😅';
  if (t.user.id === ctx.from.id) return 'ما تكدر تسويها على نفسك 😅';
  const tl = await level(ctx.api, ctx.chat.id, t.user.id);
  if (tl >= me) return `ما تكدر، رتبته (${RANKS[tl]}) أعلى أو تساوي رتبتك`;
  return null;
}
const failMsg = e => {
  const d = e?.description || e?.message || '';
  if (/not enough rights|CHAT_ADMIN_REQUIRED|need administrator/i.test(d)) return '❌ البوت ما عنده صلاحية كافية، خليه مشرف بكل الصلاحيات';
  if (/administrator/i.test(d)) return '❌ ما أكدر أطبقها على مشرف بالمجموعة';
  if (/user not found|PARTICIPANT_ID_INVALID/i.test(d)) return '❌ الشخص مو موجود بالمجموعة';
  return `❌ صار خطأ: ${esc(d).slice(0, 150)}`;
};

/* ================== الأوامر ================== */
// [الأوامر، أقل رتبة، الدالة(ctx, rest, me)]
const CMDS = [];
const cmd = (names, min, fn) => CMDS.push(...[].concat(names).map(n => ({ n: norm(n), min, fn })));
const reply = (ctx, text, extra = {}) => ctx.reply(text, { parse_mode: 'HTML', reply_parameters: { message_id: ctx.msg.message_id, allow_sending_without_reply: true }, link_preview_options: { is_disabled: true }, ...extra });

/* ---- الإدارة ---- */
async function doAction(ctx, rest, me, kind) {
  const t = await target(ctx, rest); if (t.err) return reply(ctx, t.err);
  const g = await guard(ctx, me, t); if (g) return reply(ctx, '⛔ ' + g);
  const c = C(ctx.chat.id), u = t.user, chat = ctx.chat.id, by = `\n👮 بواسطة: ${mention(ctx.from)}`;
  try {
    if (kind === 'kick') { await ctx.api.banChatMember(chat, u.id); await ctx.api.unbanChatMember(chat, u.id, { only_if_banned: true }); return reply(ctx, `👢 تم طرد ${mention(u)}${by}`); }
    if (kind === 'ban') { await ctx.api.banChatMember(chat, u.id); c.banned[u.id] = fullName(u); save(); return reply(ctx, `🚫 تم حظر ${mention(u)}${by}`); }
    if (kind === 'unban') { await ctx.api.unbanChatMember(chat, u.id, { only_if_banned: true }); delete c.banned[u.id]; save(); return reply(ctx, `✅ تم الغاء حظر ${mention(u)}`); }
    if (kind === 'mute') {
      const d = parseDur(t.rest);
      await ctx.api.restrictChatMember(chat, u.id, NO_PERMS, d >= 60 ? { until_date: Math.floor(Date.now() / 1000) + d } : {});
      c.muted[u.id] = fullName(u); save();
      return reply(ctx, `🔇 تم كتم ${mention(u)}${d >= 60 ? ` لمدة ${fmtDur(d)}` : ''}${by}`);
    }
    if (kind === 'unmute') { await ctx.api.restrictChatMember(chat, u.id, await chatPerms(ctx.api, chat)); delete c.muted[u.id]; save(); return reply(ctx, `🔊 تم الغاء كتم ${mention(u)}`); }
    if (kind === 'warn') {
      const n = (c.warns[u.id] = (c.warns[u.id] || 0) + 1); save();
      if (n >= 3) {
        c.warns[u.id] = 0; c.muted[u.id] = fullName(u); save();
        await ctx.api.restrictChatMember(chat, u.id, NO_PERMS, { until_date: Math.floor(Date.now() / 1000) + 86400 });
        return reply(ctx, `⚠️ ${mention(u)} وصل 3/3 تحذيرات\n🔇 انكتم يوم كامل`);
      }
      return reply(ctx, `⚠️ تحذير لـ ${mention(u)}  (${n}/3)\nبالتحذير الثالث ينكتم يوم`);
    }
    if (kind === 'unwarn') { c.warns[u.id] = 0; save(); return reply(ctx, `🧹 انمسحت تحذيرات ${mention(u)}`); }
  } catch (e) { return reply(ctx, failMsg(e)); }
}
cmd(['طرد', '/kick'], 2, (c, r, m) => doAction(c, r, m, 'kick'));
cmd(['حظر', '/ban'], 2, (c, r, m) => doAction(c, r, m, 'ban'));
cmd(['الغاء حظر', 'الغاء الحظر', '/unban'], 2, (c, r, m) => doAction(c, r, m, 'unban'));
cmd(['كتم', 'تقييد', '/mute'], 2, (c, r, m) => doAction(c, r, m, 'mute'));
cmd(['الغاء كتم', 'الغاء الكتم', 'الغاء تقييد', 'الغاء التقييد', '/unmute'], 2, (c, r, m) => doAction(c, r, m, 'unmute'));
cmd(['تحذير', 'انذار', '/warn'], 2, (c, r, m) => doAction(c, r, m, 'warn'));
cmd(['مسح تحذيرات', 'حذف التحذيرات', 'مسح التحذيرات'], 2, (c, r, m) => doAction(c, r, m, 'unwarn'));

cmd('التحذيرات', 0, async ctx => {
  const r = ctx.msg.reply_to_message?.from || ctx.from;
  reply(ctx, `⚠️ تحذيرات ${mention(r)}: <b>${C(ctx.chat.id).warns[r.id] || 0}/3</b>`);
});
cmd(['المحظورين', 'المكتومين'], 2, (ctx, _r, _m, name) => {
  const c = C(ctx.chat.id), isBan = name === norm('المحظورين');
  const list = Object.entries(isBan ? c.banned : c.muted);
  reply(ctx, list.length ? `${isBan ? '🚫 المحظورين' : '🔇 المكتومين'} (${list.length}):\n\n${list.slice(0, 50).map(([id, n], i) => `${i + 1}. <a href="tg://user?id=${id}">${esc(n)}</a> — <code>${id}</code>`).join('\n')}` : 'القائمة فارغة ✨');
});

/* ---- الرتب ---- */
for (const [rn, rl] of Object.entries(RANK_BY)) {
  cmd([`رفع ${rn}`], rl + 1, async (ctx, rest) => {
    const t = await target(ctx, rest); if (t.err) return reply(ctx, t.err);
    if (t.user.is_bot) return reply(ctx, 'ما ينرفع بوت 🤖');
    C(ctx.chat.id).ranks[t.user.id] = rl; save();
    reply(ctx, `⬆️ ${mention(t.user)} صار <b>${rn}</b> 🎖`);
  });
  cmd([`تنزيل ${rn}`], rl + 1, async (ctx, rest) => {
    const t = await target(ctx, rest); if (t.err) return reply(ctx, t.err);
    const c = C(ctx.chat.id);
    if (c.ranks[t.user.id] !== rl) return reply(ctx, `${mention(t.user)} مو ${rn} أصلاً`);
    delete c.ranks[t.user.id]; save();
    reply(ctx, `⬇️ تم تنزيل ${mention(t.user)} من ${rn}`);
  });
  cmd([RANK_PLURAL[rl]], 1, ctx => {
    const ids = Object.entries(C(ctx.chat.id).ranks).filter(([, v]) => v === rl).map(([k]) => k);
    reply(ctx, ids.length ? `🎖 ${RANK_PLURAL[rl]} (${ids.length}):\n\n${ids.map((id, i) => `${i + 1}. <a href="tg://user?id=${id}">${esc(C(ctx.chat.id).stats[id]?.name || id)}</a>`).join('\n')}` : `ماكو ${RANK_PLURAL[rl]} بعد`);
  });
}
cmd('تنزيل الكل', 4, ctx => { C(ctx.chat.id).ranks = {}; save(); reply(ctx, '🧹 تم تنزيل كل الرتب'); });
cmd(['رفع مشرف', '/promote'], 4, async (ctx, rest) => {
  const t = await target(ctx, rest); if (t.err) return reply(ctx, t.err);
  try {
    await ctx.api.promoteChatMember(ctx.chat.id, t.user.id, { can_delete_messages: true, can_restrict_members: true, can_pin_messages: true, can_invite_users: true, can_manage_video_chats: true, can_change_info: false, can_promote_members: false });
    const title = t.rest.trim(); if (title) await ctx.api.setChatAdministratorCustomTitle(ctx.chat.id, t.user.id, title.slice(0, 16)).catch(() => {});
    memberCache.delete(`${ctx.chat.id}:${t.user.id}`);
    reply(ctx, `👑 تم رفع ${mention(t.user)} مشرف بالمجموعة${title ? `\n🏷 اللقب: ${esc(title.slice(0, 16))}` : ''}`);
  } catch (e) { reply(ctx, failMsg(e)); }
});
cmd(['تنزيل مشرف', '/demote'], 4, async (ctx, rest) => {
  const t = await target(ctx, rest); if (t.err) return reply(ctx, t.err);
  try {
    await ctx.api.promoteChatMember(ctx.chat.id, t.user.id, { can_delete_messages: false, can_restrict_members: false, can_pin_messages: false, can_invite_users: false, can_manage_video_chats: false, can_change_info: false, can_promote_members: false, can_manage_chat: false });
    memberCache.delete(`${ctx.chat.id}:${t.user.id}`);
    reply(ctx, `⬇️ تم تنزيل ${mention(t.user)} من الإشراف`);
  } catch (e) { reply(ctx, failMsg(e) + '\n(البوت يكدر ينزل بس المشرفين اللي هو رفعهم)'); }
});
cmd(['لقب', 'ضع لقب'], 4, async (ctx, rest) => {
  const t = await target(ctx, rest); if (t.err) return reply(ctx, t.err);
  try { await ctx.api.setChatAdministratorCustomTitle(ctx.chat.id, t.user.id, t.rest.trim().slice(0, 16)); reply(ctx, `🏷 تم تغيير لقب ${mention(t.user)}`); } catch (e) { reply(ctx, failMsg(e)); }
});

/* ---- المعلومات ---- */
async function infoCard(ctx, u) {
  const chat = ctx.chat.id, c = C(chat), s = c.stats[u.id] || { n: 0 };
  const lvl = await level(ctx.api, chat, u.id);
  const m = await member(ctx.api, chat, u.id);
  const full = await ctx.api.getChat(u.id).catch(() => null);
  const ranked = Object.values(c.stats).sort((a, b) => b.n - a.n);
  const pos = ranked.findIndex(x => x === c.stats[u.id]) + 1;
  const status = { creator: 'مالك المجموعة', administrator: 'مشرف', member: 'عضو', restricted: 'مقيّد', left: 'غادر', kicked: 'محظور' }[m?.status] || '—';
  const caption = [
    `👤 الاسم: ${mention(u)}`,
    `🔖 المعرف: ${u.username ? '@' + esc(u.username) : 'ماكو'}`,
    `🆔 الايدي: <code>${u.id}</code>`,
    `🎖 الرتبة: <b>${RANKS[lvl]}</b>${m?.custom_title ? ` • 🏷 ${esc(m.custom_title)}` : ''}`,
    `📌 الحالة: ${status}`,
    `💬 الرسائل: <b>${s.n || 0}</b>${s.d === today() ? ` • اليوم: ${s.t}` : ''}${pos ? ` • الترتيب: #${pos}` : ''}`,
    `📊 التفاعل: ${activity(s.n || 0)}`,
    `⚠️ التحذيرات: ${c.warns[u.id] || 0}/3`,
    full?.bio ? `📝 البايو: ${esc(full.bio)}` : null,
  ].filter(Boolean).join('\n');
  const photos = await ctx.api.getUserProfilePhotos(u.id, { limit: 1 }).catch(() => null);
  const ph = photos?.photos?.[0];
  if (ph) return ctx.replyWithPhoto(ph[ph.length - 1].file_id, { caption, parse_mode: 'HTML', reply_parameters: { message_id: ctx.msg.message_id, allow_sending_without_reply: true } }).catch(() => reply(ctx, caption));
  return reply(ctx, caption);
}
cmd(['ايدي', 'id', '/id', 'معلوماتي', 'كشف', '/info'], 0, async (ctx, rest) => {
  if (ctx.msg.reply_to_message || rest.trim()) { const t = await target(ctx, rest); if (t.err) return reply(ctx, t.err); return infoCard(ctx, t.user); }
  return infoCard(ctx, ctx.from);
});
cmd(['بايو', 'البايو', 'بايوي'], 0, async ctx => {
  const u = ctx.msg.reply_to_message?.from || ctx.from;
  const full = await ctx.api.getChat(u.id).catch(() => null);
  reply(ctx, full?.bio ? `📝 بايو ${mention(u)}:\n\n${esc(full.bio)}` : `${mention(u)} ما عنده بايو، أو مخفي 🤷‍♂️`);
});
cmd(['رسائلي', 'رسائله', 'عدد رسائلي', 'رسايلي', 'رسايله'], 0, ctx => {
  const u = ctx.msg.reply_to_message?.from || ctx.from, s = C(ctx.chat.id).stats[u.id] || { n: 0 };
  reply(ctx, `💬 رسائل ${mention(u)}: <b>${s.n || 0}</b>\n📅 اليوم: <b>${s.d === today() ? s.t : 0}</b>\n📊 التفاعل: ${activity(s.n || 0)}`);
});
cmd(['رتبتي', 'رتبته'], 0, async ctx => { const u = ctx.msg.reply_to_message?.from || ctx.from; reply(ctx, `🎖 رتبة ${mention(u)}: <b>${RANKS[await level(ctx.api, ctx.chat.id, u.id)]}</b>`); });
cmd(['اسمي'], 0, ctx => reply(ctx, `👤 اسمك: ${esc(fullName(ctx.from))}`));
cmd(['يوزري', 'معرفي'], 0, ctx => reply(ctx, ctx.from.username ? `🔖 معرفك: @${esc(ctx.from.username)}` : 'ما عندك معرف 🤷‍♂️'));
cmd(['التوب', 'توب', 'توب الرسائل', 'المتفاعلين'], 0, ctx => {
  const st = C(ctx.chat.id).stats;
  const all = Object.entries(st).sort((a, b) => b[1].n - a[1].n).slice(0, 10);
  const td = Object.entries(st).filter(([, s]) => s.d === today()).sort((a, b) => b[1].t - a[1].t).slice(0, 5);
  const med = ['🥇', '🥈', '🥉'];
  const line = ([id, s], i, k) => `${med[i] || `${i + 1}.`} <a href="tg://user?id=${id}">${esc(s.name)}</a> — <b>${s[k]}</b>`;
  reply(ctx, `🏆 <b>توب المتفاعلين</b>\n\n${all.map((x, i) => line(x, i, 'n')).join('\n') || 'ماكو بيانات بعد'}\n\n🔥 <b>توب اليوم</b>\n\n${td.map((x, i) => line(x, i, 't')).join('\n') || 'ماكو بيانات بعد'}`);
});
cmd(['المجموعه', 'معلومات المجموعه', 'الكروب'], 0, async ctx => {
  const chat = ctx.chat, c = C(chat.id);
  const count = await ctx.api.getChatMemberCount(chat.id).catch(() => '?');
  const admins = await ctx.api.getChatAdministrators(chat.id).catch(() => []);
  const owner = admins.find(a => a.status === 'creator');
  const total = Object.values(c.stats).reduce((s, x) => s + x.n, 0);
  const tdy = Object.values(c.stats).reduce((s, x) => s + (x.d === today() ? x.t : 0), 0);
  reply(ctx, `👥 <b>${esc(chat.title)}</b>\n\n🆔 <code>${chat.id}</code>\n👤 الأعضاء: <b>${count}</b>\n👮 المشرفين: <b>${admins.length}</b>${owner ? `\n👑 المالك: ${mention(owner.user)}` : ''}\n💬 الرسائل المسجلة: <b>${total}</b>\n📅 رسائل اليوم: <b>${tdy}</b>`);
});
cmd(['الرابط', 'رابط'], 0, async ctx => {
  try { const l = await ctx.api.exportChatInviteLink(ctx.chat.id); reply(ctx, `🔗 رابط المجموعة:\n${l}`); } catch (e) { reply(ctx, failMsg(e)); }
});
cmd(['الادمنيه بالكروب', 'المشرفين'], 0, async ctx => {
  const a = await ctx.api.getChatAdministrators(ctx.chat.id).catch(() => []);
  reply(ctx, `👮 المشرفين (${a.length}):\n\n${a.filter(x => !x.user.is_bot).map((x, i) => `${i + 1}. ${mention(x.user)}${x.status === 'creator' ? ' 👑' : ''}${x.custom_title ? ` — ${esc(x.custom_title)}` : ''}`).join('\n')}`);
});

/* ---- الرسائل ---- */
cmd(['تثبيت', '/pin'], 2, async ctx => {
  const r = ctx.msg.reply_to_message; if (!r) return reply(ctx, '↩️ رد على الرسالة اللي تريد تثبتها');
  try { await ctx.api.pinChatMessage(ctx.chat.id, r.message_id); reply(ctx, '📌 تم التثبيت'); } catch (e) { reply(ctx, failMsg(e)); }
});
cmd(['الغاء تثبيت', 'الغاء التثبيت', '/unpin'], 2, async ctx => {
  try { await ctx.api.unpinChatMessage(ctx.chat.id, ctx.msg.reply_to_message?.message_id); reply(ctx, '📍 تم الغاء التثبيت'); } catch (e) { reply(ctx, failMsg(e)); }
});
cmd(['حذف', '/del'], 2, async ctx => {
  const r = ctx.msg.reply_to_message; if (!r) return reply(ctx, '↩️ رد على الرسالة اللي تريد تحذفها');
  await ctx.api.deleteMessages(ctx.chat.id, [r.message_id, ctx.msg.message_id]).catch(e => reply(ctx, failMsg(e)));
});
cmd(['مسح', 'تنظيف', '/purge'], 2, async (ctx, rest) => {
  const n = Math.min(500, parseInt(norm(rest), 10) || 0);
  if (!n) return reply(ctx, 'اكتب العدد، مثلاً: <code>مسح 50</code>');
  const ids = Array.from({ length: n + 1 }, (_, i) => ctx.msg.message_id - i).filter(i => i > 0);
  try {
    for (let i = 0; i < ids.length; i += 100) await ctx.api.deleteMessages(ctx.chat.id, ids.slice(i, i + 100));
    const m = await ctx.reply(`🧹 تم مسح ${n} رسالة`);
    setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, m.message_id).catch(() => {}), 5000);
  } catch (e) { reply(ctx, failMsg(e)); }
});

/* ---- الأقفال ---- */
const lockStatus = c => Object.keys(LOCKS).map(k => `${c.locks[k] ? '🔒' : '🔓'} ${LOCK_LABEL(k)}`).join('\n');
cmd(['قفل', 'فتح'], 2, (ctx, rest, _m, name) => {
  const on = name === norm('قفل'), key = norm(rest.trim()), c = C(ctx.chat.id);
  if (key === 'الكل') { for (const k of Object.keys(LOCKS)) if (k !== 'الدردشه') c.locks[k] = on; save(); return reply(ctx, on ? '🔒 تم قفل كل شي (عدا الدردشة)' : '🔓 تم فتح كل شي'); }
  if (!(key in LOCKS)) return reply(ctx, `❓ اختار وحدة من:\n${Object.keys(LOCKS).map(LOCK_LABEL).join(' • ')}\nأو: الكل`);
  c.locks[key] = on; save();
  reply(ctx, `${on ? '🔒 تم قفل' : '🔓 تم فتح'} ${LOCK_LABEL(key)}\n👮 بواسطة: ${mention(ctx.from)}`);
});
cmd(['الاعدادات', 'الاقفال', 'الحمايه'], 1, ctx => reply(ctx, `⚙️ <b>إعدادات الحماية</b>\n\n${lockStatus(C(ctx.chat.id))}\n\n${C(ctx.chat.id).welcomeOn ? '✅' : '❌'} الترحيب`));

/* ---- الترحيب والقوانين ---- */
cmd(['ضع ترحيب', 'وضع ترحيب'], 3, (ctx, rest) => { if (!rest.trim()) return reply(ctx, 'اكتب الترحيب بعد الأمر\nالمتغيرات: {الاسم} {المعرف} {الايدي} {المجموعة} {العدد}'); C(ctx.chat.id).welcome = rest.trim(); save(); reply(ctx, '✅ تم حفظ الترحيب'); });
cmd(['الترحيب'], 1, ctx => reply(ctx, `👋 الترحيب الحالي:\n\n${esc(C(ctx.chat.id).welcome)}`));
cmd(['تفعيل الترحيب', 'تعطيل الترحيب'], 3, (ctx, _r, _m, name) => { const on = name.startsWith('تفعيل'); C(ctx.chat.id).welcomeOn = on; save(); reply(ctx, on ? '✅ تم تفعيل الترحيب' : '❌ تم تعطيل الترحيب'); });
cmd(['ضع قوانين', 'وضع قوانين'], 3, (ctx, rest) => { if (!rest.trim()) return reply(ctx, 'اكتب القوانين بعد الأمر'); C(ctx.chat.id).rules = rest.trim(); save(); reply(ctx, '✅ تم حفظ القوانين'); });
cmd(['القوانين', '/rules'], 0, ctx => reply(ctx, C(ctx.chat.id).rules ? `📜 <b>قوانين المجموعة</b>\n\n${esc(C(ctx.chat.id).rules)}` : 'ماكو قوانين بعد، المدير يكدر يضيفها بـ «ضع قوانين»'));

/* ---- إعدادات المجموعة ---- */
cmd(['ضع اسم', 'تغيير اسم المجموعه'], 3, async (ctx, rest) => { try { await ctx.api.setChatTitle(ctx.chat.id, rest.trim().slice(0, 128)); reply(ctx, '✅ تم تغيير اسم المجموعة'); } catch (e) { reply(ctx, failMsg(e)); } });
cmd(['ضع وصف'], 3, async (ctx, rest) => { try { await ctx.api.setChatDescription(ctx.chat.id, rest.trim().slice(0, 255)); reply(ctx, '✅ تم تغيير الوصف'); } catch (e) { reply(ctx, failMsg(e)); } });
cmd(['ضع صوره'], 3, async ctx => {
  const p = ctx.msg.reply_to_message?.photo; if (!p) return reply(ctx, '↩️ رد على صورة');
  try { const f = await ctx.api.getFile(p[p.length - 1].file_id); const res = await fetch(`https://api.telegram.org/file/bot${ctx.api.token}/${f.file_path}`); await ctx.api.setChatPhoto(ctx.chat.id, new InputFile(Buffer.from(await res.arrayBuffer()))); reply(ctx, '✅ تم تغيير صورة المجموعة'); } catch (e) { reply(ctx, failMsg(e)); }
});

/* ---- الردود والكلمات الممنوعة ---- */
cmd(['اضف رد', 'اضافه رد'], 2, (ctx, rest) => {
  const m = rest.match(/^([\s\S]+?)\s*=\s*([\s\S]+)$/);
  if (!m) return reply(ctx, 'الصيغة: <code>اضف رد الكلمة = الرد</code>');
  C(ctx.chat.id).replies[norm(m[1].trim())] = m[2].trim(); save();
  reply(ctx, `✅ تم إضافة رد على «${esc(m[1].trim())}»`);
});
cmd(['حذف رد', 'مسح رد'], 2, (ctx, rest) => { const k = norm(rest.trim()), c = C(ctx.chat.id); if (!c.replies[k]) return reply(ctx, 'ماكو رد بهذا الاسم'); delete c.replies[k]; save(); reply(ctx, '🗑 تم حذف الرد'); });
cmd(['الردود'], 1, ctx => { const k = Object.keys(C(ctx.chat.id).replies); reply(ctx, k.length ? `💬 الردود (${k.length}):\n\n${k.map((x, i) => `${i + 1}. ${esc(x)}`).join('\n')}` : 'ماكو ردود مضافة'); });
cmd(['مسح الردود'], 3, ctx => { C(ctx.chat.id).replies = {}; save(); reply(ctx, '🧹 تم مسح كل الردود'); });
cmd(['منع'], 2, (ctx, rest) => { const w = norm(rest.trim()); if (!w) return reply(ctx, 'اكتب الكلمة بعد «منع»'); const c = C(ctx.chat.id); if (!c.filters.includes(w)) c.filters.push(w); save(); reply(ctx, `🚫 تم منع «${esc(rest.trim())}»`); });
cmd(['الغاء منع'], 2, (ctx, rest) => { const c = C(ctx.chat.id); c.filters = c.filters.filter(x => x !== norm(rest.trim())); save(); reply(ctx, '✅ تم الغاء المنع'); });
cmd(['قائمه المنع', 'الكلمات الممنوعه'], 1, ctx => { const f = C(ctx.chat.id).filters; reply(ctx, f.length ? `🚫 الكلمات الممنوعة:\n\n${f.map((x, i) => `${i + 1}. ${esc(x)}`).join('\n')}` : 'ماكو كلمات ممنوعة'); });

/* ---- المساعدة ---- */
const HELP = {
  main: '🛡️ <b>أوامر بوت الحماية</b>\n\nكل الأوامر تنكتب بدون سلاش. أوامر الإدارة تشتغل بالرد على رسالة الشخص، أو تكتب معرفه أو ايديه بعد الأمر.\n\nاختار القسم 👇',
  admin: '👮 <b>أوامر الإدارة</b>  (ادمن فما فوق)\n\n• طرد\n• حظر / الغاء حظر\n• كتم / الغاء كتم\n• كتم 10د  •  كتم 2س  •  كتم 1ي  (كتم مؤقت)\n• تحذير  (3 تحذيرات = كتم يوم)\n• مسح التحذيرات  •  التحذيرات\n• المحظورين  •  المكتومين\n• تثبيت  •  الغاء تثبيت\n• حذف  (بالرد)  •  مسح 50',
  ranks: '🎖 <b>الرتب</b>\n\nالترتيب: المالك ← مدير ← ادمن ← مميز ← عضو\n\n• رفع مدير / تنزيل مدير  (المالك)\n• رفع ادمن / تنزيل ادمن  (مدير)\n• رفع مميز / تنزيل مميز  (ادمن)\n• المدراء  •  الادمنيه  •  المميزين\n• تنزيل الكل  (المالك)\n\n👑 <b>إشراف تلكرام الحقيقي</b> (المالك):\n• رفع مشرف [لقب]\n• تنزيل مشرف\n• لقب [النص]\n• المشرفين',
  locks: '🔒 <b>الحماية</b>  (ادمن فما فوق)\n\n<code>قفل</code> أو <code>فتح</code> + واحد من:\n' + Object.keys(LOCKS).map(LOCK_LABEL).join(' • ') + '\n\n• قفل الكل  •  فتح الكل\n• الاعدادات  (حالة الأقفال)\n• منع كلمة  •  الغاء منع كلمة  •  قائمة المنع\n\nℹ️ المميز وفوق ما تنطبق عليهم الأقفال.',
  info: '📊 <b>المعلومات</b>  (للكل)\n\n• ايدي  (صورتك ومعلوماتك والبايو)\n• كشف  (بالرد على شخص)\n• بايو  •  رسائلي  •  رسائله\n• رتبتي  •  اسمي  •  يوزري\n• التوب  (أكثر المتفاعلين)\n• المجموعة  •  الرابط  •  القوانين',
  settings: '⚙️ <b>الإعدادات</b>  (مدير فما فوق)\n\n• ضع ترحيب [النص]\n  المتغيرات: {الاسم} {المعرف} {الايدي} {المجموعة} {العدد}\n• تفعيل الترحيب  •  تعطيل الترحيب  •  الترحيب\n• ضع قوانين [النص]\n• ضع اسم  •  ضع وصف  •  ضع صورة (بالرد)\n• اضف رد كلمة = الرد\n• حذف رد كلمة  •  الردود  •  مسح الردود',
};
const helpKb = cur => ({ inline_keyboard: [
  [btn('👮 الإدارة', 'h:admin'), btn('🎖 الرتب', 'h:ranks')],
  [btn('🔒 الحماية', 'h:locks'), btn('📊 المعلومات', 'h:info')],
  [btn('⚙️ الإعدادات', 'h:settings'), ...(cur === 'main' ? [] : [btn('🔙 رجوع', 'h:main')])],
] });
cmd(['الاوامر', 'اوامر', 'مساعده', '/help', '/commands'], 0, ctx => reply(ctx, HELP.main, { reply_markup: helpKb('main') }));

CMDS.sort((a, b) => b.n.length - a.n.length); // الأطول أولاً حتى «الغاء حظر» قبل «حظر»

/* ================== البوت ================== */
function createBot(token, opts) {
  const bot = new Bot(token, opts);
  const isCmd = txt => { const t = norm(String(txt || '').trim()).replace(/@\w+bot\b/i, ''); return CMDS.some(k => t === k.n || t.startsWith(k.n + ' ') || t.startsWith(k.n + '\n')); };
  require('../force-sub').install(bot, () => db, save, ctx => ctx.chat?.type === 'private' || !!ctx.callbackQuery || isCmd(ctx.msg?.text));
  const isGroup = ctx => ['group', 'supergroup'].includes(ctx.chat?.type);

  bot.command('start', async ctx => {
    if (isGroup(ctx)) return ctx.reply('🛡️ البوت شغّال، اكتب «الاوامر»');
    const add = `https://t.me/${ctx.me.username}?startgroup=true&admin=delete_messages+restrict_members+promote_members+pin_messages+invite_users+change_info`;
    return ctx.reply(`🛡️ <b>أهلاً ${esc(ctx.from.first_name)}</b>\n\nأنا بوت حماية وإدارة المجموعات:\nطرد • حظر • كتم • تحذير • رتب • رفع مشرفين • عدد الرسائل • ايدي وبايو • أقفال • ترحيب • ردود • توب المتفاعلين وأكثر.\n\nضيفني لمجموعتك وخليني مشرف، وبعدين اكتب «الاوامر» 👇`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '➕ ضيفني لمجموعتك', url: add }]] } });
  });

  bot.callbackQuery(/^h:(\w+)$/, async ctx => {
    const k = ctx.match[1];
    await ctx.editMessageText(HELP[k] || HELP.main, { parse_mode: 'HTML', reply_markup: helpKb(k) }).catch(() => {});
    await ctx.answerCallbackQuery();
  });

  // البوت انضاف لمجموعة
  bot.on('my_chat_member', async ctx => {
    const n = ctx.myChatMember.new_chat_member.status, o = ctx.myChatMember.old_chat_member.status;
    if (!isGroup(ctx)) return;
    if (['left', 'kicked'].includes(o) && ['member', 'administrator'].includes(n))
      await ctx.reply('🛡️ شكراً لإضافتي!\nخليني <b>مشرف</b> بكل الصلاحيات حتى أشتغل صح، وبعدين اكتب «الاوامر»', { parse_mode: 'HTML' }).catch(() => {});
    if (n === 'administrator' || o === 'administrator') memberCache.delete(`${ctx.chat.id}:${ctx.me.id}`);
  });
  bot.on('chat_member', ctx => memberCache.delete(`${ctx.chat.id}:${ctx.chatMember.new_chat_member.user.id}`));

  // أعضاء جدد
  bot.on('message:new_chat_members', async ctx => {
    const c = C(ctx.chat.id);
    const adderLvl = await level(ctx.api, ctx.chat.id, ctx.from.id);
    if (c.locks['الاشعارات']) ctx.deleteMessage().catch(() => {});
    for (const u of ctx.msg.new_chat_members) {
      if (u.is_bot) {
        if (u.id !== ctx.me.id && c.locks['البوتات'] && adderLvl < 2) { await ctx.api.banChatMember(ctx.chat.id, u.id).catch(() => {}); ctx.reply(`🤖 تم طرد البوت ${mention(u)} لأن البوتات مقفولة`, { parse_mode: 'HTML' }).catch(() => {}); }
        continue;
      }
      if (u.username) db.usernames[u.username.toLowerCase()] = u.id;
      if (c.welcomeOn) {
        const count = await ctx.api.getChatMemberCount(ctx.chat.id).catch(() => '');
        const txt = esc(c.welcome).replace(/\{الاسم\}/g, mention(u)).replace(/\{المعرف\}/g, u.username ? '@' + esc(u.username) : 'ماكو').replace(/\{الايدي\}/g, u.id).replace(/\{(المجموعة|المجموعه)\}/g, esc(ctx.chat.title)).replace(/\{العدد\}/g, count);
        await ctx.reply(txt, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(() => {});
      }
    }
    save();
  });
  bot.on('message:left_chat_member', ctx => { if (C(ctx.chat.id).locks['الاشعارات']) ctx.deleteMessage().catch(() => {}); });
  bot.on(['message:pinned_message', 'message:new_chat_title', 'message:new_chat_photo'], ctx => { if (C(ctx.chat.id).locks['الاشعارات']) ctx.deleteMessage().catch(() => {}); });

  // تعديل الرسائل
  bot.on('edited_message', async ctx => {
    if (!isGroup(ctx) || !ctx.from) return;
    const c = C(ctx.chat.id);
    if (await level(ctx.api, ctx.chat.id, ctx.from.id) >= 1) return;
    if (c.locks['التعديل'] || (c.locks['الروابط'] && LOCKS['الروابط'](ctx.msg))) ctx.deleteMessage().catch(() => {});
  });

  // كل رسائل المجموعات
  bot.on('message', async ctx => {
    if (!isGroup(ctx) || !ctx.from) return;
    const m = ctx.msg, chat = ctx.chat.id, u = ctx.from, c = C(chat);

    // إحصائيات
    if (!u.is_bot && !m.sender_chat) {
      const s = c.stats[u.id] || (c.stats[u.id] = { n: 0, t: 0, d: '' });
      s.n++; s.name = fullName(u);
      if (s.d !== today()) { s.d = today(); s.t = 0; }
      s.t++;
      if (u.username) db.usernames[u.username.toLowerCase()] = u.id;
      save();
    }

    const lvl = await level(ctx.api, chat, u.id);
    const text = m.text || m.caption || '';

    // الحماية
    if (lvl < 1 && !m.is_automatic_forward && u.id !== 777000) {
      let bad = Object.keys(LOCKS).some(k => c.locks[k] && LOCKS[k] && LOCKS[k](m));
      if (!bad && c.filters.length && text) { const t = norm(text); bad = c.filters.some(w => t.includes(w)); }
      if (bad) return ctx.deleteMessage().catch(() => {});
      if (c.locks['التكرار']) {
        const k = `${chat}:${u.id}`, now = Date.now();
        const arr = (flood.get(k) || []).filter(t => now - t < 7000); arr.push(now); flood.set(k, arr);
        if (arr.length >= 7) {
          flood.delete(k);
          await ctx.api.restrictChatMember(chat, u.id, NO_PERMS, { until_date: Math.floor(now / 1000) + 900 }).catch(() => {});
          c.muted[u.id] = fullName(u); save();
          return ctx.reply(`🌊 ${mention(u)} انكتم 15 دقيقة بسبب التكرار`, { parse_mode: 'HTML' }).catch(() => {});
        }
      }
    }

    if (!m.text) return;
    let t = norm(m.text.trim()).replace(new RegExp(`@${ctx.me.username}`, 'i'), '');
    // أوامر
    for (const k of CMDS) {
      if (t === k.n || t.startsWith(k.n + ' ') || t.startsWith(k.n + '\n')) {
        if (lvl < k.min) return reply(ctx, `⛔ هذا الأمر يحتاج رتبة <b>${RANKS[k.min]}</b> فما فوق`);
        const rest = m.text.trim().replace(new RegExp(`@${ctx.me.username}`, 'i'), '').slice(k.n.length).trim();
        try { await k.fn(ctx, rest, lvl, k.n); } catch (e) { console.error(e); reply(ctx, failMsg(e)).catch(() => {}); }
        return;
      }
    }
    // ردود مخصصة
    const r = c.replies[t];
    if (r) return reply(ctx, esc(r));
  });

  bot.catch(err => console.error('Bot error:', err.error?.description || err.error?.message || err.message));
  return bot;
}

module.exports = { setStore, createBot, db, C, norm, parseDur, CMDS };

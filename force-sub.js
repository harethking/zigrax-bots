'use strict';
/**
 * 🔒 الاشتراك الإجباري — مشترك بين البوتين
 * المطور (DEV_IDS) يدير القنوات من خاص البوت:
 *   اضف قناة @channel   •   حذف قناة @channel   •   القنوات
 *   تفعيل الاشتراك       •   تعطيل الاشتراك
 * البوت لازم يكون مشرف بالقناة حتى يكدر يتحقق.
 */
const DEVS = () => String(process.env.DEV_IDS || '').split(/[,\s]+/).filter(Boolean).map(Number);
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const N = s => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');
const OK = new Set(['member', 'administrator', 'creator']);
const cache = new Map(); // `${channel}:${user}` → وقت آخر تحقق ناجح

/**
 * @param bot grammY Bot
 * @param getDb () => كائن قاعدة البيانات الحالي
 * @param save  () => حفظ
 * @param shouldCheck (ctx) => هل هذا التحديث يحتاج تحقق (اختياري)
 */
function install(bot, getDb, save, shouldCheck = () => true) {
  const cfg = () => { const db = getDb(); return db.forceSub || (db.forceSub = { on: true, list: [] }); };

  async function missing(api, uid) {
    const out = [];
    for (const ch of cfg().list) {
      const k = `${ch.id}:${uid}`;
      if (Date.now() - (cache.get(k) || 0) < 5 * 60e3) continue;
      try {
        const m = await api.getChatMember(ch.id, uid);
        if (OK.has(m.status) || (m.status === 'restricted' && m.is_member)) cache.set(k, Date.now());
        else out.push(ch);
      } catch (e) { console.error(`force-sub check ${ch.id}:`, e.description || e.message); } // البوت مو مشرف ← ما نمنع
    }
    return out;
  }

  const prompt = list => ({
    text: `🔒 <b>لازم تشترك بالقنوات حتى تستخدم البوت</b>\n\n${list.map((c, i) => `${i + 1}. ${esc(c.title)}`).join('\n')}\n\nاشترك وبعدين اضغط «✅ اشتركت»`,
    kb: { inline_keyboard: [...list.map(c => [{ text: `📢 ${c.title}`, url: c.link }]), [{ text: '✅ اشتركت', callback_data: 'fs:check' }]] },
  });

  // أوامر المطور (بالخاص)
  bot.on('message:text', async (ctx, next) => {
    if (ctx.chat.type !== 'private' || !DEVS().includes(ctx.from.id)) return next();
    const t = N(ctx.msg.text.trim()), c = cfg();
    const arg = ctx.msg.text.trim().split(/\s+/).slice(2).join(' ').trim();
    const reply = s => ctx.reply(s, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    if (t.startsWith('اضف قناه')) {
      if (!arg) return reply('الصيغة: <code>اضف قناة @username</code>\nأو ايدي القناة مثل <code>-100123456789</code>');
      const id = /^-?\d+$/.test(arg) ? Number(arg) : (arg.startsWith('@') ? arg : '@' + arg.replace(/^https?:\/\/t\.me\//, ''));
      try {
        const chat = await ctx.api.getChat(id);
        const me = await ctx.api.getChatMember(chat.id, ctx.me.id);
        if (me.status !== 'administrator') return reply(`⚠️ لازم ترفعني <b>مشرف</b> بـ «${esc(chat.title)}» أول، وبعدين أضفها`);
        const link = chat.username ? `https://t.me/${chat.username}` : (chat.invite_link || await ctx.api.exportChatInviteLink(chat.id));
        c.list = c.list.filter(x => x.id !== chat.id);
        c.list.push({ id: chat.id, title: chat.title, link });
        save();
        return reply(`✅ انضافت «${esc(chat.title)}»\nعدد القنوات: ${c.list.length}${c.on ? '' : '\n⚠️ الاشتراك الإجباري معطّل، فعّله بـ «تفعيل الاشتراك»'}`);
      } catch (e) { return reply(`❌ ما كدرت أوصل للقناة: ${esc(e.description || e.message)}\nتأكد المعرف صح والبوت مضاف مشرف بيها`); }
    }
    if (t.startsWith('حذف قناه')) {
      const before = c.list.length;
      const a = arg.replace(/^@/, '').toLowerCase();
      c.list = c.list.filter(x => String(x.id) !== a && !x.link.toLowerCase().endsWith('/' + a) && x.title !== arg);
      save();
      return reply(before === c.list.length ? '❓ ما لكيت هاي القناة، اكتب «القنوات» حتى تشوف القائمة' : '🗑 انحذفت القناة');
    }
    if (t === 'القنوات') {
      return reply(`🔒 الاشتراك الإجباري: <b>${c.on ? 'مفعّل ✅' : 'معطّل ❌'}</b>\n\n${c.list.length ? c.list.map((x, i) => `${i + 1}. ${esc(x.title)} — ${x.link}`).join('\n') : 'ماكو قنوات بعد'}\n\n➕ اضف قناة @username\n➖ حذف قناة @username\n🔁 تفعيل الاشتراك / تعطيل الاشتراك`);
    }
    if (t === 'تفعيل الاشتراك' || t === 'تعطيل الاشتراك') { c.on = t.startsWith('تفعيل'); save(); return reply(c.on ? '✅ تم تفعيل الاشتراك الإجباري' : '❌ تم تعطيل الاشتراك الإجباري'); }
    return next();
  });

  // زر «اشتركت»
  bot.callbackQuery('fs:check', async ctx => {
    const miss = await missing(ctx.api, ctx.from.id);
    if (miss.length) return ctx.answerCallbackQuery({ text: '❌ بعدك ما مشترك بكل القنوات', show_alert: true });
    await ctx.answerCallbackQuery({ text: '✅ تم التحقق' });
    await ctx.editMessageText('✅ <b>تم التحقق، شكراً لاشتراكك!</b>\nهسه تكدر تستخدم البوت، أرسل /start', { parse_mode: 'HTML' }).catch(() => {});
  });

  // الحارس
  bot.use(async (ctx, next) => {
    const u = ctx.from, c = cfg();
    if (!u || u.is_bot || !c.on || !c.list.length || DEVS().includes(u.id)) return next();
    if (ctx.chatMember || ctx.myChatMember || ctx.msg?.new_chat_members || ctx.msg?.left_chat_member) return next();
    if (!shouldCheck(ctx)) return next();
    const miss = await missing(ctx.api, u.id);
    if (!miss.length) return next();
    const p = prompt(miss);
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: '🔒 اشترك بالقنوات أول', show_alert: true }).catch(() => {});
      if (ctx.chat?.type === 'private') await ctx.reply(p.text, { parse_mode: 'HTML', reply_markup: p.kb }).catch(() => {});
      return;
    }
    const m = await ctx.reply(p.text, { parse_mode: 'HTML', reply_markup: p.kb, reply_parameters: ctx.msg ? { message_id: ctx.msg.message_id, allow_sending_without_reply: true } : undefined }).catch(() => null);
    if (m && ctx.chat?.type !== 'private') setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, m.message_id).catch(() => {}), 60e3);
  });
}

module.exports = { install, DEVS };

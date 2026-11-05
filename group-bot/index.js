'use strict';
const fs = require('fs');
const path = require('path');

// قراءة ملف .env بدون مكتبات إضافية
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const token = process.env.BOT_TOKEN;
if (!token || token.includes('ضع')) { console.error('❌ حط توكن البوت بملف .env  (BOT_TOKEN=...)'); process.exit(1); }

const { createBot } = require('./bot');
const bot = createBot(token);

bot.api.setMyCommands([
  { command: 'start', description: '🛡️ تشغيل البوت' },
  { command: 'help', description: '📋 الأوامر' },
  { command: 'id', description: '🆔 ايدي ومعلومات' },
  { command: 'rules', description: '📜 القوانين' },
]).catch(() => {});
bot.api.setMyDescription('🛡️ بوت حماية وإدارة المجموعات بأوامر عربية: طرد، حظر، كتم، تحذير، رتب، رفع مشرفين، عدد الرسائل، ايدي وبايو، أقفال، ترحيب، ردود، وتوب المتفاعلين.\n\nضيفني لمجموعتك وخليني مشرف، وبعدين اكتب «الاوامر»').catch(() => {});
bot.api.setMyShortDescription('🛡️ حماية وإدارة المجموعات بأوامر عربية').catch(() => {});

bot.start({
  allowed_updates: ['message', 'edited_message', 'callback_query', 'my_chat_member', 'chat_member'],
  onStart: me => console.log(`✅ البوت شغّال: @${me.username}`),
});
process.on('unhandledRejection', e => console.error(e));
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

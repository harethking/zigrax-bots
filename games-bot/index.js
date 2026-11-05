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
  { command: 'games', description: '🎮 قائمة الألعاب' },
  { command: 'top', description: '🏆 المتصدرين' },
  { command: 'me', description: '👤 ملفي ونقاطي' },
  { command: 'help', description: '❓ المساعدة' },
]).catch(() => {});
bot.api.setMyDescription('🎮 صالة ألعاب فيها 10 ألعاب: إكس أو، حجرة ورقة مقص، خمّن الرقم، سؤال وجواب، رتّب الكلمة، المشنقة، الذاكرة، كاسحة الألغام، 2048، وتحدّي الحساب.\nاجمع نقاط ونافس على لوحة المتصدرين 🏆\n\nاضغط «ابدأ» وخلّي اللعب يبدي!').catch(() => {});
bot.api.setMyShortDescription('🎮 10 ألعاب ونقاط ولوحة متصدرين').catch(() => {});

bot.start({ onStart: me => console.log(`✅ البوت شغّال: @${me.username}`) });
process.on('unhandledRejection', e => console.error(e));
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

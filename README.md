# 🤖 Zigrax Bots

بوتين تلكرام بخدمة وحدة:
- 🎮 **@zigrax_games_bot** — صالة ألعاب: 10 ألعاب + نقاط + متصدرين
- 🛡️ **@zigrax_guard_bot** — حماية وإدارة المجموعات بأوامر عربية

## Render (مجاني)
Web Service • Build: `npm install` • Start: `npm start`
متغيرات البيئة: `GAMES_TOKEN`, `GUARD_TOKEN`, `SUPABASE_URL`, `SUPABASE_KEY` (اختياري: `DEV_IDS`)
السيرفر يحط الـ Webhook تلقائياً على `RENDER_EXTERNAL_URL`.

## تشغيل محلي
حط التوكنات بـ `games-bot/.env` و `group-bot/.env` (BOT_TOKEN=...) وشغّل `start.bat` أو `npm install && npm start`.

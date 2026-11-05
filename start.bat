@echo off
chcp 65001 >nul
title Zigrax Bots
cd /d "%~dp0"
where node >nul 2>nul || (echo نصّب Node.js من https://nodejs.org ثم شغّل الملف مرة ثانية & pause & exit /b)
if not exist games-bot\node_modules (cd games-bot & call npm install & cd ..)
if not exist group-bot\node_modules (cd group-bot & call npm install & cd ..)
node server.js
pause

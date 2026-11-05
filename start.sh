#!/bin/sh
cd "$(dirname "$0")"
[ -d games-bot/node_modules ] || (cd games-bot && npm install)
[ -d group-bot/node_modules ] || (cd group-bot && npm install)
node server.js

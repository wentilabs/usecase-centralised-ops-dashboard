#!/bin/zsh
# Double-clickable launcher: starts the ops dashboard and opens the browser.
cd "$(dirname "$0")"
open "http://localhost:5178"
exec node server.js

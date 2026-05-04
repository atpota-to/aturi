#!/usr/bin/env bash
# Double-click (or `open` from the Cursor terminal) to launch WXT dev:firefox
# in a real Terminal.app window so hot-reload stays alive.
set -e
cd "$(dirname "$0")"
clear
echo "  Aturi extension — Firefox dev server"
echo "  ------------------------------------"
echo "  Hot reload is active. Press Ctrl+C to stop."
echo "  Log mirror: /tmp/aturi-wxt.log"
echo ""
exec npm run dev:firefox 2>&1 | tee /tmp/aturi-wxt.log

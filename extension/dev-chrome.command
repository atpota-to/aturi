#!/usr/bin/env bash
# Double-click (or `open` from the Cursor terminal) to launch WXT dev (Chrome)
# in a real Terminal.app window so hot-reload stays alive.
set -e
cd "$(dirname "$0")"
clear
echo "  Aturi extension — Chrome dev server"
echo "  -----------------------------------"
echo "  Hot reload is active. Press Ctrl+C to stop."
echo ""
exec npm run dev

#!/usr/bin/env bash
# OO Recovery — opens the app in your default browser.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
URL="file://$HERE/web/index.html"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"
elif command -v gio >/dev/null 2>&1; then
  gio open "$URL"
elif command -v sensible-browser >/dev/null 2>&1; then
  sensible-browser "$URL"
else
  echo "Could not detect a browser launcher. Open this URL manually:"
  echo "  $URL"
fi

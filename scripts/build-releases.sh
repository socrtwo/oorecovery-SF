#!/usr/bin/env bash
# Build platform-specific release bundles from the contents of web/.
#
# Usage:  scripts/build-releases.sh [VERSION]
#         scripts/build-releases.sh v1.0.0
#
# Output goes to dist/ and is overwritten each run.

set -euo pipefail

VERSION="${1:-${GITHUB_REF_NAME:-v0.0.0-dev}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
LAUNCHERS="$ROOT/scripts/launchers"
DIST="$ROOT/dist"
STAGE="$DIST/_stage"
APP="oorecovery"

if [[ ! -d "$WEB" ]]; then
  echo "ERROR: web/ folder not found at $WEB" >&2
  exit 1
fi

# Ensure PWA icons exist (regenerate if missing).
if [[ ! -f "$WEB/icon-192.png" || ! -f "$WEB/icon-512.png" || ! -f "$WEB/icon-maskable.png" ]]; then
  python3 "$ROOT/scripts/gen-icons.py"
fi

rm -rf "$DIST"
mkdir -p "$DIST" "$STAGE"

stage() {
  local name="$1"
  local platform="$2"
  local target="$STAGE/$name"
  rm -rf "$target"
  mkdir -p "$target/web"
  cp -r "$WEB/." "$target/web/"
  if [[ -d "$LAUNCHERS/$platform" ]]; then
    cp -r "$LAUNCHERS/$platform/." "$target/"
  fi
  printf '%s\n' "$VERSION" > "$target/VERSION"
  echo "$target"
}

write_zip() {
  local src="$1" out="$2"
  ( cd "$src" && zip -qr "$out" . )
  echo "  -> $(basename "$out")"
}

write_tar() {
  local src="$1" out="$2"
  ( cd "$src" && tar -czf "$out" . )
  echo "  -> $(basename "$out")"
}

echo "Building releases for $VERSION"
echo "Source: $WEB"
echo

echo "[windows]"
WIN_DIR="$(stage ${APP}-windows windows)"
write_zip "$WIN_DIR" "$DIST/${APP}-${VERSION}-windows.zip"

echo "[macos]"
MAC_DIR="$(stage ${APP}-macos macos)"
chmod +x "$MAC_DIR/OoRecovery.command" 2>/dev/null || true
write_zip "$MAC_DIR" "$DIST/${APP}-${VERSION}-macos.zip"

echo "[linux]"
LIN_DIR="$(stage ${APP}-linux linux)"
chmod +x "$LIN_DIR/oorecovery.sh" 2>/dev/null || true
write_tar "$LIN_DIR" "$DIST/${APP}-${VERSION}-linux.tar.gz"

echo "[chromeos]"
CROS_DIR="$(stage ${APP}-chromeos chromeos)"
write_zip "$CROS_DIR" "$DIST/${APP}-${VERSION}-chromeos.zip"

echo "[android]"
ANDROID_DIR="$(stage ${APP}-android android)"
write_zip "$ANDROID_DIR" "$DIST/${APP}-${VERSION}-android.zip"

echo "[ios]"
IOS_DIR="$(stage ${APP}-ios ios)"
write_zip "$IOS_DIR" "$DIST/${APP}-${VERSION}-ios.zip"

echo "[web]"
WEB_DIR_STAGE="$(stage ${APP}-web web)"
write_zip "$WEB_DIR_STAGE" "$DIST/${APP}-${VERSION}-web.zip"

echo
echo "Generating SHA256SUMS"
( cd "$DIST" && sha256sum *.zip *.tar.gz 2>/dev/null > SHA256SUMS )
cat "$DIST/SHA256SUMS"

rm -rf "$STAGE"

echo
echo "Done. Artifacts in $DIST"
ls -la "$DIST"

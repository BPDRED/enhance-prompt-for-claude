#!/bin/bash
# Builds the helper app into the skill folder (build/EnhancePrompt.app). Run again after changing main.swift.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../build/EnhancePrompt.app"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
cp "$HERE/Info.plist" "$OUT/Contents/Info.plist"
# App icon: drawn by make_icon.swift (all the sizes macOS needs), packed into AppIcon.icns.
ICONSET="$(mktemp -d)/AppIcon.iconset"
swift "$HERE/make_icon.swift" "$ICONSET"
iconutil -c icns "$ICONSET" -o "$OUT/Contents/Resources/AppIcon.icns"
rm -rf "$(dirname "$ICONSET")"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework WebKit -framework ApplicationServices -framework Speech -framework AVFoundation \
  "$HERE/main.swift" -o "$OUT/Contents/MacOS/EnhancePrompt"
codesign --force --sign - "$OUT" >/dev/null 2>&1 || true
# Tell macOS about the new build, so Finder and System Settings (Accessibility, Microphone)
# show the new icon instead of an old cached one.
touch "$OUT"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$OUT" >/dev/null 2>&1 || true
echo "built $OUT"

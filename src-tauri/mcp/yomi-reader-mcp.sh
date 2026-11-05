#!/bin/sh
# Starts Yomi Reader's assistant bridge (MCP over stdio). Needs the Yomi Reader app.
for app in '__KIJI_LAUNCHER__' \
  "/Applications/Yomi Reader.app/Contents/MacOS/kiji-app" \
  "$HOME/Applications/Yomi Reader.app/Contents/MacOS/kiji-app"; do
  if [ -x "$app" ]; then
    exec "$app" --mcp "$@"
  fi
done
found=$(mdfind "kMDItemCFBundleIdentifier == 'com.yomilab.kiji'" 2>/dev/null | head -n 1)
if [ -n "$found" ] && [ -x "$found/Contents/MacOS/kiji-app" ]; then
  exec "$found/Contents/MacOS/kiji-app" --mcp "$@"
fi
echo "Yomi Reader isn't installed. Get it from https://reader.yomilab.app" >&2
exit 1

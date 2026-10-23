#!/bin/sh
# Source me before any Playwright run in this sandbox:
#   . audit/browser-env.sh && node audit/probe-whatever.mjs
#
# Two things the sandbox loses between sessions: the soname symlinks Chromium needs
# (the versioned files survive, the links do not) and the browser download itself.
# Both are restored here, idempotently and without network when the files are present.
LIBS=/home/user/libs/usr/lib/x86_64-linux-gnu
BROWSERS=${PLAYWRIGHT_BROWSERS_PATH:-/tmp/pwb}

restore_links() {
    for pair in \
        "libatk-1.0.so.0:libatk-1.0.so.0.25611.1" \
        "libatk-bridge-2.0.so.0:libatk-bridge-2.0.so.0.0.0" \
        "libgbm.so.1:libgbm.so.1.0.0"; do
        soname=${pair%%:*}
        target=${pair##*:}
        if [ -f "$LIBS/$target" ] && [ ! -e "$LIBS/$soname" ]; then
            ln -s "$target" "$LIBS/$soname"
        fi
    done
}

restore_links
export LD_LIBRARY_PATH="$LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PLAYWRIGHT_BROWSERS_PATH="$BROWSERS"

# The headless shell is ~120 MB; only fetch it when the directory is missing.
if [ ! -d "$BROWSERS/chromium_headless_shell-1248" ] && [ -d "$HOME/.cache/ms-playwright/chromium_headless_shell-1194" ]; then
    mkdir -p "$BROWSERS"
    cp -r "$HOME/.cache/ms-playwright/chromium_headless_shell-1194" "$BROWSERS/" 2>/dev/null || true
fi

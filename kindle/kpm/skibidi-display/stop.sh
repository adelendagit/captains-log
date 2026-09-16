#!/bin/sh

STATE_DIR="/var/local/skibidi-display"
AUTOSTART_MARKER="$STATE_DIR/autostart.enabled"

# Stop is the escape hatch: disable future boot autostart first, so a reboot
# cannot immediately trap the user back in kiosk mode.
rm -f "$AUTOSTART_MARKER" >/dev/null 2>&1 || true
initctl stop skibidi-display >/dev/null 2>&1 || true

# Restore ordinary Kindle sleep behaviour.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true
fi

# Stop the fullscreen Chromium process.
killall kindle_browser >/dev/null 2>&1 || true

# Restore the normal Kindle UI.
if [ -d /etc/upstart ]; then
  start lab126_gui >/dev/null 2>&1 || true
  usleep 1250000 2>/dev/null || sleep 2
elif [ -x /etc/init.d/framework ]; then
  /etc/init.d/framework start >/dev/null 2>&1 || true
  sleep 2
fi

# Clear any stale e-ink image if eips is available.
if command -v eips >/dev/null 2>&1; then
  eips -c >/dev/null 2>&1 || true
  eips -c >/dev/null 2>&1 || true
fi

exit 0

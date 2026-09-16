#!/bin/sh

PACKAGE_DIR="/mnt/us/kmc/kpm/packages/skibidi-display"
STATE_DIR="/var/local/skibidi-display"
AUTOSTART_JOB="/etc/upstart/skibidi-display.conf"

# Restore normal UI/power state and disable the opt-in marker before removal.
if [ -f "$PACKAGE_DIR/stop.sh" ]; then
  /bin/sh "$PACKAGE_DIR/stop.sh" >/dev/null 2>&1 || true
else
  rm -f "$STATE_DIR/autostart.enabled" >/dev/null 2>&1 || true
  lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true
fi

# Remove only the Upstart job that belongs to this package.
if [ -f "$AUTOSTART_JOB" ] && grep -q "Skibidi Display KPM autostart" "$AUTOSTART_JOB" 2>/dev/null; then
  initctl stop skibidi-display >/dev/null 2>&1 || true
  if command -v mntroot >/dev/null 2>&1 && mntroot rw >/dev/null 2>&1; then
    rm -f "$AUTOSTART_JOB" >/dev/null 2>&1 || true
    mntroot ro >/dev/null 2>&1 || true
    initctl reload-configuration >/dev/null 2>&1 || true
  fi
fi

rm -rf "$STATE_DIR" >/dev/null 2>&1 || true
rm -f "/mnt/us/documents/Skibidi Display.sh" "/mnt/us/documents/Stop Skibidi Display.sh" "/mnt/us/documents/Update Skibidi.sh"
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.contentmanagerd rescanContent 1 >/dev/null 2>&1 || true
fi
exit 0

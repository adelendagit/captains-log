#!/bin/sh

SCRIPTLET="/mnt/us/documents/Skibidi Display.sh"
STOP_SCRIPTLET="/mnt/us/documents/Stop Skibidi Display.sh"
UPDATE_SCRIPTLET="/mnt/us/documents/Update Skibidi.sh"
PACKAGE_DIR="/mnt/us/kmc/kpm/packages/skibidi-display"
STATE_DIR="/var/local/skibidi-display"
AUTOSTART_JOB="/etc/upstart/skibidi-display.conf"

cat > "$SCRIPTLET" <<'EOF'
#!/bin/sh
# Name: Skibidi Display
# Author: Captain's Log
/var/local/kmc/kindlehf/bin/kpm launch skibidi-display
EOF
chmod +x "$SCRIPTLET" 2>/dev/null || true

cat > "$STOP_SCRIPTLET" <<EOF
#!/bin/sh
# Name: Stop Skibidi Display
# Author: Captain's Log
/bin/sh "$PACKAGE_DIR/stop.sh"
EOF
chmod +x "$STOP_SCRIPTLET" 2>/dev/null || true

cat > "$UPDATE_SCRIPTLET" <<'EOF'
#!/bin/sh
# Name: Update Skibidi
# Author: Captain's Log
KPM="/var/local/kmc/kindlehf/bin/kpm"
if [ ! -x "$KPM" ]; then
  eips 2 2 "Skibidi update failed: KPM not found" 2>/dev/null || true
  exit 1
fi

eips -c 2>/dev/null || true
eips 2 2 "Checking for Skibidi updates..." 2>/dev/null || true
if ! "$KPM" update; then
  eips 2 4 "Repository update failed" 2>/dev/null || true
  exit 1
fi
if ! "$KPM" install skibidi-display; then
  eips 2 4 "Skibidi update failed" 2>/dev/null || true
  exit 1
fi
eips 2 4 "Skibidi is up to date" 2>/dev/null || true
exit 0
EOF
chmod +x "$UPDATE_SCRIPTLET" 2>/dev/null || true

# 0.6.0 remains manual-only. Clean up every legacy autostart component.
rm -f "$STATE_DIR/autostart.enabled" "$STATE_DIR/autostart.sh" "$STATE_DIR/skibidi-display.conf" >/dev/null 2>&1 || true\nrm -f "$PACKAGE_DIR/touch-exit.py" "$PACKAGE_DIR/touch-exit.lua" >/dev/null 2>&1 || true\nrm -f /mnt/us/skibidi-debug.log /mnt/us/skibidi-power-events.log /mnt/us/skibidi-runtime.log /mnt/us/skibidi-touch-exit.log /mnt/us/skibidi-lua-diagnostic.log >/dev/null 2>&1 || true
initctl stop skibidi-display >/dev/null 2>&1 || true

# Remove only the old Upstart job installed by our package.
if [ -f "$AUTOSTART_JOB" ] && grep -q "Skibidi Display KPM autostart" "$AUTOSTART_JOB" 2>/dev/null; then
  if command -v mntroot >/dev/null 2>&1 && mntroot rw >/dev/null 2>&1; then
    rm -f "$AUTOSTART_JOB" >/dev/null 2>&1 || true
    mntroot ro >/dev/null 2>&1 || true
    initctl reload-configuration >/dev/null 2>&1 || true
  fi
fi

# Ask the Kindle content indexer to notice the scriptlets when available.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.contentmanagerd rescanContent 1 >/dev/null 2>&1 || true
fi

exit 0

#!/bin/sh
set -e

SCRIPTLET="/mnt/us/documents/Skibidi Display.sh"
STOP_SCRIPTLET="/mnt/us/documents/Stop Skibidi Display.sh"
UPDATE_SCRIPTLET="/mnt/us/documents/Update Skibidi.sh"
PACKAGE_DIR="/mnt/us/kmc/kpm/packages/skibidi-display"
KPM="/var/local/kmc/kindlehf/bin/kpm"

cat > "$SCRIPTLET" <<'EOF'
#!/bin/sh
# Name: Skibidi Display
# Author: Captain's Log
/var/local/kmc/kindlehf/bin/kpm launch skibidi-display
EOF
chmod +x "$SCRIPTLET"

cat > "$STOP_SCRIPTLET" <<EOF
#!/bin/sh
# Name: Stop Skibidi Display
# Author: Captain's Log
/bin/sh "$PACKAGE_DIR/stop.sh"
EOF
chmod +x "$STOP_SCRIPTLET"

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
chmod +x "$UPDATE_SCRIPTLET"

# Ask the Kindle content indexer to notice the scriptlets when available.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.contentmanagerd rescanContent 1 >/dev/null 2>&1 || true
fi

exit 0

#!/bin/sh
set -e

SCRIPTLET="/mnt/us/documents/Skibidi Display.sh"
STOP_SCRIPTLET="/mnt/us/documents/Stop Skibidi Display.sh"
PACKAGE_DIR="/mnt/us/kmc/kpm/packages/skibidi-display"

cat > "$SCRIPTLET" <<'EOF'
#!/bin/sh
/var/local/kmc/bin/kpm launch skibidi-display
EOF
chmod +x "$SCRIPTLET"

cat > "$STOP_SCRIPTLET" <<EOF
#!/bin/sh
/bin/sh "$PACKAGE_DIR/stop.sh"
EOF
chmod +x "$STOP_SCRIPTLET"

# Ask the Kindle content indexer to notice the scriptlets when available.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.contentmanagerd rescanContent 1 >/dev/null 2>&1 || true
fi

exit 0

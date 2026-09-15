#!/bin/sh
set -e

SCRIPTLET="/mnt/us/documents/Skibidi Display.sh"
cat > "$SCRIPTLET" <<'EOF'
#!/bin/sh
/var/local/kmc/bin/kpm launch skibidi-display
EOF
chmod +x "$SCRIPTLET"

# Ask the Kindle content indexer to notice the new scriptlet when available.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.contentmanagerd rescanContent 1 >/dev/null 2>&1 || true
fi

exit 0

#!/bin/sh

SCRIPTLET="/mnt/us/documents/Skibidi Display.sh"
STOP_SCRIPTLET="/mnt/us/documents/Stop Skibidi Display.sh"
UPDATE_SCRIPTLET="/mnt/us/documents/Update Skibidi.sh"
PACKAGE_DIR="/mnt/us/kmc/kpm/packages/skibidi-display"
KPM="/var/local/kmc/kindlehf/bin/kpm"
STATE_DIR="/var/local/skibidi-display"
AUTOSTART_HELPER="$STATE_DIR/autostart.sh"
AUTOSTART_JOB="/etc/upstart/skibidi-display.conf"

mkdir -p "$STATE_DIR" >/dev/null 2>&1 || true

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

# Boot helper. Autostart is deliberately opt-in: a manual Skibidi launch creates
# autostart.enabled. Stop Skibidi removes it. That means a reboot remains a safe
# recovery route until the user has successfully launched the display once.
cat > "$AUTOSTART_HELPER" <<EOF
#!/bin/sh
URL="https://where.is.achilleas.co.uk/kindle.html"
MARKER="$STATE_DIR/autostart.enabled"
PACKAGE_DIR="$PACKAGE_DIR"

[ -f "\$MARKER" ] || exit 0

# framework_ready can occur before Wi-Fi/DNS is usable. Wait for the dashboard
# rather than opening Chromium onto an error page. Removing the marker cancels.
while [ -f "\$MARKER" ]; do
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --connect-timeout 5 --max-time 10 "\$URL" >/dev/null 2>&1 && break
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 10 -O /dev/null "\$URL" >/dev/null 2>&1 && break
  else
    sleep 15
    break
  fi
  sleep 10
done

[ -f "\$MARKER" ] || exit 0
[ -f "\$PACKAGE_DIR/launch.sh" ] || exit 1
SKIBIDI_AUTOSTART_BOOT=1 /bin/sh "\$PACKAGE_DIR/launch.sh"
EOF
chmod +x "$AUTOSTART_HELPER" 2>/dev/null || true

# Install a tiny Upstart job on modern Kindle firmware. Only overwrite our own
# job; never clobber an unrelated file with the same name. Rootfs is returned to
# read-only even if the copy fails.
if [ -d /etc/upstart ] && command -v mntroot >/dev/null 2>&1; then
  INSTALL_JOB=1
  if [ -f "$AUTOSTART_JOB" ] && ! grep -q "Skibidi Display KPM autostart" "$AUTOSTART_JOB" 2>/dev/null; then
    INSTALL_JOB=0
  fi

  if [ "$INSTALL_JOB" = "1" ]; then
    JOB_TMP="$STATE_DIR/skibidi-display.conf"
    cat > "$JOB_TMP" <<EOF
# Skibidi Display KPM autostart
description "Skibidi Display autostart"
start on framework_ready
stop on stopping framework
task
script
  /bin/sh "$AUTOSTART_HELPER" >>/tmp/skibidi-autostart.log 2>&1
end script
EOF

    if mntroot rw >/dev/null 2>&1; then
      cp -f "$JOB_TMP" "$AUTOSTART_JOB" >/dev/null 2>&1 || true
      chmod 0644 "$AUTOSTART_JOB" >/dev/null 2>&1 || true
      mntroot ro >/dev/null 2>&1 || true
      initctl reload-configuration >/dev/null 2>&1 || true
    fi
  fi
fi

# Ask the Kindle content indexer to notice the scriptlets when available.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.contentmanagerd rescanContent 1 >/dev/null 2>&1 || true
fi

exit 0

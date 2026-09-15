#!/bin/sh

# Restore normal power management and UI before removing the package.
PACKAGE_DIR="/mnt/us/kmc/kpm/packages/skibidi-display"
if [ -f "$PACKAGE_DIR/stop.sh" ]; then
  /bin/sh "$PACKAGE_DIR/stop.sh" >/dev/null 2>&1 || true
else
  lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true
fi

rm -f "/mnt/us/documents/Skibidi Display.sh" "/mnt/us/documents/Stop Skibidi Display.sh"
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.contentmanagerd rescanContent 1 >/dev/null 2>&1 || true
fi
exit 0

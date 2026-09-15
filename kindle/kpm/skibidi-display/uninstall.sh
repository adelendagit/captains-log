#!/bin/sh
rm -f "/mnt/us/documents/Skibidi Display.sh"
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.contentmanagerd rescanContent 1 >/dev/null 2>&1 || true
fi
exit 0

#!/bin/sh
# Skibidi Display safe stop: close only our browser and restore normal sleep.
killall kindle_browser >/dev/null 2>&1 || true
rm -f /tmp/skibidi-browser.pid >/dev/null 2>&1 || true

if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true
fi

# Native Kindle GUI was never stopped in 0.6.1. Starting it is harmless and
# also repairs a session left behind by 0.6.0.
if [ -d /etc/upstart ]; then
  cd / && start lab126_gui >/dev/null 2>&1 || true
elif [ -x /etc/init.d/framework ]; then
  cd / && /etc/init.d/framework start >/dev/null 2>&1 || true
fi

eips -c >/dev/null 2>&1 || true
eips -c >/dev/null 2>&1 || true
exit 0

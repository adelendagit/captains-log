#!/bin/sh

refresh_screen() {
  eips -c >/dev/null 2>&1 || true
  eips -c >/dev/null 2>&1 || true
}

if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true
fi

killall kindle_browser >/dev/null 2>&1 || true
rm -f /tmp/skibidi-browser.pid >/dev/null 2>&1 || true

refresh_screen
if [ -d /etc/upstart ]; then
  cd / && start lab126_gui >/dev/null 2>&1 || true
  usleep 1250000 2>/dev/null || sleep 2
elif [ -x /etc/init.d/framework ]; then
  cd / && /etc/init.d/framework start >/dev/null 2>&1 || true
  sleep 2
fi

refresh_screen
eips 1 1 "Please wait while Kindle UI is reset" >/dev/null 2>&1 || true
refresh_screen
exit 0

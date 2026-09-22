#!/bin/sh

if [ -f /tmp/skibidi-touch-exit.pid ]; then
  WATCHER_PID="$(cat /tmp/skibidi-touch-exit.pid 2>/dev/null)"
  [ "$WATCHER_PID" = "$$" ] || kill "$WATCHER_PID" >/dev/null 2>&1 || true
  rm -f /tmp/skibidi-touch-exit.pid
fi

if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true
fi

killall kindle_browser >/dev/null 2>&1 || true

if [ -d /etc/upstart ]; then
  start lab126_gui >/dev/null 2>&1 || true
  usleep 1250000 2>/dev/null || sleep 2
elif [ -x /etc/init.d/framework ]; then
  /etc/init.d/framework start >/dev/null 2>&1 || true
  sleep 2
fi

if command -v eips >/dev/null 2>&1; then
  eips -c >/dev/null 2>&1 || true
  eips -c >/dev/null 2>&1 || true
fi

exit 0

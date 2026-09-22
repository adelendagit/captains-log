#!/bin/sh
# 0.7.0 normally exits via Kindle's native browser Close (X).
# This remains as a recovery scriptlet.
killall kindle_browser >/dev/null 2>&1 || true

if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true
  lipc-set-prop com.lab126.appmgrd start app://com.lab126.booklet.home >/dev/null 2>&1 || true
fi

eips -c >/dev/null 2>&1 || true
eips -c >/dev/null 2>&1 || true
exit 0

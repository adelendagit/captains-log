#!/bin/sh
# Skibidi Display 0.7.0
# Launch through Kindle's own app manager so the browser is a managed app and
# the native KPP/chromebar Close control owns the session.

URL="https://where.is.achilleas.co.uk/kindle.html"

if ! command -v lipc-set-prop >/dev/null 2>&1; then
  eips 1 1 "Skibidi: LIPC unavailable" 2>/dev/null || true
  exit 1
fi

# Do not stop lab126_gui/framework. Do not spawn kindle_browser ourselves.
lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true

# This is the normal registered Kindle browser handler. Existing modern Kindle
# apps use the same appmgrd URL form, which lets Kindle own Close/Home lifecycle.
lipc-set-prop com.lab126.appmgrd start "app://com.lab126.browser?url=$URL"
RC=$?

if [ "$RC" -ne 0 ]; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true
  eips 1 1 "Skibidi: browser launch failed" 2>/dev/null || true
  exit "$RC"
fi

exit 0

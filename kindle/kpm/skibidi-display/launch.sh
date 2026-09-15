#!/bin/sh

URL="https://where.is.achilleas.co.uk/kindle.html"

# Keep the Kindle awake while it is being used as the Skibidi display.
# This is intentionally limited to launch behaviour; a separate stop action will
# restore normal power management before we make this an auto-starting appliance.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
fi

# Launch the stock Kindle browser directly at the dashboard. This remains our
# proven renderer on PW4/5.18.1.1.1 while we test power-management behaviour.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.appmgrd start app://com.lab126.browser?url="$URL" >/dev/null 2>&1 && exit 0
fi

# Fallback for firmware builds exposing the browser through the legacy command.
if command -v dbus-send >/dev/null 2>&1; then
  dbus-send --system /default com.lab126.chromebrowser.open string:"$URL" >/dev/null 2>&1 && exit 0
fi

exit 1

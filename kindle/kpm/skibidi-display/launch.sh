#!/bin/sh

URL="https://where.is.achilleas.co.uk/kindle.html"

# Launch the stock Kindle browser directly at the dashboard. This first version
# deliberately reuses the browser that is already proven to render the page on PW4.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.appmgrd start app://com.lab126.browser?url="$URL" >/dev/null 2>&1 && exit 0
fi

# Fallback for firmware builds exposing the browser through the legacy command.
if command -v dbus-send >/dev/null 2>&1; then
  dbus-send --system /default com.lab126.chromebrowser.open string:"$URL" >/dev/null 2>&1 && exit 0
fi

exit 1

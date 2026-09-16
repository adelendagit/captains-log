#!/bin/sh

URL="https://where.is.achilleas.co.uk/kindle.html"
STATE_DIR="/var/local/skibidi-display"
AUTOSTART_MARKER="$STATE_DIR/autostart.enabled"

# A deliberate manual launch opts the device into appliance mode: future reboots
# will auto-launch Skibidi. Boot launches set SKIBIDI_AUTOSTART_BOOT=1 so they do
# not need to rewrite the marker.
mkdir -p "$STATE_DIR" >/dev/null 2>&1 || true
if [ "${SKIBIDI_AUTOSTART_BOOT:-0}" != "1" ]; then
  touch "$AUTOSTART_MARKER" >/dev/null 2>&1 || true
fi

# Keep the Kindle awake while it is being used as the Skibidi display.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
fi

# Firmware 5.16.4+ uses the Chromium-based Kindle browser. Launching it directly
# avoids the stock browser shell; the fullscreen/kiosk flags are intentionally
# redundant so firmware variants hide as much address/navigation chrome as they
# support.
if [ -x /usr/bin/chromium/bin/kindle_browser ]; then
  # Avoid stacking multiple browser instances if the launcher is tapped twice.
  killall kindle_browser >/dev/null 2>&1 || true

  # Stop the normal Kindle GUI only for the fullscreen session. stop.sh restores
  # it, and a normal reboot remains a recovery route if autostart is disabled.
  if [ -d /etc/upstart ]; then
    stop lab126_gui >/dev/null 2>&1 || true
  elif [ -x /etc/init.d/framework ]; then
    /etc/init.d/framework stop >/dev/null 2>&1 || true
  fi

  export XDG_CONFIG_HOME="/mnt/us/system/browser/"
  export LD_LIBRARY_PATH="/usr/bin/chromium/lib:/usr/bin/chromium/usr/lib:/usr/lib/"

  nohup /usr/bin/chromium/bin/kindle_browser "$URL" \
    --no-zygote --no-sandbox --single-process \
    --skia-resource-cache-limit-mb=64 --disable-gpu --in-process-gpu \
    --disable-gpu-sandbox --disable-gpu-compositing \
    --enable-dom-distiller --enable-distillability-service \
    --force-device-scale-factor=1 --js-flags=jitless \
    --content-shell-hide-toolbar --kiosk --start-fullscreen \
    --content-shell-host-window-cord=0,0 \
    --disable-session-crashed-bubble --disable-infobars \
    --force-gpu-mem-available-mb=32 --enable-grayscale-mode \
    --enable-low-end-device-mode --enable-low-res-tiling \
    --disable-site-isolation-trials >/tmp/skibidi-browser.log 2>&1 &
  exit 0
fi

# Safe fallback: use the normal browser if direct Chromium is unavailable.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.appmgrd start app://com.lab126.browser?url="$URL" >/dev/null 2>&1 && exit 0
fi

# If launch failed, don't leave the Kindle permanently awake.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true
fi
exit 1

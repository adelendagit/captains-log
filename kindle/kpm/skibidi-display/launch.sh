#!/bin/sh

URL="https://where.is.achilleas.co.uk/kindle.html"

# Keep the Kindle awake while it is being used as the Skibidi display.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
fi

# Firmware 5.16.4+ uses the Chromium-based Kindle browser. Launching it directly
# avoids the stock browser shell.
if [ -x /usr/bin/chromium/bin/kindle_browser ]; then
  killall kindle_browser >/dev/null 2>&1 || true

  # Stop the normal Kindle GUI only for this manually-started fullscreen session.
  # stop.sh restores it. There is deliberately no boot/autostart behaviour.
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

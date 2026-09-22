#!/bin/sh

URL="https://where.is.achilleas.co.uk/kindle.html"
PACKAGE_DIR="/mnt/us/kmc/kpm/packages/skibidi-display"

if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
fi

# Local touchscreen escape hatch. This Kindle has /usr/bin/lua and its Goodix
# touchscreen is event2. Hold the visible EXIT target for about 2 seconds.
if command -v lua >/dev/null 2>&1 && [ -e /dev/input/event2 ]; then
  rm -f /mnt/us/skibidi-touch-exit.log >/dev/null 2>&1 || true
  nohup lua "$PACKAGE_DIR/touch-exit.lua" >/tmp/skibidi-touch-exit.stdout 2>&1 &
  echo $! >/tmp/skibidi-touch-exit.pid
fi

if [ -x /usr/bin/chromium/bin/kindle_browser ]; then
  killall kindle_browser >/dev/null 2>&1 || true
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

if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.appmgrd start app://com.lab126.browser?url="$URL" >/dev/null 2>&1 && exit 0
  lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true
fi
exit 1

#!/bin/sh

URL="https://where.is.achilleas.co.uk/kindle.html"
PACKAGE_DIR="/mnt/us/kmc/kpm/packages/skibidi-display"

# Keep the Kindle awake while it is being used as the Skibidi display.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
fi

# Local, network-independent escape hatch: while Skibidi is running, a short
# press of the Kindle power button exits the display and restores Kindle Home.
# This follows the same input-event pattern used by other Kindle dashboards.
if command -v evtest >/dev/null 2>&1 && [ -e /dev/input/event0 ]; then
  (
    script -f /dev/null -c "evtest /dev/input/event0" 2>/dev/null | while read line; do
      case "$line" in
        *"code 116 (Power), value 1"*)
          /bin/sh "$PACKAGE_DIR/stop.sh" >/dev/null 2>&1 || true
          exit 0
          ;;
      esac
    done
  ) >/tmp/skibidi-exit-watcher.log 2>&1 &
  echo $! >/tmp/skibidi-exit-watcher.pid
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

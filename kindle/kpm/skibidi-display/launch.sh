#!/bin/bash
# Skibidi Display 0.6.2 - native-UI test mode
# Based on Shortcut Browser's GO_FULLSCREEN=false pattern: keep Kindle UI alive
# and leave its native top area available as the escape route.

URL="https://where.is.achilleas.co.uk/kindle.html"
BROWSERSCALING=1
USERAGENT="Mozilla/5.0 (X11; U; Linux armv7l like Android; en-us) AppleWebKit/531.2+ (KHTML, like Gecko) Version/5.0 Safari/533.2+ Kindle/3.0+"

if [ ! -x /usr/bin/chromium/bin/kindle_browser ]; then
  eips 1 1 "Skibidi: Chromium browser not found" 2>/dev/null || true
  exit 1
fi

# Deliberately do NOT stop lab126_gui/framework and do NOT intercept power.
if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
fi

export XDG_CONFIG_HOME="/mnt/us/system/browser/"
export LD_LIBRARY_PATH="/usr/bin/chromium/lib:/usr/bin/chromium/usr/lib:/usr/lib/"

# Match Shortcut Browser's non-fullscreen geometry. In particular, do not use
# --kiosk or --start-fullscreen. The browser begins below the Kindle UI region.
nohup /usr/bin/chromium/bin/kindle_browser "$URL" \
  --no-zygote --no-sandbox --single-process \
  --skia-resource-cache-limit-mb=64 --disable-gpu --in-process-gpu \
  --disable-gpu-sandbox --disable-gpu-compositing \
  --enable-dom-distiller --enable-distillability-service \
  --force-device-scale-factor="$BROWSERSCALING" --js-flags=jitless \
  --content-shell-host-window-cord=0,215 \
  --force-gpu-mem-available-mb=32 --enable-grayscale-mode \
  --enable-low-end-device-mode --enable-low-res-tiling \
  --disable-site-isolation-trials --user-agent="$USERAGENT" \
  >/tmp/skibidi-browser.log 2>&1 &

echo $! >/tmp/skibidi-browser.pid
exit 0

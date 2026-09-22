#!/bin/bash
# Skibidi Display 0.6.0
# Lifecycle adapted from kindle-shortcut-browser for firmware 5.16.4+.

URL="https://where.is.achilleas.co.uk/kindle.html"
PACKAGE_DIR="/mnt/us/kmc/kpm/packages/skibidi-display"
BROWSERSCALING=1
USERAGENT="Mozilla/5.0 (X11; U; Linux armv7l like Android; en-us) AppleWebKit/531.2+ (KHTML, like Gecko) Version/5.0 Safari/533.2+ Kindle/3.0+"

if [ ! -x /usr/bin/chromium/bin/kindle_browser ]; then
  eips 1 1 "Skibidi: Chromium browser not found" 2>/dev/null || true
  exit 1
fi

refresh_screen() {
  eips -c >/dev/null 2>&1 || true
  eips -c >/dev/null 2>&1 || true
}

# Detect init style the same way as established Kindle launchers.
if [ -d /etc/upstart ]; then
  INIT_TYPE="upstart"
else
  INIT_TYPE="sysv"
fi

if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
fi

refresh_screen
if [ "$INIT_TYPE" = "sysv" ]; then
  /etc/init.d/framework stop >/dev/null 2>&1 || true
else
  trap "" TERM
  stop lab126_gui >/dev/null 2>&1 || true
  usleep 1250000 2>/dev/null || sleep 2
  trap - TERM
fi
refresh_screen

export XDG_CONFIG_HOME="/mnt/us/system/browser/"
export LD_LIBRARY_PATH="/usr/bin/chromium/lib:/usr/bin/chromium/usr/lib:/usr/lib/"

nohup /usr/bin/chromium/bin/kindle_browser "$URL" \
  --no-zygote --no-sandbox --single-process \
  --skia-resource-cache-limit-mb=64 --disable-gpu --in-process-gpu \
  --disable-gpu-sandbox --disable-gpu-compositing \
  --enable-dom-distiller --enable-distillability-service \
  --force-device-scale-factor="$BROWSERSCALING" --js-flags=jitless \
  --content-shell-hide-toolbar --content-shell-host-window-cord=0,215 \
  --force-gpu-mem-available-mb=32 --enable-grayscale-mode \
  --enable-low-end-device-mode --enable-low-res-tiling \
  --disable-site-isolation-trials --user-agent="$USERAGENT" \
  >/tmp/skibidi-browser.log 2>&1 &

BROWSER_PID=$!
echo "$BROWSER_PID" >/tmp/skibidi-browser.pid

# Shortcut Browser's proven local power-button reader. On this Kindle the
# diagnostic confirmed event1 is bd71827-power, matching the upstream script.
unset LD_LIBRARY_PATH
DEV="/dev/input/event1"
while [ -e "$DEV" ]; do
  event=$(dd if="$DEV" bs=16 count=1 2>/dev/null | hexdump -v -e '16/1 "%02X"')
  type="${event:16:4}"
  code="${event:20:4}"
  value="${event:24:8}"
  if [ "$type" = "0100" ] && [ "$code" = "7400" ] && [ "$value" = "01000000" ]; then
    /bin/sh "$PACKAGE_DIR/stop.sh"
    exit 0
  fi
done

# If the input watcher ends unexpectedly, restore the UI rather than strand it.
kill -9 "$BROWSER_PID" >/dev/null 2>&1 || true
/bin/sh "$PACKAGE_DIR/stop.sh"
exit 0

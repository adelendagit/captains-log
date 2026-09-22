#!/usr/bin/env python3
import os, struct, time

DEVICE = "/dev/input/event2"
STOP = "/mnt/us/kmc/kpm/packages/skibidi-display/stop.sh"
LOG = "/mnt/us/skibidi-touch-exit.log"

EV_SYN, EV_ABS = 0, 3
SYN_REPORT = 0
ABS_MT_POSITION_X, ABS_MT_POSITION_Y, ABS_MT_TRACKING_ID = 53, 54, 57

# The on-screen EXIT target is the top-right corner. We deliberately define it
# as a percentage of the digitizer's observed coordinate range, so it works
# without hard-coding this Kindle panel's absolute max values.
x = y = None
min_x = min_y = None
max_x = max_y = None
tracking = False
started = None
start_x = start_y = None

def log(msg):
    try:
        with open(LOG, "a") as f:
            f.write("%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg))
    except Exception:
        pass

def in_exit(px, py):
    if None in (px, py, min_x, min_y, max_x, max_y):
        return False
    xr = max_x - min_x
    yr = max_y - min_y
    if xr < 100 or yr < 100:
        return False
    # Top-right 28% x 22% of the observed panel range. Because some panels
    # report inverted axes, accept any corner for the first hardware proof;
    # the visible EXIT target is top-right and we'll tighten orientation after.
    near_x_edge = px >= min_x + xr * 0.72 or px <= min_x + xr * 0.28
    near_y_edge = py >= min_y + yr * 0.78 or py <= min_y + yr * 0.22
    return near_x_edge and near_y_edge

log("touch exit watcher starting on %s" % DEVICE)

fmt = "llHHi"
size = struct.calcsize(fmt)

try:
    fd = os.open(DEVICE, os.O_RDONLY)
    while True:
        raw = os.read(fd, size)
        if len(raw) != size:
            continue
        sec, usec, etype, code, value = struct.unpack(fmt, raw)

        if etype == EV_ABS:
            if code == ABS_MT_POSITION_X:
                x = value
                min_x = value if min_x is None else min(min_x, value)
                max_x = value if max_x is None else max(max_x, value)
            elif code == ABS_MT_POSITION_Y:
                y = value
                min_y = value if min_y is None else min(min_y, value)
                max_y = value if max_y is None else max(max_y, value)
            elif code == ABS_MT_TRACKING_ID:
                if value >= 0 and not tracking:
                    tracking = True
                    started = time.time()
                    start_x, start_y = x, y
                elif value < 0 and tracking:
                    duration = time.time() - started if started else 0
                    ex, ey = x, y
                    log("release x=%s y=%s held=%.2f range=%s,%s..%s,%s" %
                        (ex, ey, duration, min_x, min_y, max_x, max_y))
                    if duration >= 1.5 and in_exit(ex, ey):
                        log("EXIT gesture accepted")
                        os.system("/bin/sh %s >/tmp/skibidi-stop.log 2>&1" % STOP)
                        break
                    tracking = False
                    started = None
        elif etype == EV_SYN and code == SYN_REPORT:
            if tracking and start_x is None and x is not None and y is not None:
                start_x, start_y = x, y
except Exception as exc:
    log("watcher failed: %r" % (exc,))

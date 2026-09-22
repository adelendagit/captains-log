local ffi = require("ffi")

ffi.cdef[[
struct input_event {
  long tv_sec;
  long tv_usec;
  unsigned short type;
  unsigned short code;
  int value;
};
int open(const char *pathname, int flags);
int close(int fd);
long read(int fd, void *buf, unsigned long count);
]]

local C = ffi.C
local DEVICE = "/dev/input/event2"
local STOP = "/mnt/us/kmc/kpm/packages/skibidi-display/stop.sh"
local LOG = "/mnt/us/skibidi-touch-exit.log"

local EV_SYN, EV_ABS = 0, 3
local SYN_REPORT = 0
local ABS_MT_POSITION_X, ABS_MT_POSITION_Y, ABS_MT_TRACKING_ID = 53, 54, 57

local function log(msg)
  local f = io.open(LOG, "a")
  if f then
    f:write(os.date("%Y-%m-%d %H:%M:%S "), msg, "\n")
    f:close()
  end
end

local fd = C.open(DEVICE, 0)
if fd < 0 then
  log("ERROR cannot open " .. DEVICE)
  os.exit(1)
end

local ev = ffi.new("struct input_event")
local size = ffi.sizeof(ev)
local x, y
local down = false
local down_at = 0
local min_x, max_x, min_y, max_y

local function observe(v, lo, hi)
  if lo == nil or v < lo then lo = v end
  if hi == nil or v > hi then hi = v end
  return lo, hi
end

local function is_corner(px, py)
  if not (px and py and min_x and max_x and min_y and max_y) then return false end
  local xr, yr = max_x - min_x, max_y - min_y
  if xr < 100 or yr < 100 then return false end
  -- For the first hardware proof, accept a long hold in any corner because
  -- Goodix axis orientation may be mirrored/rotated relative to the screen.
  local xedge = px <= min_x + xr * 0.28 or px >= min_x + xr * 0.72
  local yedge = py <= min_y + yr * 0.22 or py >= min_y + yr * 0.78
  return xedge and yedge
end

log("Lua touch watcher starting; event_size=" .. tostring(size))

while true do
  local n = C.read(fd, ev, size)
  if n == size then
    local etype, code, value = tonumber(ev.type), tonumber(ev.code), tonumber(ev.value)
    if etype == EV_ABS then
      if code == ABS_MT_POSITION_X then
        x = value
        min_x, max_x = observe(value, min_x, max_x)
      elseif code == ABS_MT_POSITION_Y then
        y = value
        min_y, max_y = observe(value, min_y, max_y)
      elseif code == ABS_MT_TRACKING_ID then
        if value >= 0 and not down then
          down = true
          down_at = os.time()
          log("DOWN id=" .. value .. " x=" .. tostring(x) .. " y=" .. tostring(y))
        elseif value < 0 and down then
          local held = os.time() - down_at
          log("UP x=" .. tostring(x) .. " y=" .. tostring(y) ..
              " held=" .. tostring(held) ..
              " range=" .. tostring(min_x) .. "," .. tostring(min_y) ..
              ".." .. tostring(max_x) .. "," .. tostring(max_y))
          if held >= 2 and is_corner(x, y) then
            log("EXIT gesture accepted")
            C.close(fd)
            os.execute("/bin/sh " .. STOP .. " >/tmp/skibidi-stop.log 2>&1")
            os.exit(0)
          end
          down = false
        end
      end
    elseif etype == EV_SYN and code == SYN_REPORT then
      -- Coordinates are committed here; no action required until release.
    end
  elseif n < 0 then
    log("ERROR read failed")
    C.close(fd)
    os.exit(1)
  end
end

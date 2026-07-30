#!/bin/bash
# Stop anything this project left running, from a different terminal.
#
#   ./scripts/stop.sh          # or: npm run stop
#
# For when a window got closed, a process was orphaned, or the terminal is
# wedged and Ctrl-C isn't landing. Deliberately narrow: it only kills things
# matching THIS checkout's paths, never every node on the machine.

set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PORT="${PORT:-3002}"

killed=0

# The brain app, identified by whatever is actually listening on the port —
# more reliable than matching a command line, since `next dev` renames itself.
for pid in $(lsof -ti tcp:"$PORT" 2>/dev/null); do
  echo "killing pid $pid (listening on :$PORT)"
  kill -TERM "$pid" 2>/dev/null
  killed=1
done

# The watcher, scoped to this checkout so a second clone isn't affected.
for pid in $(pgrep -f "$ROOT/src/main.js" 2>/dev/null; pgrep -f "node src/main.js" 2>/dev/null); do
  # pgrep -f "node src/main.js" can match a sibling checkout; confirm the cwd.
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  case "$cwd" in
    "$ROOT"*) echo "killing pid $pid (watcher)"; kill -TERM "$pid" 2>/dev/null; killed=1 ;;
  esac
done

sleep 1

# Anything that ignored TERM.
for pid in $(lsof -ti tcp:"$PORT" 2>/dev/null); do
  echo "force-killing pid $pid"
  kill -KILL "$pid" 2>/dev/null
done

if [ "$killed" = "0" ]; then
  echo "nothing running (port $PORT free, no watcher for this checkout)"
else
  echo "stopped."
fi

# If a wedged run left this terminal in raw mode.
[ -t 0 ] && stty sane 2>/dev/null

exit 0

#!/bin/bash
# Start the whole second brain: the vault watcher and the brain app, together,
# with interleaved labelled logs and one Ctrl-C that actually stops both.
#
#   ./scripts/start.sh          # watcher + brain app on :3002
#   PORT=3005 ./scripts/start.sh
#   ./scripts/start.sh watcher  # just one of them
#   ./scripts/start.sh brain
#
# Written for macOS's /bin/bash, which is still 3.2 — so no `wait -n`, no
# associative arrays, no ${arr[@]:-} under `set -u`.
#
# Deliberately NO `set -m`. Job control moves the children into their own
# process groups, which means the terminal's Ctrl-C (delivered to the
# foreground group) never reaches them — the parent has to relay it, and if
# anything goes wrong with the trap you get a wedged, unkillable-looking
# terminal. Without job control every child shares this shell's group, so
# Ctrl-C hits all of them directly and the trap below is belt-and-braces
# rather than the only mechanism.

set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PORT="${PORT:-3002}"
WHICH="${1:-all}"

if [ -t 1 ]; then
  DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RST=$'\033[0m'
else
  DIM=""; RED=""; GRN=""; YEL=""; RST=""
fi

say()  { printf '%s\n' "${DIM}› $*${RST}"; }
warn() { printf '%s\n' "${YEL}⚠ $*${RST}"; }
die()  { printf '%s\n' "${RED}✗ $*${RST}" >&2; exit 1; }

case "$WHICH" in
  all|watcher|brain) ;;
  *) die "usage: $0 [all|watcher|brain]" ;;
esac

# --- preflight: fail with a fixable message, not a stack trace -------------

command -v node >/dev/null || die "node not found. Install Node 20+ and retry."

if [ "$WHICH" != "brain" ]; then
  [ -d "$ROOT/node_modules" ] || die "watcher deps missing. Run: npm install"
  [ -f "$ROOT/.env" ] || warn "no .env at the repo root — the watcher's Gemini backstop will be unavailable."
fi

if [ "$WHICH" != "watcher" ]; then
  [ -d "$ROOT/brain/node_modules" ] || die "brain deps missing. Run: cd brain && npm install"
  [ -f "$ROOT/brain/.env" ] || warn "no brain/.env — saving works, but triage and the bookmarklet won't."
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    die "port $PORT is already in use (another copy running?). Stop it, or: PORT=3005 $0"
  fi
fi

# --- run ------------------------------------------------------------------

PIDS=""   # space-separated; bash 3.2 arrays under `set -u` are a minefield

# Prefix every line so two processes in one terminal stay readable. A bash read
# loop rather than `sed -u`, which is GNU-only and absent on macOS.
run() {
  name="$1"; color="$2"; dir="$3"; shift 3
  # stdin from /dev/null is load-bearing, not tidiness. Both children inherit
  # the terminal otherwise, and a dev server that finds a TTY on stdin may put
  # it in raw mode to listen for keystrokes. Raw mode disables ISIG, so ^C stops
  # being a signal and arrives as a literal byte — the terminal appears wedged
  # and Ctrl-C does nothing, no matter how many times you press it. Observed.
  ( cd "$dir" && "$@" < /dev/null 2>&1 | while IFS= read -r line; do
      printf '%s%-7s%s %s\n' "$color" "$name" "$RST" "$line"
    done ) &
  PIDS="$PIDS $!"
}

# Kill a process and everything under it, depth-first. `next dev` spawns
# workers, and the log-prefixing pipeline adds another layer, so signalling
# only the PID we backgrounded leaves real processes holding the port.
#
# Deliberately NOT `kill -TERM -$pid` (process group): job control doesn't
# reliably assign separate groups without a controlling terminal, and when it
# doesn't, the group kill quietly misses — verified, children survived.
kill_tree() {
  sig="$1"; parent="$2"
  for child in $(pgrep -P "$parent" 2>/dev/null); do
    kill_tree "$sig" "$child"
  done
  kill "-$sig" "$parent" 2>/dev/null || true
}

signal_all() {
  for pid in $PIDS; do
    kill_tree "$1" "$pid"
  done
}

CLEANED=0
cleanup() {
  [ "$CLEANED" = "1" ] && return
  CLEANED=1
  trap '' INT TERM HUP
  # Printed FIRST, before any killing: silence after Ctrl-C is what makes a
  # terminal feel wedged, and the user's next move is another Ctrl-C.
  printf '\n'
  say "stopping…"
  signal_all TERM
  sleep 1
  signal_all KILL
  # If a child did leave the tty in raw mode, hand the terminal back working.
  [ -t 0 ] && stty sane 2>/dev/null
  say "stopped."
}
# HUP too, so closing the terminal window doesn't orphan a server on :3002.
trap cleanup INT TERM HUP EXIT

if [ "$WHICH" != "brain" ];   then run watcher "$GRN" "$ROOT" node src/main.js; fi
if [ "$WHICH" != "watcher" ]; then run brain   "$YEL" "$ROOT/brain" npx next dev -p "$PORT"; fi

printf '\n'
[ "$WHICH" != "watcher" ] && say "brain    → http://localhost:$PORT"
[ "$WHICH" != "brain" ]   && say "watcher  → filing into the iCloud vault inbox"
say "Ctrl-C stops everything"
printf '\n'

# Poll instead of `wait -n` (bash 4.3+). The sleep is short on purpose: bash
# defers a trap until the current foreground command finishes, so this interval
# is also the worst-case delay between Ctrl-C and anything visible happening.
# Two seconds of a terminal ignoring you reads as "it's hung".
while :; do
  for pid in $PIDS; do
    if ! kill -0 "$pid" 2>/dev/null; then
      warn "a process exited — shutting the rest down."
      exit 1
    fi
  done
  sleep 0.3
done

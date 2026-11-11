#!/usr/bin/env bash
# Stops the local stand and wipes its state, the one-time password included.
set -uo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
state="$root/.sim"
for name in api pg; do
  if [ -f "$state/$name.pid" ]; then
    pid=$(cat "$state/$name.pid")
    pkill -P "$pid" 2>/dev/null
    kill "$pid" 2>/dev/null
  fi
done
sleep 1
rm -rf "$state"
echo "the stand is down"

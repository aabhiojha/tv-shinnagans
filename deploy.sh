#!/bin/sh
# Package, sign, install and open the launcher on the TV.
#   TV=192.168.1.33 PROFILE=couch ./deploy.sh
set -e
TV=${TV:-192.168.1.33}
PROFILE=${PROFILE:-couch}
APP=TVshnHome1.Home
SDK=${TIZEN_SDK:-$HOME/tizen-studio}
TIZEN=$SDK/tools/ide/bin/tizen
SDB=$SDK/tools/sdb

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
cp -r "$(dirname "$0")/launcher" "$out/src"

"$SDB" connect "$TV:26101"
"$TIZEN" package -t wgt -s "$PROFILE" -o "$out" -- "$out/src"
"$TIZEN" install -n Home.wgt -s "$TV:26101" -- "$out"
"$TIZEN" run -p "$APP" -s "$TV:26101"

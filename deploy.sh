#!/bin/sh
# Package, sign, install and open the launcher on the TV.
#   TV=<TV IP> [PROFILE=<certificate profile>] ./deploy.sh
set -e
: "${TV:?set TV to the IP of the TV, for example TV=192.168.1.20 ./deploy.sh}"
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

#!/bin/sh
# Launches the built AppImage with --no-sandbox.
#
# This can't be baked into the AppImage itself: Chromium's sandbox check
# happens in native code before any of the app's own JavaScript runs (not
# even a self-relaunch-with-the-flag trick can intervene in time), and the
# AppImage's chrome-sandbox helper gets extracted to a fresh temp mount point
# on every launch, so there's nothing stable to chown/chmod the way you can
# for a normal install. The .deb doesn't need this wrapper -- its desktop
# entry already launches with --no-sandbox built in (see package.json's
# build.linux.executableArgs).
set -e
cd "$(dirname "$0")/dist"
exec ./"$(ls *.AppImage | head -n1)" --no-sandbox "$@"

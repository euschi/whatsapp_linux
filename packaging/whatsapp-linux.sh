#!/bin/sh
# Extra Chromium flags, one per line (e.g. --ozone-platform=x11).
flags_file="${XDG_CONFIG_HOME:-$HOME/.config}/whatsapp-linux-flags.conf"
flags=""
if [ -r "$flags_file" ]; then
  flags="$(grep -v '^[[:space:]]*#' "$flags_file")"
fi
export WA_LAUNCHER=/usr/bin/whatsapp-linux
# shellcheck disable=SC2086
exec /usr/bin/electron44 /usr/lib/whatsapp-linux $flags "$@"

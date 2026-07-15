#!/usr/bin/env bash
set -euo pipefail

config_path="${1:-deploy/nginx/nginx.conf}"
probe_request='GET /api/v1/auth/github/callback?code=synthetic-code&state=synthetic-state HTTP/1.1'

log_format=$(awk '
  /log_format oauth_callback_safe/ { capture=1 }
  capture { print }
  capture && /;/ { exit }
' "$config_path")

if [[ -z "$log_format" ]]; then
  echo "nginx callback probe: missing oauth_callback_safe log_format" >&2
  exit 1
fi

if grep -Eq '\$request([^_a-zA-Z0-9]|$)|\$request_uri([^_a-zA-Z0-9]|$)|\$args([^_a-zA-Z0-9]|$)|\$query_string([^_a-zA-Z0-9]|$)' <<<"$log_format"; then
  echo "nginx callback probe: log_format can include query strings" >&2
  exit 1
fi

synthetic_log=${log_format//'$request_method'/GET}
synthetic_log=${synthetic_log//'$uri'/\/api\/v1\/auth\/github\/callback}
synthetic_log=${synthetic_log//'$server_protocol'/HTTP\/1.1}

if grep -Eq 'synthetic-code|synthetic-state|code=|state=' <<<"$synthetic_log"; then
  echo "nginx callback probe: synthetic log leaked callback query" >&2
  exit 1
fi

callback_location=$(awk '/location = \/api\/v1\/auth\/github\/callback/,/^[[:space:]]*}/ { print }' "$config_path")

if [[ -z "$callback_location" ]]; then
  echo "nginx callback probe: missing exact callback location" >&2
  exit 1
fi

if ! grep -q 'access_log /var/log/nginx/access.log oauth_callback_safe' <<<"$callback_location"; then
  echo "nginx callback probe: callback does not use oauth_callback_safe log format" >&2
  exit 1
fi

if ! grep -q 'Referrer-Policy "no-referrer" always' <<<"$callback_location"; then
  echo "nginx callback probe: missing callback Referrer-Policy" >&2
  exit 1
fi

if ! grep -q 'Cache-Control "no-store" always' <<<"$callback_location"; then
  echo "nginx callback probe: missing callback Cache-Control" >&2
  exit 1
fi

echo "nginx callback probe: ok (${probe_request%%\?*} query redacted from synthetic access log)"

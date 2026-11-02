#!/bin/sh
set -eu

domain=${RENEWED_DOMAINS%% *}
test -n "$domain"
src=/etc/letsencrypt/live/$domain
dst=/etc/private-mail-hub/tls
group=private-mail-hub-tls
install -o root -g "$group" -m 0640 "$src/fullchain.pem" "$dst/fullchain.pem.new"
install -o root -g "$group" -m 0640 "$src/privkey.pem" "$dst/privkey.pem.new"
mv -f "$dst/fullchain.pem.new" "$dst/fullchain.pem"
mv -f "$dst/privkey.pem.new" "$dst/privkey.pem"
systemctl reload-or-restart caddy
curl -fsS -u "$STALWART_USERNAME:$STALWART_PASSWORD" -H 'content-type: application/json' \
  --data '{"using":["urn:ietf:params:jmap:core","urn:stalwart:jmap"],"methodCalls":[["x:Action/set",{"create":{"reload":{"@type":"ReloadTlsCertificates"}}},"r"]]}' \
  http://127.0.0.1:8080/jmap/ >/dev/null

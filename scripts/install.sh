#!/bin/sh
set -eu

STALWART_VERSION=1.0.1
STALWART_SHA256=aabae69bcdeff31e305d60f3ecb059fdb203116c0077d81560bf6d6f0f757d75
NODE_VERSION=26.13.0
NODE_SHA256=d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997
CADDY_VERSION=2.11.7
CADDY_SHA256=727b91701a392de6ebc5027509f548bf39979e5216340d0faed8fa5e69c84f8b

test "$(id -u)" -eq 0 || { echo "run as root" >&2; exit 1; }
test -n "${MAIL_DOMAIN:-}" && test -n "${MAIL_HOST:-}" || { echo "MAIL_DOMAIN and MAIL_HOST are required" >&2; exit 1; }
case "$MAIL_HOST" in *.$MAIL_DOMAIN) ;; *) echo "MAIL_HOST must be under MAIL_DOMAIN" >&2; exit 1;; esac
test "$(uname -m)" = x86_64 || { echo "this pinned installer currently supports x86_64" >&2; exit 1; }
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test "$project_dir" = /opt/private-mail-hub || { echo "install the source at /opt/private-mail-hub first" >&2; exit 1; }
umask 027

wait_http() {
  url=$1
  attempts=${2:-30}
  for unused in $(seq 1 "$attempts"); do
    curl -fsS "$url" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "timed out waiting for $url" >&2
  return 1
}

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl xz-utils jq openssl certbot restic sqlite3 ufw build-essential python3 make g++ git

tmp=$(mktemp -d /tmp/private-mail-hub-install.XXXXXX)
trap 'rm -rf -- "$tmp"' EXIT INT TERM

curl --proto '=https' --tlsv1.2 -fL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o "$tmp/node.tar.xz"
echo "$NODE_SHA256  $tmp/node.tar.xz" | sha256sum -c -
install -d -o root -g root -m 0755 "/usr/local/lib/node-v${NODE_VERSION}"
tar -xJf "$tmp/node.tar.xz" --strip-components=1 -C "/usr/local/lib/node-v${NODE_VERSION}"
for binary in node npm npx corepack; do ln -sfn "/usr/local/lib/node-v${NODE_VERSION}/bin/$binary" "/usr/local/bin/$binary"; done

curl --proto '=https' --tlsv1.2 -fL "https://github.com/stalwartlabs/stalwart/releases/download/v${STALWART_VERSION}/stalwart-x86_64-unknown-linux-gnu.tar.gz" -o "$tmp/stalwart.tar.gz"
echo "$STALWART_SHA256  $tmp/stalwart.tar.gz" | sha256sum -c -
tar -xzf "$tmp/stalwart.tar.gz" -C "$tmp"
install -o root -g root -m 0755 "$tmp/stalwart" /usr/local/bin/stalwart

curl --proto '=https' --tlsv1.2 -fL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" -o "$tmp/caddy.tar.gz"
echo "$CADDY_SHA256  $tmp/caddy.tar.gz" | sha256sum -c -
tar -xzf "$tmp/caddy.tar.gz" -C "$tmp" caddy
install -o root -g root -m 0755 "$tmp/caddy" /usr/local/bin/caddy

getent group private-mail-hub-tls >/dev/null || groupadd --system private-mail-hub-tls
id stalwart >/dev/null 2>&1 || useradd --system --user-group --no-create-home --shell /usr/sbin/nologin stalwart
id private-mail-hub >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/private-mail-hub --no-create-home --shell /usr/sbin/nologin private-mail-hub
id caddy >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/caddy --no-create-home --shell /usr/sbin/nologin caddy
for account in stalwart private-mail-hub caddy; do usermod -a -G private-mail-hub-tls "$account"; done

install -d -o stalwart -g stalwart -m 0750 /etc/stalwart /var/lib/stalwart /var/log/stalwart
# TLS consumers need to traverse this parent directory. Files below it retain
# their own restrictive owner/group modes, while 0711 prevents directory listing.
install -d -o root -g root -m 0711 /etc/private-mail-hub
install -d -o root -g private-mail-hub-tls -m 0750 /etc/private-mail-hub/tls
install -d -o private-mail-hub -g private-mail-hub -m 0711 /var/lib/private-mail-hub
install -d -o private-mail-hub -g private-mail-hub -m 0755 /var/lib/private-mail-hub/acme
install -d -o caddy -g caddy -m 0750 /etc/caddy /var/lib/caddy /var/log/caddy
install -d -o root -g root -m 0700 /var/backups/private-mail-hub

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -sha256 -days 14 -nodes \
  -subj "/CN=$MAIL_HOST" -addext "subjectAltName=DNS:$MAIL_HOST" \
  -keyout /etc/private-mail-hub/tls/privkey.pem -out /etc/private-mail-hub/tls/fullchain.pem
chown root:private-mail-hub-tls /etc/private-mail-hub/tls/*.pem
chmod 0640 /etc/private-mail-hub/tls/*.pem

cp "$project_dir/deploy/systemd/stalwart.service" /etc/systemd/system/stalwart.service
cp "$project_dir/deploy/systemd/private-mail-hub.service" /etc/systemd/system/private-mail-hub.service
cp "$project_dir/deploy/systemd/caddy.service" /etc/systemd/system/caddy.service
cp "$project_dir/deploy/systemd/private-mail-hub-backup.service" /etc/systemd/system/private-mail-hub-backup.service
cp "$project_dir/deploy/systemd/private-mail-hub-backup.timer" /etc/systemd/system/private-mail-hub-backup.timer
cp "$project_dir/deploy/systemd/private-mail-hub-monitor.service" /etc/systemd/system/private-mail-hub-monitor.service
cp "$project_dir/deploy/systemd/private-mail-hub-monitor.timer" /etc/systemd/system/private-mail-hub-monitor.timer
cp "$project_dir/deploy/caddy/Caddyfile" /etc/caddy/Caddyfile
chown root:caddy /etc/caddy/Caddyfile
chmod 0640 /etc/caddy/Caddyfile
printf 'MAIL_HOST=%s\n' "$MAIL_HOST" > /etc/caddy/private-mail-hub.env
chown root:caddy /etc/caddy/private-mail-hub.env
chmod 0640 /etc/caddy/private-mail-hub.env
chmod 0750 "$project_dir/scripts"/*.sh

cd "$project_dir"
npm ci
npm run build
chown -R root:private-mail-hub "$project_dir/dist" "$project_dir/node_modules"

bootstrap_password=$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-24)
cat > /etc/stalwart/stalwart.env <<EOF
STALWART_HOSTNAME=$MAIL_HOST
STALWART_PUBLIC_URL=https://$MAIL_HOST
STALWART_RECOVERY_ADMIN=admin:$bootstrap_password
EOF
chown root:stalwart /etc/stalwart/stalwart.env
chmod 0640 /etc/stalwart/stalwart.env
systemctl daemon-reload
systemctl enable stalwart
systemctl start stalwart
wait_http http://127.0.0.1:8080/.well-known/jmap
MODE=bootstrap OUTPUT_FILE=/etc/private-mail-hub/stalwart-admin.json BOOTSTRAP_PASSWORD="$bootstrap_password" MAIL_HOST="$MAIL_HOST" MAIL_DOMAIN="$MAIL_DOMAIN" /usr/local/bin/node "$project_dir/scripts/bootstrap-stalwart.mjs"
sed -i '/^STALWART_RECOVERY_ADMIN=/d' /etc/stalwart/stalwart.env
systemctl restart stalwart
wait_http http://127.0.0.1:8080/.well-known/jmap
MODE=configure OUTPUT_FILE=/etc/private-mail-hub/stalwart-service.json ADMIN_CREDENTIAL_FILE=/etc/private-mail-hub/stalwart-admin.json MAIL_HOST="$MAIL_HOST" MAIL_DOMAIN="$MAIL_DOMAIN" /usr/local/bin/node "$project_dir/scripts/bootstrap-stalwart.mjs"
chmod 0600 /etc/private-mail-hub/stalwart-*.json
systemctl restart stalwart

admin_password=$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-24)
admin_hash=$(printf '%s' "$admin_password" | /usr/local/bin/node -e "import('argon2').then(async a=>{let d='';for await(const c of process.stdin)d+=c;process.stdout.write(await a.hash(d,{type:a.argon2id,memoryCost:65536,timeCost:3,parallelism:1}))})")
session_secret=$(openssl rand -base64 48 | tr -d '\n')
service_username=$(jq -r .serviceUsername /etc/private-mail-hub/stalwart-service.json)
service_password=$(jq -r .servicePassword /etc/private-mail-hub/stalwart-service.json)
domain_id=$(jq -r .domainId /etc/private-mail-hub/stalwart-service.json)
cat > /etc/private-mail-hub/app.env <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGIN=https://$MAIL_HOST
MAIL_DOMAIN=$MAIL_DOMAIN
MAIL_HOST=$MAIL_HOST
DATABASE_PATH=/var/lib/private-mail-hub/app.db
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH='$admin_hash'
SESSION_SECRET='$session_secret'
STALWART_BASE_URL=http://127.0.0.1:8080
STALWART_USERNAME=$service_username
STALWART_PASSWORD=$service_password
TLS_CERT_PATH=/etc/private-mail-hub/tls/fullchain.pem
MAIL_STORAGE_PATH=/var/lib/stalwart
TRUST_PROXY=loopback
EOF
chown root:private-mail-hub /etc/private-mail-hub/app.env
chmod 0640 /etc/private-mail-hub/app.env

restic_password=$(openssl rand -base64 48 | tr -d '\n')
printf '%s\n' "$restic_password" > /etc/private-mail-hub/restic-password
cat > /etc/private-mail-hub/restic.env <<EOF
RESTIC_REPOSITORY=/var/backups/private-mail-hub/restic-repo
RESTIC_PASSWORD_FILE=/etc/private-mail-hub/restic-password
EOF
chmod 0600 /etc/private-mail-hub/restic-password /etc/private-mail-hub/restic.env

systemctl start private-mail-hub
wait_http http://127.0.0.1:3000/healthz
systemctl stop private-mail-hub
/usr/local/bin/node "$project_dir/scripts/seed-domain.mjs" /var/lib/private-mail-hub/app.db "$domain_id" "$MAIL_DOMAIN"
chown private-mail-hub:private-mail-hub /var/lib/private-mail-hub/app.db*
chmod 0600 /var/lib/private-mail-hub/app.db*

mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/private-mail-hub <<EOF
#!/bin/sh
STALWART_USERNAME=\$(sed -n 's/^STALWART_USERNAME=//p' /etc/private-mail-hub/app.env)
STALWART_PASSWORD=\$(sed -n 's/^STALWART_PASSWORD=//p' /etc/private-mail-hub/app.env)
export STALWART_USERNAME STALWART_PASSWORD
exec /opt/private-mail-hub/scripts/renew-certificate.sh
EOF
chmod 0750 /etc/letsencrypt/renewal-hooks/deploy/private-mail-hub

systemctl enable --now private-mail-hub caddy private-mail-hub-backup.timer private-mail-hub-monitor.timer
ufw allow 25/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 993/tcp
ufw deny out proto tcp to any port 25
ufw deny out proto tcp to any port 465
ufw deny out proto tcp to any port 587
ufw --force enable
npm prune --omit=dev
chown -R root:private-mail-hub "$project_dir/node_modules"

printf '\nADMIN_USERNAME=admin\nADMIN_PASSWORD=%s\n' "$admin_password"
printf 'Self-signed TLS is active. Run obtain-certificate.sh after DNS resolves.\n'

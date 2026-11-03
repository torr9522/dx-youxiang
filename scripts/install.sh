#!/bin/sh
set -eu

STALWART_VERSION=1.0.1
STALWART_SHA256=aabae69bcdeff31e305d60f3ecb059fdb203116c0077d81560bf6d6f0f757d75
COSIGN_VERSION=3.1.4
COSIGN_SHA256=424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa
NODE_VERSION=26.13.0
NODE_SHA256=d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997
CADDY_VERSION=2.11.7
CADDY_SHA512=a7a433a1b133efc3c8d10eb0b99d52a24b5ef5c322dc77f5282182b1c0402139ab83f3a99f0c52409df77d20123fb0b523edad8a66d8f5e49136197bf61ef0e7
APP_BASE=/opt/dx-youxiang
CONFIG_DIR=/etc/dx-youxiang
DATA_DIR=/var/lib/dx-youxiang
BACKUP_DIR=/var/backups/dx-youxiang
CADDY_CONFIG=${CADDY_CONFIG:-/etc/caddy/Caddyfile}
ACME_MODE=${ACME_MODE:-production}

case "$ACME_MODE" in
  staging) ACME_DIRECTORY=https://acme-staging-v02.api.letsencrypt.org/directory ;;
  production) ACME_DIRECTORY=https://acme-v02.api.letsencrypt.org/directory ;;
  *) echo "ACME_MODE must be staging or production" >&2; exit 1 ;;
esac
export ACME_MODE ACME_DIRECTORY

test "$(id -u)" -eq 0 || { echo "run as root" >&2; exit 1; }
test -r /etc/os-release
# shellcheck disable=SC1091
. /etc/os-release
if test "$ID" != debian || test "$VERSION_ID" != 12; then echo "only Debian 12 is supported" >&2; exit 1; fi
test "$(uname -m)" = x86_64 || { echo "only Debian 12 AMD64 is supported" >&2; exit 1; }
test -f "$APP_BASE/current/package-lock.json" || { echo "release source is missing from $APP_BASE/current" >&2; exit 1; }
test ! -e /etc/stalwart/config.json || { echo "an existing Stalwart configuration was found; refusing to overwrite it" >&2; exit 1; }
umask 027

memory_kib=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
disk_kib=$(df -Pk /opt 2>/dev/null | awk 'NR==2 {print $4}')
test "${memory_kib:-0}" -ge 786432 || { echo "at least 768 MiB RAM is required" >&2; exit 1; }
test "${disk_kib:-0}" -ge 5242880 || { echo "at least 5 GiB free disk space is required" >&2; exit 1; }
if test "$disk_kib" -lt 20971520; then echo "warning: less than the recommended 20 GiB is free" >&2; fi

prompt() {
  variable=$1
  label=$2
  default=${3:-}
  current=
  eval "current=\${$variable:-}"
  test -n "$current" && return
  if test -n "$default"; then printf '%s [%s]: ' "$label" "$default"; else printf '%s: ' "$label"; fi
  IFS= read -r value
  test -n "$value" || value=$default
  eval "$variable=\$value"
}

read_secret() {
  variable=$1
  label=$2
  current=
  eval "current=\${$variable:-}"
  test -n "$current" && return
  test -t 0 || { echo "$variable must be supplied through a protected environment for non-interactive installation" >&2; exit 1; }
  printf '%s: ' "$label"
  stty -echo
  trap 'stty echo' EXIT INT TERM
  IFS= read -r value
  stty echo
  trap - EXIT INT TERM
  printf '\n'
  eval "$variable=\$value"
}

wait_http() {
  url=$1
  attempts=${2:-45}
  attempt=1
  while test "$attempt" -le "$attempts"; do
    curl -fsS --max-time 2 "$url" >/dev/null 2>&1 && return 0
    sleep 1
    attempt=$((attempt + 1))
  done
  echo "timed out waiting for $url" >&2
  return 1
}

port_busy() {
  ss -lntH "( sport = :$1 )" | grep -q .
}

valid_hostname() {
  printf '%s\n' "$1" | awk '
    length($0) > 253 || $0 !~ /^[A-Za-z0-9.-]+$/ || $0 ~ /\.\./ { exit 1 }
    {
      count = split($0, labels, ".")
      if (count < 2) exit 1
      for (i = 1; i <= count; i++) {
        if (length(labels[i]) < 1 || length(labels[i]) > 63 || labels[i] !~ /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/) exit 1
      }
    }'
}

valid_ipv4() {
  printf '%s\n' "$1" | awk -F. '
    NF != 4 { exit 1 }
    { for (i = 1; i <= 4; i++) if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) exit 1 }'
}

prompt MAIL_DOMAIN "Mail domain"
prompt MAIL_HOST "Mail server hostname" "mail.$MAIL_DOMAIN"
read_secret ADMIN_PASSWORD "Initial administrator password"
valid_hostname "$MAIL_DOMAIN" || { echo "invalid mail domain" >&2; exit 1; }
valid_hostname "$MAIL_HOST" || { echo "invalid mail hostname" >&2; exit 1; }
MAIL_DOMAIN=$(printf '%s' "$MAIL_DOMAIN" | tr '[:upper:]' '[:lower:]')
MAIL_HOST=$(printf '%s' "$MAIL_HOST" | tr '[:upper:]' '[:lower:]')
case "$MAIL_HOST" in *.$MAIL_DOMAIN) ;; *) echo "mail hostname must be below the mail domain" >&2; exit 1;; esac
test "${#ADMIN_PASSWORD}" -ge 12 || { echo "administrator password must contain at least 12 characters" >&2; exit 1; }

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl xz-utils jq openssl certbot restic sqlite3 nftables \
  dnsutils iproute2 build-essential python3 make g++ git tar bzip2

if ! systemctl is-active --quiet systemd-timesyncd 2>/dev/null \
  && ! systemctl is-active --quiet ntpsec 2>/dev/null \
  && ! systemctl is-active --quiet chrony 2>/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y systemd-timesyncd
  systemctl enable --now systemd-timesyncd
fi
ntp_attempt=1
while test "$ntp_attempt" -le 30; do
  test "$(timedatectl show -p NTPSynchronized --value 2>/dev/null || true)" = yes && break
  sleep 1
  ntp_attempt=$((ntp_attempt + 1))
done
test "$(timedatectl show -p NTPSynchronized --value 2>/dev/null || true)" = yes || { echo "system clock is not NTP synchronized" >&2; exit 1; }

public_ipv4=$(curl -4 -fsSL --max-time 15 https://api.ipify.org)
valid_ipv4 "$public_ipv4" || { echo "unable to determine public IPv4" >&2; exit 1; }
a_records=$(dig +short A "$MAIL_HOST" | sort -u)
mx_records=$(dig +short MX "$MAIL_DOMAIN" | awk '{print $1 " " tolower($2)}' | sed 's/\.$//' | sort -u)
test "$a_records" = "$public_ipv4" || {
  echo "DNS A mismatch: $MAIL_HOST currently resolves to: ${a_records:-<none>}" >&2
  echo "Required: $MAIL_HOST A $public_ipv4 (DNS only)" >&2
  exit 1
}
expected_mx="10 $(printf '%s' "$MAIL_HOST" | tr '[:upper:]' '[:lower:]')"
test "$mx_records" = "$expected_mx" || {
  echo "DNS MX mismatch for $MAIL_DOMAIN; current: ${mx_records:-<none>}" >&2
  echo "Required: $MAIL_DOMAIN MX 10 $MAIL_HOST" >&2
  exit 1
}

for resolver in 1.1.1.1 8.8.8.8 9.9.9.9; do
  test "$(dig +short "@$resolver" A "$MAIL_HOST" | sort -u)" = "$public_ipv4" || {
    echo "public resolver $resolver does not return $MAIL_HOST A $public_ipv4" >&2; exit 1;
  }
  test "$(dig +short "@$resolver" MX "$MAIL_DOMAIN" | awk '{print $1 " " tolower($2)}' | sed 's/\.$//' | sort -u)" = "$expected_mx" || {
    echo "public resolver $resolver does not return $MAIL_DOMAIN MX $expected_mx" >&2; exit 1;
  }
done
authoritative_ns=$(dig +short NS "$MAIL_DOMAIN" | sed 's/\.$//' | sort -u)
test -n "$authoritative_ns" || { echo "no authoritative nameserver found for $MAIL_DOMAIN" >&2; exit 1; }
for nameserver in $authoritative_ns; do
  test "$(dig +short "@$nameserver" A "$MAIL_HOST" | sort -u)" = "$public_ipv4" || {
    echo "authoritative server $nameserver does not publish $MAIL_HOST A $public_ipv4" >&2; exit 1;
  }
  test "$(dig +short "@$nameserver" MX "$MAIL_DOMAIN" | awk '{print $1 " " tolower($2)}' | sed 's/\.$//' | sort -u)" = "$expected_mx" || {
    echo "authoritative server $nameserver does not publish $MAIL_DOMAIN MX $expected_mx" >&2; exit 1;
  }
done

for port in 25 993 8080; do
  port_busy "$port" && { echo "TCP $port is already in use" >&2; exit 1; }
done

if systemctl is-active --quiet caddy && command -v caddy >/dev/null 2>&1; then
  install_mode=coexist
  caddy validate --config "$CADDY_CONFIG"
else
  install_mode=fresh
  for port in 80 443; do port_busy "$port" && { echo "TCP $port is already in use by a non-Caddy service" >&2; exit 1; }; done
fi
if test -n "${INSTALL_MODE:-}" && test "$INSTALL_MODE" != "$install_mode"; then
  echo "detected mode $install_mode does not match requested mode $INSTALL_MODE" >&2
  exit 1
fi

if test -n "${APP_PORT:-}"; then
  case "$APP_PORT" in *[!0-9]*|'') echo "application port must be numeric" >&2; exit 1;; esac
  if test "$APP_PORT" -lt 1024 || test "$APP_PORT" -gt 65535; then echo "application port must be between 1024 and 65535" >&2; exit 1; fi
  port_busy "$APP_PORT" && { echo "application port $APP_PORT is already in use" >&2; exit 1; }
else
  for candidate in 3000 3001 3100 3101; do
    if ! port_busy "$candidate"; then APP_PORT=$candidate; break; fi
  done
fi
test -n "${APP_PORT:-}" || { echo "no private application port is available" >&2; exit 1; }
export APP_PORT

tmp=$(mktemp -d /tmp/dx-youxiang-install.XXXXXX)
trap 'rm -rf -- "$tmp"' EXIT INT TERM

curl --proto '=https' --tlsv1.2 -fL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o "$tmp/node.tar.xz"
echo "$NODE_SHA256  $tmp/node.tar.xz" | sha256sum -c -
install -d -o root -g root -m 0755 "$APP_BASE/runtime/node-v${NODE_VERSION}"
tar -xJf "$tmp/node.tar.xz" --strip-components=1 -C "$APP_BASE/runtime/node-v${NODE_VERSION}"
ln -sfn "$APP_BASE/runtime/node-v${NODE_VERSION}" "$APP_BASE/runtime/node"
PATH="$APP_BASE/runtime/node/bin:$PATH"
export PATH

curl --proto '=https' --tlsv1.2 -fL "https://github.com/stalwartlabs/stalwart/releases/download/v${STALWART_VERSION}/stalwart-x86_64-unknown-linux-gnu.tar.gz" -o "$tmp/stalwart.tar.gz"
echo "$STALWART_SHA256  $tmp/stalwart.tar.gz" | sha256sum -c -
curl --proto '=https' --tlsv1.2 -fL "https://github.com/stalwartlabs/stalwart/releases/download/v${STALWART_VERSION}/stalwart-x86_64-unknown-linux-gnu.tar.gz.sigstore.json" -o "$tmp/stalwart.sigstore.json"
curl --proto '=https' --tlsv1.2 -fL "https://github.com/sigstore/cosign/releases/download/v${COSIGN_VERSION}/cosign-linux-amd64" -o "$tmp/cosign"
echo "$COSIGN_SHA256  $tmp/cosign" | sha256sum -c -
chmod 0755 "$tmp/cosign"
"$tmp/cosign" verify-blob "$tmp/stalwart.tar.gz" --bundle "$tmp/stalwart.sigstore.json" \
  --certificate-identity-regexp "^https://github.com/stalwartlabs/stalwart/\\.github/workflows/.*@refs/tags/v${STALWART_VERSION}\$" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
tar -xzf "$tmp/stalwart.tar.gz" -C "$tmp"
install -o root -g root -m 0755 "$tmp/stalwart" /usr/local/bin/stalwart

if test "$install_mode" = fresh; then
  curl --proto '=https' --tlsv1.2 -fL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" -o "$tmp/caddy.tar.gz"
  echo "$CADDY_SHA512  $tmp/caddy.tar.gz" | sha512sum -c -
  tar -xzf "$tmp/caddy.tar.gz" -C "$tmp" caddy
  install -o root -g root -m 0755 "$tmp/caddy" /usr/local/bin/caddy
fi

getent group caddy >/dev/null 2>&1 || groupadd --system caddy
id caddy >/dev/null 2>&1 || useradd --system --gid caddy --home-dir /var/lib/caddy --no-create-home --shell /usr/sbin/nologin caddy
id stalwart >/dev/null 2>&1 || useradd --system --user-group --no-create-home --shell /usr/sbin/nologin stalwart
id dx-youxiang >/dev/null 2>&1 || useradd --system --user-group --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin dx-youxiang
usermod -a -G caddy stalwart
usermod -a -G caddy dx-youxiang

install -d -o stalwart -g stalwart -m 0750 /etc/stalwart /var/lib/stalwart /var/log/stalwart
install -d -o root -g root -m 0711 "$CONFIG_DIR"
install -d -o root -g caddy -m 0750 "$CONFIG_DIR/tls"
install -d -o dx-youxiang -g dx-youxiang -m 0711 "$DATA_DIR"
install -d -o dx-youxiang -g dx-youxiang -m 0755 "$DATA_DIR/acme"
install -d -o root -g root -m 0700 "$BACKUP_DIR"
install -d -o caddy -g caddy -m 0750 /etc/caddy /etc/caddy/sites-enabled /var/lib/caddy /var/log/caddy

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -sha256 -days 14 -nodes \
  -subj "/CN=$MAIL_HOST" -addext "subjectAltName=DNS:$MAIL_HOST" \
  -keyout "$CONFIG_DIR/tls/privkey.pem" -out "$CONFIG_DIR/tls/fullchain.pem"
chown root:caddy "$CONFIG_DIR/tls/"*.pem
chmod 0640 "$CONFIG_DIR/tls/"*.pem

install -o root -g root -m 0644 "$APP_BASE/current/deploy/systemd/stalwart.service" /etc/systemd/system/stalwart.service
for unit in dx-youxiang.service dx-youxiang-backup.service dx-youxiang-backup.timer dx-youxiang-monitor.service dx-youxiang-monitor.timer dx-youxiang-firewall.service dx-youxiang-certificate-retry.service dx-youxiang-certificate-retry.timer; do
  install -o root -g root -m 0644 "$APP_BASE/current/deploy/systemd/$unit" "/etc/systemd/system/$unit"
done
install -o root -g root -m 0644 "$APP_BASE/current/deploy/logrotate/dx-youxiang" /etc/logrotate.d/dx-youxiang
if test "$install_mode" = fresh; then
  install -o root -g root -m 0644 "$APP_BASE/current/deploy/systemd/caddy.service" /etc/systemd/system/caddy.service
  printf '{\n  admin 127.0.0.1:2019\n  auto_https off\n}\n\nimport /etc/caddy/sites-enabled/*.caddy\n' > "$CADDY_CONFIG"
  chown root:caddy "$CADDY_CONFIG"
  chmod 0640 "$CADDY_CONFIG"
  caddy_site=/etc/caddy/sites-enabled/dx-youxiang.caddy
else
  caddy_site=/etc/caddy/dx-youxiang.caddy
  test ! -e "$caddy_site" || { echo "existing Dx Youxiang Caddy site found" >&2; exit 1; }
  caddy_backup="$CADDY_CONFIG.pre-dx-youxiang.$(date -u +%Y%m%dT%H%M%SZ).bak"
  cp -a "$CADDY_CONFIG" "$caddy_backup"
  grep -Fqx 'import /etc/caddy/dx-youxiang.caddy' "$CADDY_CONFIG" || printf '\nimport /etc/caddy/dx-youxiang.caddy\n' >> "$CADDY_CONFIG"
fi
sed -e "s/__MAIL_HOST__/$MAIL_HOST/g" -e "s/__APP_PORT__/$APP_PORT/g" \
  "$APP_BASE/current/deploy/caddy/Caddyfile" > "$tmp/dx-youxiang.caddy"
install -o root -g caddy -m 0640 "$tmp/dx-youxiang.caddy" "$caddy_site"
if ! caddy validate --config "$CADDY_CONFIG"; then
  rm -f "$caddy_site"
  if test "$install_mode" = coexist; then cp -a "$caddy_backup" "$CADDY_CONFIG"; fi
  echo "Caddy configuration validation failed; previous configuration was restored" >&2
  exit 1
fi

cd "$APP_BASE/current"
npm ci
npm run build
npm prune --omit=dev
chown -R root:dx-youxiang "$APP_BASE/releases" "$APP_BASE/runtime"
chmod 0750 "$APP_BASE/current/scripts/"*.sh

bootstrap_password=$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-24)
cat > /etc/stalwart/stalwart.env <<EOF
STALWART_HOSTNAME=$MAIL_HOST
STALWART_PUBLIC_URL=https://$MAIL_HOST
STALWART_RECOVERY_ADMIN=admin:$bootstrap_password
EOF
chown root:stalwart /etc/stalwart/stalwart.env
chmod 0640 /etc/stalwart/stalwart.env
systemctl daemon-reload
systemctl enable --now dx-youxiang-firewall.service
systemctl enable --now stalwart
wait_http http://127.0.0.1:8080/.well-known/jmap
MODE=bootstrap OUTPUT_FILE="$CONFIG_DIR/stalwart-admin.json" BOOTSTRAP_PASSWORD="$bootstrap_password" MAIL_HOST="$MAIL_HOST" MAIL_DOMAIN="$MAIL_DOMAIN" node "$APP_BASE/current/scripts/bootstrap-stalwart.mjs"
sed -i '/^STALWART_RECOVERY_ADMIN=/d' /etc/stalwart/stalwart.env
systemctl restart stalwart
wait_http http://127.0.0.1:8080/.well-known/jmap
MODE=configure OUTPUT_FILE="$CONFIG_DIR/stalwart-service.json" ADMIN_CREDENTIAL_FILE="$CONFIG_DIR/stalwart-admin.json" MAIL_HOST="$MAIL_HOST" MAIL_DOMAIN="$MAIL_DOMAIN" node "$APP_BASE/current/scripts/bootstrap-stalwart.mjs"
chmod 0600 "$CONFIG_DIR"/stalwart-*.json
systemctl restart stalwart
wait_http http://127.0.0.1:8080/.well-known/jmap

admin_hash=$(printf '%s' "$ADMIN_PASSWORD" | node -e "import('argon2').then(async a=>{let d='';for await(const c of process.stdin)d+=c;process.stdout.write(await a.hash(d,{type:a.argon2id,memoryCost:65536,timeCost:3,parallelism:1}))})")
session_secret=$(openssl rand -base64 48 | tr -d '\n')
service_username=$(jq -r .serviceUsername "$CONFIG_DIR/stalwart-service.json")
service_password=$(jq -r .servicePassword "$CONFIG_DIR/stalwart-service.json")
domain_id=$(jq -r .domainId "$CONFIG_DIR/stalwart-service.json")
cat > "$CONFIG_DIR/app.env" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=$APP_PORT
PUBLIC_ORIGIN=https://$MAIL_HOST
MAIL_DOMAIN=$MAIL_DOMAIN
MAIL_HOST=$MAIL_HOST
DATABASE_PATH=$DATA_DIR/app.db
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH='$admin_hash'
SESSION_SECRET='$session_secret'
STALWART_BASE_URL=http://127.0.0.1:8080
STALWART_USERNAME=$service_username
STALWART_PASSWORD=$service_password
TLS_CERT_PATH=$CONFIG_DIR/tls/fullchain.pem
MAIL_STORAGE_PATH=/var/lib/stalwart
TRUST_PROXY=loopback
ACME_MODE=$ACME_MODE
EOF
chown root:dx-youxiang "$CONFIG_DIR/app.env"
chmod 0640 "$CONFIG_DIR/app.env"

restic_password=$(openssl rand -base64 48 | tr -d '\n')
printf '%s\n' "$restic_password" > "$CONFIG_DIR/restic-password"
cat > "$CONFIG_DIR/restic.env" <<EOF
RESTIC_REPOSITORY=$BACKUP_DIR/restic-repo
RESTIC_PASSWORD_FILE=$CONFIG_DIR/restic-password
EOF
chmod 0600 "$CONFIG_DIR/restic-password" "$CONFIG_DIR/restic.env"

systemctl enable --now dx-youxiang
wait_http "http://127.0.0.1:$APP_PORT/healthz"
node "$APP_BASE/current/scripts/seed-domain.mjs" "$DATA_DIR/app.db" "$domain_id" "$MAIL_DOMAIN"
chown dx-youxiang:dx-youxiang "$DATA_DIR"/app.db*
chmod 0600 "$DATA_DIR"/app.db*
if test "$install_mode" = fresh; then
  systemctl enable --now caddy
else
  systemctl reload caddy
fi

install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
install -o root -g root -m 0750 "$APP_BASE/current/deploy/certbot/deploy-hook.sh" /etc/letsencrypt/renewal-hooks/deploy/dx-youxiang
cat > "$CONFIG_DIR/certificate.env" <<EOF
MAIL_HOST=$MAIL_HOST
ACME_MODE=$ACME_MODE
ACME_DIRECTORY=$ACME_DIRECTORY
EOF
chmod 0600 "$CONFIG_DIR/certificate.env"
systemctl enable --now certbot.timer dx-youxiang-backup.timer dx-youxiang-monitor.timer dx-youxiang-certificate-retry.timer
systemctl start dx-youxiang-backup.service
systemctl start dx-youxiang-certificate-retry.service
"$APP_BASE/current/scripts/health-check.sh"

printf '\nPROJECT=dx-youxiang\nVERSION=%s\nMODE=%s\nACME_MODE=%s\nACME_DIRECTORY=%s\nWEB_URL=https://%s\nADMIN_USERNAME=admin\n' \
  "${DX_YOUXIANG_VERSION:-0.1.0}" "$install_mode" "$ACME_MODE" "$ACME_DIRECTORY" "$MAIL_HOST"
printf 'ADMIN_PASSWORD=the password entered during installation (not written to logs)\n'
printf 'MAIL_DOMAIN=%s\nMAIL_HOST=%s\nAPP_PORT=%s\n' "$MAIL_DOMAIN" "$MAIL_HOST" "$APP_PORT"

#!/bin/sh
set -eu

table=dx_youxiang
nft_bin=${DX_NFT_BIN:-nft}
smtp_inbound_state=${DX_SMTP_INBOUND_STATE:-/var/lib/dx-youxiang/smtp-inbound.enabled}

apply_rules() {
  stalwart_uid=${DX_STALWART_UID:-$(id -u stalwart)}
  if test -f "$smtp_inbound_state"; then
    "$nft_bin" -f - <<EOF
table inet dx_youxiang {
  chain output {
    type filter hook output priority filter; policy accept;
    meta skuid $stalwart_uid ct state new tcp dport 25 accept comment "dx-youxiang Stalwart direct delivery"
    ct state new tcp dport { 25, 465, 587 } reject with tcp reset comment "dx-youxiang outbound SMTP isolation"
  }
}
EOF
  else
    "$nft_bin" -f - <<EOF
table inet dx_youxiang {
  chain input {
    type filter hook input priority filter; policy accept;
    iifname != "lo" ct state new tcp dport 25 reject with tcp reset comment "dx-youxiang SMTP readiness gate"
  }
  chain output {
    type filter hook output priority filter; policy accept;
    meta skuid $stalwart_uid ct state new tcp dport 25 accept comment "dx-youxiang Stalwart direct delivery"
    ct state new tcp dport { 25, 465, 587 } reject with tcp reset comment "dx-youxiang outbound SMTP isolation"
  }
}
EOF
  fi
}

case ${1:-} in
  apply)
    "$nft_bin" list table inet "$table" >/dev/null 2>&1 && "$nft_bin" delete table inet "$table"
    apply_rules
    ;;
  remove)
    if "$nft_bin" list table inet "$table" >/dev/null 2>&1; then "$nft_bin" delete table inet "$table"; fi
    ;;
  check)
    "$nft_bin" list table inet "$table"
    ;;
  check-inbound)
    test -f "$smtp_inbound_state"
    rules=$("$nft_bin" list table inet "$table")
    ! printf '%s\n' "$rules" | grep -Fq 'dx-youxiang SMTP readiness gate'
    ;;
  *)
    echo "usage: firewall.sh <apply|remove|check|check-inbound>" >&2
    exit 2
    ;;
esac

#!/bin/sh
set -eu

table=dx_youxiang
case ${1:-} in
  apply)
    nft list table inet "$table" >/dev/null 2>&1 && nft delete table inet "$table"
    nft -f - <<'EOF'
table inet dx_youxiang {
  chain output {
    type filter hook output priority filter; policy accept;
    ct state new tcp dport { 25, 465, 587 } reject with tcp reset comment "dx-youxiang receive-only policy"
  }
}
EOF
    ;;
  remove)
    if nft list table inet "$table" >/dev/null 2>&1; then nft delete table inet "$table"; fi
    ;;
  check)
    nft list table inet "$table"
    ;;
  *)
    echo "usage: firewall.sh <apply|remove|check>" >&2
    exit 2
    ;;
esac

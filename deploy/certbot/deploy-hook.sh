#!/bin/sh
set -eu

STALWART_USERNAME=$(sed -n 's/^STALWART_USERNAME=//p' /etc/dx-youxiang/app.env)
STALWART_PASSWORD=$(sed -n 's/^STALWART_PASSWORD=//p' /etc/dx-youxiang/app.env)
export STALWART_USERNAME STALWART_PASSWORD
exec /opt/dx-youxiang/current/scripts/renew-certificate.sh

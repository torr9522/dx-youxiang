# Deployment

## DNS prerequisites

Create a DNS-only A record from the mail host to the server IPv4 address, and an MX record from the mail domain to the mail host. Do not create an AAAA record without working public IPv6. Do not place SMTP or IMAP behind a CDN HTTP proxy.

The installer never changes DNS. It refuses to add later domains through the application until their MX record points to the configured mail host.

## Installation sequence

1. Complete the read-only host and port precheck.
2. Select an immutable GitHub RC or stable release.
3. Run the release's one-line installer as root and answer its three prompts.
4. Record the one-time application administrator password in a password manager.
5. Confirm `systemctl status stalwart dx-youxiang caddy`.
6. Confirm Certbot issued the certificate and its deploy hook updated Caddy and Stalwart.
7. Confirm `/readyz`, SMTP STARTTLS and IMAPS certificate names.

The installer does not clear or replace UFW/nftables rules. Its project-owned nftables table always rejects new outbound TCP connections to 25/465/587, so replies on established inbound SMTP sessions continue. Before initial trusted TLS and backup readiness it also rejects new public inbound TCP 25 connections; successful certificate setup opens only that gate. Existing host/provider inbound policies must already permit 25/80/443/993; the installer reports but cannot change a provider firewall.

## Secrets and permissions

`/etc/dx-youxiang/app.env` is `0640 root:dx-youxiang`. Emergency Stalwart administrator material and the Restic password are root-only. TLS files are `0640 root:caddy`; only Caddy plus explicitly added Stalwart/application service users can read them.

The Stalwart administration WebUI is not proxied. Its HTTP/JMAP listener is loopback-only.

## Verification

```sh
app_port=$(sed -n 's/^PORT=//p' /etc/dx-youxiang/app.env)
curl -fsS "http://127.0.0.1:${app_port}/healthz"
curl -fsS "http://127.0.0.1:${app_port}/readyz" | jq
ss -lntp
openssl s_client -connect mail.example.test:25 -starttls smtp -servername mail.example.test
openssl s_client -connect mail.example.test:993 -servername mail.example.test
```

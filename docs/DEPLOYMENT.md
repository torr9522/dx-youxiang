# Deployment

## DNS prerequisites

Create a DNS-only A record from the mail host to the server IPv4 address, an MX record from the mail domain to the mail host, PTR back to that host, one SPF policy, the Stalwart-generated DKIM TXT record and an initial DMARC policy. Do not create an AAAA record without working IPv6 routing, PTR and forward-confirmed reverse DNS. Do not place mail protocols behind a CDN HTTP proxy.

The installer never changes DNS. It refuses to add later domains through the application until their MX record points to the configured mail host.

## Installation sequence

1. Complete the read-only host and port precheck.
2. Select an immutable GitHub RC or stable release.
3. Run the release's one-line installer as root and answer its three prompts.
4. Record the one-time application administrator password in a password manager.
5. Confirm `systemctl status stalwart dx-youxiang caddy`.
6. Confirm Certbot issued the certificate and its deploy hook updated Caddy and Stalwart.
7. Confirm `/readyz`, SMTP STARTTLS and IMAPS certificate names.

The installer does not clear or replace UFW/nftables rules. Its project-owned table allows new outbound TCP 25 only for the Stalwart UID and rejects other processes' new connections to 25/465/587. Before trusted TLS and backup readiness it also rejects new public inbound TCP 25. Existing host/provider policies must permit inbound 25/80/443/465/587/993 and outbound 25.

Production is the default ACME mode. Release acceptance may explicitly prefix the install command with `ACME_MODE=staging`; the only accepted values are `staging` and `production`. They map respectively to `https://acme-staging-v02.api.letsencrypt.org/directory` and `https://acme-v02.api.letsencrypt.org/directory`. The selected mode and exact directory are persisted in `/etc/dx-youxiang/certificate.env`, passed explicitly to Certbot, and never fall back to the other environment. Staging certificates are deliberately not trusted by browsers and must be verified with a separate test-only CA bundle from Let's Encrypt rather than adding staging roots to the system trust store.

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
openssl s_client -connect mail.example.test:587 -starttls smtp -servername mail.example.test
openssl s_client -connect mail.example.test:465 -servername mail.example.test
openssl s_client -connect mail.example.test:993 -servername mail.example.test
```

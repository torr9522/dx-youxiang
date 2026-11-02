# Deployment

## DNS prerequisites

Create a DNS-only A record from the mail host to the server IPv4 address, and an MX record from the mail domain to the mail host. Do not create an AAAA record without working public IPv6. Do not place SMTP or IMAP behind a CDN HTTP proxy.

The installer never changes DNS. It refuses to add later domains through the application until their MX record points to the configured mail host.

## Installation sequence

1. Complete the read-only host and port precheck.
2. Put the repository at `/opt/private-mail-hub`.
3. Run `MAIL_DOMAIN=example.test MAIL_HOST=mail.example.test ./scripts/install.sh` as root.
4. Record the one-time application administrator password in a password manager.
5. Confirm `systemctl status stalwart private-mail-hub caddy`.
6. After DNS resolves, run `scripts/obtain-certificate.sh` with `ACME_EMAIL` and the variables from `app.env` exported.
7. Confirm `/readyz`, SMTP STARTTLS and IMAPS certificate names.

The installer preserves existing UFW rules. It adds inbound allows only for 25/80/443/993 and outbound denies only for new TCP connections to 25/465/587. UFW's established/related rule remains ahead of user output rules, so SMTP response traffic is not blocked.

## Secrets and permissions

`/etc/private-mail-hub/app.env` is `0640 root:private-mail-hub`. Emergency Stalwart administrator material and the Restic password are `0600 root`. TLS files are `0640 root:private-mail-hub-tls`, a group containing only Stalwart, Caddy and the application health-check user.

The Stalwart administration WebUI is not proxied. Its HTTP/JMAP listener is loopback-only.

## Verification

```sh
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS http://127.0.0.1:3000/readyz | jq
ss -lntp
openssl s_client -connect mail.example.test:25 -starttls smtp -servername mail.example.test
openssl s_client -connect mail.example.test:993 -servername mail.example.test
```

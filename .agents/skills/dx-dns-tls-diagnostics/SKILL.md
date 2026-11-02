---
name: dx-dns-tls-diagnostics
description: Diagnose Dx Youxiang DNS delegation, mail records, DNSSEC, and HTTPS/SMTP/IMAPS certificates without changing DNS or issuing certificates unless separately authorized.
---

# Dx DNS And TLS Diagnostics

Use when records do not resolve, ACME fails, or protocol certificates differ.

## Workflow

1. Confirm the exact domain spelling and expected host/IP before querying.
2. Use RDAP/WHOIS, registry parent NS/DS, `dig +trace`, each authoritative NS, and at least `1.1.1.1`, `8.8.8.8`, and `9.9.9.9` for NS/SOA/A/AAAA/MX/DS/DNSKEY.
3. Distinguish NXDOMAIN, NOERROR/NODATA, SERVFAIL, timeout, delegation mismatch, inactive zone, and DNSSEC validation failure.
4. Test HTTPS with `curl`/`openssl s_client`, SMTP STARTTLS with `-starttls smtp`, and IMAPS directly with SNI. Compare issuer, SAN, chain, expiry, and served leaf certificate.
5. Inspect Certbot renewal configuration and deploy-hook results without exposing keys.

## Safety And Acceptance

DNS-only diagnosis never edits provider records, NS, DNSSEC, certificates, or services. A record being visible in a provider dashboard is not evidence of public delegation. Accept only when authoritative and public answers agree and all three protocols serve the intended trusted certificate. Otherwise name the exact control-plane action the user must take.

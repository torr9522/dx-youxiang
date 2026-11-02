# Security Boundaries

## Trust Zones

The public browser trusts only Caddy and the application session. It never receives a Stalwart credential. The Node backend is the policy boundary between numeric application mailbox IDs and Stalwart account IDs. Stalwart JMAP and the Node listener are loopback-only.

The service identity may impersonate accounts and perform the exact management/JMAP operations required by the application. It has `emailSend` disabled. Ordinary users have no impersonation or administration permission.

## Web Controls

Administrator passwords use Argon2id. Session tokens are random and stored only as hashes; cookies are HTTP-only, secure in production and SameSite strict. Mutating API requests require the session CSRF token. Login attempts are rate-limited. SQL values use prepared statements. Mail HTML is sanitized server-side and remote images are excluded by CSP/sanitization.

Message detail, flags, delete and attachment download first resolve the selected mailbox and repeat ownership checks in that account. A message/blob ID from another account must not be returned.

## Protocol And Network Controls

Only SMTP 25, HTTPS 443 and IMAPS 993 are intended public listeners. SMTP AUTH/submission 465/587, POP3 995, ManageSieve and public JMAP are absent. Stalwart rejects relay and unknown local recipients. New outbound TCP 25/465/587 is rejected by a project-owned nftables table without clearing other rules.

Disabling external login blocks new authentication. Stalwart 1.0.1 has no verified per-account API to close an already authenticated IMAP connection, so existing sessions may continue until disconnect or timeout.

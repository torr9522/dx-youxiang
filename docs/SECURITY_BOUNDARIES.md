# Security Boundaries

## Trust Zones

The public browser trusts only Caddy and the application session. It never receives a Stalwart credential. The Node backend is the policy boundary between numeric application mailbox IDs and Stalwart account IDs. Stalwart JMAP and the Node listener are loopback-only.

The service identity may impersonate accounts and perform the exact management/JMAP operations required by administration. It contains grantable send permissions because Stalwart prevents privilege escalation, but browser submission never uses it. Ordinary users have no impersonation or administration permission and use their own Stalwart credential for upload, draft and submission calls.

## Web Controls

Administrator passwords use Argon2id. Mailbox credentials are verified by Stalwart and retained only as AES-256-GCM ciphertext for the lifetime of a mailbox-bound session; plaintext is never stored. Session tokens are random and stored only as hashes; cookies are HTTP-only, secure in production and SameSite strict. External-login state is rechecked on every mailbox-user API request. Mutating requests require CSRF, and login/send attempts are rate-limited.

Message detail, flags, delete and attachment download first resolve the selected mailbox and repeat ownership checks in that account. A message/blob ID from another account must not be returned.

CID raster images are served only after the backend finds the CID/blob pair in the selected account's named message. Remote images remain inert by default. A consent action loads opaque same-origin URLs whose encrypted tokens are bound to the mailbox and message; the backend also confirms the decrypted source still occurs in that message. The image proxy accepts only HTTP(S) on ports 80/443, pins a DNS result after rejecting every private or special result, repeats checks after redirects, enforces total time/redirect/size limits, and requires an allowed raster MIME type to match file-signature detection. It forwards no browser cookie or authorization header to the sender.

Translation provider configuration is administrator-only and CSRF-protected. The API key is encrypted with AES-256-GCM using a key derived from the installation session secret and is never returned to the browser. Provider requests originate only after an explicit message translation action, use the administrator-selected protocol, require HTTPS port 443 in production, reject credentials in URLs, reject private or special DNS results, pin the validated lookup for the connection, reject redirects, and enforce response-size and time limits. Provider error bodies, keys and mail text are not logged. Model output is treated as untrusted JSON text: node IDs and protected placeholders must validate before text is escaped back into the sanitized DOM.

## Protocol And Network Controls

Public listeners are SMTP 25, HTTPS 443, IMAPS 993, Submission 587 STARTTLS and Submissions 465 implicit TLS. POP3, ManageSieve and public JMAP are absent. Stalwart advertises AUTH only over TLS on non-25 SMTP listeners, requires authenticated submission, checks `emailSend`, matches the sender and rejects relay/unknown recipients. The project nftables table permits outbound TCP 25 only for Stalwart and rejects other processes' new SMTP connections without clearing unrelated rules.

Disabling external login blocks new authentication. Stalwart 1.0.1 has no verified per-account API to close an already authenticated IMAP connection, so existing sessions may continue until disconnect or timeout.

The same upstream limitation applies to an already authenticated SMTP connection: permission changes reject new SMTP authentication immediately, while a connection that authenticated before the change may retain its access token until disconnect or timeout. Web API requests are rechecked immediately. The application does not restart the shared mail server for one account switch.

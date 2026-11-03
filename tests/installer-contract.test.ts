import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("native installer contracts", () => {
  it("leaves the Stalwart registry absent until x:Bootstrap/set creates it", async () => {
    const installer = await readFile("scripts/install.sh", "utf8");
    const firstStart = installer.indexOf("systemctl enable --now stalwart");
    const bootstrap = installer.indexOf("MODE=bootstrap");

    expect(firstStart).toBeGreaterThan(0);
    expect(bootstrap).toBeGreaterThan(firstStart);
    expect(installer.slice(0, firstStart)).toContain("test ! -e /etc/stalwart/config.json");
    expect(installer.slice(0, bootstrap)).not.toMatch(/(?:>|tee)[^\n]*\/etc\/stalwart\/config\.json/);
  });

  it("runs the canonical application migration before seeding the default domain", async () => {
    const installer = await readFile("scripts/install.sh", "utf8");
    const applicationStart = installer.indexOf("systemctl enable --now dx-youxiang\n");
    const healthCheck = installer.indexOf('wait_http "http://127.0.0.1:$APP_PORT/healthz"');
    const domainSeed = installer.indexOf('node "$APP_BASE/current/scripts/seed-domain.mjs"');

    expect(applicationStart).toBeGreaterThan(0);
    expect(healthCheck).toBeGreaterThan(applicationStart);
    expect(domainSeed).toBeGreaterThan(healthCheck);
  });

  it("enables operational and certificate recovery timers before initial ACME issuance", async () => {
    const installer = await readFile("scripts/install.sh", "utf8");
    const timerEnable = installer.indexOf("systemctl enable --now certbot.timer dx-youxiang-backup.timer dx-youxiang-monitor.timer dx-youxiang-certificate-retry.timer");
    const certificateAttempt = installer.indexOf("systemctl start dx-youxiang-certificate-retry.service");

    expect(timerEnable).toBeGreaterThan(0);
    expect(certificateAttempt).toBeGreaterThan(timerEnable);
    expect(installer).not.toContain("certbot certonly --webroot");
  });

  it("keeps initial certificate retry separate from Certbot renewal ownership", async () => {
    const obtain = await readFile("scripts/obtain-certificate.sh", "utf8");
    const retry = await readFile("scripts/retry-initial-certificate.sh", "utf8");
    const retryService = await readFile("deploy/systemd/dx-youxiang-certificate-retry.service", "utf8");
    const retryTimer = await readFile("deploy/systemd/dx-youxiang-certificate-retry.timer", "utf8");

    expect(obtain).toContain("--non-interactive");
    expect(obtain).toContain("systemctl disable --now dx-youxiang-certificate-retry.timer");
    expect(retry).toContain("ACME issuance deferred until");
    expect(retry).toContain("retry after");
    expect(retryService).toContain("EnvironmentFile=/etc/dx-youxiang/certificate.env");
    expect(retryService).toContain("retry-initial-certificate.sh");
    expect(retryTimer).toContain("OnUnitActiveSec=30m");
  });

  it("uses one explicit and immutable ACME directory for each supported mode", async () => {
    const installer = await readFile("scripts/install.sh", "utf8");
    const obtain = await readFile("scripts/obtain-certificate.sh", "utf8");

    expect(installer).toContain("ACME_MODE=${ACME_MODE:-production}");
    expect(installer).toContain("staging) ACME_DIRECTORY=https://acme-staging-v02.api.letsencrypt.org/directory");
    expect(installer).toContain("production) ACME_DIRECTORY=https://acme-v02.api.letsencrypt.org/directory");
    expect(installer).toContain("ACME_MODE=$ACME_MODE");
    expect(installer).toContain("ACME_DIRECTORY=$ACME_DIRECTORY");
    expect(obtain).toContain('--server "$ACME_DIRECTORY"');
    expect(obtain).toContain('test "${ACME_DIRECTORY:-}" = "$expected_directory"');
    expect(obtain).not.toContain("--staging");
    expect(obtain).not.toMatch(/fallback|second.*server/i);
  });

  it("keeps public SMTP gated until trusted readiness and an encrypted backup exist", async () => {
    const installer = await readFile("scripts/install.sh", "utf8");
    const firewall = await readFile("scripts/firewall.sh", "utf8");
    const obtain = await readFile("scripts/obtain-certificate.sh", "utf8");
    const health = await readFile("scripts/health-check.sh", "utf8");

    expect(installer.indexOf("systemctl enable --now dx-youxiang-firewall.service"))
      .toBeLessThan(installer.indexOf("systemctl enable --now stalwart"));
    expect(firewall).toContain("dx-youxiang SMTP readiness gate");
    expect(firewall).toContain("check-inbound");
    expect(obtain).toContain("/readyz");
    expect(obtain).toContain("restic snapshots --tag dx-youxiang --json");
    expect(obtain).toContain("smtp_inbound_state=/var/lib/dx-youxiang/smtp-inbound.enabled");
    expect(obtain.indexOf("restic snapshots")).toBeLessThan(obtain.indexOf('install -o root -g root -m 0600 /dev/null "$smtp_inbound_state"'));
    expect(health).toContain("smtp-inbound-ready");
  });

  it("uses a dedicated top-level Caddy include in coexist mode", async () => {
    const installer = await readFile("scripts/install.sh", "utf8");
    expect(installer).toContain("caddy_site=/etc/caddy/dx-youxiang.caddy");
    expect(installer).toContain("import /etc/caddy/dx-youxiang.caddy");
  });

  it("defaults the public bootstrap installer to the stable release", async () => {
    const bootstrap = await readFile("install.sh", "utf8");
    expect(bootstrap).toContain("DX_YOUXIANG_VERSION=${DX_YOUXIANG_VERSION:-0.1.3}");
  });

  it("waits for bounded application readiness before accepting or rolling back an upgrade", async () => {
    const upgrade = await readFile("scripts/upgrade.sh", "utf8");

    expect(upgrade).toContain("wait_ready()");
    expect(upgrade).toContain('test "$wait_attempt" -lt 45 || return 1');
    expect(upgrade).toContain("sleep 1");
    expect(upgrade).toContain("if ! wait_ready; then");
    expect(upgrade.match(/if ! wait_ready; then/g)).toHaveLength(2);
  });
});

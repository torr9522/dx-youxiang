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
    const retryService = await readFile("deploy/systemd/dx-youxiang-certificate-retry.service", "utf8");
    const retryTimer = await readFile("deploy/systemd/dx-youxiang-certificate-retry.timer", "utf8");

    expect(obtain).toContain("--non-interactive");
    expect(obtain).toContain("systemctl disable --now dx-youxiang-certificate-retry.timer");
    expect(retryService).toContain("EnvironmentFile=/etc/dx-youxiang/certificate.env");
    expect(retryTimer).toContain("OnUnitActiveSec=12h");
  });
});

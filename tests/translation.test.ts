import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDatabase } from "../src/server/db.js";
import { decryptApiKey, detectEmailLanguage, encryptApiKey, getTranslationSettings, saveTranslationSettings, testTranslationConnection, translateMessage } from "../src/server/translation.js";

const directories: string[] = [];
function database() {
  const directory = mkdtempSync(join(tmpdir(), "dx-translation-"));
  directories.push(directory);
  const db = new AppDatabase(join(directory, "app.db"));
  db.db.prepare("INSERT INTO domains(stalwart_domain_id,name,is_default) VALUES('domain-a','example.test',1)").run();
  db.db.prepare("INSERT INTO mailboxes(stalwart_account_id,address,local_part,domain_id) VALUES('account-a','a@example.test','a',1),('account-b','b@example.test','b',1)").run();
  return db;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("translation storage and node mapping", () => {
  it("encrypts API keys with authenticated encryption", () => {
    const secret = "s".repeat(48);
    const encrypted = encryptApiKey("private-provider-key", secret);
    expect(encrypted).not.toContain("private-provider-key");
    expect(decryptApiKey(encrypted, secret)).toBe("private-provider-key");
    expect(() => decryptApiKey(`${encrypted.slice(0, -1)}A`, secret)).toThrow();
  });

  it("defaults every provider field to empty and invalidates tests after changes", async () => {
    const db = database();
    const secret = "s".repeat(48);
    expect(getTranslationSettings(db)).toMatchObject({ protocol: null, baseUrl: "", hasApiKey: false, model: "", targetLanguage: "zh-CN", enabled: false });
    saveTranslationSettings(db, secret, { protocol: "responses", baseUrl: "https://api.example.test/v1", apiKey: "fictional-key", model: "model-a", targetLanguage: "zh-CN", enabled: false });
    const provider = { complete: async () => "DX_TRANSLATION_OK" };
    expect(await testTranslationConnection(db, secret, provider)).toMatchObject({ tested: true, enabled: false });
    expect(saveTranslationSettings(db, secret, { protocol: "responses", baseUrl: "https://api.example.test/v1", model: "model-a", targetLanguage: "zh-CN", enabled: true })).toMatchObject({ tested: true, enabled: true });
    expect(saveTranslationSettings(db, secret, { protocol: "responses", baseUrl: "https://api.example.test/v1", model: "model-b", targetLanguage: "zh-CN", enabled: true })).toMatchObject({ tested: false, enabled: false });
    db.close();
  });

  it("distinguishes Chinese, English and meaningful mixed content", () => {
    expect(detectEmailLanguage("<p>这是中文通知，请及时查看账户信息。</p>", "")).toMatchObject({ language: "zh", translatable: false });
    expect(detectEmailLanguage("<p>This is a complete English account notification with enough text for reliable detection.</p>", "")).toMatchObject({ label: "英文", translatable: true });
    expect(detectEmailLanguage("<p>账户通知：Please review the security information and confirm your recent account activity.</p>", "")).toMatchObject({ language: "mixed", translatable: true });
  });

  it("changes only text nodes, preserves protected values and caches by account", async () => {
    const db = database();
    const secret = "s".repeat(48);
    saveTranslationSettings(db, secret, { protocol: "responses", baseUrl: "https://api.example.test/v1", apiKey: "fictional-key", model: "model-a", targetLanguage: "zh-CN", enabled: false });
    const provider = {
      calls: 0,
      async complete(_config: unknown, _instructions: string, input: string) {
        this.calls += 1;
        if (input.startsWith("Connectivity test")) return "DX_TRANSLATION_OK";
        const parsed = JSON.parse(input) as { nodes: Array<{ id: string; text: string }> };
        return JSON.stringify({ translations: parsed.nodes.map((node) => ({ id: node.id, text: node.text.replace("Your code is", "您的验证码是").replace("Visit", "访问") })) });
      },
    };
    await testTranslationConnection(db, secret, provider);
    saveTranslationSettings(db, secret, { protocol: "responses", baseUrl: "https://api.example.test/v1", model: "model-a", targetLanguage: "zh-CN", enabled: true });
    const html = '<table style="width:600px"><tbody><tr><td>Your code is 482731. Visit https://example.test.</td></tr></tbody></table><img src="/api/mailboxes/1/messages/m1/inline-images/blob" data-inline-image="true"><img data-remote-src="/api/mailboxes/1/messages/m1/remote-images/token">';
    const first = await translateMessage({ db, secret, provider, mailboxId: 1, accountId: "account-a", emailId: "m1", html, plain: "" });
    expect(first).toMatchObject({ cached: false, partial: false });
    expect(first.html).toContain("<table style=\"width:600px\">");
    expect(first.html).toContain("482731");
    expect(first.html).toContain("https://example.test");
    expect(first.html).toContain("data-inline-image=\"true\"");
    expect(first.html).toContain("data-remote-src=\"/api/mailboxes/1/messages/m1/remote-images/token\"");
    const callsAfterFirst = provider.calls;
    const cached = await translateMessage({ db, secret, provider, mailboxId: 1, accountId: "account-a", emailId: "m1", html, plain: "" });
    expect(cached).toMatchObject({ cached: true, html: first.html });
    expect(provider.calls).toBe(callsAfterFirst);
    expect(db.db.prepare("SELECT stalwart_account_id FROM translation_cache WHERE mailbox_id=1").get()).toEqual({ stalwart_account_id: "account-a" });
    db.close();
  });

  it("marks failed chunks partial and does not cache them", async () => {
    const db = database();
    const secret = "s".repeat(48);
    saveTranslationSettings(db, secret, { protocol: "responses", baseUrl: "https://api.example.test/v1", apiKey: "fictional-key", model: "model-a", targetLanguage: "zh-CN", enabled: false });
    let connection = true;
    const provider = { complete: async () => { if (connection) { connection = false; return "DX_TRANSLATION_OK"; } throw new Error("timeout"); } };
    await testTranslationConnection(db, secret, provider);
    saveTranslationSettings(db, secret, { protocol: "responses", baseUrl: "https://api.example.test/v1", model: "model-a", targetLanguage: "zh-CN", enabled: true });
    const result = await translateMessage({ db, secret, provider, mailboxId: 1, accountId: "account-a", emailId: "m2", html: "<p>This English paragraph remains original when the provider fails.</p>", plain: "" });
    expect(result).toMatchObject({ cached: false, partial: true });
    expect(result.html).toContain("remains original");
    expect(db.db.prepare("SELECT COUNT(*) count FROM translation_cache").get()).toEqual({ count: 0 });
    db.close();
  });
});

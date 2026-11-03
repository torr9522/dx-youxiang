import { describe, expect, it } from "vitest";
import { presentMessage } from "../src/server/mail.js";

describe("mail presentation", () => {
  it("removes scripts, event handlers and remote images", () => {
    const result = presentMessage({
      subject: "登录验证码 482913",
      htmlBody: [{ partId: "1" }],
      textBody: [],
      bodyValues: { "1": { value: '<script>alert(1)</script><img src="https://tracker.invalid/p.gif" onerror="alert(2)"><a href="javascript:alert(3)">bad</a><p>验证码 482913</p>' } },
    });
    expect(result.html).not.toContain("script");
    expect(result.html).not.toContain("onerror");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("tracker.invalid");
    expect(result.blockedRemoteImages).toBe(true);
    expect(result.verificationCode).toBe("482913");
  });

  it("retains common table email layout and safe inline CSS", () => {
    const result = presentMessage({
      htmlBody: [{ partId: "1" }], textBody: [],
      bodyValues: { "1": { value: '<table width="640" cellpadding="20" style="width:640px;background-color:#ffffff;border-collapse:collapse"><tbody><tr><td style="padding:24px;color:#123456;font-family:Arial, sans-serif;font-size:16px;line-height:24px;text-align:center"><h1>Notice</h1><p>Account update</p></td></tr></tbody></table>' } },
    });
    expect(result.html).toContain('<table width="640" cellpadding="20"');
    expect(result.html).toContain("border-collapse:collapse");
    expect(result.html).toContain("padding:24px");
    expect(result.html).toContain("font-family:Arial, sans-serif");
  });

  it("discards active HTML and URL-bearing CSS while retaining text", () => {
    const result = presentMessage({
      htmlBody: [{ partId: "1" }], textBody: [],
      bodyValues: { "1": { value: '<style>@import "https://evil.invalid/a.css";body{display:none}</style><iframe src="https://evil.invalid"></iframe><object data="x"></object><p style="background:url(https://evil.invalid/p);position:fixed;color:#112233" onclick="evil()">Safe text</p>' } },
    });
    expect(result.html).toContain("Safe text");
    expect(result.html).toContain("color:#112233");
    expect(result.html).not.toMatch(/iframe|object|onclick|url\(|position|@import/i);
  });
});

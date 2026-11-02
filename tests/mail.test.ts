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
});

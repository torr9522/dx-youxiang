import sanitizeHtml from "sanitize-html";

function collectBody(message: any, kind: "textBody" | "htmlBody") {
  const parts: any[] = message[kind] ?? [];
  return parts.map((part) => message.bodyValues?.[part.partId]?.value ?? "").filter(Boolean).join("\n");
}

export function presentMessage(message: any) {
  const plain = collectBody(message, "textBody");
  const rawHtml = collectBody(message, "htmlBody");
  const blockedRemoteImages = /<img\b[^>]+src\s*=\s*["']?https?:/i.test(rawHtml);
  const html = rawHtml ? sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["alt", "title", "width", "height"],
      "*": ["class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: [] },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow" }),
      img: sanitizeHtml.simpleTransform("span", { class: "remote-image-blocked" }),
    },
    disallowedTagsMode: "discard",
  }) : "";
  const codeSource = `${message.subject ?? ""}\n${plain || sanitizeHtml(rawHtml, { allowedTags: [] })}`;
  const code = /(?:验证码|校验码|verification\s*code|security\s*code|one[- ]time\s*(?:code|password)|\bOTP\b)[^0-9]{0,24}([0-9]{4,8})/i.exec(codeSource)?.[1] ?? null;
  return { ...message, plain, html, blockedRemoteImages, verificationCode: code, bodyValues: undefined, bodyStructure: undefined };
}

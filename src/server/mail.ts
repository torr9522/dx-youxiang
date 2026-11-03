import sanitizeHtml from "sanitize-html";

const emailTags = [
  "a", "b", "blockquote", "br", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "span", "strong",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
];

// Inline declarations are isolated to descendants and retain common email layout
// without permitting URL-bearing CSS or executable legacy expressions.
const safeCssValue = /^(?!.*(?:url\s*\(|expression\s*\(|@import|javascript:|data:|behavior\s*:))[-#(),.%\w\s'"+/]*$/i;
const emailStyles = [
  "background", "background-color", "border", "border-bottom", "border-collapse", "border-left", "border-radius", "border-right", "border-top",
  "color", "font-family", "font-size", "font-style", "font-weight", "height", "line-height", "margin", "margin-bottom", "margin-left", "margin-right",
  "margin-top", "max-width", "padding", "padding-bottom", "padding-left", "padding-right", "padding-top", "text-align", "text-decoration", "vertical-align", "width",
];

function sanitizeEmailHtml(rawHtml: string) {
  return sanitizeHtml(rawHtml, {
    allowedTags: emailTags,
    allowedAttributes: {
      a: ["href", "title", "target", "rel", "style"],
      img: ["alt", "title", "width", "height", "style"],
      table: ["align", "bgcolor", "border", "cellpadding", "cellspacing", "role", "style", "width"],
      td: ["align", "bgcolor", "colspan", "height", "rowspan", "style", "valign", "width"],
      th: ["align", "bgcolor", "colspan", "height", "rowspan", "scope", "style", "valign", "width"],
      "*": ["class", "style"],
    },
    allowedStyles: { "*": Object.fromEntries(emailStyles.map((property) => [property, [safeCssValue]])) },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: [] },
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow" }),
      img: sanitizeHtml.simpleTransform("span", { class: "remote-image-blocked" }),
    },
    nonTextTags: ["style", "script", "textarea", "option", "xmp", "noscript"],
    disallowedTagsMode: "discard",
  });
}

function collectBody(message: any, kind: "textBody" | "htmlBody") {
  const parts: any[] = message[kind] ?? [];
  return parts.map((part) => message.bodyValues?.[part.partId]?.value ?? "").filter(Boolean).join("\n");
}

export function presentMessage(message: any) {
  const plain = collectBody(message, "textBody");
  const rawHtml = collectBody(message, "htmlBody");
  const blockedRemoteImages = /<img\b[^>]+src\s*=\s*["']?https?:/i.test(rawHtml);
  const html = rawHtml ? sanitizeEmailHtml(rawHtml) : "";
  const codeSource = `${message.subject ?? ""}\n${plain || sanitizeHtml(rawHtml, { allowedTags: [] })}`;
  const code = /(?:验证码|校验码|verification\s*code|security\s*code|one[- ]time\s*(?:code|password)|\bOTP\b)[^0-9]{0,24}([0-9]{4,8})/i.exec(codeSource)?.[1] ?? null;
  return { ...message, plain, html, blockedRemoteImages, verificationCode: code, bodyValues: undefined, bodyStructure: undefined };
}

import sanitizeHtml from "sanitize-html";
import { createHash } from "node:crypto";
import { sealRemoteImage } from "./remote-images.js";

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
const inlineImageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function sanitizeOutgoingHtml(value: string) {
  return sanitizeHtml(value, {
    allowedTags: ["a", "b", "blockquote", "br", "div", "em", "h1", "h2", "h3", "hr", "i", "li", "ol", "p", "span", "strong", "u", "ul"],
    allowedAttributes: { a: ["href", "title"], "*": ["style"] },
    allowedStyles: { "*": { "text-align": [/^(?:left|right|center)$/], "font-weight": [/^(?:normal|bold|[1-9]00)$/], "font-style": [/^(?:normal|italic)$/], "text-decoration": [/^(?:none|underline)$/] } },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
  });
}

type PresentationContext = { mailboxId: number; emailId: string; sessionSecret: string };

function normalizeCid(value: string) {
  try { return decodeURIComponent(value.replace(/^cid:/i, "")).trim().replace(/^<|>$/g, "").toLowerCase(); }
  catch { return value.replace(/^cid:/i, "").trim().replace(/^<|>$/g, "").toLowerCase(); }
}

function isRemoteImageSource(value: string) {
  if (value.length > 4096) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function remoteImageUrls(message: any) {
  const urls = new Set<string>();
  const rawHtml = collectBody(message, "htmlBody");
  sanitizeHtml(rawHtml, { allowedTags: ["img"], allowedAttributes: { img: ["src"] }, transformTags: { img: (tagName, attributes) => {
    if (isRemoteImageSource(attributes.src ?? "")) urls.add(attributes.src);
    return { tagName, attribs: {} };
  } } });
  return urls;
}

function sanitizeEmailHtml(rawHtml: string, message: any, context?: PresentationContext) {
  const inlineByCid = new Map((message.attachments ?? []).filter((part: any) => part.cid && part.blobId).map((part: any) => [normalizeCid(String(part.cid)), part]));
  let remoteImageCount = 0;
  return sanitizeHtml(rawHtml, {
    allowedTags: emailTags,
    allowedAttributes: {
      a: ["href", "title", "target", "rel", "style"],
      img: ["alt", "title", "width", "height", "style", "src", "data-inline-image", "data-remote-src"],
      table: ["align", "bgcolor", "border", "cellpadding", "cellspacing", "role", "style", "width"],
      td: ["align", "bgcolor", "colspan", "height", "rowspan", "style", "valign", "width"],
      th: ["align", "bgcolor", "colspan", "height", "rowspan", "scope", "style", "valign", "width"],
      span: ["style", "data-inline-image"],
      "*": ["style"],
    },
    allowedStyles: { "*": Object.fromEntries(emailStyles.map((property) => [property, [safeCssValue]])) },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow" }),
      img: (_tagName, attributes) => {
        const src = attributes.src ?? "";
        const retained: Record<string, string> = {};
        for (const name of ["alt", "title", "width", "height", "style"]) if (attributes[name]) retained[name] = attributes[name];
        if (/^cid:/i.test(src)) {
          const part: any = inlineByCid.get(normalizeCid(src));
          if (!context || !part || !inlineImageTypes.has(String(part.type ?? "").toLowerCase())) return { tagName: "span", attribs: { "data-inline-image": "missing" }, text: "[内嵌图片不可用]" };
          const attribs: Record<string, string> = { ...retained, src: `/api/mailboxes/${context.mailboxId}/messages/${encodeURIComponent(context.emailId)}/inline-images/${encodeURIComponent(part.blobId)}`, "data-inline-image": "true" };
          return { tagName: "img", attribs };
        }
        if (isRemoteImageSource(src) && context && remoteImageCount++ < 100) {
          const token = sealRemoteImage(src, context.mailboxId, context.emailId, context.sessionSecret);
          const attribs: Record<string, string> = { ...retained, "data-remote-src": `/api/mailboxes/${context.mailboxId}/messages/${encodeURIComponent(context.emailId)}/remote-images/${token}`, alt: retained.alt || "远程图片" };
          return { tagName: "img", attribs };
        }
        return { tagName: "span", attribs: { "data-inline-image": "missing" }, text: "[图片不可用]" };
      },
    },
    nonTextTags: ["style", "script", "textarea", "option", "xmp", "noscript"],
    disallowedTagsMode: "discard",
  });
}

function collectBody(message: any, kind: "textBody" | "htmlBody") {
  const parts: any[] = message[kind] ?? [];
  return parts.map((part) => message.bodyValues?.[part.partId]?.value ?? "").filter(Boolean).join("\n");
}

export function presentMessage(message: any, context?: PresentationContext) {
  const plain = collectBody(message, "textBody");
  const rawHtml = collectBody(message, "htmlBody");
  const blockedRemoteImages = remoteImageUrls(message).size > 0;
  const html = rawHtml ? sanitizeEmailHtml(rawHtml, message, context) : "";
  const codeSource = `${message.subject ?? ""}\n${plain || sanitizeHtml(rawHtml, { allowedTags: [] })}`;
  const code = /(?:验证码|校验码|verification\s*code|security\s*code|one[- ]time\s*(?:code|password)|\bOTP\b)[^0-9]{0,24}([0-9]{4,8})/i.exec(codeSource)?.[1] ?? null;
  const bodyHash = createHash("sha256").update(JSON.stringify({ plain, rawHtml })).digest("hex");
  return { ...message, plain, html, bodyHash, blockedRemoteImages, verificationCode: code, bodyValues: undefined, bodyStructure: undefined };
}

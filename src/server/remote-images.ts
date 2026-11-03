import { createDecipheriv, createCipheriv, createHash, randomBytes } from "node:crypto";
import { lookup, type LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const allowedTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const blockedV4 = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blockedV4.addSubnet(address, prefix, "ipv4");
const blockedV6 = new BlockList();
for (const [address, prefix] of [["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20], ["5f00::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) blockedV6.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export function isPublicImageAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !blockedV4.check(address, "ipv4") : family === 6 ? globalV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6") : false;
}

export function imageType(buffer: Buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export function validateImage(buffer: Buffer, declaredType?: string | null) {
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("图片超过大小限制");
  const detected = imageType(buffer);
  const declared = declaredType?.split(";", 1)[0].trim().toLowerCase();
  if (!detected || (declared && (!allowedTypes.has(declared) || declared !== detected))) throw new Error("响应不是受支持的安全图片");
  return detected;
}

export async function readLimitedImage(response: Response, declaredType?: string | null) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("图片响应为空");
  const chunks: Buffer[] = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error("图片超过大小限制"); }
    chunks.push(Buffer.from(value));
  }
  const body = Buffer.concat(chunks);
  return { body, type: validateImage(body, declaredType ?? response.headers.get("content-type")) };
}

function key(secret: string) { return createHash("sha256").update(`dx-remote-image:${secret}`).digest(); }
export function sealRemoteImage(url: string, mailboxId: number, emailId: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(`${mailboxId}:${emailId}`));
  const encrypted = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function openRemoteImage(token: string, mailboxId: number, emailId: string, secret: string) {
  const packed = Buffer.from(token, "base64url");
  if (packed.length < 29 || packed.toString("base64url") !== token) throw new Error("无效图片令牌");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${mailboxId}:${emailId}`));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
}

type ResolveAll = (hostname: string, options: { all: true; verbatim: true }, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

export function createPublicLookup(resolveAll: ResolveAll = lookup as ResolveAll): LookupFunction {
  return (hostname, options, callback) => resolveAll(hostname, { all: true, verbatim: true }, (error, addresses) => {
    const wantsAll = typeof options === "object" && options.all;
    const replyAll = callback as (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void;
    const replyOne = callback as (error: NodeJS.ErrnoException | null, address: string, family: 4 | 6) => void;
    if (error) return wantsAll ? replyAll(error, []) : replyOne(error, "", 4);
    if (!addresses.length || addresses.some(({ address }) => !isPublicImageAddress(address))) {
      const blockedError = Object.assign(new Error("图片地址不是公网地址"), { code: "EACCES" });
      return wantsAll ? replyAll(blockedError, []) : replyOne(blockedError, "", 4);
    }
    return wantsAll ? replyAll(null, addresses) : replyOne(null, addresses[0].address, addresses[0].family as 4 | 6);
  });
}

const safeLookup = createPublicLookup();

export async function fetchRemoteImage(initial: string, redirects = 0, deadline = Date.now() + 8_000): Promise<{ body: Buffer; type: string }> {
  if (redirects > 3) throw new Error("图片重定向次数过多");
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("远程图片请求超时");
  const url = new URL(initial);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("不支持的图片地址");
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (!([80, 443] as number[]).includes(port)) throw new Error("不支持的图片端口");
  const literalAddress = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literalAddress) && !isPublicImageAddress(literalAddress)) throw new Error("图片地址不是公网地址");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = <T>(handler: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimeout);
      handler(value);
    };
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET", lookup: safeLookup, headers: { accept: "image/png,image/jpeg,image/gif,image/webp", "user-agent": "Dx-Youxiang-Image-Proxy/1" },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.destroy();
        settled = true;
        clearTimeout(totalTimeout);
        void fetchRemoteImage(new URL(response.headers.location, url).toString(), redirects + 1, deadline).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); finish(reject, new Error("远程图片请求失败")); return; }
      const declaredLength = Number(response.headers["content-length"]);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) { response.resume(); finish(reject, new Error("图片超过大小限制")); return; }
      const chunks: Buffer[] = []; let length = 0;
      response.on("data", (chunk: Buffer) => { length += chunk.length; if (length > MAX_IMAGE_BYTES) response.destroy(new Error("图片超过大小限制")); else chunks.push(chunk); });
      response.on("end", () => { try { const body = Buffer.concat(chunks); finish(resolve, { body, type: validateImage(body, response.headers["content-type"]) }); } catch (error) { finish(reject, error); } });
      response.on("error", (error) => finish(reject, error));
    });
    const totalTimeout = setTimeout(() => {
      const error = new Error("远程图片请求超时");
      request.destroy(error);
      finish(reject, error);
    }, remaining);
    request.setTimeout(remaining, () => request.destroy(new Error("远程图片请求超时")));
    request.on("error", (error) => finish(reject, error));
    request.end();
  });
}

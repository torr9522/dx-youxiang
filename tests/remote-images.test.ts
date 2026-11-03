import { describe, expect, it } from "vitest";
import {
  createPublicLookup,
  fetchRemoteImage,
  isPublicImageAddress,
  MAX_IMAGE_BYTES,
  openRemoteImage,
  sealRemoteImage,
  validateImage,
} from "../src/server/remote-images.js";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

describe("remote image security", () => {
  it("allows public addresses and blocks private, local, metadata and documentation ranges", () => {
    expect(isPublicImageAddress("1.1.1.1")).toBe(true);
    for (const address of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.1.1", "192.168.1.1", "198.18.0.1", "192.0.2.1", "224.0.0.1"]) {
      expect(isPublicImageAddress(address), address).toBe(false);
    }
  });

  it("allows global IPv6 and blocks loopback, mapped, private, link-local and special IPv6", () => {
    expect(isPublicImageAddress("2606:4700:4700::1111")).toBe(true);
    for (const address of ["::", "::1", "::ffff:127.0.0.1", "64:ff9b::1", "100::1", "2001:db8::1", "2002::1", "fc00::1", "fe80::1", "ff02::1"]) {
      expect(isPublicImageAddress(address), address).toBe(false);
    }
  });

  it("binds encrypted image tokens to one mailbox and message", () => {
    const secret = "secret".repeat(8);
    const token = sealRemoteImage("https://example.test/image.png?private=1", 7, "mail-a", secret);
    expect(openRemoteImage(token, 7, "mail-a", secret)).toBe("https://example.test/image.png?private=1");
    expect(() => openRemoteImage(token, 8, "mail-a", secret)).toThrow();
    expect(() => openRemoteImage(token, 7, "mail-b", secret)).toThrow();
    expect(() => openRemoteImage(`${token.slice(0, -1)}x`, 7, "mail-a", secret)).toThrow();
  });

  it("returns the callback shape requested by Node and rejects mixed DNS rebinding answers", async () => {
    const publicAddresses = [{ address: "1.1.1.1", family: 4 as const }, { address: "2606:4700:4700::1111", family: 6 as const }];
    const publicLookup = createPublicLookup((_hostname, _options, callback) => callback(null, publicAddresses));
    await expect(new Promise((resolve, reject) => publicLookup("example.test", { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses))))
      .resolves.toEqual(publicAddresses);
    await expect(new Promise((resolve, reject) => publicLookup("example.test", { family: 4 }, (error, address, family) => error ? reject(error) : resolve({ address, family }))))
      .resolves.toEqual({ address: "1.1.1.1", family: 4 });

    const rebindingLookup = createPublicLookup((_hostname, _options, callback) => callback(null, [publicAddresses[0], { address: "127.0.0.1", family: 4 }]));
    await expect(new Promise((resolve, reject) => rebindingLookup("example.test", { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses))))
      .rejects.toThrow("公网地址");
  });

  it("requires supported MIME and matching raster magic bytes", () => {
    expect(validateImage(png, "image/png")).toBe("image/png");
    expect(() => validateImage(png, "image/jpeg")).toThrow("安全图片");
    expect(() => validateImage(Buffer.from("<html>not an image</html>"), "image/png")).toThrow("安全图片");
    expect(() => validateImage(Buffer.from("<svg onload='x'></svg>"), "image/svg+xml")).toThrow("安全图片");
    expect(() => validateImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/png")).toThrow("大小限制");
  });

  it("rejects unsafe protocols, credentials, ports and local fetch targets", async () => {
    await expect(fetchRemoteImage("file:///etc/passwd")).rejects.toThrow("不支持的图片地址");
    await expect(fetchRemoteImage("https://user:pass@example.test/image.png")).rejects.toThrow("不支持的图片地址");
    await expect(fetchRemoteImage("https://example.test:8443/image.png")).rejects.toThrow("不支持的图片端口");
    await expect(fetchRemoteImage("http://127.0.0.1/image.png")).rejects.toThrow();
    await expect(fetchRemoteImage("http://169.254.169.254/latest/meta-data/")).rejects.toThrow();
    await expect(fetchRemoteImage("https://1.1.1.1/image.png", 4)).rejects.toThrow("重定向次数过多");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/client/api";
import {
  beginMailReadSession,
  clearMailReadCache,
  fetchMailRead,
  getMailReadCache,
  invalidateMailboxReadCache,
  mailReadCacheInfo,
  mailReadKey,
} from "../src/client/lib/mail-read-cache";

describe("session-scoped mail read cache", () => {
  beforeEach(() => {
    clearMailReadCache();
    beginMailReadSession("admin");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("deduplicates only identical role, mailbox, folder, query and pagination reads", async () => {
    const key = mailReadKey("list", [7, "inbox", "needle", "text", "all", "desc", 0, 50]);
    const loader = vi.fn(async () => ({ list: ["message-a"] }));
    const [first, second] = await Promise.all([fetchMailRead(key, loader), fetchMailRead(key, loader)]);
    expect(first).toEqual(second);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(getMailReadCache<typeof first>(key)?.value).toEqual(first);
    expect(getMailReadCache(mailReadKey("list", [8, "inbox", "needle", "text", "all", "desc", 0, 50]))).toBeNull();
    expect(getMailReadCache(mailReadKey("list", [7, "junk", "needle", "text", "all", "desc", 0, 50]))).toBeNull();
  });

  it("clears all sensitive values across session generations and roles", async () => {
    const adminKey = mailReadKey("detail", [7, "message-a"]);
    await fetchMailRead(adminKey, async () => ({ plain: "private" }));
    beginMailReadSession("mailbox_user");
    expect(getMailReadCache(adminKey)).toBeNull();
    expect(mailReadKey("detail", [7, "message-a"])).not.toBe(adminKey);
  });

  it("clears the active session cache after an API 401", async () => {
    const key = mailReadKey("detail", [7, "message-a"]);
    await fetchMailRead(key, async () => ({ plain: "private" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "expired" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })));
    await expect(api("/api/mailboxes/7/folders")).rejects.toThrow("expired");
    expect(getMailReadCache(key)).toBeNull();
  });

  it("invalidates a mailbox and prevents an older in-flight result from repopulating it", async () => {
    let resolve!: (value: { list: string[] }) => void;
    const key = mailReadKey("list", [7, "inbox", "", "text", "all", "desc", 0, 50]);
    const request = fetchMailRead(key, () => new Promise((done) => { resolve = done; }));
    invalidateMailboxReadCache(7);
    resolve({ list: ["stale"] });
    await request;
    expect(getMailReadCache(key)).toBeNull();
  });

  it("evicts least-recently-used entries at the documented capacity", async () => {
    const capacity = mailReadCacheInfo().capacity;
    const firstKey = mailReadKey("detail", [1, "message-0"]);
    for (let index = 0; index <= capacity; index += 1) {
      const key = mailReadKey("detail", [1, `message-${index}`]);
      await fetchMailRead(key, async () => ({ index }));
    }
    expect(mailReadCacheInfo().size).toBe(capacity);
    expect(getMailReadCache(firstKey)).toBeNull();
  });
});

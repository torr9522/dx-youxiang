import type { Config } from "./config.js";

type MethodResponse = [string, any, string];

const mailboxPermissions = {
  emailReceive: true,
  imapAuthenticate: true, imapAclGet: true, imapAclSet: true, imapMyRights: true, imapListRights: true,
  imapAppend: true, imapCapability: true, imapId: true, imapCopy: true, imapMove: true, imapCreate: true,
  imapDelete: true, imapEnable: true, imapExpunge: true, imapFetch: true, imapIdle: true, imapList: true,
  imapLsub: true, imapNamespace: true, imapRename: true, imapSearch: true, imapSort: true, imapSelect: true,
  imapExamine: true, imapStatus: true, imapStore: true, imapSubscribe: true, imapThread: true,
};

export class StalwartError extends Error {
  constructor(message: string, readonly detail?: unknown) { super(message); }
}

export class StalwartClient {
  private authorization: string;
  constructor(private config: Config) {
    this.authorization = `Basic ${Buffer.from(`${config.STALWART_USERNAME}:${config.STALWART_PASSWORD}`).toString("base64")}`;
  }

  private async fetch(path: string, init: RequestInit = {}) {
    const response = await fetch(new URL(path, this.config.STALWART_BASE_URL), {
      ...init,
      signal: AbortSignal.timeout(12_000),
      headers: { authorization: this.authorization, ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new StalwartError(`Stalwart HTTP ${response.status}`);
    return response;
  }

  async session() { return (await this.fetch("/.well-known/jmap")).json() as Promise<any>; }

  async call(methodCalls: any[]): Promise<MethodResponse[]> {
    const response = await this.fetch("/jmap/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail", "urn:stalwart:jmap"],
        methodCalls,
      }),
    });
    const payload = await response.json() as { methodResponses?: MethodResponse[] };
    const results = payload.methodResponses ?? [];
    const failure = results.find(([name]) => name === "error");
    if (failure) throw new StalwartError(failure[1]?.description ?? failure[1]?.type ?? "JMAP 请求失败", failure[1]);
    return results;
  }

  async createDomain(name: string) {
    const [, data] = (await this.call([["x:Domain/set", { create: { d: { name } } }, "domain-create"]]))[0];
    if (data.notCreated?.d) throw new StalwartError(data.notCreated.d.description, data.notCreated.d);
    return data.created.d.id as string;
  }

  async createMailbox(localPart: string, domainId: string, description: string) {
    const account = {
      "@type": "User",
      name: localPart,
      domainId,
      description,
      roles: { "@type": "Custom", roleIds: {} },
      permissions: {
        "@type": "Replace",
        enabledPermissions: mailboxPermissions,
        disabledPermissions: { authenticate: true, emailSend: true },
      },
      quotas: {},
      encryptionAtRest: { "@type": "Disabled" },
    };
    const [, data] = (await this.call([["x:Account/set", { create: { account } }, "account-create"]]))[0];
    if (data.notCreated?.account) throw new StalwartError(data.notCreated.account.description, data.notCreated.account);
    return data.created.account.id as string;
  }

  async updateMailbox(accountId: string, patch: Record<string, unknown>) {
    const [, data] = (await this.call([["x:Account/set", { update: { [accountId]: patch } }, "account-update"]]))[0];
    if (data.notUpdated?.[accountId]) throw new StalwartError(data.notUpdated[accountId].description, data.notUpdated[accountId]);
  }

  setExternalLogin(accountId: string, enabled: boolean, password?: string) {
    const patch: Record<string, unknown> = {
      permissions: {
        "@type": "Replace",
        enabledPermissions: enabled ? { ...mailboxPermissions, authenticate: true } : mailboxPermissions,
        disabledPermissions: enabled ? { emailSend: true } : { authenticate: true, emailSend: true },
      },
    };
    if (password) patch.credentials = { "0": { "@type": "Password", secret: password } };
    return this.updateMailbox(accountId, patch);
  }

  async deleteMailbox(accountId: string) {
    const [, data] = (await this.call([["x:Account/set", { destroy: [accountId] }, "account-delete"]]))[0];
    if (data.notDestroyed?.[accountId]) throw new StalwartError(data.notDestroyed[accountId].description, data.notDestroyed[accountId]);
  }

  async mailboxStats(accountId: string) {
    const responses = await this.call([
      ["Mailbox/query", { accountId, filter: { role: "inbox" }, limit: 1 }, "mq"],
      ["Mailbox/get", { accountId, "#ids": { resultOf: "mq", name: "Mailbox/query", path: "/ids" }, properties: ["id", "totalEmails", "unreadEmails"] }, "mg"],
    ]);
    const get = responses.find(([name]) => name === "Mailbox/get")?.[1];
    const inbox = get?.list?.[0];
    return {
      totalEmails: Number.isSafeInteger(inbox?.totalEmails) && inbox.totalEmails >= 0 ? inbox.totalEmails : 0,
      unreadEmails: Number.isSafeInteger(inbox?.unreadEmails) && inbox.unreadEmails >= 0 ? inbox.unreadEmails : 0,
    };
  }

  async listMessages(accountId: string, options: { query?: string; field?: string; position?: number; limit?: number; ascending?: boolean }) {
    const mailboxResponses = await this.call([
      ["Mailbox/query", { accountId, filter: { role: "inbox" }, limit: 1 }, "inbox-query"],
    ]);
    const inboxId = mailboxResponses.find(([name]) => name === "Mailbox/query")?.[1]?.ids?.[0];
    if (!inboxId) return { total: 0, position: 0, list: [] };

    const filter: Record<string, unknown> = { inMailbox: inboxId };
    if (options.query) filter[options.field === "from" ? "from" : options.field === "subject" ? "subject" : options.field === "body" ? "body" : "text"] = options.query;
    const responses = await this.call([
      ["Email/query", { accountId, filter, sort: [{ property: "receivedAt", isAscending: !!options.ascending }], position: options.position ?? 0, limit: options.limit ?? 50, calculateTotal: true }, "eq"],
      ["Email/get", { accountId, "#ids": { resultOf: "eq", name: "Email/query", path: "/ids" }, properties: ["id", "threadId", "receivedAt", "from", "to", "subject", "keywords", "hasAttachment", "preview", "size"] }, "eg"],
    ]);
    const query = responses.find(([name]) => name === "Email/query")?.[1] ?? {};
    const get = responses.find(([name]) => name === "Email/get")?.[1] ?? {};
    return { total: query.total ?? 0, position: query.position ?? 0, list: get.list ?? [] };
  }

  async getMessage(accountId: string, emailId: string) {
    const [, data] = (await this.call([["Email/get", {
      accountId,
      ids: [emailId],
      properties: ["id", "blobId", "receivedAt", "sentAt", "from", "to", "cc", "subject", "keywords", "hasAttachment", "preview", "bodyStructure", "textBody", "htmlBody", "bodyValues", "attachments"],
      fetchTextBodyValues: true,
      fetchHTMLBodyValues: true,
      maxBodyValueBytes: 10_485_760,
    }, "email-get"]]))[0];
    return data.list?.[0] ?? null;
  }

  setSeen(accountId: string, emailId: string, seen: boolean) {
    return this.call([["Email/set", { accountId, update: { [emailId]: { "keywords/$seen": seen ? true : null } } }, "email-seen"]]);
  }

  deleteMessage(accountId: string, emailId: string) {
    return this.call([["Email/set", { accountId, destroy: [emailId] }, "email-delete"]]);
  }

  async download(accountId: string, blobId: string, name: string, type: string | undefined) {
    const session = await this.session();
    const rendered = String(session.downloadUrl)
      .replace("{accountId}", encodeURIComponent(accountId))
      .replace("{blobId}", encodeURIComponent(blobId))
      .replace("{name}", encodeURIComponent(name))
      .replace("{type}", encodeURIComponent(type ?? "application/octet-stream"));
    const internal = new URL(rendered);
    const base = new URL(this.config.STALWART_BASE_URL);
    internal.protocol = base.protocol;
    internal.host = base.host;
    return this.fetch(internal.pathname + internal.search);
  }
}

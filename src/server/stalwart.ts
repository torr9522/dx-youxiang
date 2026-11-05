import type { Config } from "./config.js";

type MethodResponse = [string, any, string];

const mailboxPermissions = {
  emailReceive: true,
  jmapMailboxGet: true, jmapMailboxQuery: true,
  jmapEmailGet: true, jmapEmailQuery: true, jmapEmailUpdate: true, jmapEmailDestroy: true,
  jmapThreadGet: true, jmapSearchSnippetGet: true, jmapBlobGet: true,
  imapAuthenticate: true, imapAclGet: true, imapAclSet: true, imapMyRights: true, imapListRights: true,
  imapAppend: true, imapCapability: true, imapId: true, imapCopy: true, imapMove: true, imapCreate: true,
  imapDelete: true, imapEnable: true, imapExpunge: true, imapFetch: true, imapIdle: true, imapList: true,
  imapLsub: true, imapNamespace: true, imapRename: true, imapSearch: true, imapSort: true, imapSelect: true,
  imapExamine: true, imapStatus: true, imapStore: true, imapSubscribe: true, imapThread: true,
};

const sendPermissions = {
  emailSend: true,
  jmapMailboxCreate: true, jmapMailboxUpdate: true,
  jmapEmailCreate: true, jmapEmailUpdate: true, jmapEmailDestroy: true,
  jmapIdentityGet: true,
  jmapEmailSubmissionGet: true, jmapEmailSubmissionQuery: true,
  jmapEmailSubmissionCreate: true, jmapEmailSubmissionUpdate: true, jmapEmailSubmissionDestroy: true,
  jmapBlobUpload: true,
};

export class StalwartError extends Error {
  constructor(message: string, readonly detail?: unknown) { super(message); }
}

export class StalwartClient {
  private authorization: string;
  constructor(private config: Config) {
    this.authorization = `Basic ${Buffer.from(`${config.STALWART_USERNAME}:${config.STALWART_PASSWORD}`).toString("base64")}`;
  }

  private async fetch(path: string, init: RequestInit = {}, authorization = this.authorization) {
    const response = await fetch(new URL(path, this.config.STALWART_BASE_URL), {
      ...init,
      signal: AbortSignal.timeout(12_000),
      headers: { authorization, ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new StalwartError(`Stalwart HTTP ${response.status}`);
    return response;
  }

  async session() { return (await this.fetch("/.well-known/jmap")).json() as Promise<any>; }

  async authenticateMailbox(address: string, password: string) {
    const response = await fetch(new URL("/.well-known/jmap", this.config.STALWART_BASE_URL), {
      signal: AbortSignal.timeout(12_000),
      headers: { authorization: `Basic ${Buffer.from(`${address}:${password}`).toString("base64")}` },
    });
    if (!response.ok) return null;
    const session = await response.json() as any;
    const accountIds = new Set<string>([
      ...Object.keys(session.accounts ?? {}),
      ...Object.values(session.primaryAccounts ?? {}).filter((value): value is string => typeof value === "string"),
    ]);
    return { session, accountIds };
  }

  async call(methodCalls: any[]): Promise<MethodResponse[]> {
    return this.callAuthorized(methodCalls, this.authorization);
  }

  private async callAuthorized(methodCalls: any[], authorization: string): Promise<MethodResponse[]> {
    const response = await this.fetch("/jmap/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission", "urn:stalwart:jmap"],
        methodCalls,
      }),
    }, authorization);
    const payload = await response.json() as { methodResponses?: MethodResponse[] };
    const results = payload.methodResponses ?? [];
    const failure = results.find(([name]) => name === "error");
    if (failure) throw new StalwartError(failure[1]?.description ?? failure[1]?.type ?? "JMAP 请求失败", failure[1]);
    return results;
  }

  callAs(address: string, password: string, methodCalls: any[]) {
    return this.callAuthorized(methodCalls, `Basic ${Buffer.from(`${address}:${password}`).toString("base64")}`);
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

  setMailboxPermissions(accountId: string, externalLogin: boolean, emailSend: boolean, password?: string) {
    const canSend = externalLogin && emailSend;
    const patch: Record<string, unknown> = {
      permissions: {
        "@type": "Replace",
        enabledPermissions: externalLogin ? { ...mailboxPermissions, authenticate: true, ...(canSend ? sendPermissions : {}) } : mailboxPermissions,
        disabledPermissions: {
          ...(!externalLogin ? { authenticate: true } : {}),
          ...(!canSend ? { emailSend: true } : {}),
        },
      },
    };
    if (password) patch.credentials = { "0": { "@type": "Password", secret: password } };
    return this.updateMailbox(accountId, patch);
  }


  setExternalLogin(accountId: string, enabled: boolean, password?: string) {
    return this.setMailboxPermissions(accountId, enabled, false, password);
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

  async listMessages(accountId: string, options: { folder?: "inbox" | "sent" | "drafts"; query?: string; field?: string; read?: "all" | "unread" | "read"; position?: number; limit?: number; ascending?: boolean }) {
    const role = options.folder ?? "inbox";
    const mailboxResponses = await this.call([
      ["Mailbox/query", { accountId, filter: { role }, limit: 1 }, "inbox-query"],
    ]);
    const inboxId = mailboxResponses.find(([name]) => name === "Mailbox/query")?.[1]?.ids?.[0];
    if (!inboxId) return { total: 0, position: 0, list: [] };

    const filter: Record<string, unknown> = { inMailbox: inboxId };
    if (options.query) filter[options.field === "from" ? "from" : options.field === "subject" ? "subject" : options.field === "body" ? "body" : "text"] = options.query;
    if (options.read === "unread") filter.notKeyword = "$seen";
    if (options.read === "read") filter.hasKeyword = "$seen";
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
      properties: ["id", "blobId", "receivedAt", "sentAt", "from", "to", "cc", "bcc", "subject", "messageId", "inReplyTo", "references", "keywords", "hasAttachment", "preview", "bodyStructure", "textBody", "htmlBody", "bodyValues", "attachments"],
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

  async uploadAs(address: string, password: string, accountId: string, body: Buffer, type: string) {
    const authorization = `Basic ${Buffer.from(`${address}:${password}`).toString("base64")}`;
    const session = await (await this.fetch("/.well-known/jmap", {}, authorization)).json() as any;
    const rendered = String(session.uploadUrl).replace("{accountId}", encodeURIComponent(accountId));
    const target = new URL(rendered);
    const base = new URL(this.config.STALWART_BASE_URL);
    target.protocol = base.protocol;
    target.host = base.host;
    const response = await this.fetch(target.pathname + target.search, {
      method: "POST",
      headers: { "content-type": type },
      body: new Uint8Array(body),
    }, authorization);
    return response.json() as Promise<{ accountId: string; blobId: string; type: string; size: number }>;
  }

  async saveDraftOrSubmit(input: {
    address: string;
    password: string;
    accountId: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    text: string;
    html?: string;
    attachments: Array<{ blobId: string; type: string; name: string; size: number }>;
    submit: boolean;
    inReplyTo?: string;
    references?: string[];
  }) {
    const folderCalls = [
      ["Mailbox/query", { accountId: input.accountId, filter: { role: "drafts" }, limit: 1 }, "drafts"],
      ["Mailbox/query", { accountId: input.accountId, filter: { role: "sent" }, limit: 1 }, "sent"],
      ["Identity/get", { accountId: input.accountId }, "identities"],
    ];
    const metadata = await this.callAs(input.address, input.password, folderCalls);
    const draftId = metadata.find(([, , tag]) => tag === "drafts")?.[1]?.ids?.[0];
    const sentId = metadata.find(([, , tag]) => tag === "sent")?.[1]?.ids?.[0];
    const identities = metadata.find(([, , tag]) => tag === "identities")?.[1]?.list ?? [];
    const identity = identities.find((item: any) => String(item.email).toLowerCase() === input.address.toLowerCase());
    if (!draftId || !identity?.id) throw new StalwartError("邮箱草稿目录或发件身份不可用");
    if (input.submit && !sentId) throw new StalwartError("已发送目录不可用");

    const bodyValues: Record<string, { value: string; isTruncated: false }> = { text: { value: input.text, isTruncated: false } };
    const email: Record<string, unknown> = {
      mailboxIds: { [draftId]: true }, keywords: { "$draft": true },
      from: [{ email: input.address }],
      to: input.to.map((email) => ({ email })),
      cc: input.cc.map((email) => ({ email })),
      bcc: input.bcc.map((email) => ({ email })),
      subject: input.subject,
      textBody: [{ partId: "text", type: "text/plain" }],
      bodyValues,
      attachments: input.attachments.map((item) => ({ blobId: item.blobId, type: item.type, name: item.name, disposition: "attachment" })),
    };
    if (input.html) {
      bodyValues.html = { value: input.html, isTruncated: false };
      email.htmlBody = [{ partId: "html", type: "text/html" }];
    }
    if (input.inReplyTo) email.inReplyTo = [input.inReplyTo];
    if (input.references?.length) email.references = input.references;
    const calls: any[] = [["Email/set", { accountId: input.accountId, create: { message: email } }, "email-create"]];
    if (input.submit) calls.push(["EmailSubmission/set", {
      accountId: input.accountId,
      create: { submission: { identityId: identity.id, emailId: "#message" } },
      onSuccessUpdateEmail: { "#submission": { [`mailboxIds/${draftId}`]: null, [`mailboxIds/${sentId}`]: true, "keywords/$draft": null } },
    }, "submission-create"]);
    const result = await this.callAs(input.address, input.password, calls);
    const created = result.find(([, , tag]) => tag === "email-create")?.[1];
    if (created?.notCreated?.message) throw new StalwartError(created.notCreated.message.description ?? "邮件创建失败", created.notCreated.message);
    const submission = result.find(([, , tag]) => tag === "submission-create")?.[1];
    if (submission?.notCreated?.submission) throw new StalwartError(submission.notCreated.submission.description ?? "邮件提交失败", submission.notCreated.submission);
    return {
      emailId: created?.created?.message?.id as string,
      submissionId: submission?.created?.submission?.id as string | undefined,
      status: input.submit ? "queued" as const : "draft" as const,
    };
  }
}

import { clearMailReadCache } from "./lib/mail-read-cache";

export type Domain = { id: number; name: string; is_default: number; enabled: number; dns_verified_at?: string };
export type Mailbox = { id: number; address: string; local_part: string; domain: string; group_id: number; note: string; external_login: number; email_send: number; status: string; created_at: string; unreadEmails?: number | null; totalEmails?: number | null };
export type MailboxGroup = { id: number; name: string; sort_order: number; is_system_default: number; mailbox_count: number; created_at: string; updated_at: string };
export type SessionIdentity = { username: string; role: "admin" | "mailbox_user"; mailboxId: number | null; emailSend: boolean; csrfToken: string };
export type MessageSummary = { id: string; receivedAt: string; from?: { name?: string; email: string }[]; to?: { name?: string; email: string }[]; subject?: string; keywords?: Record<string, boolean>; hasAttachment: boolean; preview?: string; size?: number };
export type MailFolderRole = "inbox" | "sent" | "drafts" | "junk" | "trash";
export type MailFolder = { role: MailFolderRole; id: string | null; name: string | null; totalEmails: number; unreadEmails: number };
export type MessageAction = "markSpam" | "markNotSpam" | "trash";
export type MessageActionResult = { total: number; succeeded: number; failed: number; succeededIds: string[]; failures: Array<{ id: string; reason: string }> };
export type MessageDetail = MessageSummary & {
  cc?: { name?: string; email: string }[];
  bcc?: { name?: string; email: string }[];
  messageId?: string[];
  inReplyTo?: string[];
  references?: string[];
  plain: string;
  html: string;
  bodyHash: string;
  blockedRemoteImages: boolean;
  verificationCode: string | null;
  attachments?: { blobId: string; name?: string; type?: string; size?: number }[];
  translation: { language: string; label: string; translatable: boolean; configured: boolean; enabled: boolean; targetLanguage: string };
};

let csrfToken = "";
export function setCsrf(value: string) { csrfToken = value; }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) clearMailReadCache();
  if (!response.ok) throw new Error(payload.error ?? `请求失败 (${response.status})`);
  return payload as T;
}

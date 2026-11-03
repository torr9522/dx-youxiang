export type Domain = { id: number; name: string; is_default: number; enabled: number; dns_verified_at?: string };
export type Mailbox = { id: number; address: string; local_part: string; domain: string; note: string; external_login: number; status: string; created_at: string; unreadEmails?: number | null; totalEmails?: number | null };
export type MessageSummary = { id: string; receivedAt: string; from?: { name?: string; email: string }[]; to?: { name?: string; email: string }[]; subject?: string; keywords?: Record<string, boolean>; hasAttachment: boolean; preview?: string; size?: number };
export type MessageDetail = MessageSummary & {
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
  if (!response.ok) throw new Error(payload.error ?? `请求失败 (${response.status})`);
  return payload as T;
}

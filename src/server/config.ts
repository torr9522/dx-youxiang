import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_ORIGIN: z.string().url(),
  MAIL_DOMAIN: z.string().min(3),
  MAIL_HOST: z.string().min(3),
  DATABASE_PATH: z.string().min(1),
  ADMIN_USERNAME: z.string().min(3).max(64),
  ADMIN_PASSWORD_HASH: z.string().startsWith("$argon2id$"),
  SESSION_SECRET: z.string().min(32),
  STALWART_BASE_URL: z.string().url(),
  STALWART_USERNAME: z.string().min(1),
  STALWART_PASSWORD: z.string().min(1),
  TLS_CERT_PATH: z.string().default("/etc/private-mail-hub/tls/fullchain.pem"),
  MAIL_STORAGE_PATH: z.string().default("/var/lib/stalwart"),
  TRUST_PROXY: z.string().default("loopback"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(source);
}

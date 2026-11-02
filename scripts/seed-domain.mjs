import { DatabaseSync } from "node:sqlite";

const [databasePath, stalwartDomainId, domainName] = process.argv.slice(2);
if (!databasePath || !stalwartDomainId || !domainName) throw new Error("usage: seed-domain.mjs <database> <stalwart-id> <domain>");
const db = new DatabaseSync(databasePath);
db.prepare(`INSERT INTO domains(stalwart_domain_id,name,is_default,enabled,dns_verified_at)
  VALUES(?,?,1,1,CURRENT_TIMESTAMP)
  ON CONFLICT(name) DO UPDATE SET stalwart_domain_id=excluded.stalwart_domain_id,is_default=1,enabled=1`).run(stalwartDomainId, domainName);
db.close();

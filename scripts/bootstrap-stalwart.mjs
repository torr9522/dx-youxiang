import { randomBytes } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";

const mode = process.env.MODE;
const baseUrl = process.env.STALWART_BASE_URL ?? "http://127.0.0.1:8080";
const output = process.env.OUTPUT_FILE;
if (!mode || !output) throw new Error("MODE and OUTPUT_FILE are required");

async function call(username, password, methodCalls) {
  const response = await fetch(new URL("/jmap/", baseUrl), {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`, "content-type": "application/json" },
    body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail", "urn:stalwart:jmap"], methodCalls }),
  });
  if (!response.ok) throw new Error(`Stalwart HTTP ${response.status}`);
  const body = await response.json();
  const failure = body.methodResponses?.find(([name]) => name === "error");
  if (failure) throw new Error(JSON.stringify(failure[1]));
  return body.methodResponses;
}

async function store(value) {
  await writeFile(output, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await chmod(output, 0o600);
}

if (mode === "bootstrap") {
  const username = process.env.BOOTSTRAP_USERNAME ?? "admin";
  const password = process.env.BOOTSTRAP_PASSWORD;
  const hostname = process.env.MAIL_HOST;
  const domain = process.env.MAIL_DOMAIN;
  if (!password || !hostname || !domain) throw new Error("BOOTSTRAP_PASSWORD, MAIL_HOST and MAIL_DOMAIN are required");
  const response = await call(username, password, [["x:Bootstrap/set", { update: { singleton: {
    defaultHostname: hostname,
    defaultDomain: domain,
    requestTlsCertificate: false,
    generateDkimKeys: false,
    tracer: { "@type": "Log", path: "/var/log/stalwart/", prefix: "stalwart.log", ansi: false, enable: true },
  } } }, "bootstrap"]]);
  const result = response[0][1];
  if (result.notUpdated?.singleton) throw new Error(JSON.stringify(result.notUpdated.singleton));
  await store(result.updated.singleton);
} else if (mode === "configure") {
  const credentials = JSON.parse(await readFile(process.env.ADMIN_CREDENTIAL_FILE, "utf8"));
  const hostname = process.env.MAIL_HOST;
  const domain = process.env.MAIL_DOMAIN;
  const certPath = process.env.TLS_CERT_PATH ?? "/etc/dx-youxiang/tls/fullchain.pem";
  const keyPath = process.env.TLS_KEY_PATH ?? "/etc/dx-youxiang/tls/privkey.pem";
  if (!hostname || !domain) throw new Error("MAIL_HOST and MAIL_DOMAIN are required");
  const adminUser = credentials.username;
  const adminPass = credentials.secret;

  const lookup = await call(adminUser, adminPass, [
    ["x:Domain/query", { filter: { name: domain } }, "dq"],
    ["x:Account/query", { filter: { name: "dx-youxiang" } }, "aq"],
    ["x:NetworkListener/query", {}, "lq"],
    ["x:Certificate/query", { filter: { subjectAlternativeNames: hostname } }, "cq"],
  ]);
  const domainId = lookup.find(([, , id]) => id === "dq")?.[1]?.ids?.[0];
  if (!domainId) throw new Error("Default domain was not found");
  const accountIds = lookup.find(([, , id]) => id === "aq")?.[1]?.ids ?? [];
  const listenerIds = lookup.find(([, , id]) => id === "lq")?.[1]?.ids ?? [];
  const certificateIds = lookup.find(([, , id]) => id === "cq")?.[1]?.ids ?? [];
  const listenerGet = await call(adminUser, adminPass, [["x:NetworkListener/get", { ids: listenerIds }, "lg"]]);
  const listeners = listenerGet[0][1].list ?? [];
  const servicePassword = randomBytes(30).toString("base64url");
  const mailboxPermissions = {
    emailReceive: true,
    imapAuthenticate: true, imapAclGet: true, imapAclSet: true, imapMyRights: true, imapListRights: true,
    imapAppend: true, imapCapability: true, imapId: true, imapCopy: true, imapMove: true, imapCreate: true,
    imapDelete: true, imapEnable: true, imapExpunge: true, imapFetch: true, imapIdle: true, imapList: true,
    imapLsub: true, imapNamespace: true, imapRename: true, imapSearch: true, imapSort: true, imapSelect: true,
    imapExamine: true, imapStatus: true, imapStore: true, imapSubscribe: true, imapThread: true,
  };
  const create = {};
  if (!accountIds.length) create.service = {
    "@type": "User", name: "dx-youxiang", domainId, description: "Dx 邮箱 service identity",
    credentials: { "0": { "@type": "Password", secret: servicePassword } },
    roles: { "@type": "Custom", roleIds: {} },
    permissions: { "@type": "Replace", enabledPermissions: { ...mailboxPermissions,
      authenticate: true, impersonate: true,
      jmapEmailGet: true, jmapEmailQuery: true, jmapEmailUpdate: true, jmapEmailDestroy: true,
      jmapMailboxGet: true, jmapMailboxQuery: true, jmapBlobGet: true,
      sysAccountGet: true, sysAccountCreate: true, sysAccountUpdate: true, sysAccountDestroy: true, sysAccountQuery: true,
      sysDomainGet: true, sysDomainCreate: true, sysDomainUpdate: true, sysDomainDestroy: true, sysDomainQuery: true,
      sysActionCreate: true, actionReloadTlsCertificates: true
    }, disabledPermissions: { emailSend: true } }, quotas: {}, encryptionAtRest: { "@type": "Disabled" }
  };
  const listenerUpdate = {};
  const listenerDestroy = [];
  for (const item of listeners) {
    if (item.name === "smtp") listenerUpdate[item.id] = { bind: { "0.0.0.0:25": true }, useTls: true, implicitTls: false };
    else if (item.name === "imaps") listenerUpdate[item.id] = { bind: { "0.0.0.0:993": true }, useTls: true, implicitTls: true };
    else if (item.name === "http") listenerUpdate[item.id] = { bind: { "127.0.0.1:8080": true }, useTls: false, implicitTls: false };
    else listenerDestroy.push(item.id);
  }
  const methods = [];
  if (Object.keys(create).length) methods.push(["x:Account/set", { create }, "service"]);
  if (!certificateIds.length) methods.push(["x:Certificate/set", { create: { cert: {
    certificate: { "@type": "File", filePath: certPath }, privateKey: { "@type": "File", filePath: keyPath }
  } } }, "cert"]);
  methods.push(["x:NetworkListener/set", { update: listenerUpdate, destroy: listenerDestroy }, "listeners"]);
  if (accountIds.length) {
    throw new Error("Service identity already exists but its credential output is unavailable; recover or rotate it explicitly");
  }
  const configured = await call(adminUser, adminPass, methods);
  for (const [, result] of configured) {
    if (result.notCreated && Object.keys(result.notCreated).length) throw new Error(JSON.stringify(result.notCreated));
    if (result.notUpdated && Object.keys(result.notUpdated).length) throw new Error(JSON.stringify(result.notUpdated));
    if (result.notDestroyed && Object.keys(result.notDestroyed).length) throw new Error(JSON.stringify(result.notDestroyed));
  }
  const serviceId = configured.find(([, , id]) => id === "service")?.[1]?.created?.service?.id;
  await store({ domainId, serviceId, serviceUsername: `dx-youxiang@${domain}`, servicePassword });
} else {
  throw new Error("MODE must be bootstrap or configure");
}

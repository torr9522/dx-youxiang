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
    generateDkimKeys: true,
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
  const enableSending = process.env.ENABLE_SENDING !== "false";

  const lookup = await call(adminUser, adminPass, [
    ["x:Domain/query", { filter: { name: domain } }, "dq"],
    ["x:Account/query", { filter: { name: "dx-youxiang" } }, "aq"],
    ["x:NetworkListener/query", {}, "lq"],
    ["x:Certificate/query", { filter: { subjectAlternativeNames: hostname } }, "cq"],
  ]);
  const domainId = lookup.find(([, , id]) => id === "dq")?.[1]?.ids?.[0];
  if (!domainId) throw new Error("Default domain was not found");
  const dkimState = await call(adminUser, adminPass, [
    ["x:DkimSignature/query", { filter: { domainId } }, "dkim-query"],
    ["x:Domain/get", { ids: [domainId], properties: ["id", "dkimManagement"] }, "domain-get"],
  ]);
  const dkimIds = dkimState.find(([, , id]) => id === "dkim-query")?.[1]?.ids ?? [];
  const domainRecord = dkimState.find(([, , id]) => id === "domain-get")?.[1]?.list?.[0];
  const needsDkimKeys = enableSending && dkimIds.length === 0 && domainRecord?.dkimManagement?.["@type"] === "Manual";
  const accountIds = lookup.find(([, , id]) => id === "aq")?.[1]?.ids ?? [];
  const listenerIds = lookup.find(([, , id]) => id === "lq")?.[1]?.ids ?? [];
  const certificateIds = lookup.find(([, , id]) => id === "cq")?.[1]?.ids ?? [];
  const listenerGet = await call(adminUser, adminPass, [["x:NetworkListener/get", { ids: listenerIds }, "lg"]]);
  const listeners = listenerGet[0][1].list ?? [];
  const servicePassword = process.env.SERVICE_PASSWORD ?? randomBytes(30).toString("base64url");
  if (servicePassword.length < 24) throw new Error("SERVICE_PASSWORD must contain at least 24 characters");
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
  const serviceDefinition = {
    "@type": "User", name: "dx-youxiang", domainId, description: "Dx 邮箱 service identity",
    credentials: { "0": { "@type": "Password", secret: servicePassword } },
    roles: { "@type": "Custom", roleIds: {} },
    permissions: { "@type": "Replace", enabledPermissions: { ...mailboxPermissions, ...(enableSending ? sendPermissions : {}),
      authenticate: true, impersonate: true,
      jmapEmailGet: true, jmapEmailQuery: true, jmapEmailUpdate: true, jmapEmailDestroy: true,
      jmapMailboxGet: true, jmapMailboxQuery: true, jmapBlobGet: true,
      sysAccountGet: true, sysAccountCreate: true, sysAccountUpdate: true, sysAccountDestroy: true, sysAccountQuery: true,
      sysDomainGet: true, sysDomainCreate: true, sysDomainUpdate: true, sysDomainDestroy: true, sysDomainQuery: true,
      sysActionCreate: true, actionReloadTlsCertificates: true
    }, disabledPermissions: enableSending ? {} : { emailSend: true } }, quotas: {}, encryptionAtRest: { "@type": "Disabled" }
  };
  const create = {};
  const update = {};
  if (accountIds.length) update[accountIds[0]] = serviceDefinition;
  else create.service = serviceDefinition;
  const listenerUpdate = {};
  const listenerDestroy = [];
  let hasSubmission = false;
  let hasSubmissions = false;
  for (const item of listeners) {
    if (item.name === "smtp") listenerUpdate[item.id] = { bind: { "0.0.0.0:25": true }, useTls: true, implicitTls: false };
    else if (item.name === "imaps") listenerUpdate[item.id] = { bind: { "0.0.0.0:993": true }, useTls: true, implicitTls: true };
    else if (item.name === "http") listenerUpdate[item.id] = { bind: { "127.0.0.1:8080": true }, useTls: false, implicitTls: false };
    else if (item.name === "submission" && enableSending) { hasSubmission = true; listenerUpdate[item.id] = { bind: { "0.0.0.0:587": true }, protocol: "smtp", useTls: true, implicitTls: false }; }
    else if (item.name === "submissions" && enableSending) { hasSubmissions = true; listenerUpdate[item.id] = { bind: { "0.0.0.0:465": true }, protocol: "smtp", useTls: true, implicitTls: true }; }
    else listenerDestroy.push(item.id);
  }
  const methods = [];
  if (needsDkimKeys) methods.push(["x:Domain/set", { update: { [domainId]: {
    dkimManagement: { "@type": "Automatic" },
  } } }, "dkim-enable"]);
  methods.push(["x:Account/set", Object.keys(create).length ? { create } : { update }, "service"]);
  const certificateDefinition = {
    certificate: { "@type": "File", filePath: certPath }, privateKey: { "@type": "File", filePath: keyPath }
  };
  methods.push(["x:Certificate/set", certificateIds.length
    ? { update: { [certificateIds[0]]: certificateDefinition } }
    : { create: { cert: certificateDefinition } }, "cert"]);
  const listenerCreate = {};
  if (enableSending && !hasSubmission) listenerCreate.submission = { name: "submission", bind: { "0.0.0.0:587": true }, protocol: "smtp", useTls: true, implicitTls: false };
  if (enableSending && !hasSubmissions) listenerCreate.submissions = { name: "submissions", bind: { "0.0.0.0:465": true }, protocol: "smtp", useTls: true, implicitTls: true };
  methods.push(["x:NetworkListener/set", { create: listenerCreate, update: listenerUpdate, destroy: listenerDestroy }, "listeners"]);
  methods.push(["x:Authentication/set", { update: { singleton: {
    minPasswordLength: 6,
    minPasswordStrength: "zero",
  } } }, "authentication"]);
  const configured = await call(adminUser, adminPass, methods);
  for (const [, result] of configured) {
    if (result.notCreated && Object.keys(result.notCreated).length) throw new Error(JSON.stringify(result.notCreated));
    if (result.notUpdated && Object.keys(result.notUpdated).length) throw new Error(JSON.stringify(result.notUpdated));
    if (result.notDestroyed && Object.keys(result.notDestroyed).length) throw new Error(JSON.stringify(result.notDestroyed));
  }
  const serviceResult = configured.find(([, , id]) => id === "service")?.[1];
  const serviceId = serviceResult?.created?.service?.id ?? accountIds[0];
  if (needsDkimKeys) {
    let generated = false;
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const response = await call(adminUser, adminPass, [["x:DkimSignature/query", { filter: { domainId } }, "dkim-query"]]);
      if ((response[0]?.[1]?.ids ?? []).length > 0) { generated = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!generated) throw new Error("Stalwart did not generate DKIM keys within 45 seconds");
  }
  await store({ domainId, serviceId, serviceUsername: `dx-youxiang@${domain}`, servicePassword, generatedDkimKeys: needsDkimKeys });
} else if (mode === "reindex") {
  const credentials = JSON.parse(await readFile(process.env.ADMIN_CREDENTIAL_FILE, "utf8"));
  const result = await call(credentials.username, credentials.secret, [["x:Task/set", { create: { reindex: {
    "@type": "StoreMaintenance", maintenanceType: "reindexAccounts"
  } } }, "reindex"]]);
  const task = result[0][1];
  if (task.notCreated?.reindex) throw new Error(JSON.stringify(task.notCreated.reindex));
  await store({ taskId: task.created?.reindex?.id });
} else {
  throw new Error("MODE must be bootstrap, configure or reindex");
}

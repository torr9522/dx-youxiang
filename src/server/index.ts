import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadConfig();
const { app, db } = createApp(config);
const server = app.listen(config.PORT, config.HOST, () => {
  console.log(JSON.stringify({ level: "info", message: "Dx 邮箱 started", host: config.HOST, port: config.PORT }));
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ level: "info", message: "Shutting down", signal }));
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

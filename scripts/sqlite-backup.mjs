import { DatabaseSync, backup } from "node:sqlite";

const [sourcePath, destinationPath] = process.argv.slice(2);
if (!sourcePath || !destinationPath) throw new Error("usage: sqlite-backup.mjs <source> <destination>");
const source = new DatabaseSync(sourcePath, { readOnly: true });
await backup(source, destinationPath, { rate: 1000 });
source.close();

import argon2 from "argon2";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const rl = createInterface({ input: stdin, output: stdout });
const password = await rl.question("管理员密码（输入时会显示，请在私密终端运行）: ");
rl.close();
if (password.length < 14) {
  throw new Error("管理员密码至少需要 14 个字符");
}
console.log(await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }));

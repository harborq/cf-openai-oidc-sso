import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_CONFIG_PATH = "wrangler.deploy.toml";

export function validateDeployEnv(env) {
  const databaseId = String(env.D1_DATABASE_ID ?? "").trim();
  if (!databaseId) {
    throw new Error("缺少必要构建环境变量：D1_DATABASE_ID");
  }
  return {
    workerName: optionalValue(env.WORKER_NAME, "sso"),
    databaseName: optionalValue(env.D1_DATABASE_NAME, "openai_oidc_sso"),
    databaseId
  };
}

export function createWranglerConfig(env = process.env) {
  const config = validateDeployEnv(env);
  return `name = ${quoteToml(config.workerName)}
main = "src/index.js"
compatibility_date = "2026-06-08"
keep_vars = true

[[d1_databases]]
binding = "DB"
database_name = ${quoteToml(config.databaseName)}
database_id = ${quoteToml(config.databaseId)}
`;
}

export async function writeWranglerConfig({
  env = process.env,
  outputPath = process.env.WRANGLER_DEPLOY_CONFIG || DEFAULT_CONFIG_PATH
} = {}) {
  const content = createWranglerConfig(env);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf8");
  return outputPath;
}

function optionalValue(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function quoteToml(value) {
  return JSON.stringify(String(value));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeWranglerConfig()
    .then((outputPath) => {
      console.log(`已生成临时 Wrangler 设置：${outputPath}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

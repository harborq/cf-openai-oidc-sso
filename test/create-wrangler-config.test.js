import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  DEFAULT_CONFIG_PATH,
  createWranglerConfig,
  validateDeployEnv
} from "../scripts/create-wrangler-config.js";

describe("临时 Wrangler 设置生成", () => {
  it("缺少 D1 database id 时会拒绝生成部署设置", () => {
    assert.throws(
      () => validateDeployEnv({}),
      /缺少必要构建环境变量：D1_DATABASE_ID/
    );
  });

  it("会生成不包含 runtime vars 的 D1 部署设置", () => {
    const config = createWranglerConfig({
      D1_DATABASE_ID: "11111111-2222-3333-4444-555555555555",
      D1_DATABASE_NAME: "openai_oidc_sso",
      WORKER_NAME: "sso"
    });

    assert.match(config, /keep_vars = true/);
    assert.match(config, /\[\[d1_databases\]\]/);
    assert.match(config, /binding = "DB"/);
    assert.match(config, /database_id = "11111111-2222-3333-4444-555555555555"/);
    assert.doesNotMatch(config, /\[vars\]/);
    assert.doesNotMatch(config, /ISSUER/);
  });

  it("部署指令会使用根目录的临时 Wrangler 设置", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    );

    assert.equal(DEFAULT_CONFIG_PATH, "wrangler.deploy.toml");
    assert.equal(
      packageJson.scripts.deploy,
      `npm run deploy:config && wrangler deploy --config ${DEFAULT_CONFIG_PATH}`
    );
    assert.equal(
      packageJson.scripts["deploy:version"],
      `npm run deploy:config && wrangler versions upload --config ${DEFAULT_CONFIG_PATH}`
    );
  });
});

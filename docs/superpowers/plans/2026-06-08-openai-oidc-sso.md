- [ ] # OpenAI OIDC SSO Implementation Plan

  

  > **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( `- [ ]`) syntax for tracking.

  **Goal:**建立可部署于Cloudflare Workers 的OpenAI Custom OIDC SSO Provider，支援邀请码建立上限与既有使用者持续登入。

  **Architecture:** Worker 负责OIDC HTTP 端点、登入表单与JWT 签发；D1 储存使用者、邀请码与一次性授权码；核心逻辑抽成可在Node.js 测试中直接呼叫的纯JavaScript 模组。

  **Tech Stack:** Cloudflare Workers ES module、D1、WebCrypto、Node.js 内建`node:test`。

  ------

  ## 档案结构

  

  - `src/app.js`：Worker 路由、HTML 表单、OIDC 端点与回应。
  - `src/config.js`：环境变数解析与设定验证。
  - `src/crypto.js`：RS256 JWK 汇入、JWT 签名、杂凑与安全随机值。
  - `src/store.js`：D1 储存介面与记忆体测试储存介面。
  - `src/invite-service.js`：使用者登入、邀请码检查与建立使用者。
  - `src/oidc-service.js`：授权请求验证、授权码建立、token 签发与userinfo。
  - `src/index.js`：Cloudflare Workers 入口。
  - `schema.sql`：D1 资料表。
  - `wrangler.toml`：Cloudflare Workers 设定范本。
  - `.env.example`：部署所需变数范本。
  - `test/*.test.js`：核心流程测试。
  - `README.md`：繁体中文部署与OpenAI 设定说明。
  - `package.json`：测试与语法检查指令。

  ## 任务

  

  ### Task 1: 专案骨架与设定

  

  - 建立`package.json`、`wrangler.toml`、`.env.example`。
  - 建立`src/index.js`与基本模组档。
  - 建立`schema.sql`。

  ### Task 2: 邀请码与使用者登入

  

  - 先写测试：新使用者可用邀请码登入并消耗一次。
  - 先写测试：邀请码达上限后拒绝新使用者。
  - 先写测试：既有使用者可登入且不再消耗邀请码。
  - 实作`MemoryStore`、`D1Store`与`InviteService`。

  ### Task 3: OIDC discovery、JWKS 与授权请求

  

  - 先写测试：discovery metadata 包含OpenAI 需要的端点。
  - 先写测试：JWKS 回传公开金钥。
  - 先写测试：不允许未知client 或redirect URI。
  - 实作`OidcService`的设定验证与metadata。

  ### Task 4: 授权码与token

  

  - 先写测试：有效授权码可换取RS256 `id_token`。
  - 先写测试：授权码只能使用一次。
  - 先写测试：错误client secret 被拒绝。
  - 实作授权码建立、消耗与JWT 签名。

  ### Task 5: Worker HTTP 端点

  

  - 先写测试：`/authorize`显示登入页。
  - 先写测试：`/login`成功后导回OpenAI `redirect_uri`。
  - 先写测试：管理端点需要`ADMIN_TOKEN`。
  - 实作Workers 路由与繁体中文错误页。

  ### Task 6: 文件与验证

  

  - 补齐`README.md`的部署、D1 初始化、金钥产生与OpenAI Custom OIDC 设定。
  - 执行`node --test`。
  - 执行`node --check src/index.js`。
  - 若可用，执行`git diff --stat`检查变更范围。
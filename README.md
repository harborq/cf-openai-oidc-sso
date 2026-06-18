- # Cloudflare Workers OpenAI OIDC SSO

  

  这是一个在部署 Cloudflare Workers 的自定义 OIDC SSO 提供商，用于对接 OpenAI SSO。用户登入时只需输入帐号；注册新帐号时需要输入邀请码。系统把帐号固定转成`ACCOUNT_DOMAIN`指定的信箱域名。已创建帐号之后仍可登入，不会再消耗邀请码。

  ## 功能

  

  - OIDC发现：`/.well-known/openid-configuration`
  - JWKS：`/jwks.json`
  - 授权端点：`/authorize`
  - 登入端点：`/login`
  - 注册页面与注册端点：`/register`
  - Token端点：`/token`
  - 用户信息端点：`/userinfo`
  - 邀请码管理：`/admin/invite-codes`
  - Cloudflare Turnstile 人机验证
  - Cloudflare D1 储存用户、邀请码和授权码

  ## 配置方式

  

  推荐使用**Cloudflare Dashboard 网页版 + GitHub 自动部署**。本仓库已避免将正式环境变数、D1 数据库 id、OIDC 秘密、私钥 JWK 写入进公开程序码。

  公开仓库中的`wrangler.toml`只保留安全设置：

  - `keep_vars = true`：避免Wrangler部署时覆盖Dashboard里的文本变量。
  - 不包含`[vars]`：避免公开仓库保存正式环境变数。
  - 不包含真实`[[d1_databases]]`：避免公开D1数据库id。

  自动部署时请使用`npm run deploy`。该命令会从 Cloudflare Build 变量`D1_DATABASE_ID`生成临时`wrangler.deploy.toml`，再执行 Wrangler 部署。临时文件只存在于构建环境不会，提交到 GitHub。

  整体流程如下：

  1. 在Cloudflare网页建立D1数据库。
  2. 在D1控制台贴上[schema.sql](https://github.com/gakiyukr/sso/blob/main/schema.sql)初始化数据表。
  3. 在 Cloudflare Workers & Pages 连接 GitHub 仓库。
  4. 在Cloudflare的**构建环境变量**中填`D1_DATABASE_ID`。
  5. 在Worker的**Variables and Secrets**中填SSO运行时变数与密钥。
  6. 将部署命令改成`npm run deploy`，如果页面有版本命令，改成`npm run deploy:version`。
  7. 重新部署，确认OIDC发现与JWKS端点可正常开启。

  ## 你需要准备

  

  - Cloudflare 帐号。
  - GitHub仓库。
  - 一个 Cloudflare D1 数据库。
  - 一个要作为 SSO 提供商的 HTTPS 域名，例如`https://auth.example.com`。
  - 一个帐号信箱尾部绑定域名，例如`example.com`。
  - OpenAI SSO 后台提供回调 URL 和 Tile URL。
  - 一组 OIDC Client ID / Client Secret。
  - 一个RS256私钥JWK，用于签发token并提供JWKS。

  ## 1. 建立D1数据库

  

  1. 进入 Cloudflare 仪表板。
  2. 存储**和数据库 → D1 SQL 数据库**。
  3. 选择**创建数据库**。
  4. 数据库名称建议填：

  ```text
  openai_oidc_sso
  ```

  

  1. 创建后复制`database_id`，稍后会填到 Cloudflare Builds 的`D1_DATABASE_ID`。

  ## 2. 初始化资料表

  

  1. 在 Cloudflare Dashboard 进入刚刚建立的 D1 数据库。
  2. 打开**控制台**。
  3. 复制本仓库[schema.sql](https://github.com/gakiyukr/sso/blob/main/schema.sql)的全部内容。
  4. 贴到D1控制台并执行。
  5. 到**表**确认已建立：

  - `users`
  - `invite_codes`
  - `authorization_codes`

  也可以在D1控制台执行：

  ```
  SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
  ```

  

  ## 3.连接GitHub自动部署

  

  1. 将本仓库自动化到GitHub。
  2. 进入 Cloudflare Dashboard 的**Workers & Pages**。
  3. 选择**创建应用程序**。
  4. 选择**导入仓库**或连接Git仓库的部署方式。
  5. 选择你的GitHub仓库和生产分支。
  6. 创建完成后，进入该Worker的**Settings → Builds**，确认Build设置：

  | 设定                            | 值                                             |
  | ------------------------------- | ---------------------------------------------- |
  | 根目录                          | 如果在仓库根目录，留空或填`/`                  |
  | 构建命令                        | 留空                                           |
  | 部署命令                        | `npm run deploy`                               |
  | 版本控制命令/非生产环境部署命令 | 如果页面有这一项，请填`npm run deploy:version` |

  不要使用`npx wrangler deploy`或`npx wrangler versions upload`作为部署命令。它们会直接读取公开仓库的`wrangler.toml`，无法获取裸D1数据库id。

  如果你已经连接过 GitHub 仓库，只需要打开**Settings → Builds**右边的编辑按钮，把命令改成上表的值，重新重新配置。

  ## 4.设置构建变量

  

  在 Worker 的**Settings → Builds → Variables and Secrets**或构建设定弹窗中，加入以下**构建环境变量**。这些值只在构建时使用，不是 Worker 运行时变量。

  | 名称               | 必填 | 说明                                                         |
  | ------------------ | ---- | ------------------------------------------------------------ |
  | `D1_DATABASE_ID`   | 是   | 刚建立的 D1 数据库 id。配置脚本会用它生成临时 Wrangler 配置。 |
  | `D1_DATABASE_NAME` | 否   | D1数据库名称，默认`openai_oidc_sso`。                        |
  | `WORKER_NAME`      | 否   | 工人姓名，默认`sso`。                                        |

  `D1_DATABASE_ID`可以设置普通构建变量，方便日后查看；如果不想让协作者，可以设置加密值。

  请确认变数作用在生产分支。若 Cloudflare 页面同时提供生产与预览的变数区，至少要在生产区填`D1_DATABASE_ID`。如果之后要让非生产分支部署成功，则必须在预览区填同一个数据库 id，或填另一个测试用的 D1 数据库 id。

  这一步只解决D1绑定。`ISSUER`、、`OIDC_CLIENT_ID`等`PRIVATE_JWK`SSO设置不要填在这里，请填到下面的运行时变量。

  ## 5.设置运行时变量和秘密

  

  进入Worker的**Settings → Variables and Secrets**，点**添加**新增的以下运行时变量。Worker程序会透过`env.变量名`读取这些值。

  文本变数可以在仪表板上再次查看；秘密存储后不能再查看原值。建议把需要日后研究的非按键设定设置成文本，把真正的按键设置成秘密。

  | 名称                             | 类型 | 必填 | 说明                                                         |
  | -------------------------------- | ---- | ---- | ------------------------------------------------------------ |
  | `ISSUER`                         | 文本 | 是   | Worker对外URL，不要带结尾斜线，例如`https://auth.example.com`。 |
  | `OIDC_CLIENT_ID`                 | 文本 | 是   | OpenAI 自定义 OIDC 使用的客户端 ID，例如`openai-sso`。       |
  | `ALLOWED_REDIRECT_URIS`          | 文本 | 是   | OpenAI后台显示的回调URL。多个值用分隔符分隔。                |
  | `ACCOUNT_DOMAIN`                 | 文本 | 是   | 用户帐号的信箱域名，例如`example.com`。用户输入`neko`时会变成`neko@example.com`。 |
  | `OPENAI_LOGIN_URL`               | 文本 | 建议 | OpenAI SSO 设置页提供了图块 URL。直接访问`/`时会跳转到此处。 |
  | `AUTHORIZATION_CODE_TTL_SECONDS` | 文本 | 否   | 授权码有效秒数，默认`300`。                                  |
  | `TOKEN_TTL_SECONDS`              | 文本 | 否   | Access token 与 ID token 秒有效数，默认`3600`。              |
  | `TURNSTILE_SITE_KEY`             | 文本 | 否   | Cloudflare Turnstile 入口密钥。                              |
  | `OIDC_CLIENT_SECRET`             | 秘密 | 是   | OpenAI 自定义 OIDC 使用的客户端密钥。                        |
  | `PRIVATE_JWK`                    | 秘密 | 是   | RS256 私钥 JWK，必须是单行 JSON，且包含`kid`。               |
  | `ADMIN_TOKEN`                    | 秘密 | 否   | 调用`/admin/invite-codes`创建邀请码时使用。                  |
  | `TURNSTILE_SECRET_KEY`           | 秘密 | 否   | Cloudflare Turnstile 入口 Secret Key。设置 Site Key 时也必须设置它。 |

  注意：

  - Cloudflare介面中，先输入变量名称和值；需要Secret时再点**加密**或选择密钥类型。
  - 不要把运行时的变数填到构建变量中；Worker执行时读不到。
  - `D1_DATABASE_ID`例外的是，它只提供配置脚本生成临时 Wrangler 配置，而不是运行时变量。
  - Runtime Text 变数不会被`npm run deploy`覆盖，因为临时 config 只包含`keep_vars = true`和 D1 绑定，不包含`[vars]`。
  - 修改运行时变量后，Cloudflare 通常需要重新部署或建立新版本才会让最新部署使用新值。

  ## 6.产生RS256私钥JWK

  

  在本机执行：

  ```
  node -e "crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']).then(k=>crypto.subtle.exportKey('jwk',k.privateKey)).then(j=>{j.kid='openai-sso-key';j.alg='RS256';j.use='sig';console.log(JSON.stringify(j))})"
  ```

  

  把输出整段JSON作为`PRIVATE_JWK`Secret。请保持单行，不要手动换行。

  ## 7.设置D1绑定

  

  本程序码固定使用`env.DB`访问数据库。因此 D1 绑定名称必须是：

  ```text
  DB
  ```

  

  如果您使用本 README 的`npm run deploy`，配置脚本会从构建变量`D1_DATABASE_ID`生成`DB`绑定，通常不需要在 Dashboard 中手动创建绑定。

  部署后可以进入Worker的**设置→绑定**确认：

  | 栏位              | 正确值                                  |
  | ----------------- | --------------------------------------- |
  | 绑定名称/变量名称 | `DB`                                    |
  | 资源类型          | D1数据库                                |
  | 数据库            | 你建立的D1数据库，例如`openai_oidc_sso` |

  如果仪表板显示没有 D1 绑定，或构建日志仍提示`DB`绑定到`00000000...`，通常表示配置命令没有改成`npm run deploy`，或构建变量`D1_DATABASE_ID`没有套用本次配置。

  ## 8. 触发配置

  

  完成上述设定后：

  1. 返回 Cloudflare Worker 的**部署**或 Git 构建页面。
  2. 重新部署生产分支。
  3. 构建日志中应该看到：

  ```text
  Executing user deploy command: npm run deploy
  已生成临时 Wrangler 设置：wrangler.deploy.toml
  ```

  

  如果有版本上传或预览部署，也应该看到它的使用：

  ```text
  npm run deploy:version
  ```

  

  如果还看到：

  ```text
  Executing user deploy command: npx wrangler deploy
  ```

  

  代表部署作战尚未成功。

  如果看到：

  ```text
  缺少必要构建环境变量：D1_DATABASE_ID
  ```

  

  表示`D1_DATABASE_ID`没有填写在 Cloudflare 的构建环境变量中，或者没有套用当前部署分支。

  ## 9.设定自订域名

  

  部署完成后，若要使用自己的域名：

  1. 进入 Worker 的**设置 → 域和路由**。
  2. 选择**添加→自定义域**。
  3. 填入`auth.example.com`此类完整主机名称。
  4. 等待 Cloudflare 建立 DNS 记录与依赖。
  5. 将运行时变数`ISSUER`改成正式域名，例如`https://auth.example.com`。
  6. 重新部署。

  若先使用`*.workers.dev`测试，`ISSUER`、OpenAI OIDC端点与OpenAI回调设置也必须使用同一个测试域名。

  ## 10.OpenAI 自定义 OIDC 设置

  

  在 OpenAI SSO 设置页面选择**Custom OIDC**。建议填入：

  | OpenAI栏位   | 值                           |
  | ------------ | ---------------------------- |
  | 发行人       | `https://你的域名`           |
  | 授权端点     | `https://你的域名/authorize` |
  | 令牌端点     | `https://你的域名/token`     |
  | JWKS URI     | `https://你的域名/jwks.json` |
  | 用户信息端点 | `https://你的域名/userinfo`  |
  | 客户ID       | 与`OIDC_CLIENT_ID`相同       |
  | 客户机密     | 与`OIDC_CLIENT_SECRET`相同   |

  OpenAI 后台显示的回调 URL 必须填入 Worker 运行时变数`ALLOWED_REDIRECT_URIS`。若有多个重定向 URI，使用分隔分隔。

  `OPENAI_LOGIN_URL`必须填写 OpenAI SSO 设置页提供的 Tile URL，例如：

  ```text
  https://chatgpt.com/auth/login?sso=true&connection=conn_...
  ```

  

  不要把OpenAI回调URL填到`OPENAI_LOGIN_URL`，否则OpenAI端没有先建立SSO会话，可能会出现`client_id_not_found_in_session`。

  ## 11. 建立邀请码

  

  初始化数据表不会自动创建邀请码。您可以直接在D1控制台创建：

  ```
  INSERT INTO invite_codes (code, max_uses, used_count, enabled, created_at)
  VALUES ('JOIN-2026', 100, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  ```

  

  若已设定`ADMIN_TOKEN`，也可以使用管理API：

  ```
  curl -X POST https://你的域名/admin/invite-codes ^
    -H "Authorization: Bearer 你的_ADMIN_TOKEN" ^
    -H "Content-Type: application/json" ^
    -d "{\"code\":\"JOIN-2026\",\"maxUses\":100}"
  ```

  

  回传范例：

  ```
  {
    "code": "JOIN-2026",
    "maxUses": 100,
    "usedCount": 0,
    "enabled": true,
    "createdAt": "2026-06-08T00:00:00.000Z"
  }
  ```

  

  ## 12. 部署后检查

  

  部署后先开启：

  - `https://你的域名/.well-known/openid-configuration`
  - `https://你的域名/jwks.json`

  确认端点两个正常后，再到OpenAI后台启用自定义OIDC。

  常见错误：

  - `D1 binding 'DB' references database '00000000...'`：配置命令目前读取公开占位设置，请改成`npm run deploy`，并设置`D1_DATABASE_ID`。
  - `缺少必要设置：ACCOUNT_DOMAIN`：Worker Runtime Variables and Secrets 里缺货`ACCOUNT_DOMAIN`。
  - `缺少必要设置：PRIVATE_JWK`：`PRIVATE_JWK`秘密未设定或尚未重新部署。
  - `不允許的 redirect_uri`：`ALLOWED_REDIRECT_URIS`未包含OpenAI后台显示的回调URL。
  - 直接访问`/`失败：检查`OPENAI_LOGIN_URL`是否填写了 OpenAI Tile URL。

  ## 登入与注册流程

  

  - 直接入口：访问`https://你的域名/`会跳转到`OPENAI_LOGIN_URL`。
  - 登入页面：只输入帐号，例如`neko`。系统会使用`neko@ACCOUNT_DOMAIN`登入。
  - 注册完成页：输入帐号与邀请码。注册成功后会直接OIDC登入。

  若用户输入完整的信箱，例如`neko@example.com`，系统只接受尾缀符合`ACCOUNT_DOMAIN`的地址。其他信箱域名会被拒绝。

  ## 旋转闸门

  

  如果同时设置`TURNSTILE_SITE_KEY`与`TURNSTILE_SECRET_KEY`，登入与注册页会启用 Cloudflare Turnstile。

  - 两个值都不设置：失效旋转门。
  - 只设定其中一个：登入与注册会因缺少必要设定而失败。

  ## 本地设置备份

  

  如果您想在本机保存一份可查看的设置备份，可以复制：

  ```
  Copy-Item .env.example .env
  ```

  

  `.env`已被`.gitignore`忽略，不会提交到 GitHub。它只是本机备份，不会自动同步到 Cloudflare Dashboard。

  ## CLI 附录

  

  主要部署方式是Cloudflare Dashboard。若偏好本机CLI：

  ```
  pnpm install
  pnpm wrangler d1 create openai_oidc_sso
  pnpm wrangler d1 execute openai_oidc_sso --remote --file .\schema.sql
  $env:D1_DATABASE_ID = "你的_database_id"
  pnpm run deploy
  ```

  

  秘密可用Wrangler CLI设置：

  ```
  pnpm wrangler secret put PRIVATE_JWK
  pnpm wrangler secret put OIDC_CLIENT_SECRET
  pnpm wrangler secret put ADMIN_TOKEN
  pnpm wrangler secret put TURNSTILE_SECRET_KEY
  ```

  

  ## 本地验证

  

  ```
  pnpm install
  pnpm test
  pnpm check
  ```

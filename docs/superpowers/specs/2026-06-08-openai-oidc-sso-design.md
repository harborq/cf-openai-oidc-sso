# OpenAI OIDC SSO 设计



## 目标



建立一个可部署于Cloudflare Workers 的OIDC 身分提供者，用于对接OpenAI 的Custom OIDC SSO。使用者登入时输入电子邮件与邀请码；已建立的使用者可持续登入，新使用者必须使用有效邀请码，且单一邀请码预设最多只能建立100 个帐号。

## 协议选型



本专案使用OIDC，而非SAML。 OIDC 使用JSON 与JWT，适合Cloudflare Workers 的WebCrypto 与无状态HTTP 模型；SAML 依赖XML 签名与断言处理，实作与验证成本较高。

OpenAI 官方SSO 说明指出，完成网域验证后可选择Custom OIDC 连接，并需将IdP 应用程式与OpenAI 设定精灵互相配置。 OpenAI 使用者模型至少需要电子邮件，名字与姓氏为建议栏位。

## 架构



Worker 提供OIDC Provider 端点与一个简单登入页。 D1 储存使用者、邀请码与一次性授权码。 JWT 使用RS256 金钥签名，公开金钥透过JWKS 端点提供给OpenAI 验证。

系统只信任设定中的`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`与`ALLOWED_REDIRECT_URIS`。所有新帐号建立都必须先通过邀请码限制；既有帐号登入不再消耗邀请码。

## 端点



- `GET /.well-known/openid-configuration`：回传OIDC discovery metadata。
- `GET /jwks.json`：回传公开JWK。
- `GET /authorize`：验证OIDC 请求并显示登入表单。
- `POST /login`：处理电子邮件与邀请码，建立授权码并导回OpenAI。
- `POST /token`：验证授权码与client 认证，签发`id_token`。
- `GET /userinfo`：透过Bearer token 回传使用者资讯。
- `POST /admin/invite-codes`：以`ADMIN_TOKEN`保护，用于建立邀请码。
- `GET /admin/invite-codes`：以`ADMIN_TOKEN`保护，用于查看邀请码使用状态。

## 资料模型



- `users`：`email`、`display_name`、`invite_code`、`created_at`、`last_login_at`。
- `invite_codes`：`code`、`max_uses`、`used_count`、`enabled`、`created_at`。
- `authorization_codes`：一次性OIDC 授权码、使用者、client、redirect URI、nonce、scope、过期时间与使用时间。

## 安全与限制



电子邮件一律转为小写并去除前后空白。授权码短期有效且只能使用一次。邀请码建立新使用者时以D1 transaction 保证计数与使用者建立一致。登入页与错误讯息使用繁体中文。专案不实作密码、二阶段验证或自助邀请码管理介面，避免超出本次需求。

## 测试策略



以Node.js 内建测试框架覆盖核心行为：邀请码上限、既有使用者登入、OIDC discovery、JWKS、授权码交换、client secret 验证与错误回应。测试使用记忆体储存介面，避免依赖Cloudflare 运行环境。
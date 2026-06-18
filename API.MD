# SSO API 整合指南



本文件说明如何让其他程式透过API 请求本SSO 系统的登录与注册功能，无需经过网页表单或人机验证（Turnstile）。

## 系统背景



本SSO 是一个OIDC（OpenID Connect）提供者，部署于Cloudflare Workers。标准流程是：

1. 客户端将使用者导向`/authorize`（显示登录表单）
2. 使用者填写表单、通过人机验证后，系统产生授权码（authorization code）并重导向回客户端
3. 客户端用授权码向`/token`交换JWT token

**API 端点跳过了第1、2 步的网页与人机验证**，直接用JSON 请求即可取得授权码。

## 认证



所有API 端点都需要`ADMIN_TOKEN`进行Bearer 认证：

```
Authorization: Bearer <ADMIN_TOKEN>
```



`ADMIN_TOKEN`的值在SSO 伺服器的环境变数中设定。

## API 端点



### POST /api/login



登录已有帐号，取得OIDC 授权码。

**请求（JSON）：**

| 栏位                    | 必填 | 说明                                                     |
| ----------------------- | ---- | -------------------------------------------------------- |
| `account`               | 是   | 帐号名称（不含`@域名`），例如`"alice"`                   |
| `client_id`             | 否   | OIDC client ID，预设为伺服器设定的`OIDC_CLIENT_ID`       |
| `redirect_uri`          | 否   | 回调URL，预设为伺服器设定的第一个`ALLOWED_REDIRECT_URIS` |
| `scope`                 | 否   | OIDC scope，预设`"openid email"`                         |
| `state`                 | 否   | OIDC state 参数                                          |
| `nonce`                 | 否   | OIDC nonce 参数                                          |
| `code_challenge`        | 否   | PKCE code challenge                                      |
| `code_challenge_method` | 否   | PKCE 方法，仅支援`"S256"`                                |

**回应（JSON）：**

```
{
  "code": "abc123...",
  "redirect_uri": "https://example.com/callback?code=abc123...&state=...",
  "user": {
    "email": "alice@example.com",
    "displayName": "alice",
    "created": false
  }
}
```



- `code`：授权码，可用于向`/token`交换JWT token
- `redirect_uri`：拼好的完整回调URL（含code 和state）
- `user`：使用者资讯

### POST /api/register



注册新帐号（需要邀请码），同时完成登录并取得授权码。若帐号已存在则直接登录。

**请求（JSON）：**

| 栏位                    | 必填 | 说明                     |
| ----------------------- | ---- | ------------------------ |
| `account`               | 是   | 帐号名称（不含`@域名`）  |
| `invite_code`           | 是   | 邀请码                   |
| `display_name`          | 否   | 显示名称，预设为帐号名称 |
| `client_id`             | 否   | OIDC client ID           |
| `redirect_uri`          | 否   | 回调URL                  |
| `scope`                 | 否   | OIDC scope               |
| `state`                 | 否   | OIDC state               |
| `nonce`                 | 否   | OIDC nonce               |
| `code_challenge`        | 否   | PKCE code challenge      |
| `code_challenge_method` | 否   | PKCE 方法                |

**回应（JSON）：**

```
{
  "code": "xyz789...",
  "redirect_uri": "https://example.com/callback?code=xyz789...",
  "user": {
    "email": "bob@example.com",
    "displayName": "bob",
    "created": true
  }
}
```



- `user.created`：`true`表示新建帐号，`false`表示帐号已存在并直接登录

## 错误回应



所有错误回传JSON，HTTP status 非200：

```
{ "error": "错误信息" }
```



常见错误：

- `401`— 未提供或错误的`ADMIN_TOKEN`
- `400`— 缺少必要栏位、帐号不存在、邀请码无效、OIDC 参数不合法

## 完整使用流程



以下是让你的程式整合本SSO 的完整步骤：

```
1. 请求 /api/login 或 /api/register 取得授权码（code）
2. 用授权码请求 /token 交换 JWT token
3. 用 JWT token 获取受保护的资源
```



### 步骤1：取得授权码



```
curl -X POST https://sso.example.com/api/register \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "account": "alice",
    "invite_code": "YOUR_INVITE_CODE",
    "redirect_uri": "https://your-app.com/callback",
    "client_id": "YOUR_CLIENT_ID"
  }'
```



### 步骤2：用授权码交换token



```
curl -X POST https://sso.example.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=上一步拿到的 code" \
  -d "redirect_uri=https://your-app.com/callback" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET"
```



回应：

```
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "id_token": "eyJ..."
}
```



### 步骤3（可选）：查询使用者资讯



```
curl https://sso.example.com/userinfo \
  -H "Authorization: Bearer <access_token>"
```



## 修改其他程式的整合范例



假设你要让一个程式在启动时自动透过本SSO 取得token，以下是Node.js 范例：

```
async function ssoLogin({ baseUrl, adminToken, account, inviteCode, clientId, clientSecret, redirectUri }) {
  // 步骤 1：注册或登录
  const endpoint = inviteCode ? "/api/register" : "/api/login";
  const body = { account, client_id: clientId, redirect_uri: redirectUri };
  if (inviteCode) body.invite_code = inviteCode;

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`SSO 登录失败: ${JSON.stringify(await res.json())}`);
  const { code } = await res.json();

  // 步骤 2：交换 token
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret
  });

  const tokenRes = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  if (!tokenRes.ok) throw new Error(`Token 交换失败: ${JSON.stringify(await tokenRes.json())}`);
  return tokenRes.json(); // { access_token, id_token, expires_in, token_type }
}
```



## 注意事项



- 授权码预设有效期为5 分钟（`AUTHORIZATION_CODE_TTL_SECONDS`），且只能使用一次
- token 预设有效期为1 小时（`TOKEN_TTL_SECONDS`）
- `account`栏位只能是英文字母、数字、点、底线、加号、连字号
- 所有帐号自动加上`@ACCOUNT_DOMAIN`后缀作为email
- 若`/api/register`的帐号已存在，会直接登录而不报错（`user.created`为`false`）
import { strict as assert } from "node:assert";
import { before, describe, it } from "node:test";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";

let privateJwk;

before(async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );
  privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  privateJwk.kid = "app-test-key";
  privateJwk.alg = "RS256";
  privateJwk.use = "sig";
});

function createTestApp(envOverrides = {}, appOptions = {}) {
  const store = new MemoryStore();
  const config = loadConfig({
    ISSUER: "https://sso.example.com",
    OIDC_CLIENT_ID: "openai-client",
    OIDC_CLIENT_SECRET: "secret",
    ALLOWED_REDIRECT_URIS: "https://auth.openai.com/oidc/callback",
    ACCOUNT_DOMAIN: "example.com",
    OPENAI_LOGIN_URL: "https://chatgpt.com/auth/login?sso=true&connection=conn_test",
    PRIVATE_JWK: JSON.stringify(privateJwk),
    ADMIN_TOKEN: "admin-token",
    ...envOverrides
  });
  return { store, config, app: createApp({ store, config, ...appOptions }) };
}

async function withGlobalFetch(fetchImplementation, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImplementation;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("Worker HTTP 端点", () => {
  it("/ 会跳转 OpenAI SSO Tile URL", async () => {
    const { app } = createTestApp();
    const response = await app.fetch(new Request("https://sso.example.com/"));

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://chatgpt.com/auth/login?sso=true&connection=conn_test");
  });

  it("/ 未设置 OpenAI SSO Tile URL 时会提示设置错误", async () => {
    const { app } = createTestApp({
      OPENAI_LOGIN_URL: ""
    });
    const originalConsoleError = console.error;
    console.error = () => {};

    const response = await app.fetch(new Request("https://sso.example.com/")).finally(() => {
      console.error = originalConsoleError;
    });
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /缺少必要设置：OPENAI_LOGIN_URL/);
  });

  it("/authorize 会提示登录表单", async () => {
    const { app } = createTestApp({
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA"
    });
    const response = await app.fetch(
      new Request(
        "https://sso.example.com/authorize?client_id=openai-client&redirect_uri=https%3A%2F%2Fauth.openai.com%2Foidc%2Fcallback&response_type=code&scope=openid%20email&state=abc"
      )
    );

    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /OpenAI SSO 登录/);
    assert.match(html, /注册/);
    assert.match(html, /account-field/);
    assert.match(html, /account-domain/);
    assert.match(html, /@example\.com/);
    assert.match(html, /cf-turnstile/);
    assert.match(html, /data-sitekey="1x00000000000000000000AA"/);
    assert.match(html, /data-action="login"/);
    assert.doesNotMatch(html, /邀请码/);
    assert.doesNotMatch(html, /@example\.@example\.com/);
  });

  it("/authorize 会提示设置的账号域名", async () => {
    const { app } = createTestApp({
      ACCOUNT_DOMAIN: "team.example.org"
    });
    const response = await app.fetch(
      new Request(
        "https://sso.example.com/authorize?client_id=openai-client&redirect_uri=https%3A%2F%2Fauth.openai.com%2Foidc%2Fcallback&response_type=code&scope=openid%20email"
      )
    );

    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /@team\.example\.org/);
    assert.doesNotMatch(html, /@old\.example\.com/);
  });

  it("/login 启用 Turnstile 后缺少 token 会拒绝登录", async () => {
    const { store, app } = createTestApp(
      {
        TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA"
      },
      {
        turnstileFetch() {
          throw new Error("缺少 token 时不应请求 Siteverify");
        }
      }
    );
    await store.createInviteCode({ code: "JOIN", maxUses: 1 });
    await store.createUserWithInvite({
      email: "member@example.com",
      displayName: "Neko Maau",
      inviteCode: "JOIN"
    });
    const body = new URLSearchParams({
      account: "member",
      client_id: "openai-client",
      redirect_uri: "https://auth.openai.com/oidc/callback",
      scope: "openid email"
    });
    const originalConsoleError = console.error;
    console.error = () => {};

    const response = await app.fetch(
      new Request("https://sso.example.com/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      })
    ).finally(() => {
      console.error = originalConsoleError;
    });
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /请先完成 Cloudflare 人机验证/);
  });

  it("/login 会用 Turnstile token 通过验证后才登录", async () => {
    const calls = [];
    const { store, app } = createTestApp(
      {
        TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA"
      },
      {
        turnstileFetch(url, init) {
          calls.push({ url, init });
          return Response.json({ success: true });
        }
      }
    );
    await store.createInviteCode({ code: "JOIN", maxUses: 1 });
    await store.createUserWithInvite({
      email: "member@example.com",
      displayName: "Neko Maau",
      inviteCode: "JOIN"
    });
    const body = new URLSearchParams({
      account: "member",
      "cf-turnstile-response": "valid-login-token",
      client_id: "openai-client",
      redirect_uri: "https://auth.openai.com/oidc/callback",
      scope: "openid email"
    });

    const response = await app.fetch(
      new Request("https://sso.example.com/login", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "cf-connecting-ip": "203.0.113.20"
        },
        body
      })
    );

    assert.equal(response.status, 302);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.body.get("response"), "valid-login-token");
    assert.equal(calls[0].init.body.get("remoteip"), "203.0.113.20");
    assert.ok(new URL(response.headers.get("location")).searchParams.get("code"));
  });

  it("/login 使用设置 fetch 验证 Turnstile 时会保留 Workers this", async () => {
    await withGlobalFetch(
      function () {
        if (this !== globalThis) {
          throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
        }
        return Response.json({ success: true });
      },
      async () => {
        const { store, app } = createTestApp({
          TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
          TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA"
        });
        await store.createInviteCode({ code: "JOIN", maxUses: 1 });
        await store.createUserWithInvite({
          email: "member@example.com",
          displayName: "Neko Maau",
          inviteCode: "JOIN"
        });

        const response = await app.fetch(
          new Request("https://sso.example.com/login", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              account: "member",
              "cf-turnstile-response": "valid-login-token",
              client_id: "openai-client",
              redirect_uri: "https://auth.openai.com/oidc/callback",
              scope: "openid email"
            })
          })
        );

        assert.equal(response.status, 302);
      }
    );
  });

  it("/register 使用设置 fetch 验证 Turnstile 时会保留 Workers this", async () => {
    await withGlobalFetch(
      function () {
        if (this !== globalThis) {
          throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
        }
        return Response.json({ success: true });
      },
      async () => {
        const { store, app } = createTestApp({
          TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
          TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA"
        });
        await store.createInviteCode({ code: "JOIN", maxUses: 100 });

        const response = await app.fetch(
          new Request("https://sso.example.com/register", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              account: "user",
              invite_code: "JOIN",
              "cf-turnstile-response": "valid-register-token",
              client_id: "openai-client",
              redirect_uri: "https://auth.openai.com/oidc/callback",
              scope: "openid email"
            })
          })
        );

        assert.equal(response.status, 302);
      }
    );
  });

  it("/register 会提示独立注册表单", async () => {
    const { app } = createTestApp({
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA"
    });
    const response = await app.fetch(
      new Request(
        "https://sso.example.com/register?client_id=openai-client&redirect_uri=https%3A%2F%2Fauth.openai.com%2Foidc%2Fcallback&response_type=code&scope=openid%20email&state=abc"
      )
    );

    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /OpenAI SSO 注册/);
    assert.match(html, /邀请码/);
    assert.match(html, /返回登录/);
    assert.match(html, /account-field/);
    assert.match(html, /account-domain/);
    assert.match(html, /@example\.com/);
    assert.match(html, /cf-turnstile/);
    assert.match(html, /data-sitekey="1x00000000000000000000AA"/);
    assert.match(html, /data-action="register"/);
    assert.match(html, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
    assert.doesNotMatch(html, /@example\.@example\.com/);
  });

  it("/register 启用 Turnstile 后缺少 token 会拒绝建立账号", async () => {
    const { store, app } = createTestApp(
      {
        TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA"
      },
      {
        turnstileFetch() {
          throw new Error("缺少 token 时不应请求 Siteverify");
        }
      }
    );
    await store.createInviteCode({ code: "JOIN", maxUses: 100 });
    const body = new URLSearchParams({
      account: "user",
      invite_code: "JOIN",
      client_id: "openai-client",
      redirect_uri: "https://auth.openai.com/oidc/callback",
      scope: "openid email"
    });
    const originalConsoleError = console.error;
    console.error = () => {};

    const response = await app.fetch(
      new Request("https://sso.example.com/register", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      })
    ).finally(() => {
      console.error = originalConsoleError;
    });
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /请先完成 Cloudflare 人机验证/);
    assert.equal(await store.getUserByEmail("user@example.com"), null);
    assert.equal((await store.getInviteCode("JOIN")).usedCount, 0);
  });

  it("/register 只设置 Turnstile site key 时会拒绝注册", async () => {
    const { store, app } = createTestApp({
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA"
    });
    await store.createInviteCode({ code: "JOIN", maxUses: 100 });
    const body = new URLSearchParams({
      account: "user",
      invite_code: "JOIN",
      "cf-turnstile-response": "token",
      client_id: "openai-client",
      redirect_uri: "https://auth.openai.com/oidc/callback",
      scope: "openid email"
    });
    const originalConsoleError = console.error;
    console.error = () => {};

    const response = await app.fetch(
      new Request("https://sso.example.com/register", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      })
    ).finally(() => {
      console.error = originalConsoleError;
    });
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /缺少必要设置：TURNSTILE_SECRET_KEY/);
    assert.equal(await store.getUserByEmail("user@example.com"), null);
    assert.equal((await store.getInviteCode("JOIN")).usedCount, 0);
  });

  it("/register 会用 Turnstile token 通过验证后才建立账号", async () => {
    const calls = [];
    const { store, app } = createTestApp(
      {
        TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA"
      },
      {
        turnstileFetch(url, init) {
          calls.push({ url, init });
          return Response.json({ success: true });
        }
      }
    );
    await store.createInviteCode({ code: "JOIN", maxUses: 100 });
    const body = new URLSearchParams({
      account: "user",
      invite_code: "JOIN",
      "cf-turnstile-response": "valid-token",
      client_id: "openai-client",
      redirect_uri: "https://auth.openai.com/oidc/callback",
      scope: "openid email",
      state: "state-1"
    });

    const response = await app.fetch(
      new Request("https://sso.example.com/register", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "cf-connecting-ip": "203.0.113.10"
        },
        body
      })
    );

    assert.equal(response.status, 302);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.body.get("secret"), "1x0000000000000000000000000000000AA");
    assert.equal(calls[0].init.body.get("response"), "valid-token");
    assert.equal(calls[0].init.body.get("remoteip"), "203.0.113.10");
    assert.ok(await store.getUserByEmail("user@example.com"));
  });

  it("/register 会拒绝未通过 Turnstile 的注册", async () => {
    const { store, app } = createTestApp(
      {
        TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA"
      },
      {
        turnstileFetch() {
          return Response.json({ success: false, "error-codes": ["invalid-input-response"] });
        }
      }
    );
    await store.createInviteCode({ code: "JOIN", maxUses: 100 });
    const body = new URLSearchParams({
      account: "user",
      invite_code: "JOIN",
      "cf-turnstile-response": "bad-token",
      client_id: "openai-client",
      redirect_uri: "https://auth.openai.com/oidc/callback",
      scope: "openid email"
    });
    const originalConsoleError = console.error;
    console.error = () => {};

    const response = await app.fetch(
      new Request("https://sso.example.com/register", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      })
    ).finally(() => {
      console.error = originalConsoleError;
    });
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /Cloudflare 人机验证失败/);
    assert.equal(await store.getUserByEmail("user@example.com"), null);
    assert.equal((await store.getInviteCode("JOIN")).usedCount, 0);
  });

  it("/register 注册成功后会跳转 redirect_uri 并帶上授权码", async () => {
    const { store, app } = createTestApp();
    await store.createInviteCode({ code: "JOIN", maxUses: 100 });
    const body = new URLSearchParams({
      account: "user",
      invite_code: "JOIN",
      client_id: "openai-client",
      redirect_uri: "https://auth.openai.com/oidc/callback",
      scope: "openid email",
      state: "state-1"
    });

    const response = await app.fetch(
      new Request("https://sso.example.com/register", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      })
    );

    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location"));
    assert.equal(location.origin + location.pathname, "https://auth.openai.com/oidc/callback");
    assert.equal(location.searchParams.get("state"), "state-1");
    assert.ok(location.searchParams.get("code"));
  });

  it("/login 既有账号登录不需要邀请码", async () => {
    const { store, app } = createTestApp();
    await store.createInviteCode({ code: "JOIN", maxUses: 1 });
    await store.createUserWithInvite({
      email: "member@example.com",
      displayName: "Neko Maau",
      inviteCode: "JOIN"
    });
    const body = new URLSearchParams({
      mode: "login",
      account: "member@example.com",
      client_id: "openai-client",
      redirect_uri: "https://auth.openai.com/oidc/callback",
      scope: "openid email"
    });

    const response = await app.fetch(
      new Request("https://sso.example.com/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      })
    );

    assert.equal(response.status, 302);
    assert.ok(new URL(response.headers.get("location")).searchParams.get("code"));
    assert.equal((await store.getInviteCode("JOIN")).usedCount, 1);
  });

  it("/login 登录未注册账号会提示错误", async () => {
    const { app } = createTestApp();
    const body = new URLSearchParams({
      mode: "login",
      account: "unknown",
      client_id: "openai-client",
      redirect_uri: "https://auth.openai.com/oidc/callback",
      scope: "openid email"
    });
    const originalConsoleError = console.error;
    console.error = () => {};

    const response = await app.fetch(
      new Request("https://sso.example.com/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      })
    ).finally(() => {
      console.error = originalConsoleError;
    });
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /账号不存在，请先注册/);
  });

  it("/login 遇到非标准错误时仍会跳转登录失败页", async () => {
    const { app } = createTestApp();
    app.fetch = createApp({
      store: {
        getUserByEmail() {
          throw null;
        }
      },
      config: loadConfig({
        ISSUER: "https://sso.example.com",
        OIDC_CLIENT_ID: "openai-client",
        OIDC_CLIENT_SECRET: "secret",
        ALLOWED_REDIRECT_URIS: "https://auth.openai.com/oidc/callback",
        ACCOUNT_DOMAIN: "example.com",
        PRIVATE_JWK: JSON.stringify(privateJwk),
        ADMIN_TOKEN: "admin-token"
      })
    }).fetch;
    const body = new URLSearchParams({
      account: "user",
      invite_code: "JOIN",
      client_id: "openai-client",
      redirect_uri: "https://auth.openai.com/oidc/callback",
      scope: "openid email"
    });
    const originalConsoleError = console.error;
    console.error = () => {};

    const response = await app.fetch(
      new Request("https://sso.example.com/register", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      })
    ).finally(() => {
      console.error = originalConsoleError;
    });
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /登录失败/);
    assert.match(html, /登录处理失败/);
  });

  it("/authorize 登录表单不要求使用者填写名字", async () => {
    const { app } = createTestApp();

    const response = await app.fetch(
      new Request(
        "https://sso.example.com/authorize?client_id=openai-client&redirect_uri=https%3A%2F%2Fauth.openai.com%2Foidc%2Fcallback&response_type=code&scope=openid%20email"
      )
    );

    const html = await response.text();
    assert.doesNotMatch(html, /display_name/);
    assert.doesNotMatch(html, /提示名称/);
  });

  it("/token 会接受表单格式并跳转 id_token", async () => {
    const { store, app } = createTestApp();
    await store.createInviteCode({ code: "JOIN", maxUses: 100 });
    const loginBody = new URLSearchParams({
      account: "user",
      invite_code: "JOIN",
      client_id: "openai-client",
      redirect_uri: "https://auth.openai.com/oidc/callback",
      scope: "openid email"
    });
    const loginResponse = await app.fetch(
      new Request("https://sso.example.com/register", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: loginBody
      })
    );
    const code = new URL(loginResponse.headers.get("location")).searchParams.get("code");

    const tokenResponse = await app.fetch(
      new Request("https://sso.example.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: "openai-client",
          client_secret: "secret",
          redirect_uri: "https://auth.openai.com/oidc/callback"
        })
      })
    );

    const token = await tokenResponse.json();
    assert.equal(tokenResponse.status, 200);
    assert.ok(token.id_token);
    assert.equal(token.token_type, "Bearer");
  });

  it("/jwks.json 会回传最小 RSA JWKS 与标准 content-type", async () => {
    const { app } = createTestApp();

    const response = await app.fetch(new Request("https://sso.example.com/jwks.json"));
    const jwks = await response.json();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^application\/jwk-set\+json/);
    assert.deepEqual(Object.keys(jwks.keys[0]).sort(), ["alg", "e", "kid", "kty", "n", "use"]);
    assert.equal(jwks.keys[0].kty, "RSA");
    assert.equal(jwks.keys[0].alg, "RS256");
  });

  it("管理邀请码端点需要 ADMIN_TOKEN", async () => {
    const { app } = createTestApp();
    const denied = await app.fetch(
      new Request("https://sso.example.com/admin/invite-codes", {
        method: "POST",
        body: JSON.stringify({ code: "JOIN", maxUses: 100 })
      })
    );

    assert.equal(denied.status, 401);

    const created = await app.fetch(
      new Request("https://sso.example.com/admin/invite-codes", {
        method: "POST",
        headers: {
          authorization: "Bearer admin-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ code: "JOIN", maxUses: 100 })
      })
    );

    assert.equal(created.status, 201);
    assert.equal((await created.json()).code, "JOIN");
  });
});

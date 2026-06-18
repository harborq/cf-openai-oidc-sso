import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import worker from "../src/index.js";

describe("Worker 入口设置", () => {
  it("缺少 runtime 设置时会回传设置错误页而不是拋出 Cloudflare 1101", async () => {
    const originalConsoleError = console.error;
    console.error = () => {};

    const response = await worker.fetch(
      new Request("https://sso.example.com/.well-known/openid-configuration"),
      {
        ISSUER: "https://sso.example.com",
        OIDC_CLIENT_ID: "openai-sso",
        ALLOWED_REDIRECT_URIS: "https://external.auth.openai.com/sso/oidc/callback"
      }
    ).finally(() => {
      console.error = originalConsoleError;
    });
    const html = await response.text();

    assert.equal(response.status, 500);
    assert.match(html, /设置错误/);
    assert.match(html, /缺少必要设置：ACCOUNT_DOMAIN/);
  });

  it("直接访问时缺少 runtime 设置也不应拋出 Cloudflare 1101", async () => {
    const originalConsoleError = console.error;
    console.error = () => {};

    const response = await worker.fetch(
      new Request("https://sso.example.com/"),
      {
        ISSUER: "https://sso.example.com",
        OIDC_CLIENT_ID: "openai-sso",
        ALLOWED_REDIRECT_URIS: "https://external.auth.openai.com/sso/oidc/callback",
        OPENAI_LOGIN_URL: "https://chatgpt.com/auth/login?sso=true&connection=conn_test"
      }
    ).finally(() => {
      console.error = originalConsoleError;
    });
    const html = await response.text();

    assert.equal(response.status, 500);
    assert.match(html, /设置错误/);
    assert.match(html, /缺少必要设置：ACCOUNT_DOMAIN/);
  });

  it("discovery endpoint 不应因尚未设置私钥而回传 Cloudflare 1101", async () => {
    const response = await worker.fetch(
      new Request("https://sso.example.com/.well-known/openid-configuration"),
      {
        ISSUER: "https://sso.example.com",
        OIDC_CLIENT_ID: "openai-sso",
        ACCOUNT_DOMAIN: "example.com",
        ALLOWED_REDIRECT_URIS: "https://external.auth.openai.com/sso/oidc/callback"
      }
    );

    const metadata = await response.json();
    assert.equal(response.status, 200);
    assert.equal(metadata.issuer, "https://sso.example.com");
    assert.equal(metadata.jwks_uri, "https://sso.example.com/jwks.json");
  });

  it("discovery endpoint 不应因私钥格式错误而回传 Cloudflare 1101", async () => {
    const response = await worker.fetch(
      new Request("https://sso.example.com/.well-known/openid-configuration"),
      {
        ISSUER: "https://sso.example.com",
        OIDC_CLIENT_ID: "openai-sso",
        ACCOUNT_DOMAIN: "example.com",
        ALLOWED_REDIRECT_URIS: "https://external.auth.openai.com/sso/oidc/callback",
        PRIVATE_JWK: "not-json"
      }
    );

    const metadata = await response.json();
    assert.equal(response.status, 200);
    assert.equal(metadata.issuer, "https://sso.example.com");
  });
});

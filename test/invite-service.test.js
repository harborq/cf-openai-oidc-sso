import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { InviteService } from "../src/invite-service.js";
import { MemoryStore } from "../src/store.js";

const TEST_ACCOUNT_DOMAIN = "example.com";

function createInviteService(store) {
  return new InviteService(store, { accountDomain: TEST_ACCOUNT_DOMAIN });
}

describe("邀请码登录规则", () => {
  it("会使用设置的账号域名建立邮箱", async () => {
    const store = new MemoryStore();
    await store.createInviteCode({ code: "JOIN-100", maxUses: 100 });
    const service = new InviteService(store, { accountDomain: "example.org" });

    const result = await service.registerWithInvite({
      account: "Alice",
      inviteCode: "JOIN-100"
    });

    assert.equal(result.email, "alice@example.org");
    await assert.rejects(
      () =>
        service.registerWithInvite({
          account: "bob@example.com",
          inviteCode: "JOIN-100"
        }),
      /只能使用 @example\.org 账号/
    );
  });

  it("新使用者使用有效邀请码登录时会建立账号并消耗一次", async () => {
    const store = new MemoryStore();
    await store.createInviteCode({ code: "JOIN-100", maxUses: 100 });
    const service = createInviteService(store);

    const result = await service.registerWithInvite({
      account: "Alice",
      displayName: "Alice",
      inviteCode: "JOIN-100"
    });

    assert.equal(result.email, "alice@example.com");
    assert.equal(result.created, true);
    assert.equal((await store.getInviteCode("JOIN-100")).usedCount, 1);
  });

  it("注册时会移除固定邮箱后缀", async () => {
    const store = new MemoryStore();
    await store.createInviteCode({ code: "JOIN-100", maxUses: 100 });
    const service = createInviteService(store);

    const result = await service.registerWithInvite({
      account: "Neko@example.com",
      inviteCode: "JOIN-100"
    });

    assert.equal(result.email, "neko@example.com");
  });

  it("注册时会拒绝其他邮箱域名", async () => {
    const store = new MemoryStore();
    await store.createInviteCode({ code: "JOIN-100", maxUses: 100 });
    const service = createInviteService(store);

    await assert.rejects(
      () =>
        service.registerWithInvite({
          account: "neko@example.org",
          inviteCode: "JOIN-100"
        }),
      /只能使用 @example\.com 账号/
    );
  });

  it("新使用者不需要填名字并会分配固定显示名称", async () => {
    const store = new MemoryStore();
    await store.createInviteCode({ code: "JOIN-100", maxUses: 100 });
    const service = createInviteService(store);

    const result = await service.registerWithInvite({
      account: "name-free",
      inviteCode: "JOIN-100"
    });

    assert.equal(result.displayName, "Neko Maau");
  });

  it("邀请码达到上限后会拒绝建立新使用者", async () => {
    const store = new MemoryStore();
    await store.createInviteCode({ code: "FULL", maxUses: 1 });
    const service = createInviteService(store);

    await service.registerWithInvite({
      account: "first",
      inviteCode: "FULL"
    });

    await assert.rejects(
      () =>
        service.registerWithInvite({
          account: "second",
          inviteCode: "FULL"
        }),
      /邀请码使用次数已达上限/
    );
  });

  it("既有使用者登录只需要账号且不消耗邀请码次数", async () => {
    const store = new MemoryStore();
    await store.createInviteCode({ code: "ONCE", maxUses: 1 });
    const service = createInviteService(store);

    await service.registerWithInvite({
      account: "member",
      inviteCode: "ONCE"
    });

    const result = await service.login({
      account: "MEMBER@example.com"
    });

    assert.equal(result.email, "member@example.com");
    assert.equal(result.created, false);
    assert.equal((await store.getInviteCode("ONCE")).usedCount, 1);
  });

  it("未注册账号登录时会要求先注册", async () => {
    const service = createInviteService(new MemoryStore());

    await assert.rejects(
      () =>
        service.login({
          account: "new-user"
        }),
      /账号不存在，请先注册/
    );
  });
});

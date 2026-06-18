import { normalizeEmail, normalizeInviteCode } from "./store.js";

export class InviteService {
  constructor(store, { accountDomain } = {}) {
    this.store = store;
    this.accountDomain = normalizeAccountDomain(accountDomain);
  }

  async login({ account }) {
    const normalizedEmail = normalizeAccountEmail(account, this.accountDomain);
    const existingUser = await this.store.getUserByEmail(normalizedEmail);
    if (!existingUser) {
      throw new Error("账号不存在，请先注册");
    }

    const user = await this.store.updateUserLogin(normalizedEmail);
    return { ...user, created: false };
  }

  async registerWithInvite({ account, displayName, inviteCode }) {
    const normalizedEmail = normalizeAccountEmail(account, this.accountDomain);
    const existingUser = await this.store.getUserByEmail(normalizedEmail);
    if (existingUser) {
      const user = await this.store.updateUserLogin(normalizedEmail);
      return { ...user, created: false };
    }
    normalizeInviteCode(inviteCode);
    const result = await this.store.createUserWithInvite({
      email: normalizedEmail,
      displayName,
      inviteCode
    });
    return { ...result.user, created: result.created };
  }

  async loginWithInvite({ email, displayName, inviteCode }) {
    return this.registerWithInvite({ account: email, displayName, inviteCode });
  }
}

export function normalizeAccountEmail(account, accountDomain) {
  const normalizedDomain = normalizeAccountDomain(accountDomain);
  const normalized = String(account ?? "").trim().toLowerCase();
  if (!normalized) {
    throw new Error("请输入账号");
  }
  if (normalized.includes("@")) {
    if (!normalized.endsWith(`@${normalizedDomain}`)) {
      throw new Error(`只能使用 @${normalizedDomain} 账号`);
    }
    return normalizeEmail(normalized);
  }
  if (!/^[a-z0-9._+-]+$/.test(normalized)) {
    throw new Error("账号只能包含英文字母、数字、点、下划线、加号与连字号");
  }
  return normalizeEmail(`${normalized}@${normalizedDomain}`);
}

function normalizeAccountDomain(accountDomain) {
  const normalized = String(accountDomain ?? "").trim().toLowerCase().replace(/^@+/, "").replace(/\.+$/, "");
  if (!normalized) {
    throw new Error("缺少必要设置：ACCOUNT_DOMAIN");
  }
  return normalized;
}

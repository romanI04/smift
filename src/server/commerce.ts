import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type BillingPlan = 'starter' | 'growth';

type LedgerKind = 'signup-credit' | 'topup' | 'charge' | 'adjustment';

interface CommerceUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  updatedAt: string;
  plan: BillingPlan;
  credits: number;
}

interface CommerceSessionRecord {
  token: string;
  userId: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

interface CommerceLedgerEntry {
  id: string;
  userId: string;
  at: string;
  kind: LedgerKind;
  creditsDelta: number;
  balanceAfter: number;
  reason: string;
  meta?: Record<string, unknown>;
}

interface CommerceStoreFile {
  updatedAt: string;
  users: CommerceUserRecord[];
  sessions: CommerceSessionRecord[];
  ledger: CommerceLedgerEntry[];
}

export interface CommercePublicUser {
  id: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  plan: BillingPlan;
  credits: number;
}

export interface AuthResult {
  ok: boolean;
  code: number;
  error?: string;
  token?: string;
  user?: CommercePublicUser;
}

interface CommerceMutateResult {
  ok: boolean;
  code: number;
  error?: string;
  user?: CommercePublicUser;
  creditsCharged?: number;
  creditsRemaining?: number;
}

const DEFAULT_SESSION_DAYS = 30;
const PLAN_SIGNUP_CREDITS: Record<BillingPlan, number> = {
  starter: 20,
  growth: 80,
};

export class CommerceStore {
  private readonly filePath: string;
  private state: CommerceStoreFile;

  constructor(outDir: string) {
    this.filePath = path.join(outDir, 'server-commerce.json');
    this.state = this.readStore();
    this.persist();
  }

  signup(emailRaw: string, password: string, planRaw: string): AuthResult {
    const email = normalizeEmail(emailRaw);
    if (!email || !isLikelyEmail(email)) {
      return {ok: false, code: 400, error: 'valid email is required'};
    }
    if (!isStrongEnoughPassword(password)) {
      return {ok: false, code: 400, error: 'password must be at least 8 characters'};
    }

    const existing = this.state.users.find((user) => user.email === email);
    if (existing) {
      return {ok: false, code: 409, error: 'user already exists'};
    }

    const plan = normalizePlan(planRaw);
    const now = new Date().toISOString();
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    const user: CommerceUserRecord = {
      id: newId('usr'),
      email,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: now,
      updatedAt: now,
      plan,
      credits: 0,
    };
    this.state.users.push(user);
    this.addCredits(user.id, PLAN_SIGNUP_CREDITS[plan], 'signup-credit', `${plan} signup credits`);
    const session = this.createSession(user.id);
    this.persist();
    return {
      ok: true,
      code: 201,
      token: session.token,
      user: this.toPublicUser(this.mustGetUser(user.id)),
    };
  }

  login(emailRaw: string, password: string): AuthResult {
    const email = normalizeEmail(emailRaw);
    if (!email || !password) {
      return {ok: false, code: 400, error: 'email and password are required'};
    }
    const user = this.state.users.find((item) => item.email === email);
    if (!user) return {ok: false, code: 401, error: 'invalid credentials'};
    const hash = hashPassword(password, user.passwordSalt);
    if (hash !== user.passwordHash) return {ok: false, code: 401, error: 'invalid credentials'};
    const session = this.createSession(user.id);
    this.persist();
    return {
      ok: true,
      code: 200,
      token: session.token,
      user: this.toPublicUser(user),
    };
  }

  logout(tokenRaw: string): AuthResult {
    const token = normalizeToken(tokenRaw);
    if (!token) return {ok: false, code: 400, error: 'token is required'};
    const before = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter((session) => session.token !== token);
    if (before === this.state.sessions.length) {
      return {ok: false, code: 404, error: 'session not found'};
    }
    this.persist();
    return {ok: true, code: 200};
  }

  authenticate(tokenRaw: string): AuthResult {
    const token = normalizeToken(tokenRaw);
    if (!token) return {ok: false, code: 401, error: 'auth token required'};
    this.pruneExpiredSessions();
    const session = this.state.sessions.find((item) => item.token === token);
    if (!session) return {ok: false, code: 401, error: 'session expired or invalid'};
    const user = this.state.users.find((item) => item.id === session.userId);
    if (!user) return {ok: false, code: 401, error: 'session user missing'};
    session.lastUsedAt = new Date().toISOString();
    this.persist();
    return {ok: true, code: 200, token: session.token, user: this.toPublicUser(user)};
  }

  chargeCredits(userId: string, credits: number, reason: string, meta?: Record<string, unknown>): CommerceMutateResult {
    if (credits <= 0) {
      const user = this.state.users.find((item) => item.id === userId);
      if (!user) return {ok: false, code: 404, error: 'user not found'};
      return {
        ok: true,
        code: 200,
        user: this.toPublicUser(user),
        creditsCharged: 0,
        creditsRemaining: user.credits,
      };
    }
    const user = this.state.users.find((item) => item.id === userId);
    if (!user) return {ok: false, code: 404, error: 'user not found'};
    if (user.credits < credits) {
      return {
        ok: false,
        code: 402,
        error: `insufficient credits (need ${credits}, have ${user.credits})`,
      };
    }
    user.credits -= credits;
    user.updatedAt = new Date().toISOString();
    this.state.ledger.unshift({
      id: newId('led'),
      userId: user.id,
      at: new Date().toISOString(),
      kind: 'charge',
      creditsDelta: -credits,
      balanceAfter: user.credits,
      reason,
      ...(meta ? {meta} : {}),
    });
    this.trimLedger();
    this.persist();
    return {
      ok: true,
      code: 200,
      user: this.toPublicUser(user),
      creditsCharged: credits,
      creditsRemaining: user.credits,
    };
  }

  addTopupCredits(userId: string, creditsRaw: number, reasonRaw: string): CommerceMutateResult {
    const credits = Math.max(0, Math.floor(Number(creditsRaw) || 0));
    if (!credits) return {ok: false, code: 400, error: 'credits must be a positive integer'};
    const reason = String(reasonRaw || '').trim() || 'manual topup';
    const user = this.state.users.find((item) => item.id === userId);
    if (!user) return {ok: false, code: 404, error: 'user not found'};
    this.addCredits(user.id, credits, 'topup', reason);
    this.persist();
    return {
      ok: true,
      code: 200,
      user: this.toPublicUser(this.mustGetUser(userId)),
      creditsCharged: -credits,
      creditsRemaining: this.mustGetUser(userId).credits,
    };
  }

  getBillingSummary(userId: string) {
    const user = this.state.users.find((item) => item.id === userId);
    if (!user) return null;
    const recentLedger = this.state.ledger
      .filter((entry) => entry.userId === user.id)
      .slice(0, 30);
    return {
      user: this.toPublicUser(user),
      pricing: {
        starter: {monthlyUsd: 39, includedCredits: 20},
        growth: {monthlyUsd: 99, includedCredits: 80},
        topup: {usd: 15, credits: 10},
      },
      recentLedger,
    };
  }

  setPlan(userId: string, planRaw: string): CommerceMutateResult {
    const plan = normalizePlan(planRaw);
    const user = this.state.users.find((item) => item.id === userId);
    if (!user) return {ok: false, code: 404, error: 'user not found'};
    user.plan = plan;
    user.updatedAt = new Date().toISOString();
    this.state.ledger.unshift({
      id: newId('led'),
      userId: user.id,
      at: new Date().toISOString(),
      kind: 'adjustment',
      creditsDelta: 0,
      balanceAfter: user.credits,
      reason: `plan changed to ${plan}`,
      meta: {plan},
    });
    this.trimLedger();
    this.persist();
    return {ok: true, code: 200, user: this.toPublicUser(user), creditsRemaining: user.credits};
  }

  private readStore(): CommerceStoreFile {
    const parsed = safeReadJson(this.filePath);
    if (
      parsed
      && typeof parsed === 'object'
      && Array.isArray((parsed as CommerceStoreFile).users)
      && Array.isArray((parsed as CommerceStoreFile).sessions)
      && Array.isArray((parsed as CommerceStoreFile).ledger)
    ) {
      return {
        updatedAt: String((parsed as CommerceStoreFile).updatedAt || new Date(0).toISOString()),
        users: (parsed as CommerceStoreFile).users,
        sessions: (parsed as CommerceStoreFile).sessions,
        ledger: (parsed as CommerceStoreFile).ledger,
      };
    }
    return {
      updatedAt: new Date(0).toISOString(),
      users: [],
      sessions: [],
      ledger: [],
    };
  }

  private persist() {
    this.state.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  private createSession(userId: string): CommerceSessionRecord {
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + DEFAULT_SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const session: CommerceSessionRecord = {
      token: newToken(),
      userId,
      createdAt,
      lastUsedAt: createdAt,
      expiresAt,
    };
    this.state.sessions.push(session);
    this.pruneExpiredSessions();
    return session;
  }

  private pruneExpiredSessions() {
    const now = new Date().toISOString();
    this.state.sessions = this.state.sessions.filter((session) => session.expiresAt > now);
  }

  private addCredits(userId: string, credits: number, kind: LedgerKind, reason: string) {
    const user = this.mustGetUser(userId);
    user.credits += credits;
    user.updatedAt = new Date().toISOString();
    this.state.ledger.unshift({
      id: newId('led'),
      userId: user.id,
      at: new Date().toISOString(),
      kind,
      creditsDelta: credits,
      balanceAfter: user.credits,
      reason,
    });
    this.trimLedger();
  }

  private trimLedger() {
    if (this.state.ledger.length > 5000) {
      this.state.ledger = this.state.ledger.slice(0, 5000);
    }
  }

  private mustGetUser(userId: string): CommerceUserRecord {
    const user = this.state.users.find((item) => item.id === userId);
    if (!user) {
      throw new Error(`user ${userId} not found`);
    }
    return user;
  }

  private toPublicUser(user: CommerceUserRecord): CommercePublicUser {
    return {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      plan: user.plan,
      credits: user.credits,
    };
  }
}

export function parseAuthToken(
  authorizationHeader: string | string[] | undefined,
  xTokenHeader: string | string[] | undefined,
): string {
  const rawAuth = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  const rawToken = Array.isArray(xTokenHeader) ? xTokenHeader[0] : xTokenHeader;
  if (rawAuth && /^bearer\s+/i.test(rawAuth)) {
    return normalizeToken(rawAuth.replace(/^bearer\s+/i, ''));
  }
  return normalizeToken(rawToken || '');
}

function normalizePlan(value: string): BillingPlan {
  return String(value || '').trim().toLowerCase() === 'growth' ? 'growth' : 'starter';
}

function normalizeEmail(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeToken(value: string): string {
  return String(value || '').trim();
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isStrongEnoughPassword(value: string): boolean {
  return String(value || '').length >= 8;
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
}

function newToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeReadJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

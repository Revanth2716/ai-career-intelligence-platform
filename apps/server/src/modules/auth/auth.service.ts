import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { Role } from '@career/shared';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { AuthError, ConflictError, ForbiddenError } from '../../lib/errors.js';

/**
 * Auth service.
 *
 * Security decisions:
 *  - bcrypt cost 12 (~250ms/attempt, brute-force resistant)
 *  - 15-min HS256 access tokens, algorithm pinned at verification (no `none`)
 *  - 7-day refresh tokens stored hashed; rotated on every use; replay of a
 *    rotated token revokes the whole token family (stolen-token containment)
 *  - identical error for unknown email vs wrong password (no user enumeration)
 */
const BCRYPT_COST = 12;

interface AccessClaims {
  sub: string;
  role: Role;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function signAccessToken(userId: string, role: Role): { token: string; expiresAt: Date } {
  const ttlSec = env.ACCESS_TOKEN_TTL_MIN * 60;
  const token = jwt.sign({ sub: userId, role } satisfies AccessClaims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: ttlSec,
  });
  return { token, expiresAt: new Date(Date.now() + ttlSec * 1000) };
}

function newRefreshToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = crypto.randomBytes(48).toString('base64url');
  return {
    token,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
  };
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

export class AuthService {
  async register(input: { email: string; password: string; name: string }, ip?: string) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing !== null) {
      throw new ConflictError('An account with this email already exists');
    }
    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: hashPassword(input.password),
      },
    });
    await this.audit('auth.register', user.id, 'User', user.id, ip);
    return this.issueTokens(user.id, user.role);
  }

  async login(input: { email: string; password: string }, ip?: string) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (user === null || !verifyPassword(input.password, user.passwordHash)) {
      throw new AuthError('Invalid email or password');
    }
    await this.audit('auth.login', user.id, 'User', user.id, ip);
    return this.issueTokens(user.id, user.role);
  }

  /**
   * Refresh-token rotation with reuse detection. The presented token must be
   * valid, unexpired and unrevoked. Presenting an already-rotated token is a
   * replay: the entire token family is revoked immediately.
   */
  async refresh(
    rawRefreshToken: string,
    ip?: string,
  ): Promise<AuthTokens & { user: { id: string; role: Role } }> {
    const tokenHash = sha256(rawRefreshToken);
    const stored = await prisma.refreshToken.findFirst({ where: { tokenHash } });
    if (stored === null) throw new AuthError('Invalid refresh token');

    if (stored.revokedAt !== null) {
      await prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit('auth.refresh.replay', stored.userId, 'RefreshToken', stored.id, ip);
      throw new AuthError('Refresh token reuse detected; all sessions revoked');
    }
    if (stored.expiresAt < new Date()) throw new AuthError('Refresh token expired');

    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (user === null) throw new AuthError('User no longer exists');

    // Atomic rotation: revoke old + create new in one transaction.
    const next = newRefreshToken();
    await prisma.$transaction([
      prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } }),
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: next.tokenHash,
          familyId: stored.familyId,
          expiresAt: next.expiresAt,
        },
      }),
    ]);

    const access = signAccessToken(user.id, user.role);
    return {
      accessToken: access.token,
      refreshToken: next.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      user: { id: user.id, role: user.role },
    };
  }

  async logout(rawRefreshToken: string, ip?: string): Promise<void> {
    const tokenHash = sha256(rawRefreshToken);
    const stored = await prisma.refreshToken.findFirst({ where: { tokenHash } });
    if (stored !== null && stored.revokedAt === null) {
      await prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      await this.audit('auth.logout', stored.userId, 'RefreshToken', stored.id, ip);
    }
    // Idempotent: unknown/expired tokens are a silent no-op.
  }

  async me(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    if (user === null) throw new AuthError('User no longer exists');
    return user;
  }

  async requireAdmin(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role !== 'ADMIN') throw new ForbiddenError('Admin role required');
  }

  private async issueTokens(userId: string, role: Role): Promise<AuthTokens> {
    const refresh = newRefreshToken();
    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: refresh.tokenHash,
        familyId: crypto.randomUUID(),
        expiresAt: refresh.expiresAt,
      },
    });
    const access = signAccessToken(userId, role);
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
    };
  }

  private async audit(action: string, userId: string, entity: string, entityId: string, ip?: string) {
    await prisma.auditLog.create({
      data: { action, userId, entity, entityId, ip },
    });
  }
}

# Auth Service Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Décomposer `AuthService` (603 lignes) en 3 services spécialisés (`AuthService` core, `AuthTokenService`, `AuthPasswordService`) et mettre à jour module et controller.

**Architecture:** `AuthController` injecte 3 services : `AuthService` (validateUser, login), `AuthTokenService` (refresh token lifecycle), `AuthPasswordService` (password flows). `AuthPasswordService` injecte `AuthTokenService` car `resetPassword` appelle `revokeAllUserTokens`.

**Tech Stack:** NestJS, Prisma, JWT (`@nestjs/jwt`), bcrypt, crypto, Jest avec mocks manuels.

---

## Files

- Create: `apps/backend/src/auth/auth-token.service.ts`
- Create: `apps/backend/src/auth/auth-token.service.spec.ts`
- Create: `apps/backend/src/auth/auth-password.service.ts`
- Create: `apps/backend/src/auth/auth-password.service.spec.ts`
- Modify: `apps/backend/src/auth/auth.service.ts`
- Modify: `apps/backend/src/auth/auth.service.spec.ts`
- Modify: `apps/backend/src/auth/auth.module.ts`
- Modify: `apps/backend/src/auth/auth.controller.ts`

---

### Task 1: Créer AuthTokenService avec spec

**Files:**

- Create: `apps/backend/src/auth/auth-token.service.ts`
- Create: `apps/backend/src/auth/auth-token.service.spec.ts`

- [x] **Step 1: Écrire le test qui échoue**

Créer `apps/backend/src/auth/auth-token.service.spec.ts` :

```typescript
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthTokenService } from './auth-token.service';

describe('AuthTokenService', () => {
  let service: AuthTokenService;
  let module: TestingModule;

  const mockPrismaService = {
    refreshToken: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        AuthTokenService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthTokenService>(AuthTokenService);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('refreshAccessToken', () => {
    it('should return new tokens when refresh token is valid', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      mockPrismaService.refreshToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        token: 'old-refresh',
        revoked: false,
        expiresAt: futureDate,
        user: {
          id: 'u1',
          email: 'u@test.com',
          firstName: 'First',
          lastName: 'Last',
          role: UserRole.LICENSEE,
          clubName: 'Club',
          license: { number: 'L1' },
        },
      });
      mockPrismaService.$transaction.mockResolvedValue([
        {},
        { token: 'new-refresh', userId: 'u1' },
      ]);
      mockJwtService.sign.mockReturnValue('new-access');

      const result = await service.refreshAccessToken('old-refresh');

      expect(result).toEqual({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        user: expect.objectContaining({
          id: 'u1',
          email: 'u@test.com',
          licenseNumber: 'L1',
        }),
      });
    });

    it('should throw when refresh token is invalid', async () => {
      mockPrismaService.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refreshAccessToken('invalid-token')).rejects.toThrow(
        'Invalid or expired refresh token',
      );
    });

    it('should throw when refresh token is revoked', async () => {
      mockPrismaService.refreshToken.findUnique.mockResolvedValue({
        id: 't1',
        revoked: true,
        expiresAt: new Date(Date.now() + 86400000),
      });
      await expect(service.refreshAccessToken('revoked-token')).rejects.toThrow(
        'Invalid or expired refresh token',
      );
    });
  });

  describe('revokeRefreshToken', () => {
    it('should return true when token revoked', async () => {
      mockPrismaService.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      const result = await service.revokeRefreshToken('token');
      expect(result).toBe(true);
    });

    it('should return false when token not found', async () => {
      mockPrismaService.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      const result = await service.revokeRefreshToken('unknown');
      expect(result).toBe(false);
    });
  });

  describe('revokeAllUserTokens', () => {
    it('should return count of revoked tokens', async () => {
      mockPrismaService.refreshToken.updateMany.mockResolvedValue({ count: 3 });
      const result = await service.revokeAllUserTokens('user-1');
      expect(result).toBe(3);
    });
  });
});
```

- [x] **Step 2: Vérifier que le test échoue**

```bash
cd apps/backend && npx jest auth-token.service.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './auth-token.service'`

- [x] **Step 3: Créer AuthTokenService**

Créer `apps/backend/src/auth/auth-token.service.ts` :

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginResponse } from './auth.service';

@Injectable()
export class AuthTokenService {
  private readonly REFRESH_TOKEN_EXPIRY_DAYS = 30;
  private readonly ACCESS_TOKEN_EXPIRY_MINUTES = 60;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async createRefreshToken(userId: string) {
    const token = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.REFRESH_TOKEN_EXPIRY_DAYS);

    await this.cleanupExpiredTokens(userId);

    return this.prisma.refreshToken.create({
      data: {
        token,
        userId,
        expiresAt,
      },
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<LoginResponse> {
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            clubId: true,
            clubName: true,
            category: true,
            ageGroup: true,
            passportLevelLatin: true,
            passportLevelStandard: true,
            license: {
              select: {
                number: true,
              },
            },
          },
        },
      },
    });

    if (!tokenRecord || tokenRecord.revoked || tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = tokenRecord.user;

    const token = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.REFRESH_TOKEN_EXPIRY_DAYS);

    const [, newRefreshToken] = await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: tokenRecord.id },
        data: { revoked: true, revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: { token, userId: user.id, expiresAt },
      }),
    ]);

    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      clubName: user.clubName,
    };
    const access_token = this.jwtService.sign(payload, {
      expiresIn: `${this.ACCESS_TOKEN_EXPIRY_MINUTES}m`,
    });

    return {
      access_token,
      refresh_token: newRefreshToken.token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        clubId: user.clubId,
        clubName: user.clubName,
        licenseNumber: user.license?.number,
        category: user.category ?? null,
        ageGroup: user.ageGroup ?? null,
        passportLevelLatin: user.passportLevelLatin ?? null,
        passportLevelStandard: user.passportLevelStandard ?? null,
      },
    };
  }

  async revokeRefreshToken(refreshToken: string): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        token: refreshToken,
        revoked: false,
      },
      data: {
        revoked: true,
        revokedAt: new Date(),
      },
    });

    return result.count > 0;
  }

  async revokeAllUserTokens(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revoked: false,
      },
      data: {
        revoked: true,
        revokedAt: new Date(),
      },
    });

    return result.count;
  }

  private async cleanupExpiredTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: {
        userId,
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  }
}
```

- [x] **Step 4: Vérifier que les tests passent**

```bash
cd apps/backend && npx jest auth-token.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 8 tests

- [x] **Step 5: Commit**

```bash
cd apps/backend && git add src/auth/auth-token.service.ts src/auth/auth-token.service.spec.ts
git commit -m "feat(auth): create AuthTokenService with refresh token lifecycle"
```

---

### Task 2: Créer AuthPasswordService avec spec

**Files:**

- Create: `apps/backend/src/auth/auth-password.service.ts`
- Create: `apps/backend/src/auth/auth-password.service.spec.ts`

- [x] **Step 1: Écrire le test qui échoue**

Créer `apps/backend/src/auth/auth-password.service.spec.ts` :

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';
import { AuthPasswordService } from './auth-password.service';
import { AuthTokenService } from './auth-token.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
  getRounds: jest.fn(),
}));

describe('AuthPasswordService', () => {
  let service: AuthPasswordService;
  let module: TestingModule;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    passwordResetToken: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockEmailService = {
    sendPasswordResetEmail: jest.fn(),
  };

  const mockAuthTokenService = {
    revokeAllUserTokens: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        AuthPasswordService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: AuthTokenService, useValue: mockAuthTokenService },
      ],
    }).compile();

    service = module.get<AuthPasswordService>(AuthPasswordService);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('forgotPassword', () => {
    it('should return success when user not found (security)', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      const result = await service.forgotPassword('unknown@test.com');
      expect(result).toEqual({ success: true });
      expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('should send email when user exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'u@test.com',
      });
      mockPrismaService.passwordResetToken.updateMany.mockResolvedValue({});
      mockPrismaService.passwordResetToken.create.mockResolvedValue({});

      const result = await service.forgotPassword('u@test.com');

      expect(result).toEqual({ success: true });
      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'u@test.com',
        expect.any(String),
      );
    });
  });

  describe('resetPassword', () => {
    it('should throw when password invalid', async () => {
      await expect(service.resetPassword('token', 'short')).rejects.toThrow(
        'Le mot de passe ne respecte pas',
      );
    });

    it('should throw when token invalid', async () => {
      mockPrismaService.passwordResetToken.findUnique.mockResolvedValue(null);
      await expect(service.resetPassword('bad-token', 'ValidPass1!')).rejects.toThrow(
        'Token de réinitialisation invalide',
      );
    });

    it('should reset password when token valid', async () => {
      const futureDate = new Date(Date.now() + 3600000);
      mockPrismaService.passwordResetToken.findUnique.mockResolvedValue({
        id: 'rt1',
        userId: 'u1',
        used: false,
        expiresAt: futureDate,
      });
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
      mockPrismaService.user.update.mockResolvedValue({});
      mockPrismaService.passwordResetToken.update.mockResolvedValue({});
      mockAuthTokenService.revokeAllUserTokens.mockResolvedValue(0);

      const result = await service.resetPassword('valid-token', 'ValidPass1!');

      expect(result).toEqual({ success: true });
      expect(mockPrismaService.user.update).toHaveBeenCalled();
      expect(mockAuthTokenService.revokeAllUserTokens).toHaveBeenCalledWith('u1');
    });

    it('should throw when token already used', async () => {
      mockPrismaService.passwordResetToken.findUnique.mockResolvedValue({
        id: 'rt1',
        used: true,
      });
      await expect(service.resetPassword('used-token', 'ValidPass1!')).rejects.toThrow(
        'Token de réinitialisation invalide',
      );
    });

    it('should throw when token expired', async () => {
      const pastDate = new Date(Date.now() - 3600000);
      mockPrismaService.passwordResetToken.findUnique.mockResolvedValue({
        id: 'rt1',
        used: false,
        expiresAt: pastDate,
      });
      await expect(service.resetPassword('expired-token', 'ValidPass1!')).rejects.toThrow(
        'Token de réinitialisation invalide',
      );
    });
  });

  describe('changePassword', () => {
    it('should throw when user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.changePassword('u1', 'OldPass1!', 'NewValid1!')).rejects.toThrow(
        'Utilisateur non trouvé',
      );
    });

    it('should throw when current password wrong', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'u1',
        password: 'hashed',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(service.changePassword('u1', 'WrongPass1!', 'NewValid1!')).rejects.toThrow(
        'Mot de passe actuel incorrect',
      );
    });

    it('should change password when valid', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'u1',
        password: 'hashed-old',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-new');
      mockPrismaService.user.update.mockResolvedValue({});

      const result = await service.changePassword('u1', 'OldPass1!', 'NewValid1!');

      expect(result).toEqual({ success: true });
      expect(mockPrismaService.user.update).toHaveBeenCalled();
    });

    it('should throw when new password is same as old', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'u1',
        password: 'hashed',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(service.changePassword('u1', 'OldPass1!', 'OldPass1!')).rejects.toThrow(
        'Le nouveau mot de passe doit être différent',
      );
    });

    it('should throw when new password does not meet policy', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'u1',
        password: 'hashed',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      await expect(service.changePassword('u1', 'OldPass1!', 'short')).rejects.toThrow(
        'Le mot de passe ne respecte pas',
      );
    });
  });
});
```

- [x] **Step 2: Vérifier que le test échoue**

```bash
cd apps/backend && npx jest auth-password.service.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './auth-password.service'`

- [x] **Step 3: Créer AuthPasswordService**

Créer `apps/backend/src/auth/auth-password.service.ts` :

```typescript
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';
import { AuthTokenService } from './auth-token.service';
import { PasswordValidator } from './password-validator';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthPasswordService {
  private readonly PASSWORD_RESET_TOKEN_EXPIRY_HOURS = 1;

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private authTokenService: AuthTokenService,
  ) {}

  async forgotPassword(email: string): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return { success: true };
    }

    await this.prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        used: false,
      },
      data: {
        used: true,
        usedAt: new Date(),
      },
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.PASSWORD_RESET_TOKEN_EXPIRY_HOURS);

    await this.prisma.passwordResetToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt,
      },
    });

    await this.emailService.sendPasswordResetEmail(email, token);

    return { success: true };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ success: boolean }> {
    const validation = PasswordValidator.validate(newPassword);
    if (!validation.isValid) {
      throw new BadRequestException({
        message: 'Le mot de passe ne respecte pas la politique de sécurité',
        errors: validation.errors,
      });
    }

    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken || resetToken.used || resetToken.expiresAt < new Date()) {
      throw new BadRequestException('Token de réinitialisation invalide, expiré ou déjà utilisé');
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: resetToken.userId },
      data: { password: hashedPassword },
    });

    await this.prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: {
        used: true,
        usedAt: new Date(),
      },
    });

    await this.authTokenService.revokeAllUserTokens(resetToken.userId);

    return { success: true };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Mot de passe actuel incorrect');
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      throw new BadRequestException("Le nouveau mot de passe doit être différent de l'ancien");
    }

    const validation = PasswordValidator.validate(newPassword);
    if (!validation.isValid) {
      throw new BadRequestException({
        message: 'Le mot de passe ne respecte pas la politique de sécurité',
        errors: validation.errors,
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return { success: true };
  }
}
```

- [x] **Step 4: Vérifier que les tests passent**

```bash
cd apps/backend && npx jest auth-password.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 11 tests

- [x] **Step 5: Commit**

```bash
cd apps/backend && git add src/auth/auth-password.service.ts src/auth/auth-password.service.spec.ts
git commit -m "feat(auth): create AuthPasswordService with password flows"
```

---

### Task 3: Slim down AuthService et mettre à jour sa spec

**Files:**

- Modify: `apps/backend/src/auth/auth.service.ts`
- Modify: `apps/backend/src/auth/auth.service.spec.ts`

- [x] **Step 1: Réécrire auth.service.ts (version slimmée)**

Remplacer le contenu de `apps/backend/src/auth/auth.service.ts` :

```typescript
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthTokenService } from './auth-token.service';

const BCRYPT_ROUNDS = 12;

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    clubId?: string | null;
    clubName: string | null;
    licenseNumber?: string | null;
    category?: string | null;
    ageGroup?: string | null;
    passportLevelLatin?: string | null;
    passportLevelStandard?: string | null;
  };
}

@Injectable()
export class AuthService {
  private readonly ACCESS_TOKEN_EXPIRY_MINUTES = 60;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private authTokenService: AuthTokenService,
  ) {}

  async validateUser(email: string, pass: string): Promise<Omit<User, 'password'> | null> {
    const fullSelect = {
      id: true,
      email: true,
      password: true,
      firstName: true,
      lastName: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      ageGroup: true,
      category: true,
      clubId: true,
      clubName: true,
      birthDate: true,
      nationalRanking: true,
      passportLevelLatin: true,
      passportLevelStandard: true,
      competitionLevel: true,
      license: {
        select: {
          id: true,
          number: true,
          validUntil: true,
          category: true,
          clubName: true,
          qrCodeSignature: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    } as const;

    let user: { password: string; [k: string]: unknown } | null = null;
    try {
      user = await this.prisma.user.findUnique({
        where: { email },
        select: fullSelect,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.message.includes('does not exist') || err.code === 'P2021')
      ) {
        user = await this.prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            password: true,
            firstName: true,
            lastName: true,
            role: true,
            createdAt: true,
            updatedAt: true,
            ageGroup: true,
            category: true,
            clubName: true,
          },
        });
      } else {
        throw err;
      }
    }

    if (user && (await bcrypt.compare(pass, user.password))) {
      const currentRounds = bcrypt.getRounds(user.password);
      if (currentRounds < BCRYPT_ROUNDS) {
        bcrypt
          .hash(pass, BCRYPT_ROUNDS)
          .then((newHash) =>
            this.prisma.user.update({
              where: { id: user.id as string },
              data: { password: newHash },
            }),
          )
          .catch((err: unknown) => {
            console.warn(
              { err, userId: user.id },
              'Silent bcrypt rehash failed — login not affected',
            );
          });
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...result } = user;
      return result as Omit<User, 'password'>;
    }
    return null;
  }

  async login(
    user: Omit<User, 'password'> & {
      license?: { number: string | null } | null;
    },
  ): Promise<LoginResponse> {
    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      clubName: user.clubName,
    };

    const access_token = this.jwtService.sign(payload, {
      expiresIn: `${this.ACCESS_TOKEN_EXPIRY_MINUTES}m`,
    });

    const refreshToken = await this.authTokenService.createRefreshToken(user.id);

    return {
      access_token,
      refresh_token: refreshToken.token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        clubId: user.clubId,
        clubName: user.clubName,
        licenseNumber: user.license?.number,
        category: user.category ?? null,
        ageGroup: user.ageGroup ?? null,
        passportLevelLatin: user.passportLevelLatin ?? null,
        passportLevelStandard: user.passportLevelStandard ?? null,
      },
    };
  }
}
```

- [x] **Step 2: Réécrire auth.service.spec.ts (garder uniquement validateUser et login)**

Remplacer le contenu de `apps/backend/src/auth/auth.service.spec.ts` :

```typescript
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
  getRounds: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let module: TestingModule;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  const mockAuthTokenService = {
    createRefreshToken: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: AuthTokenService, useValue: mockAuthTokenService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser', () => {
    it('should return user without password if validation succeeds', async () => {
      const mockUser = {
        id: 'u1',
        email: 'test@example.com',
        password: 'hashedpassword',
        firstName: 'Test',
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('test@example.com', 'password');
      expect(result).toEqual({
        id: 'u1',
        email: 'test@example.com',
        firstName: 'Test',
      });
    });

    it('should return null if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      const result = await service.validateUser('notfound@example.com', 'password');
      expect(result).toBeNull();
    });

    it('should return null if password mismatch', async () => {
      const mockUser = {
        id: 'u1',
        password: 'hashedpassword',
      };
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser('test@example.com', 'wrongpassword');
      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should return access token, refresh token and user info', async () => {
      const mockUser = {
        id: 'u1',
        email: 'test@example.com',
        role: UserRole.LICENSEE,
        clubName: 'Club',
        firstName: 'First',
        lastName: 'Last',
        license: { number: 'LIC123' },
        password: 'hashedpassword',
        createdAt: new Date(),
        updatedAt: new Date(),
        ageGroup: null,
        category: null,
        birthDate: null,
        nationalRanking: null,
      };

      mockJwtService.sign.mockReturnValue('jwt-token');
      mockAuthTokenService.createRefreshToken.mockResolvedValue({
        id: 'token-id',
        token: 'refresh-token',
        userId: 'u1',
        expiresAt: new Date(),
        revoked: false,
        revokedAt: null,
      });

      const result = await service.login(mockUser as never);

      expect(result).toEqual({
        access_token: 'jwt-token',
        refresh_token: 'refresh-token',
        user: expect.objectContaining({
          id: 'u1',
          email: 'test@example.com',
          licenseNumber: 'LIC123',
        }) as unknown,
      });
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'u1',
          email: 'test@example.com',
        }),
        expect.objectContaining({
          expiresIn: expect.any(String),
        }),
      );
      expect(mockAuthTokenService.createRefreshToken).toHaveBeenCalledWith('u1');
    });
  });

  describe('validateUser — rehash bcrypt transparent', () => {
    it('should rehash password with 12 rounds when existing hash has fewer rounds', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        password: 'hashed-with-6-rounds',
        firstName: 'Test',
        lastName: 'User',
        role: 'LICENSEE',
        createdAt: new Date(),
        updatedAt: new Date(),
        ageGroup: null,
        category: null,
        clubId: null,
        clubName: null,
        birthDate: null,
        nationalRanking: null,
        passportLevelLatin: null,
        passportLevelStandard: null,
        competitionLevel: null,
        license: null,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.update = jest.fn().mockResolvedValue(mockUser);

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.getRounds as jest.Mock).mockReturnValue(6);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash-12-rounds');

      await service.validateUser('test@example.com', 'password');

      expect(bcrypt.hash).toHaveBeenCalledWith('password', 12);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { password: 'new-hash-12-rounds' },
      });
    });

    it('should not throw when rehash DB update fails', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        password: 'hashed-with-6-rounds',
        firstName: 'Test',
        lastName: 'User',
        role: 'LICENSEE',
        createdAt: new Date(),
        updatedAt: new Date(),
        ageGroup: null,
        category: null,
        clubId: null,
        clubName: null,
        birthDate: null,
        nationalRanking: null,
        passportLevelLatin: null,
        passportLevelStandard: null,
        competitionLevel: null,
        license: null,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.update = jest.fn().mockRejectedValue(new Error('DB timeout'));

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.getRounds as jest.Mock).mockReturnValue(6);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash-12-rounds');

      const result = await service.validateUser('test@example.com', 'password');
      expect(result).not.toBeNull();
    });

    it('should NOT rehash password when existing hash already has 12 rounds', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        password: 'hashed-with-12-rounds',
        firstName: 'Test',
        lastName: 'User',
        role: 'LICENSEE',
        createdAt: new Date(),
        updatedAt: new Date(),
        ageGroup: null,
        category: null,
        clubId: null,
        clubName: null,
        birthDate: null,
        nationalRanking: null,
        passportLevelLatin: null,
        passportLevelStandard: null,
        competitionLevel: null,
        license: null,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.update = jest.fn();

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.getRounds as jest.Mock).mockReturnValue(12);

      await service.validateUser('test@example.com', 'password');

      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });
  });
});
```

- [x] **Step 3: Vérifier que les tests passent**

```bash
cd apps/backend && npx jest auth.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 8 tests

- [x] **Step 4: Vérifier que toutes les suites de tests auth passent**

```bash
cd apps/backend && npx jest src/auth --no-coverage 2>&1 | tail -15
```

Expected: PASS — auth.service, auth-token.service, auth-password.service

- [x] **Step 5: Commit**

```bash
cd apps/backend && git add src/auth/auth.service.ts src/auth/auth.service.spec.ts
git commit -m "refactor(auth): slim down AuthService to validateUser and login only"
```

---

### Task 4: Mettre à jour AuthModule

**Files:**

- Modify: `apps/backend/src/auth/auth.module.ts`

- [x] **Step 1: Mettre à jour auth.module.ts**

Remplacer le contenu de `apps/backend/src/auth/auth.module.ts` :

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { AuthController } from './auth.controller';
import { AuthPasswordService } from './auth-password.service';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { jwtConstants } from './constants';
import { EmailService } from './email.service';
import { JwtStrategy } from './jwt.strategy';
import { SessionCleanupService } from './session-cleanup.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: '60m' },
    }),
  ],
  providers: [
    AuthService,
    AuthTokenService,
    AuthPasswordService,
    PrismaService,
    JwtStrategy,
    SessionCleanupService,
    EmailService,
  ],
  controllers: [AuthController],
  exports: [AuthService, AuthTokenService, AuthPasswordService],
})
export class AuthModule {}
```

- [x] **Step 2: Vérifier que les tests passent toujours**

```bash
cd apps/backend && npx jest src/auth --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [x] **Step 3: Commit**

```bash
cd apps/backend && git add src/auth/auth.module.ts
git commit -m "feat(auth): update AuthModule with AuthTokenService and AuthPasswordService"
```

---

### Task 5: Mettre à jour AuthController

**Files:**

- Modify: `apps/backend/src/auth/auth.controller.ts`

- [x] **Step 1: Mettre à jour auth.controller.ts**

Remplacer le contenu de `apps/backend/src/auth/auth.controller.ts` :

```typescript
import { Body, Controller, Post, Request, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrorResponses } from '../common/decorators/api-error-responses.decorator';
import { AuthPasswordService } from './auth-password.service';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import type { RequestWithUser } from './interfaces/jwt-payload.interface';
import { JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
@ApiCommonErrorResponses()
export class AuthController {
  constructor(
    private authService: AuthService,
    private authTokenService: AuthTokenService,
    private authPasswordService: AuthPasswordService,
  ) {}

  @Post('login')
  @ApiOperation({
    summary: 'Authentifie un utilisateur',
    description:
      "Valide les identifiants (username/email et mot de passe) et retourne un access token JWT, un refresh token ainsi que les informations de l'utilisateur.",
  })
  // @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Authentification réussie',
    schema: {
      type: 'object',
      properties: {
        access_token: {
          type: 'string',
          description:
            "Token JWT pour l'authentification des requêtes suivantes (expire en 60 minutes)",
          example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        },
        refresh_token: {
          type: 'string',
          description: 'Refresh token pour obtenir un nouveau access token (expire en 30 jours)',
          example: 'a1b2c3d4e5f6...',
        },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            role: {
              type: 'string',
              enum: ['LICENSEE', 'CLUB', 'STAFF', 'ADMIN'],
            },
            clubName: { type: 'string', nullable: true },
            licenseNumber: { type: 'string', nullable: true },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Identifiants invalides',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Invalid credentials' },
        error: { type: 'string', example: 'Unauthorized' },
        timestamp: { type: 'string', example: '2026-02-11T17:00:00.000Z' },
        path: { type: 'string', example: '/auth/login' },
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Trop de tentatives de connexion. Rate limit dépassé.',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 429 },
        message: { type: 'string', example: 'Too many requests' },
      },
    },
  })
  async login(@Body() body: LoginDto): Promise<import('./auth.service').LoginResponse> {
    const user = await this.authService.validateUser(body.username, body.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Rafraîchit un access token',
    description:
      'Utilise un refresh token valide pour obtenir un nouveau access token et un nouveau refresh token. Implémente la rotation des tokens pour la sécurité.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        refresh_token: {
          type: 'string',
          description: 'Le refresh token à utiliser',
          example: 'a1b2c3d4e5f6...',
        },
      },
      required: ['refresh_token'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Tokens rafraîchis avec succès',
    schema: {
      type: 'object',
      properties: {
        access_token: {
          type: 'string',
          description: 'Nouveau access token JWT',
        },
        refresh_token: {
          type: 'string',
          description: "Nouveau refresh token (l'ancien est révoqué)",
        },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            role: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh token invalide, expiré ou révoqué',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 401 },
        message: {
          type: 'string',
          example: 'Invalid or expired refresh token',
        },
        error: { type: 'string', example: 'Unauthorized' },
      },
    },
  })
  async refresh(@Body() body: RefreshTokenDto): Promise<import('./auth.service').LoginResponse> {
    return this.authTokenService.refreshAccessToken(body.refresh_token);
  }

  @Post('logout')
  @ApiOperation({
    summary: 'Déconnexion',
    description: "Révoque un refresh token pour déconnecter l'utilisateur de manière sécurisée.",
  })
  @ApiBearerAuth('JWT-auth')
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({
    status: 200,
    description: 'Déconnexion réussie',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Logged out successfully' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh token invalide',
  })
  async logout(@Body() body: RefreshTokenDto): Promise<{ success: boolean; message: string }> {
    const revoked = await this.authTokenService.revokeRefreshToken(body.refresh_token);
    if (!revoked) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: 'Demande de réinitialisation de mot de passe',
    description:
      "Envoie un email avec un lien de réinitialisation de mot de passe. Pour des raisons de sécurité, ne révèle pas si l'email existe ou non.",
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({
    status: 200,
    description: "Email de réinitialisation envoyé (si l'email existe)",
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
      },
    },
  })
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authPasswordService.forgotPassword(body.email);
  }

  @Post('reset-password')
  @ApiOperation({
    summary: 'Réinitialise le mot de passe avec un token',
    description:
      'Réinitialise le mot de passe en utilisant le token reçu par email. Le token expire après 1 heure.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Mot de passe réinitialisé avec succès',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Token invalide, expiré ou déjà utilisé, ou mot de passe invalide',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string' },
        errors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Liste des erreurs de validation du mot de passe',
        },
      },
    },
  })
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authPasswordService.resetPassword(body.token, body.newPassword);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Change le mot de passe (utilisateur authentifié)',
    description:
      'Permet à un utilisateur authentifié de changer son mot de passe. Nécessite le mot de passe actuel.',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Mot de passe modifié avec succès',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Mot de passe actuel incorrect',
  })
  @ApiResponse({
    status: 400,
    description: 'Le nouveau mot de passe ne respecte pas la politique de sécurité',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string' },
        errors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Liste des erreurs de validation du mot de passe',
        },
      },
    },
  })
  async changePassword(@Request() req: RequestWithUser, @Body() body: ChangePasswordDto) {
    return this.authPasswordService.changePassword(
      req.user.userId,
      body.currentPassword,
      body.newPassword,
    );
  }
}
```

- [x] **Step 2: Vérifier que la suite de tests complète passe**

```bash
cd apps/backend && npx jest --no-coverage 2>&1 | tail -20
```

Expected: toutes les suites passent

- [x] **Step 3: Vérifier le typecheck TypeScript**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: aucune erreur

- [x] **Step 4: Commit**

```bash
cd apps/backend && git add src/auth/auth.controller.ts
git commit -m "refactor(auth): update AuthController to inject 3 specialized services"
```

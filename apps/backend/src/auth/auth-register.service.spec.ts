import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";
import { AuthTokenService } from "./auth-token.service";

describe("AuthService.register", () => {
  let authService: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock };
    license: { findUnique: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let authTokenService: { createRefreshToken: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
      license: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    };
    configService = { get: jest.fn().mockReturnValue(undefined) };
    authTokenService = {
      createRefreshToken: jest.fn().mockResolvedValue({ token: "refresh-tok" }),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue("jwt-tok") },
        },
        { provide: AuthTokenService, useValue: authTokenService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    authService = module.get(AuthService);
  });

  // Relative to now, never a literal: a hardcoded date silently turns this
  // fixture into an expired licence once it passes, and register() then throws
  // instead of succeeding (it did, on 2026-08-31).
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  const validLicense = {
    id: "lic-1",
    number: "FFD-2025-001",
    validUntil: new Date(Date.now() + ONE_YEAR_MS),
    category: "Latin",
    clubName: "Club Paris Danse",
    userId: null,
  };

  it("registers a new user with a valid unclaimed license", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.license.findUnique.mockResolvedValue(validLicense);
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          user: {
            create: jest.fn().mockResolvedValue({
              id: "user-1",
              email: "test@example.com",
              firstName: "",
              lastName: "Dupont",
              role: "LICENSEE",
              clubId: null,
              clubName: "Club Paris Danse",
              category: "Latin",
              ageGroup: null,
              passportLevelLatin: null,
              passportLevelStandard: null,
            }),
          },
          license: { update: jest.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      },
    );

    const result = await authService.register(
      "Test@Example.COM",
      "MonPass1!abc",
      "FFD-2025-001",
      "Dupont",
    );

    expect(result.access_token).toBe("jwt-tok");
    expect(result.refresh_token).toBe("refresh-tok");
    expect(result.user.email).toBe("test@example.com");
    expect(result.user.clubName).toBe("Club Paris Danse");
  });

  it("rejects if email already exists", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "existing" });

    await expect(
      authService.register(
        "taken@example.com",
        "MonPass1!abc",
        "FFD-2025-001",
        "Dupont",
      ),
    ).rejects.toThrow(ConflictException);
  });

  it("rejects if license number not found", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.license.findUnique.mockResolvedValue(null);

    await expect(
      authService.register(
        "new@example.com",
        "MonPass1!abc",
        "INVALID-NUM",
        "Dupont",
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects if license already claimed", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.license.findUnique.mockResolvedValue({
      ...validLicense,
      userId: "other-user",
    });

    await expect(
      authService.register(
        "new@example.com",
        "MonPass1!abc",
        "FFD-2025-001",
        "Dupont",
      ),
    ).rejects.toThrow(ConflictException);
  });

  it("rejects if license expired", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.license.findUnique.mockResolvedValue({
      ...validLicense,
      validUntil: new Date("2020-01-01"),
    });

    await expect(
      authService.register(
        "new@example.com",
        "MonPass1!abc",
        "FFD-2025-001",
        "Dupont",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects weak password", async () => {
    await expect(
      authService.register("new@example.com", "weak", "FFD-2025-001", "Dupont"),
    ).rejects.toThrow(BadRequestException);
  });

  it("normalizes email to lowercase", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.license.findUnique.mockResolvedValue(validLicense);
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const createMock = jest.fn().mockResolvedValue({
          id: "user-1",
          email: "upper@example.com",
          firstName: "",
          lastName: "Dupont",
          role: "LICENSEE",
          clubId: null,
          clubName: "Club Paris Danse",
          category: "Latin",
          ageGroup: null,
          passportLevelLatin: null,
          passportLevelStandard: null,
        });
        const tx = {
          user: { create: createMock },
          license: { update: jest.fn().mockResolvedValue({}) },
        };
        const result = await fn(tx);
        // Verify the email was normalized
        expect(createMock).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ email: "upper@example.com" }),
          }),
        );
        return result;
      },
    );

    await authService.register(
      "UPPER@EXAMPLE.COM",
      "MonPass1!abc",
      "FFD-2025-001",
      "Dupont",
    );

    // Verify findUnique was called with normalized email
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "upper@example.com" } }),
    );
  });
  describe("birthDate derived from the licence number (#60)", () => {
    const createdUser = {
      id: "user-1",
      email: "new@example.com",
      firstName: "",
      lastName: "Dupont",
      role: "LICENSEE",
      clubId: null,
      clubName: "Club Paris Danse",
      category: "Latin",
      ageGroup: null,
      passportLevelLatin: null,
      passportLevelStandard: null,
    };

    /** Registers against `number` and returns the `tx.user.create` mock. */
    const registerWithLicenseNumber = async (number: string) => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.license.findUnique.mockResolvedValue({ ...validLicense, number });
      const createMock = jest.fn().mockResolvedValue(createdUser);
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            user: { create: createMock },
            license: { update: jest.fn().mockResolvedValue({}) },
          }),
      );

      await authService.register(
        "new@example.com",
        "MonPass1!abc",
        number,
        "Dupont",
      );
      return createMock;
    };

    const birthDateOf = (createMock: jest.Mock): unknown =>
      createMock.mock.calls[0][0].data.birthDate;

    it("stores the date encoded in a conforming number", async () => {
      const createMock = await registerWithLicenseNumber("20051203-dup-ga42");

      expect(birthDateOf(createMock)).toEqual(
        new Date("2005-12-03T00:00:00.000Z"),
      );
    });

    // Regression guard for #60: a number that does not carry a date must leave
    // birthDate null. null means "we do not know" — never "adult" (see #61/#23).
    it.each([
      ["the test fixture number", "TEST-LICENSEE-001"],
      ["a legacy-grammar number", "FFD-2025-001"],
      ["an impossible encoded date", "20250231-dup-ga42"],
    ])("leaves birthDate null for %s", async (_label, number) => {
      const createMock = await registerWithLicenseNumber(number);

      expect(birthDateOf(createMock)).toBe(null);
    });

    it("derives the date from the stored licence, not from user input", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.license.findUnique.mockResolvedValue({
        ...validLicense,
        number: "20051203-dup-ga42",
      });
      const createMock = jest.fn().mockResolvedValue(createdUser);
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            user: { create: createMock },
            license: { update: jest.fn().mockResolvedValue({}) },
          }),
      );

      await authService.register(
        "new@example.com",
        "MonPass1!abc",
        "  20051203-DUP-GA42  ",
        "Dupont",
      );

      expect(birthDateOf(createMock)).toEqual(
        new Date("2005-12-03T00:00:00.000Z"),
      );
    });
  });

  describe("BETA_AUTO_LICENSE (staging only)", () => {
    const createdUser = {
      id: "user-beta",
      email: "beta@example.com",
      firstName: "",
      lastName: "Testeur",
      role: "LICENSEE",
      clubId: null,
      clubName: "Club bêta-test (licence auto-créée)",
      category: "Ten Dance",
      ageGroup: null,
      passportLevelLatin: null,
      passportLevelStandard: null,
    };

    const enableFlag = (value: string | undefined) =>
      configService.get.mockImplementation((key: string) =>
        key === "BETA_AUTO_LICENSE" ? value : undefined,
      );

    /** Runs the transaction callback against a fake tx and exposes its mocks. */
    const mockTransaction = (licenseCreate: jest.Mock) => {
      const tx = {
        user: { create: jest.fn().mockResolvedValue(createdUser) },
        license: {
          create: licenseCreate,
          update: jest.fn().mockResolvedValue({}),
        },
      };
      prisma.$transaction.mockImplementation(
        async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
      );
      return tx;
    };

    it.each([undefined, "false", "TRUE", "1", ""])(
      "keeps the 404 for an unknown number when the flag is %p",
      async (value) => {
        enableFlag(value);
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.license.findUnique.mockResolvedValue(null);

        await expect(
          authService.register(
            "new@example.com",
            "MonPass1!abc",
            "UNKNOWN-1",
            "Dupont",
          ),
        ).rejects.toThrow(NotFoundException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it("auto-creates the license and links the new user when the flag is on", async () => {
      enableFlag("true");
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.license.findUnique.mockResolvedValue(null);
      const tx = mockTransaction(
        jest.fn().mockResolvedValue({ id: "lic-new" }),
      );
      const logSpy = jest
        .spyOn(
          (authService as unknown as { logger: { log: jest.Mock } }).logger,
          "log",
        )
        .mockImplementation(() => undefined);
      const before = Date.now();

      const result = await authService.register(
        "beta@example.com",
        "MonPass1!abc",
        "  20990101-beta-01  ",
        "Testeur",
      );

      expect(prisma.license.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { number: "20990101-beta-01" } }),
      );
      expect(tx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            category: "Ten Dance",
            clubName: "Club bêta-test (licence auto-créée)",
          }),
        }),
      );
      expect(tx.license.update).not.toHaveBeenCalled();
      expect(tx.license.create).toHaveBeenCalledTimes(1);
      const createArgs = tx.license.create.mock.calls[0][0] as {
        data: {
          number: string;
          validUntil: Date;
          category: string;
          clubName: string;
          userId: string;
        };
      };
      expect(createArgs.data).toMatchObject({
        number: "20990101-beta-01",
        category: "Ten Dance",
        clubName: "Club bêta-test (licence auto-créée)",
        userId: "user-beta",
      });
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      const delta = createArgs.data.validUntil.getTime() - before;
      expect(delta).toBeGreaterThan(ONE_YEAR_MS - ONE_DAY_MS);
      expect(delta).toBeLessThan(ONE_YEAR_MS + ONE_DAY_MS);

      expect(result.access_token).toBe("jwt-tok");
      expect(result.user.licenseNumber).toBe("20990101-beta-01");
      expect(logSpy).toHaveBeenCalledWith(
        { licenseNumber: "20990101-beta-01" },
        expect.stringContaining("auto-created"),
      );
    });

    it("rejects a blank number instead of auto-creating it", async () => {
      enableFlag("true");
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.license.findUnique.mockResolvedValue(null);

      await expect(
        authService.register(
          "new@example.com",
          "MonPass1!abc",
          "   ",
          "Dupont",
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects an over-long number instead of auto-creating it", async () => {
      enableFlag("true");
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.license.findUnique.mockResolvedValue(null);

      await expect(
        authService.register(
          "new@example.com",
          "MonPass1!abc",
          "x".repeat(51),
          "Dupont",
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("still rejects an already-claimed license with 409", async () => {
      enableFlag("true");
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.license.findUnique.mockResolvedValue({
        ...validLicense,
        userId: "other-user",
      });

      await expect(
        authService.register(
          "new@example.com",
          "MonPass1!abc",
          "FFD-2025-001",
          "Dupont",
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("still rejects an expired license with 400", async () => {
      enableFlag("true");
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.license.findUnique.mockResolvedValue({
        ...validLicense,
        validUntil: new Date("2020-01-01"),
      });

      await expect(
        authService.register(
          "new@example.com",
          "MonPass1!abc",
          "FFD-2025-001",
          "Dupont",
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("links an existing unclaimed license without creating one", async () => {
      enableFlag("true");
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.license.findUnique.mockResolvedValue(validLicense);
      const tx = mockTransaction(jest.fn());

      await authService.register(
        "new@example.com",
        "MonPass1!abc",
        "FFD-2025-001",
        "Dupont",
      );

      expect(tx.license.create).not.toHaveBeenCalled();
      expect(tx.license.update).toHaveBeenCalledWith({
        where: { id: "lic-1" },
        data: { userId: "user-beta" },
      });
    });

    it("maps a lost unique-constraint race to 409", async () => {
      enableFlag("true");
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.license.findUnique.mockResolvedValue(null);
      mockTransaction(
        jest
          .fn()
          .mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError(
              "Unique constraint failed on the fields: (`number`)",
              { code: "P2002", clientVersion: "test" },
            ),
          ),
      );

      await expect(
        authService.register(
          "new@example.com",
          "MonPass1!abc",
          "20990101-beta-01",
          "Dupont",
        ),
      ).rejects.toThrow(ConflictException);
    });

    it("propagates other errors from the license creation", async () => {
      enableFlag("true");
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.license.findUnique.mockResolvedValue(null);
      const boom = new Error("db down");
      mockTransaction(jest.fn().mockRejectedValue(boom));

      await expect(
        authService.register(
          "new@example.com",
          "MonPass1!abc",
          "20990101-beta-01",
          "Dupont",
        ),
      ).rejects.toBe(boom);
    });
  });
});

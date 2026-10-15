import { BadRequestException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { mockDeep, type DeepMockProxy } from "jest-mock-extended";
import { UpdateAdminClubDto } from "../admin/dto/admin-clubs.dto";
import type { PrismaService } from "../prisma/prisma.service";
import { clubPaymentProviderStatusSelect } from "../utils/prisma-selects";
import {
  clubPaymentProviderState,
  isPaymentProviderConfigured,
} from "./club-payment-provider";
import { ClubPaymentProviderQueryService } from "./club-payment-provider.query-service";
import { ClubPaymentProviderService } from "./club-payment-provider.service";
import type { ClubsService } from "./clubs.service";
import { SetClubPaymentProviderDto } from "./dto/club-payment-provider.dto";

const SECRET = "club-helloasso-secret";
const connectedClub = {
  id: "club-1",
  name: "Club A",
  paymentProvider: "HELLOASSO" as const,
  helloAssoClientId: "client-id",
  helloAssoClientSecret: SECRET,
  helloAssoOrgSlug: "club-a",
};

describe("club payment connector state (#388)", () => {
  it.each([
    ["all credentials set", {}, true],
    ["no client id", { helloAssoClientId: null }, false],
    ["an empty secret", { helloAssoClientSecret: "" }, false],
    ["no organisation slug", { helloAssoOrgSlug: null }, false],
  ])("HelloAsso is configured only with %s", (_label, override, expected) => {
    expect(
      isPaymentProviderConfigured(
        { ...connectedClub, ...override },
        "HELLOASSO",
      ),
    ).toBe(expected);
  });

  it("reads a NULL choice as HelloAsso", () => {
    expect(
      clubPaymentProviderState({ ...connectedClub, paymentProvider: null }),
    ).toEqual({ paymentProvider: "HELLOASSO", configured: true });
  });
});

describe("club payment connector API (#388)", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let getClubIdForOrganizer: jest.Mock;
  let query: ClubPaymentProviderQueryService;
  let writer: ClubPaymentProviderService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    getClubIdForOrganizer = jest.fn().mockResolvedValue("club-1");
    const clubs = { getClubIdForOrganizer } as unknown as ClubsService;
    query = new ClubPaymentProviderQueryService(
      prisma as unknown as PrismaService,
      clubs,
    );
    writer = new ClubPaymentProviderService(
      prisma as unknown as PrismaService,
      clubs,
    );
  });

  it("returns the club's connector, configured flag and choices, never a credential", async () => {
    prisma.club.findUnique.mockResolvedValue(connectedClub as never);

    const status = await query.getMyClubPaymentProvider("user-1");

    expect(status).toEqual({
      clubName: "Club A",
      paymentProvider: "HELLOASSO",
      configured: true,
      selectableProviders: ["HELLOASSO"],
    });
    expect(JSON.stringify(status)).not.toContain(SECRET);
    expect(JSON.stringify(status)).not.toContain("client-id");
    expect(getClubIdForOrganizer).toHaveBeenCalledWith("user-1");
    expect(prisma.club.findUnique).toHaveBeenCalledWith({
      where: { id: "club-1" },
      select: clubPaymentProviderStatusSelect,
    });
  });

  it("reports a club without credentials as not configured", async () => {
    prisma.club.findUnique.mockResolvedValue({
      ...connectedClub,
      paymentProvider: null,
      helloAssoClientSecret: null,
    } as never);

    await expect(query.getMyClubPaymentProvider("user-1")).resolves.toEqual(
      expect.objectContaining({
        paymentProvider: "HELLOASSO",
        configured: false,
      }),
    );
  });

  it("answers 404 when the club disappeared meanwhile", async () => {
    prisma.club.findUnique.mockResolvedValue(null);

    await expect(query.getMyClubPaymentProvider("user-1")).rejects.toThrow(
      "Club introuvable",
    );
  });

  it("propagates the organiser check (not a club account, no club)", async () => {
    getClubIdForOrganizer.mockRejectedValue(
      new BadRequestException("Only club role can manage club data"),
    );

    await expect(
      writer.setMyClubPaymentProvider("user-1", {
        paymentProvider: "HELLOASSO",
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.club.update).not.toHaveBeenCalled();
  });

  it("stores the choice on the organiser's club only, credentials untouched", async () => {
    prisma.club.update.mockResolvedValue(connectedClub as never);

    const status = await writer.setMyClubPaymentProvider("user-1", {
      paymentProvider: "HELLOASSO",
    });

    expect(prisma.club.update).toHaveBeenCalledWith({
      where: { id: "club-1" },
      data: { paymentProvider: "HELLOASSO" },
      select: clubPaymentProviderStatusSelect,
    });
    expect(status).toEqual({
      clubName: "Club A",
      paymentProvider: "HELLOASSO",
      configured: true,
      selectableProviders: ["HELLOASSO"],
    });
    expect(JSON.stringify(status)).not.toContain(SECRET);
  });
});

describe("payment connector choice validation (#388)", () => {
  const errorsOf = (cls: new () => object, body: object) =>
    validateSync(plainToInstance<object, object>(cls, body));

  it.each([SetClubPaymentProviderDto, UpdateAdminClubDto])(
    "%p accepts HELLOASSO",
    (cls) => {
      expect(errorsOf(cls, { paymentProvider: "HELLOASSO" })).toHaveLength(0);
    },
  );

  it.each([SetClubPaymentProviderDto, UpdateAdminClubDto])(
    "%p refuses a connector not available yet, or junk",
    (cls) => {
      for (const paymentProvider of ["ASSOCONNECT", "helloasso", "", 1, null]) {
        expect(errorsOf(cls, { paymentProvider }).length).toBeGreaterThan(0);
      }
    },
  );

  it("requires the choice on the club route", () => {
    expect(errorsOf(SetClubPaymentProviderDto, {}).length).toBeGreaterThan(0);
  });

  it("keeps it optional on the back-office update", () => {
    expect(errorsOf(UpdateAdminClubDto, { name: "Club A" })).toHaveLength(0);
  });
});

import type { PaymentProvider, PrismaClient } from "@prisma/client";
import { mockDeep, type DeepMockProxy } from "jest-mock-extended";
import type { PrismaService } from "../../prisma/prisma.service";
import {
  clubPaymentProviderSelect,
  competitionOrganizerSelect,
} from "../../utils/prisma-selects";
import type { HelloAssoPaymentConnector } from "./helloasso-payment.connector";
import { PaymentConnectorRegistry } from "./payment-connector.registry";
import {
  DEFAULT_PAYMENT_PROVIDER,
  effectivePaymentProvider,
  PAYMENT_PROVIDER_NAMES,
  SELECTABLE_PAYMENT_PROVIDERS,
} from "./payment-providers";

describe("PaymentConnectorRegistry (#388)", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let registry: PaymentConnectorRegistry;
  const helloAsso = {
    provider: "HELLOASSO",
    displayName: "HelloAsso",
  } as HelloAssoPaymentConnector;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    registry = new PaymentConnectorRegistry(
      prisma as unknown as PrismaService,
      helloAsso,
    );
  });

  it("returns the registered connector of a provider", () => {
    expect(registry.get("HELLOASSO")).toBe(helloAsso);
  });

  it("returns null for a provider without a connector", () => {
    expect(registry.get("ASSOCONNECT" as PaymentProvider)).toBeNull();
  });

  it("uses HelloAsso for an unknown competition", async () => {
    prisma.competition.findUnique.mockResolvedValue(null);

    await expect(registry.forCompetition("comp-1")).resolves.toBe(helloAsso);
    expect(prisma.competition.findUnique).toHaveBeenCalledWith({
      where: { id: "comp-1" },
      select: competitionOrganizerSelect,
    });
    expect(prisma.club.findUnique).not.toHaveBeenCalled();
  });

  it("uses HelloAsso when no organising club resolves", async () => {
    prisma.competition.findUnique.mockResolvedValue({
      organizerClubId: null,
      organizer: null,
    } as never);

    await expect(registry.forCompetition("comp-1")).resolves.toBe(helloAsso);
    expect(prisma.club.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["chose HelloAsso", { paymentProvider: "HELLOASSO" }],
    ["never chose (NULL)", { paymentProvider: null }],
    ["is gone", null],
  ])("uses HelloAsso when the organising club %s", async (_label, club) => {
    prisma.competition.findUnique.mockResolvedValue({
      organizerClubId: "club-1",
      organizer: "Club A",
    } as never);
    prisma.club.findUnique.mockResolvedValue(club as never);

    await expect(registry.forCompetition("comp-1")).resolves.toBe(helloAsso);
    expect(prisma.club.findUnique).toHaveBeenCalledWith({
      where: { id: "club-1" },
      select: clubPaymentProviderSelect,
    });
  });

  it("resolves an unlinked competition's club by its label (#408)", async () => {
    prisma.competition.findUnique.mockResolvedValue({
      organizerClubId: null,
      organizer: "Club A",
    } as never);
    prisma.club.findMany.mockResolvedValue([{ id: "club-1" }] as never);
    prisma.club.findUnique.mockResolvedValue({
      paymentProvider: "HELLOASSO",
    } as never);

    await expect(registry.forCompetition("comp-1")).resolves.toBe(helloAsso);
    expect(prisma.club.findUnique).toHaveBeenCalledWith({
      where: { id: "club-1" },
      select: clubPaymentProviderSelect,
    });
  });

  it("has no connector when the club chose a provider this release does not know", async () => {
    prisma.competition.findUnique.mockResolvedValue({
      organizerClubId: "club-1",
    } as never);
    prisma.club.findUnique.mockResolvedValue({
      paymentProvider: "ASSOCONNECT",
    } as never);

    await expect(registry.forCompetition("comp-1")).resolves.toBeNull();
  });
});

describe("payment providers (#388)", () => {
  it("defaults to HelloAsso, the only selectable connector so far", () => {
    expect(DEFAULT_PAYMENT_PROVIDER).toBe("HELLOASSO");
    expect(SELECTABLE_PAYMENT_PROVIDERS).toEqual(["HELLOASSO"]);
    expect(PAYMENT_PROVIDER_NAMES.HELLOASSO).toBe("HelloAsso");
  });

  it("reads a NULL provider as HelloAsso", () => {
    expect(effectivePaymentProvider(null)).toBe("HELLOASSO");
    expect(effectivePaymentProvider(undefined)).toBe("HELLOASSO");
    expect(effectivePaymentProvider("HELLOASSO")).toBe("HELLOASSO");
  });
});

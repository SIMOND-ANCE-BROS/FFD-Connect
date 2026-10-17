import { ClubRegistrationMode, PrismaClient } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import { ClubRegistrationModeQueryService } from "./club-registration-mode.query-service";

describe("ClubRegistrationModeQueryService (#665)", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let service: ClubRegistrationModeQueryService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new ClubRegistrationModeQueryService(
      prisma as unknown as PrismaService,
    );
  });

  const user = (clubId: string | null, clubName: string | null) =>
    prisma.user.findUnique.mockResolvedValue({ clubId, clubName } as never);

  it("reads the linked club's mode by id", async () => {
    user("club-1", "Stale Name");
    prisma.club.findUnique.mockResolvedValue({
      registrationMode: ClubRegistrationMode.CLUB_ONLY,
    } as never);

    await expect(service.getMyClubRegistrationMode("u1")).resolves.toBe(
      ClubRegistrationMode.CLUB_ONLY,
    );
    expect(prisma.club.findUnique).toHaveBeenCalledWith({
      where: { id: "club-1" },
      select: { registrationMode: true },
    });
    expect(prisma.club.findMany).not.toHaveBeenCalled();
  });

  it("resolves a legacy account to the one club its name designates", async () => {
    user(null, " Club A ");
    prisma.club.findMany.mockResolvedValue([{ id: "club-7" }] as never);
    prisma.club.findUnique.mockResolvedValue({
      registrationMode: ClubRegistrationMode.CLUB_AND_MEMBERS_PENDING,
    } as never);

    await expect(service.getMyClubRegistrationMode("u1")).resolves.toBe(
      ClubRegistrationMode.CLUB_AND_MEMBERS_PENDING,
    );
    expect(prisma.club.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "club-7" } }),
    );
  });

  it("returns null, never a homonym's setting, when the name is ambiguous", async () => {
    user(null, "Club A");
    prisma.club.findMany.mockResolvedValue([
      { id: "club-1" },
      { id: "club-2" },
    ] as never);

    await expect(service.getMyClubRegistrationMode("u1")).resolves.toBeNull();
    expect(prisma.club.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["no club", null],
    ["an unknown club name", "Ghost Club"],
  ])("returns null for a user with %s", async (_case, clubName) => {
    user(null, clubName);
    prisma.club.findMany.mockResolvedValue([] as never);

    await expect(service.getMyClubRegistrationMode("u1")).resolves.toBeNull();
  });

  it("returns null for an unknown user", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.getMyClubRegistrationMode("ghost"),
    ).resolves.toBeNull();
  });

  it("returns null when the linked club no longer exists", async () => {
    user("club-gone", null);
    prisma.club.findUnique.mockResolvedValue(null);

    await expect(service.getMyClubRegistrationMode("u1")).resolves.toBeNull();
  });
});

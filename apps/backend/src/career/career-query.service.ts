import { Injectable } from "@nestjs/common";
import { PartnershipStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CareerPartnership,
  CareerRegistration,
  CareerResult,
} from "./career.types";

@Injectable()
export class CareerQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async getPartnershipsForUser(userId: string): Promise<CareerPartnership[]> {
    const list = await this.prisma.partnership.findMany({
      where: {
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      include: {
        user1: {
          select: { id: true, firstName: true, lastName: true, clubName: true },
        },
        user2: {
          select: { id: true, firstName: true, lastName: true, clubName: true },
        },
        club: { select: { name: true } },
        secondaryClub: { select: { name: true } },
      },
      orderBy: { startDate: "desc" },
      take: 200,
    });

    return list.map((p) => {
      const partner = p.user1Id === userId ? p.user2 : p.user1;
      const isCurrent = p.status === PartnershipStatus.ACTIVE && !p.endDate;
      return {
        id: p.id,
        status: p.status,
        startDate: p.startDate.toISOString(),
        endDate: p.endDate?.toISOString() ?? null,
        partner: {
          id: partner.id,
          firstName: partner.firstName,
          lastName: partner.lastName,
          clubName: partner.clubName,
        },
        clubName: p.club.name,
        secondaryClubName: p.secondaryClub?.name ?? null,
        isCurrent,
      };
    });
  }

  async getRegistrationsWithCompetition(
    userId: string,
  ): Promise<CareerRegistration[]> {
    const list = await this.prisma.registration.findMany({
      where: { userId },
      include: {
        event: {
          select: {
            id: true,
            category: true,
            ageGroup: true,
            level: true,
            competitionId: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const competitionIds = [...new Set(list.map((r) => r.event.competitionId))];
    const competitions = await this.prisma.competition.findMany({
      where: { id: { in: competitionIds } },
      select: {
        id: true,
        title: true,
        date: true,
        location: true,
        status: true,
      },
    });
    const compMap = new Map(competitions.map((c) => [c.id, c]));

    return list.map((r) => {
      const comp = compMap.get(r.event.competitionId);
      return {
        id: r.id,
        status: r.status,
        bibNumber: r.bibNumber,
        partnerName: r.partnerName,
        event: {
          id: r.event.id,
          category: r.event.category,
          ageGroup: r.event.ageGroup,
          level: r.event.level,
        },
        competition: comp
          ? {
              id: comp.id,
              title: comp.title,
              date: comp.date.toISOString(),
              location: comp.location,
              status: comp.status,
            }
          : {
              id: "",
              title: "",
              date: "",
              location: "",
              status: "",
            },
      };
    });
  }

  async getResultsForUser(
    userId: string,
    registrations: CareerRegistration[],
  ): Promise<CareerResult[]> {
    const eventIds = [...new Set(registrations.map((r) => r.event.id))];
    if (eventIds.length === 0) return [];

    // Résultats du licencié : rattachés par userId (source de vérité). On ne
    // filtre PLUS par details.participant (matching par nom, fragile : homonymes,
    // changement de nom, import qui ne renseigne pas le champ → résultat perdu).
    const results = await this.prisma.result.findMany({
      where: { eventId: { in: eventIds }, userId },
      include: {
        event: {
          select: {
            id: true,
            category: true,
            ageGroup: true,
            competitionId: true,
          },
        },
      },
      orderBy: [{ eventId: "asc" }, { ranking: "asc" }],
      take: 1000,
    });

    const competitionIds = [
      ...new Set(results.map((r) => r.event.competitionId)),
    ];
    const competitions = await this.prisma.competition.findMany({
      where: { id: { in: competitionIds } },
      select: { id: true, title: true, date: true },
    });
    const compMap = new Map(competitions.map((c) => [c.id, c]));

    const out: CareerResult[] = results.map((r) => {
      const details = r.details as {
        participant?: string;
        totalParticipants?: number;
      } | null;
      const trimmed = details?.participant?.trim();
      const participant = trimmed ? trimmed : null;
      const totalParticipants =
        typeof details?.totalParticipants === "number"
          ? details.totalParticipants
          : null;
      const comp = compMap.get(r.event.competitionId);
      return {
        id: r.id,
        eventId: r.eventId,
        round: r.round,
        ranking: r.ranking,
        totalParticipants,
        participantLabel: participant,
        event: {
          category: r.event.category,
          ageGroup: r.event.ageGroup,
        },
        competition: comp
          ? { id: comp.id, title: comp.title, date: comp.date.toISOString() }
          : { id: "", title: "", date: "" },
      };
    });

    return out.sort(
      (a, b) =>
        new Date(b.competition.date).getTime() -
        new Date(a.competition.date).getTime(),
    );
  }
}

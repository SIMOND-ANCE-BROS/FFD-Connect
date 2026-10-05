// apps/backend/src/clubs/solo-team.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { handlePrismaError } from "../utils/prisma-errors.util";
import type { CreateSoloTeamDto } from "./dto/create-soloteam.dto";
import { ClubsService } from "./clubs.service";

@Injectable()
export class SoloTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubsService: ClubsService,
  ) {}

  async getSoloTeams(organizerUserId: string) {
    const clubId =
      await this.clubsService.getClubIdForOrganizer(organizerUserId);
    return this.prisma.soloTeam.findMany({
      where: { clubId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                competitionLevel: true,
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
      take: 100,
    });
  }

  async createSoloTeam(organizerUserId: string, dto: CreateSoloTeamDto) {
    const clubId =
      await this.clubsService.getClubIdForOrganizer(organizerUserId);
    try {
      return await this.prisma.soloTeam.create({
        data: { clubId, name: dto.name.trim(), level: dto.level },
      });
    } catch (err) {
      handlePrismaError(err, "SoloTeam");
    }
  }

  async getSoloTeam(organizerUserId: string, teamId: string) {
    const clubId =
      await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const team = await this.prisma.soloTeam.findFirst({
      where: { id: teamId, clubId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                competitionLevel: true,
                birthDate: true,
              },
            },
          },
        },
      },
    });
    if (!team) throw new NotFoundException("Solo team not found");
    return team;
  }

  async addSoloTeamMember(
    organizerUserId: string,
    teamId: string,
    userId: string,
  ) {
    const clubId =
      await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const team = await this.prisma.soloTeam.findFirst({
      where: { id: teamId, clubId },
    });
    if (!team) throw new NotFoundException("Solo team not found");
    const [user, club] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { clubId: true, clubName: true },
      }),
      this.prisma.club.findUnique({
        where: { id: clubId },
        select: { name: true },
      }),
    ]);
    if (!user) throw new NotFoundException("User not found");
    if (!club) throw new NotFoundException("Club not found");
    const belongs =
      user.clubId === clubId ||
      user.clubName?.trim().toLowerCase() === club.name.toLowerCase();
    if (!belongs)
      throw new BadRequestException("User must be a member of your club");
    try {
      await this.prisma.soloTeamMember.create({ data: { teamId, userId } });
    } catch (err) {
      handlePrismaError(err, "SoloTeamMember");
    }
    return this.recalculateSoloTeamLevel(teamId);
  }

  async removeSoloTeamMember(
    organizerUserId: string,
    teamId: string,
    userId: string,
  ) {
    const clubId =
      await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const team = await this.prisma.soloTeam.findFirst({
      where: { id: teamId, clubId },
    });
    if (!team) throw new NotFoundException("Solo team not found");
    await this.prisma.soloTeamMember.deleteMany({ where: { teamId, userId } });
    return this.recalculateSoloTeamLevel(teamId);
  }

  async recalculateSoloTeamLevel(teamId: string) {
    const members = await this.prisma.soloTeamMember.findMany({
      where: { teamId },
      include: { user: { select: { competitionLevel: true } } },
    });
    const levels = members
      .map((m) => m.user.competitionLevel?.trim())
      .filter(Boolean);
    const level = levels.some((l) =>
      ["Intermédiaire", "Avancé", "International"].includes(l!),
    )
      ? "Intermédiaire"
      : "Débutant";
    return this.prisma.soloTeam.update({
      where: { id: teamId },
      data: { level },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                competitionLevel: true,
              },
            },
          },
        },
      },
    });
  }
}

// apps/backend/src/clubs/clubs.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { PrismaService } from "./../prisma/prisma.service";

@Injectable()
export class ClubsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retourne l'ID du club de l'organisateur (CLUB role). Lance si pas de club.
   */
  async getClubIdForOrganizer(organizerUserId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: organizerUserId },
      select: { role: true, clubId: true, clubName: true },
    });
    if (!user) throw new NotFoundException("User not found");
    if (user.role !== UserRole.CLUB) {
      throw new BadRequestException("Only club role can manage club data");
    }
    const club = user.clubId
      ? await this.prisma.club.findUnique({ where: { id: user.clubId } })
      : user.clubName?.trim()
        ? await this.findOrCreateByName(user.clubName)
        : null;
    if (!club) {
      throw new BadRequestException(
        "Organizer has no club assigned. Set clubName on your profile first.",
      );
    }
    return club.id;
  }

  /**
   * Récupère ou crée le club par son nom (insensible à la casse pour le lookup).
   */
  async findOrCreateByName(name: string) {
    const normalized = name.trim();
    if (!normalized) {
      throw new BadRequestException("Club name is required");
    }
    let club = await this.prisma.club.findFirst({
      where: { name: { equals: normalized, mode: "insensitive" } },
    });
    club ??= await this.prisma.club.create({
      data: { name: normalized },
    });
    return club;
  }
}

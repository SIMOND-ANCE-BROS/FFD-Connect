// apps/backend/src/clubs/partnership.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  NotificationType,
  PartnershipManagementMode,
  PartnershipStatus,
} from "@prisma/client";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { ClubsService } from "./clubs.service";
import type { CreatePartnershipDto } from "./dto/create-partnership.dto";
import type { EndPartnershipDto } from "./dto/end-partnership.dto";
import { computePartnershipSuggestion } from "./partnership-suggestion.util";

@Injectable()
export class PartnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubsService: ClubsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createPartnership(organizerUserId: string, dto: CreatePartnershipDto) {
    const clubId =
      await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true, name: true },
    });
    if (!club) throw new NotFoundException("Club not found");
    const [u1, u2] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: dto.user1Id },
        select: {
          clubId: true,
          clubName: true,
          birthDate: true,
          ageGroup: true,
          category: true,
          competitionLevel: true,
          passportLevelLatin: true,
          passportLevelStandard: true,
        },
      }),
      this.prisma.user.findUnique({
        where: { id: dto.user2Id },
        select: {
          clubId: true,
          clubName: true,
          birthDate: true,
          ageGroup: true,
          category: true,
          competitionLevel: true,
          passportLevelLatin: true,
          passportLevelStandard: true,
        },
      }),
    ]);
    if (!u1 || !u2) throw new NotFoundException("One or both users not found");
    if (dto.user1Id === dto.user2Id)
      throw new BadRequestException("Cannot create partnership with same user");
    const user1Id = dto.user1Id < dto.user2Id ? dto.user1Id : dto.user2Id;
    const user2Id = dto.user1Id < dto.user2Id ? dto.user2Id : dto.user1Id;
    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();

    const belongsToPrimary = (u: {
      clubId: string | null;
      clubName: string | null;
    }) =>
      u.clubId === clubId ||
      u.clubName?.trim().toLowerCase() === club.name.toLowerCase();

    let secondaryClubId: string | null = null;
    let status: PartnershipStatus = PartnershipStatus.ACTIVE;
    let managementMode: PartnershipManagementMode =
      PartnershipManagementMode.PRIMARY_ONLY;
    let secondaryClub: { id: string; name: string } | null = null;

    if (dto.secondaryClubId) {
      if (dto.secondaryClubId === clubId) {
        throw new BadRequestException(
          "Le second club doit être différent de votre club",
        );
      }
      secondaryClub = await this.prisma.club.findUnique({
        where: { id: dto.secondaryClubId },
        select: { id: true, name: true },
      });
      if (!secondaryClub) throw new NotFoundException("Second club not found");
      const belongsToSecondary = (u: {
        clubId: string | null;
        clubName: string | null;
      }) =>
        u.clubId === dto.secondaryClubId ||
        u.clubName?.trim().toLowerCase() === secondaryClub!.name.toLowerCase();
      if (!belongsToPrimary(u1) && !belongsToSecondary(u1)) {
        throw new BadRequestException(
          "Le premier licencié doit appartenir à votre club ou au club partenaire",
        );
      }
      if (!belongsToPrimary(u2) && !belongsToSecondary(u2)) {
        throw new BadRequestException(
          "Le second licencié doit appartenir à votre club ou au club partenaire",
        );
      }
      secondaryClubId = dto.secondaryClubId;
      status = PartnershipStatus.PENDING_SECOND_CLUB;
      managementMode = dto.managementMode ?? PartnershipManagementMode.BOTH;
    } else {
      if (!belongsToPrimary(u1) || !belongsToPrimary(u2)) {
        throw new BadRequestException(
          "Les deux licenciés doivent être membres de votre club",
        );
      }
    }

    const existingActive = await this.prisma.partnership.findFirst({
      where: {
        user1Id,
        user2Id,
        endDate: null,
        status: {
          in: [PartnershipStatus.ACTIVE, PartnershipStatus.PENDING_SECOND_CLUB],
        },
      },
    });
    if (existingActive) {
      throw new BadRequestException(
        "Un couple actif existe déjà entre ces deux partenaires. Clôturez-le avant d'en créer un nouveau.",
      );
    }

    const partnership = await this.prisma.partnership.create({
      data: {
        clubId,
        secondaryClubId,
        user1Id,
        user2Id,
        startDate,
        status,
        managementMode,
      },
      include: {
        user1: { select: { id: true, firstName: true, lastName: true } },
        user2: { select: { id: true, firstName: true, lastName: true } },
        secondaryClub: { select: { id: true, name: true } },
      },
    });

    const { coupleAgeGroup, suggestedLevel, suggestedCategories } =
      computePartnershipSuggestion(u1, u2, startDate);

    // Notification au club partenaire lorsqu'un couple inter-club est créé
    if (secondaryClub && status === PartnershipStatus.PENDING_SECOND_CLUB) {
      const pLabelUser1 =
        `${partnership.user1.firstName} ${partnership.user1.lastName}`.trim();
      const pLabelUser2 =
        `${partnership.user2.firstName} ${partnership.user2.lastName}`.trim();
      const pLabel =
        pLabelUser1 && pLabelUser2
          ? `${pLabelUser1} & ${pLabelUser2}`
          : "Un couple";

      let modeLabel: string;
      let inviteOperations = "";
      if (managementMode === PartnershipManagementMode.BOTH) {
        modeLabel = "Mode : co-gestion (les deux clubs gèrent ce couple).";
        inviteOperations =
          "Les opérations importantes sur ce couple devront être validées par les deux clubs.";
      } else if (managementMode === PartnershipManagementMode.SECONDARY_ONLY) {
        modeLabel = `Mode : gestion par votre club (le club ${club.name} vous délègue la gestion de ce couple).`;
      } else {
        modeLabel = `Mode : gestion par le club ${club.name} (votre club ne gère pas directement ce couple).`;
      }

      const firstSentence =
        managementMode === PartnershipManagementMode.BOTH
          ? `${pLabel} : votre club est invité à co-gérer ce couple avec le club ${club.name}.`
          : managementMode === PartnershipManagementMode.SECONDARY_ONLY
            ? `${pLabel} : votre club est invité à gérer ce couple pour le compte du club ${club.name}.`
            : `${pLabel} : votre club est indiqué comme club partenaire, la gestion reste faite par le club ${club.name}.`;

      const body = [firstSentence, modeLabel, inviteOperations]
        .filter(Boolean)
        .join("\n");

      await this.notifyClubOrganizersForClub(secondaryClub, {
        type: "partnership_interclub_request",
        title: "Nouveau couple inter-club à valider",
        body,
        partnershipId: partnership.id,
      });
    }

    return {
      partnership,
      coupleAgeGroup,
      suggestedLevel: suggestedLevel ?? null,
      suggestedCategories,
    };
  }

  async endPartnership(
    organizerUserId: string,
    partnershipId: string,
    dto: EndPartnershipDto,
  ) {
    const clubId =
      await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const p = await this.prisma.partnership.findFirst({
      where: {
        id: partnershipId,
        endDate: null,
        status: PartnershipStatus.ACTIVE,
      },
      select: {
        id: true,
        clubId: true,
        secondaryClubId: true,
        managementMode: true,
        club: { select: { id: true, name: true } },
        secondaryClub: { select: { id: true, name: true } },
      },
    });
    if (!p)
      throw new NotFoundException("Partnership not found or already ended");
    const canManageAsPrimary =
      p.club.id === clubId &&
      (p.managementMode === PartnershipManagementMode.PRIMARY_ONLY ||
        p.managementMode === PartnershipManagementMode.BOTH);
    const canManageAsSecondary =
      p.secondaryClub?.id === clubId &&
      (p.managementMode === PartnershipManagementMode.SECONDARY_ONLY ||
        p.managementMode === PartnershipManagementMode.BOTH);
    if (!canManageAsPrimary && !canManageAsSecondary) {
      throw new BadRequestException(
        "Seul le club gestionnaire de ce couple peut le clôturer.",
      );
    }
    const updated = await this.prisma.partnership.update({
      where: { id: partnershipId },
      data: { endDate: new Date(dto.endDate) },
      include: {
        user1: { select: { id: true, firstName: true, lastName: true } },
        user2: { select: { id: true, firstName: true, lastName: true } },
        club: { select: { id: true, name: true } },
        secondaryClub: { select: { id: true, name: true } },
      },
    });

    {
      const actingClubId = clubId;
      const otherClub =
        actingClubId === updated.club.id
          ? updated.secondaryClub
          : actingClubId === updated.secondaryClub?.id
            ? updated.club
            : null;
      if (otherClub) {
        const pLabelUser1 =
          `${updated.user1.firstName} ${updated.user1.lastName}`.trim();
        const pLabelUser2 =
          `${updated.user2.firstName} ${updated.user2.lastName}`.trim();
        const pLabel =
          pLabelUser1 && pLabelUser2
            ? `${pLabelUser1} & ${pLabelUser2}`
            : "Un couple";
        await this.notifyClubOrganizersForClub(otherClub, {
          type: "partnership_interclub_ended",
          title: "Couple inter-club clôturé",
          body: `${pLabel} : le couple inter-club a été clôturé par l'autre club.`,
          partnershipId: updated.id,
        });
      }
    }

    return updated;
  }

  async validatePartnership(
    organizerUserId: string,
    partnershipId: string,
    accepted: boolean,
  ) {
    const clubId =
      await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const p = await this.prisma.partnership.findFirst({
      where: {
        id: partnershipId,
        secondaryClubId: clubId,
        status: PartnershipStatus.PENDING_SECOND_CLUB,
        endDate: null,
      },
      include: {
        user1: { select: { id: true, firstName: true, lastName: true } },
        user2: { select: { id: true, firstName: true, lastName: true } },
        club: { select: { id: true, name: true } },
        secondaryClub: { select: { id: true, name: true } },
      },
    });
    if (!p) {
      throw new NotFoundException(
        "Aucun couple en attente de validation par votre club pour cet ID.",
      );
    }
    const newStatus = accepted
      ? PartnershipStatus.ACTIVE
      : PartnershipStatus.REJECTED;
    const updated = await this.prisma.partnership.update({
      where: { id: partnershipId },
      data: { status: newStatus },
      include: {
        user1: { select: { id: true, firstName: true, lastName: true } },
        user2: { select: { id: true, firstName: true, lastName: true } },
        secondaryClub: { select: { id: true, name: true } },
      },
    });

    {
      const pLabelUser1 = `${p.user1.firstName} ${p.user1.lastName}`.trim();
      const pLabelUser2 = `${p.user2.firstName} ${p.user2.lastName}`.trim();
      const pLabel =
        pLabelUser1 && pLabelUser2
          ? `${pLabelUser1} & ${pLabelUser2}`
          : "Un couple";
      const decisionText = accepted ? "validé" : "refusé";
      const type = accepted
        ? "partnership_interclub_accepted"
        : "partnership_interclub_rejected";
      await this.notifyClubOrganizersForClub(
        { id: p.club.id, name: p.club.name },
        {
          type,
          title: `Couple inter-club ${decisionText} par le club partenaire`,
          body: `${pLabel} : le club ${
            p.secondaryClub?.name ?? "partenaire"
          } a ${decisionText} le couple inter-club.`,
          partnershipId: p.id,
        },
      );
    }

    return updated;
  }

  private async notifyClubOrganizersForClub(
    club: { id: string; name: string },
    notification: {
      type: string;
      title: string;
      body: string;
      partnershipId: string;
    },
  ): Promise<void> {
    const organizers = await this.prisma.user.findMany({
      where: {
        role: "CLUB" as const,
        OR: [
          { clubId: club.id },
          {
            clubName: {
              equals: club.name.trim(),
              mode: "insensitive",
            },
          },
        ],
      },
      select: { id: true },
      take: 50,
    });
    if (organizers.length === 0) return;
    const data: Record<string, string> = {
      type: notification.type,
      partnershipId: notification.partnershipId,
    };
    await Promise.all(
      organizers.map((o) =>
        this.notificationsService.createForUser(
          o.id,
          NotificationType.CLUB_PARTNERSHIP,
          notification.title,
          notification.body,
          data,
        ),
      ),
    );
  }
}

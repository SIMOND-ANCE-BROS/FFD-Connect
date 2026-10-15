import { Injectable, NotFoundException } from "@nestjs/common";
import { SELECTABLE_PAYMENT_PROVIDERS } from "../payment/connectors/payment-providers";
import { PrismaService } from "../prisma/prisma.service";
import { clubPaymentProviderStatusSelect } from "../utils/prisma-selects";
import { clubPaymentProviderState } from "./club-payment-provider";
import { ClubsService } from "./clubs.service";
import type { ClubPaymentProviderStatusDto } from "./dto/club-payment-provider.dto";

/** Reads the payment connector of the organiser's club (#388). */
@Injectable()
export class ClubPaymentProviderQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubsService: ClubsService,
  ) {}

  async getMyClubPaymentProvider(
    organizerUserId: string,
  ): Promise<ClubPaymentProviderStatusDto> {
    const clubId =
      await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: clubPaymentProviderStatusSelect,
    });
    if (!club) throw new NotFoundException("Club introuvable");
    return {
      clubName: club.name,
      ...clubPaymentProviderState(club),
      selectableProviders: [...SELECTABLE_PAYMENT_PROVIDERS],
    };
  }
}

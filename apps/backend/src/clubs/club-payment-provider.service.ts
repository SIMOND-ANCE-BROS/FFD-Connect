import { Injectable } from "@nestjs/common";
import { SELECTABLE_PAYMENT_PROVIDERS } from "../payment/connectors/payment-providers";
import { PrismaService } from "../prisma/prisma.service";
import { clubPaymentProviderStatusSelect } from "../utils/prisma-selects";
import { clubPaymentProviderState } from "./club-payment-provider";
import { ClubsService } from "./clubs.service";
import type {
  ClubPaymentProviderStatusDto,
  SetClubPaymentProviderDto,
} from "./dto/club-payment-provider.dto";

/**
 * Sets the payment connector of the organiser's club (#388). Only the
 * choice: each connector's credentials have their own endpoint (HelloAsso:
 * `PUT /clubs/me/helloasso`), and a switch never erases the credentials of
 * the previous connector (payments in flight there are still verified and
 * confirmed through its own webhook route).
 */
@Injectable()
export class ClubPaymentProviderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubsService: ClubsService,
  ) {}

  async setMyClubPaymentProvider(
    organizerUserId: string,
    dto: SetClubPaymentProviderDto,
  ): Promise<ClubPaymentProviderStatusDto> {
    const clubId =
      await this.clubsService.getClubIdForOrganizer(organizerUserId);
    // The club was just resolved (or created) for this organiser.
    const club = await this.prisma.club.update({
      where: { id: clubId },
      data: { paymentProvider: dto.paymentProvider },
      select: clubPaymentProviderStatusSelect,
    });
    return {
      clubName: club.name,
      ...clubPaymentProviderState(club),
      selectableProviders: [...SELECTABLE_PAYMENT_PROVIDERS],
    };
  }
}

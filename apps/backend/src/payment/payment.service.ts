import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BookingStatus } from "@prisma/client";
import { ClubsHelloAssoService } from "../clubs/clubs-helloasso.service";
import { handlePrismaError } from "../utils/prisma-errors.util";
import { idOnlySelect } from "../utils/prisma-selects";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCheckoutDto } from "./dto/create-checkout.dto";
import { HelloAssoService } from "./hello-asso.service";
import { PaymentNotificationService } from "./payment-notification.service";

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly helloAssoService: HelloAssoService,
    private readonly clubsHelloAssoService: ClubsHelloAssoService,
    private readonly configService: ConfigService,
    private readonly paymentNotificationService: PaymentNotificationService,
  ) {}

  async createCheckout(userId: string, body: CreateCheckoutDto) {
    // 1. Vérifier que la compétition a un club organisateur avec HelloAsso connecté
    const credentials =
      await this.clubsHelloAssoService.getHelloAssoCredentialsForCompetition(
        body.competitionId,
      );
    if (!credentials) {
      throw new BadRequestException(
        "Le club organisateur de cette compétition n'a pas connecté son compte HelloAsso. " +
          "L'organisateur doit configurer HelloAsso dans Paramètres du club.",
      );
    }

    // 2. Charger l'utilisateur pour les infos paiement
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    if (!user) {
      throw new BadRequestException("User not found");
    }

    // 3. Créer une réservation en attente
    let booking;
    try {
      booking = await this.prisma.seatBooking.create({
        data: {
          competitionId: body.competitionId,
          userId: user.id,
          itemId: body.itemId,
          seatLabel: body.seatLabel,
          status: "PENDING",
          expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min
        },
      });
    } catch (err) {
      handlePrismaError(err, "SeatBooking");
    }

    const appBaseUrl =
      this.configService.get<string>("APP_URL") ?? "https://app.example.com";

    try {
      const intent = await this.helloAssoService.createCheckoutIntent(
        credentials,
        appBaseUrl,
        {
          amount: body.amount,
          label: `Place Compétition - ${body.seatLabel ?? body.itemId}`,
          consumerEmail: user.email,
          consumerFirstName: user.firstName,
          consumerLastName: user.lastName,
          metadata: {
            bookingId: booking.id,
            competitionId: body.competitionId,
          },
        },
      );

      await this.prisma.seatBooking.update({
        where: { id: booking.id },
        data: { paymentId: intent.id },
      });

      return intent;
    } catch (error) {
      this.logger.error(
        `Payment initiation failed for booking ${booking.id}`,
        error instanceof Error ? error.stack : error,
      );
      await this.prisma.seatBooking
        .delete({ where: { id: booking.id } })
        .catch(() => {});
      throw new BadRequestException("Échec de l'initiation du paiement");
    }
  }

  /**
   * Confirms a booking paid through HelloAsso, then tells the organizer club.
   *
   * IDEMPOTENT: HelloAsso replays webhooks. The transition is a conditional
   * write (`status != CONFIRMED`), atomic in the database, so of two
   * deliveries of the same payment — even concurrent — exactly one moves the
   * booking and notifies the club; the others are no-ops.
   */
  async confirmBooking(bookingId: string): Promise<void> {
    const { count } = await this.prisma.seatBooking.updateMany({
      where: { id: bookingId, status: { not: BookingStatus.CONFIRMED } },
      data: { status: BookingStatus.CONFIRMED },
    });

    if (count === 0) {
      const existing = await this.prisma.seatBooking.findUnique({
        where: { id: bookingId },
        select: idOnlySelect,
      });
      if (!existing) {
        throw new NotFoundException("Réservation introuvable");
      }
      this.logger.log(
        `Booking ${bookingId} already confirmed: webhook replay ignored`,
      );
      return;
    }

    // Never rejects: a notification failure must not fail the webhook.
    await this.paymentNotificationService.notifyPaymentReceived(bookingId);
  }
}

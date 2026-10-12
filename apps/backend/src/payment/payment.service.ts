import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Sentry from "@sentry/nestjs";
import { ClubsHelloAssoService } from "../clubs/clubs-helloasso.service";
import { handlePrismaError } from "../utils/prisma-errors.util";
import { PrismaService } from "../prisma/prisma.service";
import {
  competitionSeatPricingSelect,
  seatBookingPaymentCheckSelect,
} from "../utils/prisma-selects";
import { CreateCheckoutDto } from "./dto/create-checkout.dto";
import { WebhookPayloadDto } from "./dto/webhook-payload.dto";
import { HelloAssoService } from "./hello-asso.service";
import {
  checkOrderAgainstBooking,
  getWebhookMetadata,
  type OrderRejectionReason,
} from "./helloasso-order-check";
import { resolveSeatPriceCents } from "./seat-pricing";

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly helloAssoService: HelloAssoService,
    private readonly clubsHelloAssoService: ClubsHelloAssoService,
    private readonly configService: ConfigService,
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

    // 2. Prix de la place, fixé côté serveur (#381) : `body.amount` est ignoré
    const competition = await this.prisma.competition.findUnique({
      where: { id: body.competitionId },
      select: competitionSeatPricingSelect,
    });
    const amountCents = competition
      ? resolveSeatPriceCents(competition.layout, body.itemId)
      : null;
    if (amountCents === null) {
      throw new BadRequestException(
        "Aucun tarif n'est défini pour cette place : le paiement en ligne est indisponible.",
      );
    }

    // 3. Charger l'utilisateur pour les infos paiement
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    if (!user) {
      throw new BadRequestException("User not found");
    }

    // 4. Créer une réservation en attente
    let booking;
    try {
      booking = await this.prisma.seatBooking.create({
        data: {
          competitionId: body.competitionId,
          userId: user.id,
          itemId: body.itemId,
          seatLabel: body.seatLabel,
          status: "PENDING",
          expectedAmountCents: amountCents,
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
          amount: amountCents,
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
        // HelloAsso returns a numeric id; the column is a string.
        data: { paymentId: String(intent.id) },
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
   * Signed HelloAsso `Order` notification (#381): confirms the booking only
   * when the order is paid, for the expected amount, on the booking's
   * competition and checkout intent (fail-closed, see
   * `checkOrderAgainstBooking`). A rejection never throws — HelloAsso gets a
   * 2xx and does not retry — but is logged and reported to Sentry
   * (identifiers only, no personal data).
   *
   * A legacy booking (created before #381, no stored expected amount) is
   * rejected rather than compared against today's layout price: the price may
   * have changed since, and such holds expired after 15 minutes anyway.
   *
   * The transition is a conditional update (PENDING + same expected amount)
   * so a booking cancelled or re-priced between the read and the write is
   * never confirmed.
   */
  async handleOrderWebhook(payload: WebhookPayloadDto): Promise<void> {
    const bookingId = getWebhookMetadata(payload)?.bookingId;
    if (!bookingId) return; // Not a seat-booking checkout.

    const orderId = payload.data.id;
    const booking = await this.prisma.seatBooking.findUnique({
      where: { id: bookingId },
      select: seatBookingPaymentCheckSelect,
    });
    if (!booking) {
      this.rejectOrder(bookingId, orderId, "booking_not_found");
      return;
    }
    if (booking.status === "CONFIRMED") {
      // HelloAsso redelivery of an order already processed: nothing to do.
      this.logger.log(`Booking ${bookingId} already confirmed`);
      return;
    }

    const reason = checkOrderAgainstBooking(payload, booking);
    if (reason) {
      this.rejectOrder(bookingId, orderId, reason);
      return;
    }

    const { count } = await this.prisma.seatBooking.updateMany({
      where: {
        id: booking.id,
        status: "PENDING",
        expectedAmountCents: booking.expectedAmountCents,
      },
      data: { status: "CONFIRMED" },
    });
    if (count === 0) this.rejectOrder(bookingId, orderId, "not_pending");
  }

  private rejectOrder(
    bookingId: string,
    orderId: number | undefined,
    reason: OrderRejectionReason,
  ): void {
    this.logger.error(
      `HelloAsso order ${orderId ?? "?"} rejected for booking ${bookingId}: ${reason}`,
    );
    Sentry.captureMessage("HelloAsso order rejected", {
      level: "error",
      tags: { payment: "helloasso-order-rejected", reason },
      extra: { bookingId, orderId },
    });
  }

  async confirmBooking(bookingId: string): Promise<void> {
    await this.prisma.seatBooking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    });
  }
}

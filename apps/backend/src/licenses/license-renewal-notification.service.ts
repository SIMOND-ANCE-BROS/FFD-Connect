import { Injectable, Logger } from "@nestjs/common";
import { LicenseRenewalStatus, NotificationType } from "@prisma/client";
import {
  adminRecipientsOrderBy,
  adminRecipientsWhere,
  MAX_ADMINS_NOTIFIED,
} from "../notifications/admin-recipients";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { getErrorMessage } from "../utils/error.utils";
import { idOnlySelect } from "../utils/prisma-selects";
import { toLicenseQrExpiry } from "./qr/license-qr";

/**
 * Push copy of the licence renewal notifications (#269).
 *
 * Deliberately generic: a notification is shown on a lock screen and is not
 * erased with the request, so it carries NO name (neither the licensee's nor
 * the reviewer's) and NO health data — not the rejection reason
 * (`MEDICAL_RESTRICTION` is health data), not the reviewer's comment, nothing
 * read on a certificate. The details are read in the app, behind login.
 */
export const LICENSE_RENEWAL_PUSH_COPY = {
  toReview: {
    title: "Renouvellement de licence à vérifier",
    body: "Une demande de renouvellement de licence attend votre vérification.",
  },
  approved: {
    title: "Renouvellement de licence approuvé",
    body: (validUntil: Date): string => {
      const [year, month, day] = toLicenseQrExpiry(validUntil).split("-");
      return `Votre licence est renouvelée jusqu'au ${day}/${month}/${year}.`;
    },
  },
  rejected: {
    title: "Renouvellement de licence refusé",
    body: "Votre demande de renouvellement de licence n'a pas été acceptée. Ouvrez l'application pour en savoir plus.",
  },
} as const;

/** `data.type` of the payloads: drives the deep link on the client. */
export const LICENSE_RENEWAL_TO_REVIEW_DATA_TYPE = "LICENSE_RENEWAL_TO_REVIEW";
export const LICENSE_RENEWAL_DECISION_DATA_TYPE = "LICENSE_RENEWAL_DECISION";

export type LicenseRenewalDecision =
  | { status: typeof LicenseRenewalStatus.APPROVED; validUntil: Date }
  | { status: typeof LicenseRenewalStatus.REJECTED };

/**
 * Licence renewal notifications (#269): the administrators when a request
 * awaits review, the licensee when an administrator decides.
 *
 * FIRE-AND-FORGET by contract: callers invoke these methods AFTER their
 * transaction committed and do not await them. The returned promise never
 * rejects — every failure (admin lookup, feed write, push) is logged and
 * swallowed, so a notification can never fail, nor delay, a submission or a
 * decision. User preferences are applied by NotificationsService (push
 * filtered, in-app feed always written).
 */
@Injectable()
export class LicenseRenewalNotificationService {
  private readonly logger = new Logger(LicenseRenewalNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * LICENSE_RENEWAL_TO_REVIEW to every enabled administrator. A disabled
   * account cannot log in to act on it: it is skipped. Oldest accounts first,
   * so that the bounded subset is deterministic.
   */
  async notifyToReview(requestId: string): Promise<void> {
    try {
      const admins = await this.prisma.user.findMany({
        where: adminRecipientsWhere(),
        select: idOnlySelect,
        orderBy: adminRecipientsOrderBy,
        take: MAX_ADMINS_NOTIFIED,
      });
      await this.notifications.sendToUsers(
        admins.map((admin) => admin.id),
        NotificationType.LICENSE_RENEWAL_TO_REVIEW,
        LICENSE_RENEWAL_PUSH_COPY.toReview.title,
        LICENSE_RENEWAL_PUSH_COPY.toReview.body,
        { type: LICENSE_RENEWAL_TO_REVIEW_DATA_TYPE, requestId },
      );
    } catch (error) {
      this.logger.warn(
        `Licence renewal ${requestId}: admin notification failed: ${getErrorMessage(error)}`,
      );
    }
  }

  /** LICENSE_RENEWAL_DECISION to the licensee who submitted the request. */
  async notifyDecision(
    userId: string,
    requestId: string,
    decision: LicenseRenewalDecision,
  ): Promise<void> {
    try {
      const approved = decision.status === LicenseRenewalStatus.APPROVED;
      await this.notifications.sendToUser(
        userId,
        NotificationType.LICENSE_RENEWAL_DECISION,
        approved
          ? LICENSE_RENEWAL_PUSH_COPY.approved.title
          : LICENSE_RENEWAL_PUSH_COPY.rejected.title,
        approved
          ? LICENSE_RENEWAL_PUSH_COPY.approved.body(decision.validUntil)
          : LICENSE_RENEWAL_PUSH_COPY.rejected.body,
        {
          type: LICENSE_RENEWAL_DECISION_DATA_TYPE,
          requestId,
          status: decision.status,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Licence renewal ${requestId}: licensee notification failed: ${getErrorMessage(error)}`,
      );
    }
  }
}

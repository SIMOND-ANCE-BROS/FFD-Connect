import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { licenseEntryQrSelect } from "../utils/prisma-selects";
import { entryQrHolderName } from "./qr/entry-qr";
import {
  EntryQrBatch,
  EntryQrKeySet,
  EntryQrService,
} from "./qr/entry-qr.service";

export const ENTRY_QR_DISABLED_MESSAGE =
  "QR d'entrée tournant indisponible : l'application garde le QR de licence statique.";
export const ENTRY_QR_NO_LICENSE_MESSAGE =
  "Aucune licence en cours de validité pour ce compte.";

/**
 * Reads behind the rotating entry QR (#24, ADR-0024): the batch of signed
 * tokens for the requester's own licence, and the public keys scanners
 * verify them with. Nothing is written: a batch is derived from the licence
 * and the signing key, so re-fetching it is idempotent.
 */
@Injectable()
export class EntryQrQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entryQrService: EntryQrService,
  ) {}

  /**
   * Batch of the user's own licence. 404 when the feature is off as well as
   * without a valid licence: never 503, which the app reads as "backend
   * asleep" and answers with wake-and-replay (backendWake.ts).
   */
  async getBatchForUser(
    userId: string,
    now: Date = new Date(),
  ): Promise<EntryQrBatch> {
    if (!this.entryQrService.canIssue()) {
      throw new NotFoundException(ENTRY_QR_DISABLED_MESSAGE);
    }
    const license = await this.prisma.license.findUnique({
      where: { userId },
      select: licenseEntryQrSelect,
    });
    if (!license?.user) {
      throw new NotFoundException(ENTRY_QR_NO_LICENSE_MESSAGE);
    }
    const batch = this.entryQrService.issueBatch(
      {
        licenseId: license.id,
        number: license.number,
        holderName: entryQrHolderName(
          license.user.firstName,
          license.user.lastName,
        ),
      },
      license.validUntil,
      now,
    );
    if (!batch) {
      throw new NotFoundException(ENTRY_QR_NO_LICENSE_MESSAGE);
    }
    return batch;
  }

  getKeySet(): EntryQrKeySet {
    return this.entryQrService.getKeySet();
  }
}

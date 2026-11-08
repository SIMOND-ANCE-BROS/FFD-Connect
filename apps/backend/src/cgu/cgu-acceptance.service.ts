import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { cguAcceptanceSelect } from "../utils/prisma-selects";
import { cguAcceptance } from "./cgu-acceptance";
import { CGU_VERSION } from "./cgu-version";
import type { CguAcceptanceDto } from "./dto/cgu-acceptance.dto";

/** Records that an account accepted the CGU in force (#894). */
@Injectable()
export class CguAcceptanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Only the CURRENT version can be accepted: an app showing an older text
   * (the CGU changed in between) gets a 409 rather than recording a version
   * the user never read.
   *
   * Idempotent: accepting a version the account already accepted keeps the
   * timestamp of the FIRST acceptance — the proof of consent is not
   * overwritten by a replay (offline resync, second device).
   */
  async accept(userId: string, version: string): Promise<CguAcceptanceDto> {
    if (version !== CGU_VERSION) {
      throw new ConflictException(
        "Les conditions générales d'utilisation ont changé entre-temps.",
      );
    }
    await this.prisma.user.updateMany({
      where: {
        id: userId,
        OR: [
          { cguAcceptedVersion: null },
          { cguAcceptedVersion: { not: version } },
        ],
      },
      data: { cguAcceptedVersion: version, cguAcceptedAt: new Date() },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: cguAcceptanceSelect,
    });
    if (!user) throw new NotFoundException("Utilisateur introuvable");
    return cguAcceptance(user);
  }
}

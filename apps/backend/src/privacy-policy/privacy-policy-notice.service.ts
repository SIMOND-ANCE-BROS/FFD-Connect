import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { privacyPolicySeenVersionSelect } from "../utils/prisma-selects";
import type { PrivacyPolicyNoticeDto } from "./dto/privacy-policy-notice.dto";
import { privacyPolicyNotice } from "./privacy-policy-notice";
import { PRIVACY_POLICY_VERSION } from "./privacy-policy-version";

/** Records that a user was told about the current policy version (#734). */
@Injectable()
export class PrivacyPolicyNoticeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Only the CURRENT version can be acknowledged: an app that read an older
   * one (the policy changed in between) gets a 409 and shows the notice again
   * at its next check, rather than recording a version the user never saw.
   */
  async acknowledge(
    userId: string,
    version: string,
  ): Promise<PrivacyPolicyNoticeDto> {
    if (version !== PRIVACY_POLICY_VERSION) {
      throw new ConflictException(
        "La politique de confidentialité a changé entre-temps.",
      );
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { privacyPolicySeenVersion: version },
      select: privacyPolicySeenVersionSelect,
    });
    return privacyPolicyNotice(user.privacyPolicySeenVersion);
  }
}

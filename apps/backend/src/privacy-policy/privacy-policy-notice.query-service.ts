import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { privacyPolicySeenVersionSelect } from "../utils/prisma-selects";
import type { PrivacyPolicyNoticeDto } from "./dto/privacy-policy-notice.dto";
import { privacyPolicyNotice } from "./privacy-policy-notice";

/** Reads whether a user still has to be told about the policy (#734). */
@Injectable()
export class PrivacyPolicyNoticeQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async getNotice(userId: string): Promise<PrivacyPolicyNoticeDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: privacyPolicySeenVersionSelect,
    });
    if (!user) throw new NotFoundException("Utilisateur introuvable");
    return privacyPolicyNotice(user.privacyPolicySeenVersion);
  }
}

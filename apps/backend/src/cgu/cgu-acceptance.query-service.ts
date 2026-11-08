import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { cguAcceptanceSelect } from "../utils/prisma-selects";
import { cguAcceptance } from "./cgu-acceptance";
import type { CguAcceptanceDto } from "./dto/cgu-acceptance.dto";

/** Reads whether an account accepted the CGU in force (#894). */
@Injectable()
export class CguAcceptanceQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async getAcceptance(userId: string): Promise<CguAcceptanceDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: cguAcceptanceSelect,
    });
    if (!user) throw new NotFoundException("Utilisateur introuvable");
    return cguAcceptance(user);
  }
}

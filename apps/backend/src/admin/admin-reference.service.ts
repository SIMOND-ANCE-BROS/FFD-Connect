import { Injectable } from "@nestjs/common";
import { PassportLevel, UserRole } from "@prisma/client";
import {
  COMPETITION_LEVELS,
  COUPLE_AGE_GROUPS,
  SOLO_AGE_GROUPS,
} from "../common/age-group";
import { USER_CATEGORIES } from "../common/user-categories";
import { PrismaService } from "../prisma/prisma.service";
import { adminClubOptionSelect } from "../utils/prisma-selects";
import {
  AdminClubOptionDto,
  AdminReferenceDataDto,
} from "./dto/admin-reference.dto";

/** Clubs are a small, federation-wide list; 1000 is a safety bound. */
const MAX_CLUBS = 1000;

@Injectable()
export class AdminReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  referenceData(): AdminReferenceDataDto {
    return {
      categories: [...USER_CATEGORIES],
      ageGroups: [...COUPLE_AGE_GROUPS, ...SOLO_AGE_GROUPS],
      competitionLevels: [...COMPETITION_LEVELS],
      passportLevels: Object.values(PassportLevel),
      roles: Object.values(UserRole),
    };
  }

  clubs(): Promise<AdminClubOptionDto[]> {
    return this.prisma.club.findMany({
      orderBy: { name: "asc" },
      take: MAX_CLUBS,
      select: adminClubOptionSelect,
    });
  }
}

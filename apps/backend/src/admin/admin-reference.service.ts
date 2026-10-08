import { Injectable } from "@nestjs/common";
import { PassportLevel, UserRole } from "@prisma/client";
import {
  COMPETITION_LEVELS,
  COUPLE_AGE_GROUPS,
  SOLO_AGE_GROUPS,
} from "../common/age-group";
import { USER_CATEGORIES } from "../common/user-categories";
import { AdminReferenceDataDto } from "./dto/admin-reference.dto";

@Injectable()
export class AdminReferenceService {
  referenceData(): AdminReferenceDataDto {
    return {
      categories: [...USER_CATEGORIES],
      ageGroups: [...COUPLE_AGE_GROUPS, ...SOLO_AGE_GROUPS],
      competitionLevels: [...COMPETITION_LEVELS],
      passportLevels: Object.values(PassportLevel),
      roles: Object.values(UserRole),
    };
  }
}

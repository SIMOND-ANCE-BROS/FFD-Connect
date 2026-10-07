import { ApiPropertyOptional } from "@nestjs/swagger";
import { PassportLevel, UserRole } from "@prisma/client";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import {
  COMPETITION_LEVELS,
  COUPLE_AGE_GROUPS,
  SOLO_AGE_GROUPS,
} from "../../common/age-group";
import { USER_CATEGORIES } from "../../common/user-categories";

const AGE_GROUPS = [...COUPLE_AGE_GROUPS, ...SOLO_AGE_GROUPS];
/** `null` clears the field; an absent key leaves it unchanged. */
const notNull = (_: object, v: unknown) => v !== null;

export class UpdateAdminUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @ValidateIf(notNull)
  @IsOptional()
  @IsUUID()
  clubId?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: USER_CATEGORIES })
  @ValidateIf(notNull)
  @IsOptional()
  @IsIn(USER_CATEGORIES)
  category?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: AGE_GROUPS })
  @ValidateIf(notNull)
  @IsOptional()
  @IsIn(AGE_GROUPS)
  ageGroup?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: PassportLevel,
    enumName: "PassportLevel",
  })
  @ValidateIf(notNull)
  @IsOptional()
  @IsEnum(PassportLevel)
  passportLevelLatin?: PassportLevel | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: PassportLevel,
    enumName: "PassportLevel",
  })
  @ValidateIf(notNull)
  @IsOptional()
  @IsEnum(PassportLevel)
  passportLevelStandard?: PassportLevel | null;

  @ApiPropertyOptional({ nullable: true, enum: COMPETITION_LEVELS })
  @ValidateIf(notNull)
  @IsOptional()
  @IsIn(COMPETITION_LEVELS)
  competitionLevel?: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  @ValidateIf(notNull)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  nationalRanking?: number | null;

  @ApiPropertyOptional({ enum: UserRole, enumName: "UserRole" })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

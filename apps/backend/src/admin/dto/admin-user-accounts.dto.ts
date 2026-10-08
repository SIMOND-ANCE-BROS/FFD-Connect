import { ApiProperty, ApiPropertyOptional, PickType } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";
import type { InvitationRole } from "../../auth/email.service";
import { UpdateAdminUserDto } from "./update-admin-user.dto";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** ADMIN is never created here: it is granted afterwards from the user page. */
export const INVITABLE_ROLES: readonly InvitationRole[] = [
  UserRole.LICENSEE,
  UserRole.CLUB,
  UserRole.STAFF,
];

/** Optional profile fields reuse the PATCH validation (reference lists). */
export class CreateAdminUserDto extends PickType(UpdateAdminUserDto, [
  "category",
  "ageGroup",
  "passportLevelLatin",
  "passportLevelStandard",
  "competitionLevel",
  "nationalRanking",
] as const) {
  @ApiProperty()
  @Transform(trim)
  @IsEmail()
  email!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  lastName!: string;

  @ApiProperty({ enum: [...INVITABLE_ROLES] })
  @IsIn([...INVITABLE_ROLES])
  role!: InvitationRole;

  @ApiPropertyOptional({
    enum: [...INVITABLE_ROLES],
    isArray: true,
    description:
      "Rôles supplémentaires (hors Admin ; le rôle principal en est retiré)",
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn([...INVITABLE_ROLES], { each: true })
  extraRoles?: UserRole[];

  @ApiPropertyOptional({
    description: "Club existant (exclusif avec clubName)",
  })
  @IsOptional()
  @IsUUID()
  clubId?: string;

  @ApiPropertyOptional({
    description:
      "Nouveau club, pour un compte Club ou ayant le rôle Club en supplément (exclusif avec clubId)",
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  clubName?: string;
}

export class AdminUserCreatedDto {
  @ApiProperty() userId!: string;
  @ApiProperty({ nullable: true, type: String }) clubId!: string | null;
  @ApiProperty() invitationSent!: boolean;
}

export class InvitationResultDto {
  @ApiProperty() invitationSent!: boolean;
}

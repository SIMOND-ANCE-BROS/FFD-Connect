import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ClubRegistrationMode, UserRole } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { PaginationParamsDto } from "../../common/dto/pagination-params.dto";
import { AdminPageMetaDto } from "./admin-audit.dto";
import { ACCOUNT_STATUSES, type AccountStatusFilter } from "./admin-users.dto";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class ListAdminClubsQueryDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: "Nom du club" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trim)
  search?: string;

  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES })
  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: AccountStatusFilter;
}

export class ClubOptionsQueryDto {
  @ApiPropertyOptional({
    description: "Club à inclure même s'il est désactivé (valeur actuelle)",
  })
  @IsOptional()
  @IsUUID()
  includeId?: string;
}

export class AdminClubListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ClubRegistrationMode, enumName: "ClubRegistrationMode" })
  registrationMode!: ClubRegistrationMode;
  @ApiProperty({ nullable: true, type: Date }) disabledAt!: Date | null;
  @ApiProperty({ description: "Membres hors comptes Club" })
  memberCount!: number;
  @ApiProperty() clubAccountCount!: number;
  @ApiProperty({
    description: "Identifiants HelloAsso renseignés (jamais exposés)",
  })
  helloAssoConfigured!: boolean;
  @ApiProperty() createdAt!: Date;
}

export class AdminClubsPageDto {
  @ApiProperty({ type: [AdminClubListItemDto] }) data!: AdminClubListItemDto[];
  @ApiProperty({ type: AdminPageMetaDto }) meta!: AdminPageMetaDto;
}

export class AdminClubMemberDto {
  @ApiProperty() id!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: UserRole, enumName: "UserRole" }) role!: UserRole;
  @ApiProperty({ nullable: true, type: Date }) disabledAt!: Date | null;
}

export class AdminClubDetailDto extends AdminClubListItemDto {
  @ApiProperty({ description: "Compétitions dont l'organisateur porte ce nom" })
  competitionCount!: number;
  @ApiProperty() partnershipCount!: number;
  @ApiProperty() soloTeamCount!: number;
  @ApiProperty({
    type: [AdminClubMemberDto],
    description: "200 premiers membres, triés par nom",
  })
  members!: AdminClubMemberDto[];
}

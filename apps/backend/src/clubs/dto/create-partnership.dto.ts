import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsEnum, IsOptional, IsUUID } from "class-validator";
import { PartnershipManagementMode } from "@prisma/client";

export class CreatePartnershipDto {
  @ApiProperty({ description: "ID du premier licencié" })
  @IsUUID()
  user1Id!: string;

  @ApiProperty({ description: "ID du second licencié" })
  @IsUUID()
  user2Id!: string;

  @ApiPropertyOptional({
    description:
      "ID du second club (couple inter-club). Si fourni, le couple est en attente de validation par ce club.",
  })
  @IsUUID()
  @IsOptional()
  secondaryClubId?: string;

  @ApiPropertyOptional({
    description:
      "Qui peut gérer le couple (défaut: PRIMARY_ONLY si mono-club, BOTH si inter-club)",
  })
  @IsEnum(PartnershipManagementMode)
  @IsOptional()
  managementMode?: PartnershipManagementMode;

  @ApiPropertyOptional({
    description: "Date de début du partenariat (défaut: aujourd'hui)",
  })
  @IsDateString()
  @IsOptional()
  startDate?: string;
}

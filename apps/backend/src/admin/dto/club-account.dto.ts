import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, IsUUID, Length } from "class-validator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class CreateClubAccountDto {
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

  @ApiPropertyOptional({
    description: "Club existant (exclusif avec clubName)",
  })
  @IsOptional()
  @IsUUID()
  clubId?: string;

  @ApiPropertyOptional({ description: "Nouveau club (exclusif avec clubId)" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  clubName?: string;
}

export class ClubAccountCreatedDto {
  @ApiProperty() userId!: string;
  @ApiProperty() clubId!: string;
  @ApiProperty() invitationSent!: boolean;
}

export class InvitationResultDto {
  @ApiProperty() invitationSent!: boolean;
}

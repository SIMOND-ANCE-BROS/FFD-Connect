import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class ConnectHelloAssoDto {
  @ApiProperty({
    description: "Client ID de l'application HelloAsso du club",
    example: "your-client-id",
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  clientId!: string;

  @ApiProperty({
    description: "Client Secret de l'application HelloAsso du club",
    example: "your-client-secret",
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  clientSecret!: string;

  @ApiProperty({
    description:
      "Slug de l'organisation HelloAsso (visible dans l'URL du compte)",
    example: "mon-club-danse",
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  organizationSlug!: string;
}

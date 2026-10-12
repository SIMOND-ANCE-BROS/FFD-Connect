import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

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
    maxLength: 255,
    example: "your-client-secret",
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(255)
  clientSecret!: string;

  @ApiProperty({
    description:
      "Slug de l'organisation HelloAsso (visible dans l'URL du compte)",
    example: "mon-club-danse",
    maxLength: 255,
    pattern: "^[a-z0-9-]+$",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(255)
  // HelloAsso slugs are lower-case letters, digits and dashes (#404): never
  // `.`/`/`, which would alter the API path built from it.
  @Matches(/^[a-z0-9-]+$/, {
    message:
      "organizationSlug must contain only lower-case letters, digits and dashes",
  })
  organizationSlug!: string;
}

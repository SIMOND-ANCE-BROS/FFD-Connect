import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class RefreshTokenDto {
  @ApiProperty({
    description:
      "Le refresh token à utiliser pour obtenir un nouveau access token",
    example: "a1b2c3d4e5f6...",
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  refresh_token!: string;
}

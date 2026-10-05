import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsUUID } from "class-validator";

/**
 * DTO pour la désinscription d'un membre par l'organisateur du club.
 */
export class UnregisterMemberDto {
  @ApiProperty({
    description: "ID de l'événement",
    example: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  })
  @IsUUID(4)
  @IsNotEmpty()
  eventId!: string;

  @ApiProperty({
    description: "ID du membre à désinscrire",
    example: "b1ffcd00-0d1c-5fg9-cc7e-7cc0ce491b22",
  })
  @IsUUID(4)
  @IsNotEmpty()
  userId!: string;
}

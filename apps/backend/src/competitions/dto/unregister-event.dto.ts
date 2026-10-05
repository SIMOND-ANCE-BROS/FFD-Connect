import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsUUID } from "class-validator";

/**
 * DTO pour la désinscription d'un événement de compétition
 */
export class UnregisterEventDto {
  @ApiProperty({
    description: "ID de l'événement dont se désinscrire",
    example: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  })
  @IsUUID(4, { message: "eventId doit être un UUID v4 valide" })
  @IsNotEmpty()
  eventId!: string;
}

import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

/**
 * DTO pour le check-in d'un participant à une compétition
 */
export class CheckInDto {
  @ApiProperty({
    description: "Données QR code du participant à checker",
    example: '{"userId":"user-123","eventId":"event-456"}',
  })
  @IsString()
  @IsNotEmpty()
  qrData!: string;
}

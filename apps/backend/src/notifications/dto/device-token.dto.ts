import { ApiProperty } from "@nestjs/swagger";
import { DevicePlatform } from "@prisma/client";
import { IsEnum, IsNotEmpty, IsString, MaxLength } from "class-validator";

/**
 * Borne haute acceptée pour un token de registration FCM. Firebase ne documente
 * pas de longueur maximale, mais les tokens actuels font ~160-200 caractères :
 * 512 laisse une marge confortable tout en réduisant d'un facteur 8 ce qu'un
 * compte authentifié peut écrire en base par ligne. Le token est une chaîne
 * arbitraire fournie par le client : c'est la seule borne côté entrée.
 */
export const DEVICE_TOKEN_MAX_LENGTH = 512;

const TOKEN_EXAMPLE =
  "fJ8kQm2xTZm4:APA91bFxq0Zx-exemple-de-token-de-registration-FCM";

/**
 * DTO d'enregistrement d'un appareil pour les notifications push.
 * Envoyé par le client à l'ouverture de session (et au renouvellement du token
 * par Firebase). L'upsert est fait sur le token, l'utilisateur est déduit du JWT.
 */
export class RegisterDeviceTokenDto {
  @ApiProperty({
    description: "Token de registration FCM de l'appareil",
    example: TOKEN_EXAMPLE,
    maxLength: DEVICE_TOKEN_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(DEVICE_TOKEN_MAX_LENGTH, {
    message: `Le token ne peut pas dépasser ${DEVICE_TOKEN_MAX_LENGTH} caractères`,
  })
  token!: string;

  @ApiProperty({
    enum: DevicePlatform,
    description: "Plateforme de l'appareil (IOS ou ANDROID)",
    example: DevicePlatform.IOS,
  })
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;
}

/**
 * DTO de désenregistrement d'un appareil (déconnexion). Seul le propriétaire
 * du token peut le retirer ; l'appel est idempotent.
 */
export class UnregisterDeviceTokenDto {
  @ApiProperty({
    description: "Token de registration FCM à retirer",
    example: TOKEN_EXAMPLE,
    maxLength: DEVICE_TOKEN_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(DEVICE_TOKEN_MAX_LENGTH, {
    message: `Le token ne peut pas dépasser ${DEVICE_TOKEN_MAX_LENGTH} caractères`,
  })
  token!: string;
}

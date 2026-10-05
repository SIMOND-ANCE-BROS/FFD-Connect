import { ApiProperty } from "@nestjs/swagger";
import { NotificationType } from "@prisma/client";
import { IsBoolean, IsEnum } from "class-validator";

/**
 * DTO de mise à jour d'un interrupteur de l'écran de réglages.
 *
 * Un seul type par appel : l'écran bascule un interrupteur à la fois, et un
 * lot n'apporterait qu'une sémantique d'échec partiel à arbitrer.
 *
 * `@IsEnum` borne les valeurs acceptées à l'enum Prisma, mais pas aux types
 * RÉGLABLES : le service refuse les autres (cf. `setPreference`).
 */
export class UpdateNotificationPreferenceDto {
  @ApiProperty({
    enum: NotificationType,
    description:
      "Type d'événement à régler, tel que renvoyé par GET /notifications/preferences",
    example: NotificationType.NEW_COMPETITION,
  })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiProperty({
    description: "true pour recevoir les notifications push de ce type",
    example: false,
  })
  @IsBoolean()
  enabled!: boolean;
}

/**
 * Entrée du catalogue renvoyée au client : de quoi afficher un interrupteur
 * sans connaître l'enum ni la copie associée.
 */
export class NotificationPreferenceDto {
  @ApiProperty({
    enum: NotificationType,
    description: "Type d'événement",
    example: NotificationType.REGISTRATION_STATUS,
  })
  type!: NotificationType;

  @ApiProperty({
    description:
      "État effectif : le choix enregistré s'il existe, le défaut documenté sinon",
    example: true,
  })
  enabled!: boolean;

  @ApiProperty({
    description: "Libellé court de l'interrupteur",
    example: "Mes inscriptions",
  })
  label!: string;

  @ApiProperty({
    description: "Quand cette notification arrive, du point de vue utilisateur",
    example:
      "Quand votre inscription à une épreuve est enregistrée, validée, refusée ou annulée par votre club.",
  })
  description!: string;
}

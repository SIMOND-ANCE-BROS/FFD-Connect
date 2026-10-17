import { ApiProperty } from "@nestjs/swagger";
import { ClubRegistrationMode } from "@prisma/client";

/** `GET /clubs/me/helloasso`: the club's HelloAsso connection, no credential. */
export class HelloAssoStatusDto {
  @ApiProperty() clubName!: string;

  @ApiProperty({
    description: "Identifiants HelloAsso renseignés (jamais exposés)",
  })
  helloAssoConnected!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Slug de l'organisation HelloAsso, quand le club est connecté",
  })
  organizationSlug!: string | null;

  /**
   * Kept for the installed apps that still read it here (#665). Removal: once
   * the minimum supported app version reads `GET /clubs/me/registration-mode`.
   */
  @ApiProperty({
    enum: ClubRegistrationMode,
    enumName: "ClubRegistrationMode",
    deprecated: true,
    description:
      "Déprécié (#665) : le mode d'inscription n'a rien de propre à HelloAsso. " +
      "Lire `GET /clubs/me/registration-mode`. Conservé pour les applications déjà installées.",
  })
  registrationMode!: ClubRegistrationMode;
}

import { ApiProperty } from "@nestjs/swagger";

/** Lot de QR d'entrée tournants signés pour la licence du demandeur (#24). */
export class EntryQrBatchDto {
  @ApiProperty({ example: 3, description: "Version du QR (v3 = tournant)" })
  version!: number;

  @ApiProperty({
    example: "AbCdEfGhIjK",
    description: "Identifiant de la clé de signature (champ `k` du QR)",
  })
  keyId!: string;

  @ApiProperty({ example: "3f0c6d2e-…" })
  licenseId!: string;

  @ApiProperty({ example: "FFD-123456" })
  number!: string;

  @ApiProperty({
    example: "DUPONT Jean",
    description: "Nom affiché au scanner hors ligne (champ `nm` du QR)",
  })
  holderName!: string;

  @ApiProperty({ example: 30, description: "Durée d'un pas de temps (s)" })
  stepSeconds!: number;

  @ApiProperty({
    example: 1,
    description: "Pas acceptés de part et d'autre de l'heure du scanner",
  })
  toleranceSteps!: number;

  @ApiProperty({
    example: 59612345,
    description:
      "Pas de temps de `signatures[0]` (floor(secondes Unix / stepSeconds)) ; `signatures[i]` signe le pas `firstStep + i`",
  })
  firstStep!: number;

  @ApiProperty({
    type: [String],
    description:
      "Signatures Ed25519 (base64url), une par pas de temps, sur 12 h au plus (jamais au-delà de la fin de validité de la licence)",
  })
  signatures!: string[];

  @ApiProperty({
    type: String,
    format: "date-time",
    description:
      "Fin du dernier pas couvert : l'application doit renouveler le lot avant",
  })
  coversUntil!: Date;
}

export class EntryQrPublicKeyDto {
  @ApiProperty({ example: "AbCdEfGhIjK" })
  kid!: string;

  @ApiProperty({
    description: "Clé publique Ed25519 brute (32 octets), base64url",
    example: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
  })
  publicKey!: string;

  @ApiProperty({
    description:
      "Vrai pour la clé qui signe les nouveaux lots ; faux pour une clé retirée encore acceptée",
  })
  active!: boolean;
}

/** Clés publiques de vérification hors ligne des QR tournants (#24). */
export class EntryQrKeySetDto {
  @ApiProperty({ example: 3 })
  version!: number;

  @ApiProperty({ example: 30 })
  stepSeconds!: number;

  @ApiProperty({ example: 1 })
  toleranceSteps!: number;

  @ApiProperty({
    type: [EntryQrPublicKeyDto],
    description: "Vide si le QR tournant est désactivé",
  })
  keys!: EntryQrPublicKeyDto[];
}

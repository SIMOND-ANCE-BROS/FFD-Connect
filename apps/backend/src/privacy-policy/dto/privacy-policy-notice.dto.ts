import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches } from "class-validator";
import { PRIVACY_POLICY_VERSION_PATTERN } from "../privacy-policy-version";

/** Whether the signed-in user still has to be told about the policy (#734). */
export class PrivacyPolicyNoticeDto {
  @ApiProperty({
    example: "2026-10-17",
    description: "Version en vigueur de la politique de confidentialité",
  })
  currentVersion!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: "2026-10-17",
    description:
      "Dernière version signalée à l'utilisateur et dont il a pris connaissance (null : aucune)",
  })
  seenVersion!: string | null;

  @ApiProperty({
    description:
      "true : afficher l'avis « la politique de confidentialité a été mise à jour »",
  })
  pending!: boolean;
}

export class AcknowledgePrivacyPolicyDto {
  @ApiProperty({
    example: "2026-10-17",
    description: "Version dont l'utilisateur a pris connaissance",
  })
  @IsString()
  @Matches(PRIVACY_POLICY_VERSION_PATTERN)
  version!: string;
}

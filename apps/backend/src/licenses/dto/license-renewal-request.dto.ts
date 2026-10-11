import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
} from "@prisma/client";
import {
  RENEWAL_REJECTION_REASONS,
  RenewalRejectionReason,
} from "./admin-license-renewal.dto";

/**
 * Fields read on a renewal document, as whitelisted by `pickRenewalOcrData`
 * (#224): never the raw certificate text.
 */
export class LicenseRenewalOcrDataDto {
  @ApiPropertyOptional() isApte?: boolean;
  @ApiPropertyOptional() date?: string;
  @ApiPropertyOptional() doctorName?: string;
  @ApiPropertyOptional() licenseNumber?: string;
  @ApiPropertyOptional() expiryDate?: string;
}

export class LicenseRenewalDocumentDto {
  @ApiProperty() id!: string;
  @ApiProperty() requestId!: string;
  @ApiProperty({
    enum: LicenseRenewalDocumentType,
    enumName: "LicenseRenewalDocumentType",
  })
  type!: LicenseRenewalDocumentType;
  @ApiProperty() filePath!: string;
  @ApiProperty({ type: LicenseRenewalOcrDataDto, nullable: true })
  ocrData!: LicenseRenewalOcrDataDto | null;
  @ApiProperty() createdAt!: Date;
}

/**
 * The licensee's own renewal request (#268): its status and, once decided,
 * the outcome of the review. The reviewer's identity is never exposed.
 */
export class LicenseRenewalRequestDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({
    enum: LicenseRenewalStatus,
    enumName: "LicenseRenewalStatus",
  })
  status!: LicenseRenewalStatus;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) submittedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) reviewedAt!: Date | null;
  @ApiProperty({
    nullable: true,
    enum: RENEWAL_REJECTION_REASONS,
    enumName: "LicenseRenewalRejectionReason",
    // The shared enum schema gets its own generic description; without it,
    // Nest copies the property-specific one below onto the component.
    enumSchema: {
      description:
        "Code du motif de refus d'une demande de renouvellement de licence.",
    },
    description:
      "Motif du refus (null sauf demande refusée). `MEDICAL_RESTRICTION` est ramené à `OTHER` par la purge de rétention.",
  })
  rejectionReason!: RenewalRejectionReason | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      "Commentaire de l'administrateur au licencié. Effacé avec le certificat par la purge de rétention.",
  })
  reviewComment!: string | null;
  @ApiProperty({ type: [LicenseRenewalDocumentDto] })
  documents!: LicenseRenewalDocumentDto[];
}

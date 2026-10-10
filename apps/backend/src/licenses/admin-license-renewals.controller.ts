import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { UserRole } from "@prisma/client";
import type { Response } from "express";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { simulatedEmptyPage } from "../auth/store-review/store-review-responses";
import { StoreReviewRead } from "../auth/store-review/store-review.decorator";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import {
  AdminLicenseRenewalDetailDto,
  AdminLicenseRenewalsPageDto,
  ApproveLicenseRenewalDto,
  ListAdminLicenseRenewalsQueryDto,
  RejectLicenseRenewalDto,
} from "./dto/admin-license-renewal.dto";
import { LicenseRenewalModerationQueryService } from "./license-renewal-moderation.query-service";
import { LicenseRenewalModerationService } from "./license-renewal-moderation.service";

/**
 * Response headers of a renewal document (health data, GDPR art. 9): never
 * cached, shown inline, its type never sniffed, and sandboxed so a crafted
 * file (PDF, image) cannot run script in the back-office origin.
 */
export const RENEWAL_DOCUMENT_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "Content-Disposition": "inline",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox",
};

/**
 * Human moderation of licence renewals (#266, ADR-0021). Guards and role are
 * set on the CLASS (as AdminController): no route can be exposed by omission.
 *
 * Store-review account (ADMIN, shared with the stores): its GETs are not on
 * the read allowlist (empty page / empty object), its decisions are simulated
 * by the global StoreReviewInterceptor — it never sees a certificate.
 */
@ApiTags("admin")
@ApiCommonErrorResponses()
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("admin/license-renewals")
export class AdminLicenseRenewalsController {
  constructor(
    private readonly query: LicenseRenewalModerationQueryService,
    private readonly moderation: LicenseRenewalModerationService,
  ) {}

  @StoreReviewRead(simulatedEmptyPage)
  @Get()
  @ApiOperation({
    summary: "File des demandes de renouvellement",
    description:
      "Paginée (take ≤ 50), plus anciennes soumissions d'abord. Filtre status (par défaut PENDING). Ni fichier, ni donnée lue sur les documents.",
  })
  @ApiResponse({ status: 200, type: AdminLicenseRenewalsPageDto })
  list(
    @Query() query: ListAdminLicenseRenewalsQueryDto,
  ): Promise<AdminLicenseRenewalsPageDto> {
    return this.query.list(query);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Détail d'une demande de renouvellement",
    description:
      "Demande, documents (indices OCR tant qu'elle est en attente), fin de validité qu'accorderait une approbation, historique des demandes du même utilisateur (statuts et dates). Consultation tracée (LICENSE_RENEWAL_VIEW).",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: AdminLicenseRenewalDetailDto })
  @ApiResponse({ status: 404, description: "Demande non trouvée" })
  detail(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ): Promise<AdminLicenseRenewalDetailDto> {
    return this.query.detail(req.user.userId, id);
  }

  @Get(":id/documents/:docId/file")
  // Per admin: enough to review a queue, not to bulk-download certificates.
  @UseGuards(ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({
    summary: "Fichier d'un document (certificat médical ou de licence)",
    description:
      "Servi en flux authentifié, jamais mis en cache, uniquement tant que la demande est en attente (410 ensuite). Consultation tracée (LICENSE_RENEWAL_DOCUMENT_VIEW). Limité à 30 ouvertures par minute.",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiParam({ name: "docId", format: "uuid" })
  @ApiProduces("image/jpeg", "image/png", "application/pdf")
  @ApiResponse({
    status: 200,
    description: "Contenu du document",
    content: {
      "image/jpeg": { schema: { type: "string", format: "binary" } },
      "image/png": { schema: { type: "string", format: "binary" } },
      "application/pdf": { schema: { type: "string", format: "binary" } },
    },
  })
  @ApiResponse({ status: 404, description: "Document ou fichier introuvable" })
  @ApiResponse({
    status: 410,
    description: "Demande traitée : documents plus consultables",
  })
  @ApiResponse({ status: 429, description: "Trop d'ouvertures" })
  @ApiResponse({ status: 503, description: "Stockage indisponible" })
  async documentFile(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("docId", ParseUUIDPipe) docId: string,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.query.openDocument(req.user.userId, id, docId);
    for (const [name, value] of Object.entries(RENEWAL_DOCUMENT_HEADERS)) {
      res.setHeader(name, value);
    }
    return new StreamableFile(file.stream, {
      type: file.contentType,
      disposition: "inline",
    });
  }

  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Approuver une demande (renouvelle la licence)",
    description:
      "Licence renouvelée jusqu'au 31 août (Europe/Paris) de la saison accordée à la date de la décision, jamais raccourcie. Numéro : celui confirmé par l'administrateur, sinon la lecture OCR, sinon celui de la licence existante ; aucun → 400 (jamais de numéro inventé). Tracé (LICENSE_RENEWAL_APPROVE).",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: AdminLicenseRenewalDetailDto })
  @ApiResponse({ status: 400, description: "Aucun numéro de licence connu" })
  @ApiResponse({ status: 404, description: "Demande non trouvée" })
  @ApiResponse({
    status: 409,
    description:
      "Demande déjà traitée, ou numéro de licence attribué à un autre compte",
  })
  approve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ApproveLicenseRenewalDto,
    @Req() req: RequestWithUser,
  ): Promise<AdminLicenseRenewalDetailDto> {
    return this.moderation.approve(req.user.userId, id, dto);
  }

  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Refuser une demande",
    description:
      "Motif obligatoire parmi les codes, commentaire facultatif (≤ 500). Le certificat médical est purgé au plus tard 30 jours après la décision. Tracé (LICENSE_RENEWAL_REJECT, sans le motif).",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: AdminLicenseRenewalDetailDto })
  @ApiResponse({ status: 404, description: "Demande non trouvée" })
  @ApiResponse({ status: 409, description: "Demande déjà traitée" })
  reject(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectLicenseRenewalDto,
    @Req() req: RequestWithUser,
  ): Promise<AdminLicenseRenewalDetailDto> {
    return this.moderation.reject(req.user.userId, id, dto);
  }
}

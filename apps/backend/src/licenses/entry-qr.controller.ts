import { Controller, Get, Header, Request, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NoImpersonationGuard } from "../auth/no-impersonation.guard";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { StoreReviewOwnData } from "../auth/store-review/store-review.decorator";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import { EntryQrBatchDto, EntryQrKeySetDto } from "./dto/entry-qr.dto";
import { EntryQrQueryService } from "./entry-qr.query-service";

/**
 * Rotating entry QR (#24, ADR-0023): the licensee's phone pre-fetches a
 * batch of short-lived signed tokens; scanners download the public keys and
 * verify a QR without network.
 */
@ApiTags("licenses")
@ApiCommonErrorResponses()
@Controller("licenses")
export class EntryQrController {
  constructor(private readonly entryQrQueryService: EntryQrQueryService) {}

  @StoreReviewOwnData()
  @Get("my/entry-qr")
  // An administrator "logged in as" someone must not walk away with a batch
  // that admits its holder for 12 h (#545).
  @UseGuards(JwtAuthGuard, NoImpersonationGuard, ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Header("Cache-Control", "no-store")
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Lot de QR d'entrée tournants de ma licence",
    description:
      "Signatures Ed25519 d'un QR d'entrée par pas de 30 s, sur les 12 prochaines heures (au plus jusqu'à la fin de validité de la licence). L'application affiche le QR du pas courant (v3) et le renouvelle quand elle a du réseau ; un scanner le vérifie hors ligne avec la clé publique (GET /licenses/entry-qr/keys).",
  })
  @ApiResponse({ status: 200, type: EntryQrBatchDto })
  @ApiResponse({
    status: 404,
    description:
      "Aucune licence en cours de validité pour ce compte, ou QR tournant désactivé (pas de clé de signature) : garder le QR statique",
  })
  @ApiResponse({
    status: 403,
    description: "Session d'impersonation (« connecté en tant que »)",
  })
  getMyEntryQr(@Request() req: RequestWithUser): Promise<EntryQrBatchDto> {
    return this.entryQrQueryService.getBatchForUser(req.user.userId);
  }

  // Public on purpose: a volunteer scanner may have no account, and these
  // are public keys. The global per-IP limit applies.
  @Get("entry-qr/keys")
  @Header("Cache-Control", "public, max-age=3600")
  @ApiOperation({
    summary: "Clés publiques de vérification des QR d'entrée tournants",
    description:
      "Clés Ed25519 (active + retirées encore acceptées) avec lesquelles un scanner vérifie un QR v3 sans réseau. À télécharger à l'ouverture du scanner et à garder en cache.",
  })
  @ApiResponse({ status: 200, type: EntryQrKeySetDto })
  getEntryQrKeys(): EntryQrKeySetDto {
    return this.entryQrQueryService.getKeySet();
  }
}

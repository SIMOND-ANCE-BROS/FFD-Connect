import { Controller, Get, Header } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { StoreReviewReadable } from "../auth/store-review/store-review.decorator";
import { DisciplineCatalogQueryService } from "./discipline-catalog.query-service";
import { DisciplineCatalogDto } from "./dto/discipline-catalog.dto";

/**
 * Catalog of dance domains, disciplines and capabilities (ADR-0026, #1022).
 *
 * Public on purpose: reference data with no personal data, needed before
 * sign-in (registration form). The global per-IP limit applies. It changes
 * rarely, so clients and intermediaries may cache it for an hour.
 */
// No ApiCommonErrorResponses: a public read with no input answers neither
// 400, 401, 403, 404 nor 409.
@ApiTags("disciplines")
@Controller("disciplines")
export class DisciplinesController {
  constructor(private readonly query: DisciplineCatalogQueryService) {}

  // No-op today (no auth guard, so no store-review user is ever resolved
  // here); keeps the route serving real data if a guard is added later.
  @StoreReviewReadable()
  @Get()
  @Header("Cache-Control", "public, max-age=3600")
  @ApiOperation({
    summary: "Référentiel des domaines de danse et de leurs disciplines",
    description:
      "Domaines (familles de danses de la fédération) dans l'ordre d'affichage, chacun avec ses capacités et ses disciplines actives. Public, sans authentification ; à garder en cache (Cache-Control : 1 h).",
  })
  @ApiResponse({ status: 200, type: DisciplineCatalogDto })
  @ApiResponse({
    status: 429,
    description: "Trop de requêtes (limite globale de débit)",
  })
  getCatalog(): Promise<DisciplineCatalogDto> {
    return this.query.getCatalog();
  }
}

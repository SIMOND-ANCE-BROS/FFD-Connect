import {
  BadRequestException,
  Controller,
  Get,
  Head,
  Header,
  Param,
  Post,
  Request as Req,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Request as ExpressRequest } from "express";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { API_GLOBAL_PREFIX } from "../../common/api-prefix";
import { ThrottlerUserGuard } from "../../common/guards/throttler-user.guard";
import { PKPASS_MIME_TYPE } from "./apple-wallet-pass.generator";
import { AppleWalletPassService } from "./apple-wallet-pass.service";
import {
  AppleWalletPassLinkDto,
  WalletPassTokenParamDto,
} from "./dto/apple-wallet.dto";
import { StoreReviewPassthrough } from "../../auth/store-review/store-review.decorator";

interface RequestWithUser extends ExpressRequest {
  user: { userId: string };
}

/** Route of the public download, relative to the API prefix. */
export const APPLE_WALLET_DOWNLOAD_PATH = "licenses/wallet/apple";

/** Hostname or bracketed IPv6 literal, optional port. */
const HOST_PATTERN = /^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:\d{1,5})?$/;

/**
 * Public origin the client reached, as seen behind the Container Apps
 * ingress (TLS terminated upstream ⇒ trust `X-Forwarded-Proto`). A forged
 * header only changes the URL handed back to the caller itself.
 */
export function publicOrigin(req: ExpressRequest): string {
  const forwarded = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const protocol =
    proto === "https" || proto === "http" ? proto : req.protocol || "http";
  const host = req.get("host") ?? "";
  if (!HOST_PATTERN.test(host)) {
    throw new BadRequestException("Invalid Host header");
  }
  return `${protocol}://${host}`;
}

/**
 * Apple Wallet license pass (#162). Two steps because Safari, which shows the
 * native "Add to Apple Wallet" sheet, does not carry the app's JWT.
 */
@ApiTags("licenses")
@Controller("licenses")
export class AppleWalletController {
  constructor(private readonly walletPassService: AppleWalletPassService) {}

  @StoreReviewPassthrough()
  @Post("my/wallet/apple")
  @UseGuards(JwtAuthGuard, ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Lien de téléchargement du pass Apple Wallet de ma licence",
    description:
      "Émet un lien (valable 5 minutes, 5 téléchargements au plus) vers le pass `.pkpass` de la licence de l'utilisateur connecté, à ouvrir dans le navigateur. Émettre un lien invalide les précédents.",
  })
  @ApiResponse({
    status: 201,
    description: "Lien émis",
    type: AppleWalletPassLinkDto,
  })
  @ApiResponse({ status: 401, description: "Non authentifié" })
  @ApiResponse({ status: 404, description: "Aucune licence pour ce compte" })
  @ApiResponse({ status: 422, description: "Licence expirée" })
  @ApiResponse({ status: 429, description: "Trop de demandes" })
  @ApiResponse({
    status: 503,
    description:
      "Fonctionnalité indisponible (pass non configuré ou signature des QR désactivée)",
  })
  async createDownloadLink(
    @Req() req: RequestWithUser,
  ): Promise<AppleWalletPassLinkDto> {
    // Validate the Host first: a bad header must not leave a token behind.
    const origin = publicOrigin(req);
    const { token, expiresAt } =
      await this.walletPassService.issueDownloadToken(req.user.userId);
    const path = `${APPLE_WALLET_DOWNLOAD_PATH}/${token}`;
    return {
      url: `${origin}/${API_GLOBAL_PREFIX}/${path}`,
      path,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Express answers `HEAD` with the `GET` handler of the same path unless an
   * explicit `HEAD` route is registered first — so this one must stay declared
   * BEFORE `downloadPass`. A probe (browser, link preview) then gets the status
   * the download would get, without spending a download or signing a pass.
   */
  @Head("wallet/apple/:token")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @Header("Content-Type", PKPASS_MIME_TYPE)
  @ApiOperation({
    summary: "Vérifie un lien de pass Apple Wallet sans le consommer",
    description:
      "Mêmes codes que le `GET`, sans corps : ne décompte pas de téléchargement et ne génère pas le pass.",
  })
  @ApiOkResponse({ description: "Lien utilisable" })
  @ApiResponse({ status: 400, description: "Jeton mal formé" })
  @ApiResponse({ status: 404, description: "Lien invalide ou épuisé" })
  @ApiResponse({ status: 410, description: "Lien expiré" })
  @ApiResponse({ status: 429, description: "Trop de demandes" })
  @ApiResponse({ status: 503, description: "Fonctionnalité indisponible" })
  async checkPassLink(@Param() params: WalletPassTokenParamDto): Promise<void> {
    await this.walletPassService.checkDownloadToken(params.token);
  }

  @Get("wallet/apple/:token")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @ApiOperation({
    summary: "Télécharge le pass Apple Wallet",
    description:
      "Route publique : le jeton émis par `POST /licenses/my/wallet/apple` tient lieu d'authentification, pour 5 téléchargements au plus pendant sa durée de vie (certains navigateurs iOS récupèrent le fichier plusieurs fois).",
  })
  @ApiProduces(PKPASS_MIME_TYPE)
  @ApiOkResponse({
    description: "Pass signé",
    schema: { type: "string", format: "binary" },
  })
  @ApiResponse({ status: 400, description: "Jeton mal formé" })
  @ApiResponse({
    status: 404,
    description:
      "Lien invalide ou épuisé (5 téléchargements), ou licence introuvable",
  })
  @ApiResponse({ status: 410, description: "Lien expiré" })
  @ApiResponse({ status: 422, description: "Licence expirée" })
  @ApiResponse({ status: 429, description: "Trop de demandes" })
  @ApiResponse({ status: 503, description: "Fonctionnalité indisponible" })
  async downloadPass(
    @Param() params: WalletPassTokenParamDto,
  ): Promise<StreamableFile> {
    const pass = await this.walletPassService.consumeAndGeneratePass(
      params.token,
    );
    return new StreamableFile(pass, {
      type: PKPASS_MIME_TYPE,
      disposition: 'attachment; filename="ffd-connect-licence.pkpass"',
      length: pass.length,
    });
  }
}

import { HttpService } from "@nestjs/axios";
import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";

import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { WdsfAthleteResponse } from "./interfaces/wdsf-athlete.interface";
import { parsePersonsToAthlete } from "./wdsf.utils";

/** Valeurs par défaut si WDSF_API_V1_URL / WDSF_API_V2_URL non définis (doc: https://github.com/jaykay-design/WDSF-API/wiki/Accessing-the-service) */
const DEFAULT_WDSF_V1_URL = "https://services.worlddancesport.org/api/1";
const DEFAULT_WDSF_V2_URL = "https://api.wdsf.org/api/2";

/** Accept header pour la liste de personnes (doc: https://github.com/jaykay-design/WDSF-API/wiki/Media-Types#applicationvndworlddancesportpersons) */
const WDSF_ACCEPT_PERSONS_JSON = "application/vnd.worlddancesport.persons+json";
/** Accept pour une seule personne (application/vnd.worlddancesport.person) — certains endpoints renvoient ce type */
const WDSF_ACCEPT_PERSON_JSON = "application/vnd.worlddancesport.person+json";
/** Valeur utilisée pour les requêtes : on accepte les deux formats. */
const WDSF_ACCEPT = `${WDSF_ACCEPT_PERSONS_JSON}, ${WDSF_ACCEPT_PERSON_JSON}`;
/** Pour l'API v1, la doc indique "Accept: application/json" pour le JSON (obligatoire). */
const WDSF_ACCEPT_V1 = "application/json";

@Injectable()
export class WdsfService {
  private readonly logger = new Logger(WdsfService.name);

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
    private circuitBreakerService: CircuitBreakerService,
  ) {}

  /**
   * Construit les headers d'authentification WDSF.
   * - Si WDSF_API_KEY est défini : API v2 avec header X-WDSF-API-KEY (token généré sur https://my.wdsf.org/Account/Manage/Tokens).
   * - Sinon WDSF_USERNAME + WDSF_PASSWORD : API v1 avec Basic Auth.
   * Quand les deux sont configurés, on privilégie la v1 (API principale, meilleure couverture des MIN).
   * Les URLs sont configurables via WDSF_API_V1_URL et WDSF_API_V2_URL (ex. staging: https://sandbox.worlddancesport.org/api/1).
   */
  private getAuthConfig(): {
    baseUrl: string;
    headers: Record<string, string>;
    isV1: boolean;
  } {
    const username = this.configService.get<string>("WDSF_USERNAME");
    const password = this.configService.get<string>("WDSF_PASSWORD");
    const hasV1 = Boolean(username?.trim() && password?.trim());
    const apiKey = this.configService.get<string>("WDSF_API_KEY");
    const hasV2 = Boolean(apiKey?.trim());

    // Quand les deux sont présents : privilégier v1 (meilleure couverture, doc WDSF)
    if (hasV1) {
      const baseUrl =
        this.configService.get<string>("WDSF_API_V1_URL")?.trim() ??
        DEFAULT_WDSF_V1_URL;
      const auth = Buffer.from(`${username!.trim()}:${password!}`).toString(
        "base64",
      );
      return {
        baseUrl,
        isV1: true,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: WDSF_ACCEPT_V1,
        },
      };
    }
    if (hasV2) {
      const baseUrl =
        this.configService.get<string>("WDSF_API_V2_URL")?.trim() ??
        DEFAULT_WDSF_V2_URL;
      return {
        baseUrl,
        isV1: false,
        headers: {
          "X-WDSF-API-KEY": apiKey!.trim(),
          Accept: WDSF_ACCEPT,
        },
      };
    }
    this.logger.error(
      "WDSF credentials not configured: set WDSF_API_KEY (v2 token) or WDSF_USERNAME + WDSF_PASSWORD (v1) in .env",
    );
    throw new ServiceUnavailableException(
      "Vérification WDSF indisponible. Contacter l’administrateur.",
    );
  }

  /**
   * Appelle l'API WDSF /person?min= (paramètre comme dans l'exemple officiel PHP).
   * @see https://github.com/jaykay-design/WDSF-API/blob/master/PHP/min.php
   */
  private async fetchPersonByMin(
    baseUrl: string,
    headers: Record<string, string>,
    min: string,
  ): Promise<unknown> {
    const url = `${baseUrl}/person?min=${encodeURIComponent(min)}`;
    const response = await this.circuitBreakerService.fire("wdsf", () =>
      firstValueFrom(
        this.httpService.get<
          | WdsfAthleteResponse[]
          | { persons?: unknown[]; data?: unknown[]; items?: unknown[] }
        >(url, { headers }),
      ),
    );
    return response.data;
  }

  /**
   * Récupère les informations d'un athlète WDSF par son numéro MIN (Member Identification Number).
   * Si WDSF_API_KEY (v2) est configuré et renvoie 404, tente un fallback avec l'API v1 (Basic Auth)
   * si WDSF_USERNAME + WDSF_PASSWORD sont présents (la v2 est provisoire et peut ne pas avoir tous les MIN).
   */
  async getAthleteByMin(min: string) {
    const primary = this.getAuthConfig();
    const url = `${primary.baseUrl}/person?min=${encodeURIComponent(min)}`;
    this.logger.debug(
      `WDSF request: GET ${url} (${primary.isV1 ? "v1" : "v2"})`,
    );

    const tryFetch = async (
      baseUrl: string,
      headers: Record<string, string>,
    ): Promise<ReturnType<typeof parsePersonsToAthlete>> => {
      const data = await this.fetchPersonByMin(baseUrl, headers, min);
      return parsePersonsToAthlete(data, min);
    };

    try {
      return await tryFetch(primary.baseUrl, primary.headers);
    } catch (error: unknown) {
      const status =
        error &&
        typeof error === "object" &&
        "response" in error &&
        error.response &&
        typeof error.response === "object" &&
        "status" in error.response
          ? (error.response as { status: number }).status
          : 0;

      // Fallback: si on a utilisé v1 et 404 → réessayer avec v2 (si configuré). Sinon si on a utilisé v2 et 404 → réessayer avec v1.
      const username = this.configService.get<string>("WDSF_USERNAME");
      const password = this.configService.get<string>("WDSF_PASSWORD");
      const apiKey = this.configService.get<string>("WDSF_API_KEY")?.trim();
      const hasV1 = Boolean(username?.trim() && password?.trim());
      const hasV2 = Boolean(apiKey);

      if (status === 404 && primary.isV1 && hasV2) {
        const v2Url =
          this.configService.get<string>("WDSF_API_V2_URL")?.trim() ??
          DEFAULT_WDSF_V2_URL;
        this.logger.log(
          `WDSF v1 returned 404 for MIN=${min}, retrying with API v2 (${v2Url})`,
        );
        try {
          return await tryFetch(v2Url, {
            "X-WDSF-API-KEY": apiKey!,
            Accept: WDSF_ACCEPT,
          });
        } catch (v2Error: unknown) {
          this.logWdsfFallbackError("v2", min, v2Error);
        }
      } else if (status === 404 && !primary.isV1 && hasV1) {
        const v1Url =
          this.configService.get<string>("WDSF_API_V1_URL")?.trim() ??
          DEFAULT_WDSF_V1_URL;
        const auth = Buffer.from(`${username!.trim()}:${password!}`).toString(
          "base64",
        );
        this.logger.log(
          `WDSF v2 returned 404 for MIN=${min}, retrying with API v1 (${v1Url})`,
        );
        try {
          return await tryFetch(v1Url, {
            Authorization: `Basic ${auth}`,
            Accept: WDSF_ACCEPT_V1,
          });
        } catch (v1Error: unknown) {
          this.logWdsfFallbackError("v1", min, v1Error);
        }
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`WDSF API Error: ${errorMessage}`);
      if (
        error &&
        typeof error === "object" &&
        "response" in error &&
        error.response &&
        typeof error.response === "object" &&
        "status" in error.response &&
        "data" in error.response
      ) {
        const axiosResponse = error.response as {
          data: unknown;
          status: number;
        };
        this.logger.warn(
          `WDSF API response: status=${axiosResponse.status} data=${JSON.stringify(axiosResponse.data).slice(0, 500)}`,
        );
        throw new HttpException(
          axiosResponse.status === 404
            ? {
                message: "Numéro MIN invalide ou introuvable.",
                code: "WDSF_ATHLETE_NOT_FOUND",
              }
            : (axiosResponse.data as string | Record<string, unknown>),
          axiosResponse.status,
        );
      }
      throw error;
    }
  }

  /**
   * Log détaillé en cas d'échec du fallback (réseau, 401, etc.)
   */
  private logWdsfFallbackError(
    apiLabel: string,
    min: string,
    err: unknown,
  ): void {
    const res =
      err && typeof err === "object" && "response" in err
        ? (err as { response?: { status?: number; data?: unknown } }).response
        : undefined;
    const status = res?.status;
    const dataSnippet =
      res?.data != null
        ? typeof res.data === "string"
          ? res.data.slice(0, 200)
          : JSON.stringify(res.data).slice(0, 200)
        : "";
    const msg = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code: string }).code
        : "";
    if (status === 401) {
      this.logger.warn(
        `WDSF ${apiLabel} fallback: 401 Unauthorized. Vérifiez les identifiants dans .env (v1: https://sso.wdsf.org/Register/Account/ServiceConsumer, v2: https://my.wdsf.org/Account/Manage/Tokens). MIN=${min}`,
      );
    } else {
      this.logger.warn(
        `WDSF ${apiLabel} fallback failed for MIN=${min}: status=${status ?? "n/a"} code=${code || "n/a"} message=${msg} body=${dataSnippet}`,
      );
    }
  }
}

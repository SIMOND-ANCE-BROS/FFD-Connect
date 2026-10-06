import {
  trackCorrectionsControllerApprove,
  trackCorrectionsControllerCreate,
  trackCorrectionsControllerList,
  trackCorrectionsControllerListMine,
  trackCorrectionsControllerPendingCount,
  trackCorrectionsControllerReject,
  type ApproveTrackCorrectionDto,
  type CreateTrackCorrectionDto,
  type MyTrackCorrectionDto,
  type MyTrackCorrectionPageDto,
  type TrackCorrectionAdminDto,
  type TrackCorrectionAdminPageDto,
  type TrackCorrectionReason,
  type TrackCorrectionStatus,
} from "../../api/generated";
import { ERROR_MESSAGES } from "../../constants/errorMessages";

export type {
  ApproveTrackCorrectionDto,
  CreateTrackCorrectionDto,
  MyTrackCorrectionDto,
  MyTrackCorrectionPageDto,
  TrackCorrectionAdminDto,
  TrackCorrectionAdminPageDto,
  TrackCorrectionReason,
  TrackCorrectionStatus,
};

/**
 * Échec d'un appel « propositions de correction ».
 *
 * `message` est déjà rédigé pour l'utilisateur (français) ; `status` permet à
 * l'appelant d'adapter son comportement (ex. 409 → rafraîchir la liste).
 */
export class TrackCorrectionApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status: number | undefined) {
    super(message);
    this.name = "TrackCorrectionApiError";
    this.status = status;
  }
}

type Operation = "create" | "review" | "load";

/**
 * Messages par code HTTP, par opération. Le texte serveur n'est pas affiché
 * tel quel : il peut être technique (validation) ou en anglais.
 */
const MESSAGES: Record<Operation, Partial<Record<number, string>>> = {
  create: {
    400: "Rien à corriger : modifiez au moins une valeur ou ajoutez un commentaire.",
    404: "Cette musique n'est plus disponible.",
    429: "Vous avez déjà plusieurs propositions en attente sur cette musique. Attendez qu'un administrateur les traite.",
  },
  review: {
    400: "Les valeurs saisies sont invalides.",
    404: "Cette proposition n'existe plus.",
    409: "Cette proposition a déjà été traitée.",
  },
  load: {},
};

const FALLBACK: Record<Operation, string> = {
  create: "L'envoi de la proposition a échoué. Réessayez.",
  review: ERROR_MESSAGES.OPERATION_FAILED,
  load: ERROR_MESSAGES.LOADING_FAILED,
};

/** Construit l'erreur à partir du code HTTP de la réponse (absent = réseau). */
export function toTrackCorrectionError(
  operation: Operation,
  status: number | undefined,
): TrackCorrectionApiError {
  const message =
    (status !== undefined ? MESSAGES[operation][status] : undefined) ??
    FALLBACK[operation];
  return new TrackCorrectionApiError(message, status);
}

interface SdkResult<T> {
  data?: T;
  error?: unknown;
  response?: { status: number };
}

function unwrap<T>(operation: Operation, result: SdkResult<T>): T {
  if (result.error !== undefined || result.data === undefined) {
    throw toTrackCorrectionError(operation, result.response?.status);
  }
  return result.data;
}

export interface TrackCorrectionPageParams {
  skip?: number;
  take?: number;
}

/**
 * Propositions de correction des métadonnées d'une musique (titre, artiste,
 * danse, MPM, clashs paso doble). Passe par le client OpenAPI généré.
 */
export const TrackCorrectionApi = {
  /** Envoie une proposition (tout utilisateur connecté). */
  async create(body: CreateTrackCorrectionDto): Promise<MyTrackCorrectionDto> {
    return unwrap("create", await trackCorrectionsControllerCreate({ body }));
  },

  /** Propositions de l'utilisateur connecté, plus récentes d'abord. */
  async listMine(
    params: TrackCorrectionPageParams = {},
  ): Promise<MyTrackCorrectionPageDto> {
    return unwrap(
      "load",
      await trackCorrectionsControllerListMine({ query: params }),
    );
  },

  /** File de modération (ADMIN), filtrable par statut. */
  async list(
    params: TrackCorrectionPageParams & { status?: TrackCorrectionStatus } = {},
  ): Promise<TrackCorrectionAdminPageDto> {
    return unwrap(
      "load",
      await trackCorrectionsControllerList({ query: params }),
    );
  },

  /** Nombre de propositions en attente (ADMIN) — badge. */
  async pendingCount(): Promise<number> {
    return unwrap("load", await trackCorrectionsControllerPendingCount()).count;
  },

  /** Valide une proposition, avec ajustements éventuels (ADMIN). */
  async approve(
    id: string,
    body: ApproveTrackCorrectionDto = {},
  ): Promise<TrackCorrectionAdminDto> {
    return unwrap(
      "review",
      await trackCorrectionsControllerApprove({ path: { id }, body }),
    );
  },

  /** Refuse une proposition (ADMIN). */
  async reject(id: string, comment?: string): Promise<TrackCorrectionAdminDto> {
    return unwrap(
      "review",
      await trackCorrectionsControllerReject({
        path: { id },
        body: comment ? { comment } : {},
      }),
    );
  },
};

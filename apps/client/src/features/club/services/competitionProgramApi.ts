// Side-effect: configures the generated OpenAPI client (baseUrl + auth + refresh).
import "../../../api/client";
import {
  competitionsControllerGetProgram,
  competitionsControllerReplaceProgram,
} from "../../../api/generated/sdk.gen";
import type {
  CompetitionProgramDto,
  ReplaceCompetitionProgramDto,
} from "../../../api/generated/types.gen";

/**
 * Programme (events + schedule) of a competition in the club editor (#442):
 * GET / PUT /competitions/:id/program.
 */

/** A failed call; `message` is French and can be shown to the club. */
export class CompetitionProgramError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CompetitionProgramError";
  }
}

/**
 * The server's own explanation for a refused programme (400 broken rule,
 * 409 event with registrations), French and meant for the club.
 */
function serverMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const { message } = error as { message?: unknown };
  if (typeof message === "string") return message;
  if (Array.isArray(message) && typeof message[0] === "string") {
    return message[0];
  }
  return null;
}

export async function fetchCompetitionProgram(
  competitionId: string,
): Promise<CompetitionProgramDto> {
  const { data, error, response } = await competitionsControllerGetProgram({
    path: { id: competitionId },
  });
  if (error || !data) {
    throw new CompetitionProgramError(
      "Impossible de charger les épreuves et le planning",
      response?.status,
    );
  }
  return data;
}

export async function saveCompetitionProgram(
  competitionId: string,
  body: ReplaceCompetitionProgramDto,
): Promise<CompetitionProgramDto> {
  const { data, error, response } = await competitionsControllerReplaceProgram({
    path: { id: competitionId },
    body,
  });
  if (error || !data) {
    const status = response?.status;
    const explained =
      status === 400 || status === 409 ? serverMessage(error) : null;
    throw new CompetitionProgramError(
      explained ?? "Impossible d'enregistrer les épreuves et le planning",
      status,
    );
  }
  return data;
}

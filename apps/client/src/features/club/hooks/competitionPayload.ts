import type {
  CreateCompetitionDto,
  UpdateCompetitionDto,
} from "../../../api/generated/types.gen";
import type {
  CompetitionKind,
  CompetitionStatus,
  CompetitionType,
  LayoutItem,
  MajorSubType,
} from "./useClubCompetitionEditorLogic.types";

/**
 * Body of POST/PATCH /competitions built from the club competition editor
 * (#417). Typed against the generated OpenAPI DTOs so the global
 * ValidationPipe (`whitelist` + `forbidNonWhitelisted`) can't reject a field
 * the backend doesn't declare.
 *
 * The « Épreuves » and « Planning » tabs are not part of this body: they are
 * saved right after by PUT /competitions/:id/program (#442, see
 * `competitionProgram.ts`).
 */

export type ApiCompetitionStatus = NonNullable<CreateCompetitionDto["status"]>;

export interface CompetitionEditorForm {
  kind: CompetitionKind;
  title: string;
  status: CompetitionStatus;
  date: Date;
  location: string;
  competitionType: CompetitionType;
  majorSubType: MajorSubType | null;
  eventsDescription: string;
  ticketingUrl: string;
  layoutItems: LayoutItem[];
  /** Rotating entry QR mandatory at check-in (#668). */
  requireRotatingQr: boolean;
}

/** Editor statuses predating #417 (DRAFT/OPEN/CLOSED) don't exist in the API. */
export function toApiCompetitionStatus(
  status: CompetitionStatus,
): ApiCompetitionStatus {
  switch (status) {
    case "LIVE":
    case "PAST":
    case "CANCELLED":
      return status;
    case "CLOSED":
      return "PAST";
    default:
      return "UPCOMING";
  }
}

const pad = (n: number) => n.toString().padStart(2, "0");

/** Local calendar day picked in the editor, as an ISO 8601 date (no time). */
export function toApiDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** An API (ISO 8601) date, or `null` for anything else (e.g. a display label). */
export function parseCompetitionDate(value?: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildCompetitionPayload(
  form: CompetitionEditorForm,
): CreateCompetitionDto {
  const ticketingUrl = form.ticketingUrl.trim();
  const common: CreateCompetitionDto = {
    title: form.title,
    status: toApiCompetitionStatus(form.status),
    date: toApiDate(form.date),
    location: form.location,
    type: form.kind,
    eventsDescription: form.eventsDescription,
    // Check-in at the entrance of a competition and of an event alike.
    requireRotatingQr: form.requireRotatingQr,
    // An empty string fails @IsUrl: omit it instead.
    ...(ticketingUrl ? { ticketingUrl } : {}),
  };
  if (form.kind === "EVENT") return common;

  return {
    ...common,
    competitionType: form.competitionType,
    ...(form.competitionType === "MAJEURE" && form.majorSubType
      ? { majorSubType: form.majorSubType }
      : {}),
    layout: form.layoutItems.map((item) => ({ ...item })),
  };
}

export function buildCompetitionUpdatePayload(
  form: CompetitionEditorForm,
): UpdateCompetitionDto {
  const payload = buildCompetitionPayload(form);
  if (form.kind === "EVENT") return payload;
  // `null` clears a sub-type left over from a former MAJEURE competition.
  return { ...payload, majorSubType: payload.majorSubType ?? null };
}

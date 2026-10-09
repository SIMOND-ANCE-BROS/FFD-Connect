import { registerAs } from "@nestjs/config";

/**
 * Configuration pour l'API FFD (Fédération Française de Danse)
 */
export default registerAs("ffd", () => ({
  apiBaseUrl: process.env.FFD_API_BASE_URL ?? "https://api.ffdanse.fr",
  apiPath: process.env.FFD_API_PATH ?? "/federal_actions",
  itemsPerPage: parseInt(process.env.FFD_ITEMS_PER_PAGE ?? "50", 10),
  danceFamilies: process.env.FFD_DANCE_FAMILIES ?? "latines-standards",
  eventCategory: process.env.FFD_EVENT_CATEGORY ?? "Compétitions",
  // TEMPORARY: deduce real épreuves from the FFD description / circular PDF
  // during the sync. On by default (opt-out with "false"): it only runs inside
  // the sync job, once per document, and costs no cloud resource.
  deduceEvents:
    (process.env.FFD_DEDUCE_EVENTS ?? "true").trim().toLowerCase() !== "false",
}));

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
}));

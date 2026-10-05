export interface FFDCompetitionItem {
  "@id": string;
  title: string;
  startAt: string;
  endAt?: string;
  status?: string;
  city?: string;
  address1?: string;
  zipCode?: string;
  description?: string;
  /** Programme des épreuves (texte libre HTML) — la seule info "épreuves" exposée par FFD. */
  danceEventDescription?: string;
  latitude?: number;
  longitude?: number;
  type?: { title: string };
  company?: { name: string };
  communicationLink?: string;
  communicationPhoto?: string | { path: string };
  fileLogisticInformation?: { path: string };
  /** PDF du programme des épreuves (souvent null). */
  fileEvents?: { path: string } | null;
}

export interface FFDResponse {
  "hydra:member": FFDCompetitionItem[];
  "hydra:totalItems"?: number;
}

import type { AuthRole } from "../../../stores/auth.store";

export type SpaceRole = Exclude<AuthRole, "GUEST">;

export const SPACE_LABELS: Record<SpaceRole, string> = {
  LICENSEE: "Danseur",
  CLUB: "Club",
  STAFF: "Staff",
  ADMIN: "Admin",
};

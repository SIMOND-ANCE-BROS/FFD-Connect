import { Request } from "express";

export interface JwtPayload {
  email: string;
  sub: string;
  role: string;
  clubName?: string;
  /** Présent quand ce token est une impersonation : id de l'acteur (admin/staff). */
  impersonatedBy?: string;
}

export interface RequestWithUser extends Request {
  user: {
    userId: string;
    email: string;
    role: string;
    /** Non-null si la session est une impersonation (#545) → bloque le destructif. */
    impersonatedBy?: string;
  };
}

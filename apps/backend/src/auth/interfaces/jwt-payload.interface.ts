import { UserRole } from "@prisma/client";
import { Request } from "express";

export interface JwtPayload {
  email: string;
  sub: string;
  role: string;
  clubName?: string;
  /** Présent quand ce token est une impersonation : id de l'acteur (admin). */
  impersonatedBy?: string;
  /**
   * Impersonation (#733) : id de la ligne `ImpersonationLog` de cette session.
   * Relue à chaque requête : la session meurt quand la ligne est close.
   */
  impersonationLogId?: string;
}

export interface RequestWithUser extends Request {
  user: {
    userId: string;
    email: string;
    role: string;
    /** Every effective role, read from the database on each request (lot 1c). */
    roles: UserRole[];
    /** Non-null si la session est une impersonation (#545) → bloque le destructif. */
    impersonatedBy?: string;
    /** Journal row of the impersonation session (#733), set with impersonatedBy. */
    impersonationLogId?: string;
    /** Store-review account (or an impersonation it opened): writes are simulated. */
    storeReview?: boolean;
  };
}

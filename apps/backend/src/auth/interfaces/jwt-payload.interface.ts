import { UserRole } from "@prisma/client";
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
    /** Every effective role, read from the database on each request (lot 1c). */
    roles: UserRole[];
    /** Non-null si la session est une impersonation (#545) → bloque le destructif. */
    impersonatedBy?: string;
    /** Store-review account (or an impersonation it opened): writes are simulated. */
    storeReview?: boolean;
  };
}

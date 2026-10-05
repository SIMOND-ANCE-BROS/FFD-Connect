import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { RequestWithUser } from "./interfaces/jwt-payload.interface";

/**
 * Bloque les actions destructives quand la session est une impersonation (#545).
 *
 * Un admin/staff « connecté en tant que » un tiers ne doit PAS pouvoir
 * supprimer le compte, changer le mot de passe, ni exporter/supprimer les
 * données RGPD de la cible. À appliquer sur ces endpoints (après JwtAuthGuard).
 */
@Injectable()
export class NoImpersonationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    if (req.user?.impersonatedBy) {
      throw new ForbiddenException(
        "Action impossible en mode impersonation (« connecté en tant que »).",
      );
    }
    return true;
  }
}

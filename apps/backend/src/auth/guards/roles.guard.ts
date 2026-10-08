import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { rolesOf } from "../roles";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      UserRole[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles?.length) {
      return true;
    }

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: { role: UserRole; roles?: UserRole[] } }>();
    if (!user) {
      return false;
    }

    const roles = user.roles ?? rolesOf({ role: user.role });
    const hasRole = requiredRoles.some((r) => roles.includes(r));
    if (!hasRole) {
      throw new ForbiddenException(
        `Permissions insuffisantes. Rôles requis: ${requiredRoles.join(", ")}`,
      );
    }

    return true;
  }
}

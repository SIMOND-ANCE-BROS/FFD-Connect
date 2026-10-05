import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/**
 * Convertit les erreurs Prisma connues en exceptions NestJS appropriées.
 * À utiliser dans les blocs catch des services.
 *
 * @example
 * try { ... } catch (err) { handlePrismaError(err, 'User'); }
 */
export function handlePrismaError(
  err: unknown,
  entityName = "Resource",
): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        throw new ConflictException(`${entityName} already exists`);
      case "P2025":
        throw new NotFoundException(`${entityName} not found`);
      case "P2003":
        throw new ConflictException(
          `Related resource not found for ${entityName}`,
        );
      case "P2014":
        throw new ConflictException(
          `Required relation for ${entityName} would be violated`,
        );
    }
  }
  throw err;
}

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

// Seuil en ms au-dessus duquel une requête Prisma est considérée lente
const SLOW_QUERY_THRESHOLD_MS = 200;

// Logger au niveau du module — nécessaire car `this` dans les callbacks $extends
// est le client étendu, pas le service NestJS
const prismaLogger = new Logger("PrismaService");

/** Callback pour $extends : log les requêtes plus lentes que le seuil. */
export async function slowQueryCallback({
  operation,
  model,
  args,
  query,
}: {
  operation: string;
  model: string | undefined;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}): Promise<unknown> {
  const before = Date.now();
  const result = await query(args);
  const duration = Date.now() - before;
  if (duration > SLOW_QUERY_THRESHOLD_MS) {
    prismaLogger.warn(
      `[SlowQuery] ${duration}ms — ${model ?? "raw"}.${operation}`,
    );
  }
  return result;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  declare private readonly isDevelopment: boolean;

  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>("DATABASE_URL");
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.isDevelopment =
      configService.get<string>("NODE_ENV") === "development";
  }

  async onModuleInit() {
    await this.$connect();

    // Slow query logging via $extends (Prisma 5+ — remplace $use supprimé)
    // $on('query') non supporté avec driver adapters
    // Actif uniquement en développement — en production, Pino + New Relic suffisent
    if (this.isDevelopment) {
      Object.assign(
        this,
        this.$extends({
          query: {
            $allModels: {
              $allOperations: slowQueryCallback,
            },
          },
        }),
      );
    }
  }
}

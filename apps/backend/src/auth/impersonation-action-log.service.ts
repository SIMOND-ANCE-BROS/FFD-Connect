import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { idOnlySelect } from "../utils/prisma-selects";

/** One write made during a support access (#761). */
export interface ImpersonationActionEntry {
  impersonationLogId: string;
  /** POST, PUT, PATCH or DELETE. */
  method: string;
  /** Route template, never the concrete URL (no ids, no query string). */
  route: string;
  statusCode: number;
}

/**
 * Journal of the writes made during a « se connecter en tant que » session
 * (#761). Each row hangs off its `ImpersonationLog` session (ON DELETE
 * CASCADE): it is purged with it, and carries no actor identity of its own.
 */
@Injectable()
export class ImpersonationActionLogService {
  private readonly logger = new Logger(ImpersonationActionLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records one write. Never throws: the response has already left when it
   * runs, so a failure can only be reported (and alerted on), not undone.
   */
  async record(entry: ImpersonationActionEntry): Promise<void> {
    try {
      await this.prisma.impersonationActionLog.create({
        data: entry,
        select: idOnlySelect,
      });
    } catch (error) {
      this.logger.error(
        `Support access write not journalled (${entry.method} ${entry.route} → ${entry.statusCode}, session ${entry.impersonationLogId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

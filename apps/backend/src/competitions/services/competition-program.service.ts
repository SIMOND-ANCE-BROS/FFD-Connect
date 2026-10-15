import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  competitionProgramEventSelect,
  competitionProgramHeaderSelect,
} from "../../utils/prisma-selects";
import type {
  CompetitionProgramDto,
  ProgramEventInputDto,
  ProgramScheduleItemInputDto,
  ReplaceCompetitionProgramDto,
} from "../dto/competition-program.dto";
import {
  type NormalizedProgramEvent,
  ProgramRuleError,
  normalizeProgramEvent,
  programEventLabel,
} from "../program/program-rules";
import { scheduleInstant } from "../program/schedule-time";
import { CompetitionCacheService } from "./competition-cache.service";
import { CompetitionProgramQueryService } from "./competition-program-query.service";

type StoredEvent = Prisma.EventGetPayload<{
  select: typeof competitionProgramEventSelect;
}>;

/** Room for the stored rows: write caps + events imported from the FFD. */
const STORED_ROWS_LIMIT = 1000;
/** Up to a few hundred row writes: above Prisma's 5 s default. */
const TRANSACTION_TIMEOUT_MS = 20_000;

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** The client sent the stored event back as is (no validation needed). */
function isUnchanged(
  input: ProgramEventInputDto,
  stored: StoredEvent,
): boolean {
  return (
    (input.eventKind ?? null) === stored.eventKind &&
    input.eventType === stored.eventType &&
    input.category === stored.category &&
    (input.ageGroup ?? "") === stored.ageGroup &&
    sameList(input.ageGroups ?? [], stored.ageGroups) &&
    (input.level ?? null) === stored.level &&
    sameList(input.openLevels ?? [], stored.openLevels)
  );
}

function isLocked(stored: StoredEvent): boolean {
  return stored._count.registrations > 0 || stored._count.results > 0;
}

function assertIdsBelong(
  inputs: readonly { id?: string }[],
  storedIds: ReadonlySet<string>,
  what: "Épreuve" | "Créneau",
): void {
  const seen = new Set<string>();
  inputs.forEach(({ id }, index) => {
    if (id === undefined) return;
    if (!storedIds.has(id)) {
      throw new BadRequestException(
        `${what} n°${index + 1} : identifiant inconnu pour cette compétition.`,
      );
    }
    if (seen.has(id)) {
      throw new BadRequestException(
        `${what} n°${index + 1} : envoyé deux fois.`,
      );
    }
    seen.add(id);
  });
}

/** One row write of the plan, decided before the transaction writes. */
type EventWrite =
  | { kind: "skip"; id: string }
  | { kind: "keep"; id: string; position: number }
  | {
      kind: "update";
      id: string;
      position: number;
      data: NormalizedProgramEvent;
    }
  | { kind: "create"; position: number; data: NormalizedProgramEvent };

/**
 * Saves the programme (events + schedule) entered in the club competition
 * editor (#442). The payload is the whole programme and replaces the stored
 * one, in a single transaction:
 * - an event sent with its `id` is kept (unchanged) or updated, one without
 *   `id` is created, a stored one left out is deleted;
 * - an event with registrations or results is never deleted nor changed:
 *   the whole save is refused with a 409 naming it;
 * - the schedule is replaced the same way (nothing depends on its slots).
 *
 * Saving stamps `programEditedAt`: the FFD sync then never replaces nor
 * re-seeds the events of the competition (club input wins, see
 * CompetitionEventsDeductionService.isReplaceable).
 */
@Injectable()
export class CompetitionProgramService {
  private readonly logger = new Logger(CompetitionProgramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CompetitionCacheService,
    private readonly queryService: CompetitionProgramQueryService,
  ) {}

  async replaceProgram(
    competitionId: string,
    dto: ReplaceCompetitionProgramDto,
  ): Promise<CompetitionProgramDto> {
    try {
      await this.prisma.$transaction(
        (tx) => this.writeProgram(tx, competitionId, dto),
        { timeout: TRANSACTION_TIMEOUT_MS },
      );
    } catch (error: unknown) {
      // A registration created on a deleted event between the check and the
      // delete: the foreign key refuses the delete, the transaction rolls back.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      ) {
        throw new ConflictException(
          "Une épreuve retirée vient de recevoir une inscription : rechargez la compétition puis réessayez.",
        );
      }
      throw error;
    }
    await this.cacheService.invalidateCompetition(competitionId);
    this.logger.log(
      `Programme saved for competition ${competitionId}: ${dto.events.length} events, ${dto.schedule.length} schedule items`,
    );
    return this.queryService.getProgram(competitionId);
  }

  private async writeProgram(
    tx: Prisma.TransactionClient,
    competitionId: string,
    dto: ReplaceCompetitionProgramDto,
  ): Promise<void> {
    const competition = await tx.competition.findUnique({
      where: { id: competitionId },
      select: competitionProgramHeaderSelect,
    });
    if (!competition) throw new NotFoundException("Compétition non trouvée");

    const [storedEvents, storedSchedule] = await Promise.all([
      tx.event.findMany({
        where: { competitionId },
        select: competitionProgramEventSelect,
        take: STORED_ROWS_LIMIT,
      }),
      tx.scheduleItem.findMany({
        where: { competitionId },
        select: { id: true },
        take: STORED_ROWS_LIMIT,
      }),
    ]);

    const eventWrites = this.planEvents(
      dto.events,
      storedEvents,
      competition.competitionType,
    );

    // Events left out: deleted, unless something depends on them.
    const keptIds = new Set(
      eventWrites.flatMap((w) => (w.kind === "create" ? [] : [w.id])),
    );
    const removed = storedEvents.filter((event) => !keptIds.has(event.id));
    const lockedRemoved = removed.filter(isLocked);
    if (lockedRemoved.length > 0) {
      throw new ConflictException(
        `Impossible de retirer ${lockedRemoved.length > 1 ? "ces épreuves" : "l'épreuve"} ${lockedRemoved
          .map((event) => `« ${programEventLabel(event)} »`)
          .join(", ")} : des inscriptions ou des résultats y sont rattachés.`,
      );
    }

    if (removed.length > 0) {
      const removedIds = removed.map((event) => event.id);
      // A schedule slot pointing at a removed event stays, unlinked.
      await tx.scheduleItem.updateMany({
        where: { eventId: { in: removedIds } },
        data: { eventId: null },
      });
      await tx.event.deleteMany({ where: { id: { in: removedIds } } });
    }

    for (const write of eventWrites) {
      if (write.kind === "skip") continue;
      if (write.kind === "create") {
        await tx.event.create({
          data: { ...write.data, competitionId, position: write.position },
          select: { id: true },
        });
      } else {
        await tx.event.update({
          where: { id: write.id },
          data:
            write.kind === "update"
              ? { ...write.data, position: write.position }
              : { position: write.position },
          select: { id: true },
        });
      }
    }

    await this.writeSchedule(
      tx,
      competitionId,
      competition.date,
      dto.schedule,
      new Set(storedSchedule.map((item) => item.id)),
    );

    await tx.competition.update({
      where: { id: competitionId },
      // Club input from now on: no more « à vérifier » flag of a deduction.
      data: { programEditedAt: new Date(), eventsSource: null },
      select: { id: true },
    });
  }

  private planEvents(
    inputs: readonly ProgramEventInputDto[],
    storedEvents: readonly StoredEvent[],
    competitionType: Prisma.CompetitionGetPayload<{
      select: typeof competitionProgramHeaderSelect;
    }>["competitionType"],
  ): EventWrite[] {
    const storedById = new Map(storedEvents.map((event) => [event.id, event]));
    assertIdsBelong(inputs, new Set(storedById.keys()), "Épreuve");

    return inputs.map((input, position): EventWrite => {
      const stored = input.id ? storedById.get(input.id) : undefined;
      if (stored && isUnchanged(input, stored)) {
        return stored.position === position
          ? { kind: "skip", id: stored.id }
          : { kind: "keep", id: stored.id, position };
      }
      let data: NormalizedProgramEvent;
      try {
        data = normalizeProgramEvent(input, competitionType);
      } catch (error: unknown) {
        if (error instanceof ProgramRuleError) {
          throw new BadRequestException(
            `Épreuve n°${position + 1} : ${error.message}`,
          );
        }
        throw error;
      }
      if (!stored) return { kind: "create", position, data };
      if (isLocked(stored)) {
        throw new ConflictException(
          `L'épreuve « ${programEventLabel(stored)} » a des inscriptions ou des résultats : elle ne peut plus être modifiée.`,
        );
      }
      return { kind: "update", id: stored.id, position, data };
    });
  }

  private async writeSchedule(
    tx: Prisma.TransactionClient,
    competitionId: string,
    competitionDate: Date,
    inputs: readonly ProgramScheduleItemInputDto[],
    storedIds: ReadonlySet<string>,
  ): Promise<void> {
    assertIdsBelong(inputs, storedIds, "Créneau");
    const keptIds = new Set(inputs.flatMap(({ id }) => (id ? [id] : [])));
    const removedIds = [...storedIds].filter((id) => !keptIds.has(id));
    if (removedIds.length > 0) {
      await tx.scheduleItem.deleteMany({ where: { id: { in: removedIds } } });
    }

    for (const [position, input] of inputs.entries()) {
      const data = {
        startClock: input.startTime,
        startTime: scheduleInstant(competitionDate, input.startTime),
        durationMinutes: input.durationMinutes,
        type: input.type,
        title: input.title.trim(),
        position,
      };
      if (input.id) {
        await tx.scheduleItem.update({
          where: { id: input.id },
          data,
          select: { id: true },
        });
      } else {
        await tx.scheduleItem.create({
          data: { ...data, competitionId },
          select: { id: true },
        });
      }
    }
  }
}

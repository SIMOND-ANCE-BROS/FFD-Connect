/**
 * Inactive-account purge rules (#991). The privacy policy (§5) promises that
 * an account is deleted 3 years after its last login; a warning e-mail goes
 * out 30 days before.
 *
 * Pure functions: the dates and the Prisma filters the query service and the
 * purge service share, so the selection, the per-account claim and the
 * re-check right before a deletion can never drift apart.
 *
 * Last activity = `lastLoginAt` (written on every login AND every token
 * refresh), or `createdAt` for an account that never logged in since the
 * column exists (invited and never activated, or older rows).
 *
 * A warning only counts when it is LATER than the last login: a login after
 * the warning cancels it without any write, and the next inactivity period
 * gets a fresh warning.
 */
import { Prisma } from "@prisma/client";

/** Published retention (privacy policy §5): 3 years after the last login. */
export const INACTIVITY_RETENTION_YEARS = 3;

/** Minimum notice between the warning e-mail and the deletion. */
export const INACTIVITY_WARNING_NOTICE_DAYS = 30;

const DAY_MS = 86_400_000;

/** `User.lastLoginAt` as a column reference (`prisma.user.fields.lastLoginAt`). */
export type LastLoginAtRef = Prisma.FieldRef<"User", "DateTime">;

function minusYears(date: Date, years: number): Date {
  const result = new Date(date.getTime());
  result.setUTCFullYear(result.getUTCFullYear() - years);
  return result;
}

/** Accounts whose last activity is before this date are due for deletion. */
export function deletionCutoff(now: Date): Date {
  return minusYears(now, INACTIVITY_RETENTION_YEARS);
}

/** Accounts whose last activity is before this date are due for a warning. */
export function warningCutoff(now: Date): Date {
  return new Date(
    deletionCutoff(now).getTime() + INACTIVITY_WARNING_NOTICE_DAYS * DAY_MS,
  );
}

/** A warning older than this date has given its full notice. */
export function noticeCutoff(now: Date): Date {
  return new Date(now.getTime() - INACTIVITY_WARNING_NOTICE_DAYS * DAY_MS);
}

/** Last login before `cutoff`, or never logged in and created before it. */
export function lastActivityBefore(cutoff: Date): Prisma.UserWhereInput {
  return {
    OR: [
      { lastLoginAt: { lt: cutoff } },
      { lastLoginAt: null, createdAt: { lt: cutoff } },
    ],
  };
}

/**
 * Inactive for 3 years minus 30 days and not warned since the last login.
 * The store-review account is never touched (it must stay for Apple/Google).
 */
export function warningDueWhere(
  now: Date,
  lastLoginAt: LastLoginAtRef,
): Prisma.UserWhereInput {
  return {
    AND: [
      { isStoreReview: false },
      lastActivityBefore(warningCutoff(now)),
      {
        OR: [
          { inactivityWarningSentAt: null },
          // Warned during an earlier inactivity period, then logged in.
          { inactivityWarningSentAt: { lt: lastLoginAt } },
        ],
      },
    ],
  };
}

/**
 * Lease of a warning claim: a replica that claimed a warning and died before
 * sending it (scale-to-zero shutdown, crash) leaves a stale claim, retried
 * once this lease is over. Far above one send (8 s timeout).
 */
export const WARNING_CLAIM_LEASE_MS = 60 * 60_000;

/** No other replica is sending this warning (no claim, or a stale one). */
export function warningClaimableWhere(now: Date): Prisma.UserWhereInput {
  return {
    OR: [
      { inactivityWarningClaimedAt: null },
      {
        inactivityWarningClaimedAt: {
          lt: new Date(now.getTime() - WARNING_CLAIM_LEASE_MS),
        },
      },
    ],
  };
}

/**
 * Inactive for 3 years AND warned at least 30 days ago, after the last
 * login. Never without a warning: no e-mail sent means no deletion. Only the
 * CONFIRMED-sent date counts; a claim (`inactivityWarningClaimedAt`) never
 * does.
 */
export function deletionDueWhere(
  now: Date,
  lastLoginAt: LastLoginAtRef,
): Prisma.UserWhereInput {
  return {
    AND: [
      { isStoreReview: false },
      lastActivityBefore(deletionCutoff(now)),
      { inactivityWarningSentAt: { lte: noticeCutoff(now) } },
      {
        OR: [
          { lastLoginAt: null },
          { inactivityWarningSentAt: { gt: lastLoginAt } },
        ],
      },
    ],
  };
}

/**
 * Earliest deletion date announced in the warning: 3 years after the last
 * activity, and never less than the 30-day notice from now (the job only
 * runs while a replica is awake, so a warning can go out late).
 */
export function scheduledDeletionDate(
  account: { lastLoginAt: Date | null; createdAt: Date },
  now: Date,
): Date {
  const lastActivity = account.lastLoginAt ?? account.createdAt;
  const byRetention = minusYears(lastActivity, -INACTIVITY_RETENTION_YEARS);
  const byNotice = new Date(
    now.getTime() + INACTIVITY_WARNING_NOTICE_DAYS * DAY_MS,
  );
  return byRetention > byNotice ? byRetention : byNotice;
}

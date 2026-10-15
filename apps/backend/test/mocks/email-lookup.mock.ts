import { Prisma } from "@prisma/client";

/**
 * `$queryRaw` stand-in for the e-mail lookup of `auth/email-identity` (#465):
 * every address designates exactly one account, `id`, stored in the
 * normalised form. Suites that mock the account itself through
 * `user.findUnique` keep working unchanged.
 */
export const oneAccountPerAddress =
  (id = "user-1") =>
  (query: Prisma.Sql) =>
    Promise.resolve([{ id, email: String(query.values[0]) }]);

/** Matches the e-mail lookup query for the normalised address `normalized`. */
export const emailLookupFor = (normalized: string): unknown =>
  expect.objectContaining({
    text: expect.stringContaining('"emailNormalized" = $1'),
    values: expect.arrayContaining([normalized]),
  });

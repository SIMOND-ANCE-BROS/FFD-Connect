import type * as Bcrypt from "bcrypt";

/** Cost factor the services ask for (auth.service, admin-user-accounts.service). */
export const PRODUCTION_BCRYPT_ROUNDS = 12;

/** bcrypt's minimum cost: a real hash in about a millisecond. */
const TEST_BCRYPT_ROUNDS = 4;

/**
 * `bcrypt` whose `hash` still produces a real bcrypt hash, but at the minimum
 * cost instead of the one the caller asks for (#546).
 *
 * At cost 12 a hash is ~0.5 s of CPU on a developer machine. A suite that
 * registers a dozen users spent that on every test, and under load (backend
 * and client suites running side by side, other worktree sessions) a single
 * hash took longer than the 5 s test budget: the tests failed under load and
 * passed alone. The cost factor is not what these unit tests check, so they
 * assert the requested one on the mock instead
 * (`toHaveBeenCalledWith(…, PRODUCTION_BCRYPT_ROUNDS)`).
 *
 * Use inside a hoisted factory:
 * `jest.mock("bcrypt", () => jest.requireActual("<path>/bcrypt.mock").cheapBcrypt())`.
 */
export function cheapBcrypt(): typeof Bcrypt {
  const actual = jest.requireActual<typeof Bcrypt>("bcrypt");
  return {
    ...actual,
    hash: jest.fn((data: string | Buffer) =>
      actual.hash(data, TEST_BCRYPT_ROUNDS),
    ),
  };
}

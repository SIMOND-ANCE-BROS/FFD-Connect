/**
 * `user.findMany` stand-in for the e-mail lookup of `auth/email-identity`
 * (#465): every address designates exactly one account, `id`, stored as typed
 * (LIKE escapes removed). Suites that mock the account itself through
 * `user.findUnique` keep working unchanged.
 */
export const oneAccountPerAddress =
  (id = "user-1") =>
  (args: { where?: { email?: { equals?: string } } }) =>
    Promise.resolve(
      args.where?.email?.equals === undefined
        ? []
        : [{ id, email: args.where.email.equals.replace(/\\(.)/g, "$1") }],
    );

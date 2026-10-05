/**
 * Vérifie qu'une variable d'environnement requise est définie en production.
 * Lance process.exit(1) si la variable est absente en NODE_ENV=production.
 */
export function requireProductionEnv(
  key: string,
  value: string | undefined,
  nodeEnv: string | undefined,
  callbacks: {
    onError: (msg: string) => void;
    onWarn: (msg: string) => void;
    exit: (code: number) => never;
  },
): void {
  if (!value) {
    if (nodeEnv === "production") {
      callbacks.onError(`${key} is required in production. Shutting down.`);
      callbacks.exit(1);
      return;
    }
    callbacks.onWarn(`${key} not configured. Related feature disabled.`);
  }
}

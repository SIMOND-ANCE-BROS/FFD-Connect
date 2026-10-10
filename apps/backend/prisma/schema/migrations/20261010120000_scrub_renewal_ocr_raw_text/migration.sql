-- Effacement du texte brut des certificats médicaux déjà stockés (issue #224).
--
-- `ocrData.rawText` contenait les 500 premiers caractères du certificat médical
-- (donnée de santé, RGPD art. 9). Le code ne l'écrit plus et filtre ce qu'il
-- relit, mais les lignes existantes le portent encore en base : il disparaît ici.
--
-- AUCUN CHANGEMENT DE SCHÉMA (ADR-0017) : seule une clé JSON jamais lue est
-- retirée. La révision précédente, en cas de rollback, tourne à l'identique —
-- elle ne lit pas `rawText`.
--
-- Pourquoi une migration plutôt que la purge de rétention : la purge ne tourne
-- pas quand le stockage blob n'est pas configuré, et ne traite que les
-- documents échus. Une migration s'exécute une fois, partout, au démarrage.
--
-- La requête ne peut pas échouer : aucun cast, et le garde `jsonb_typeof`
-- écarte les valeurs non-objet (l'opérateur `-` lève une erreur sur un
-- scalaire). Idempotente : rejouée, elle ne trouve plus rien à modifier.

UPDATE "LicenseRenewalDocument"
SET "ocrData" = "ocrData" - 'rawText'
WHERE "ocrData" IS NOT NULL
  AND jsonb_typeof("ocrData") = 'object'
  AND "ocrData" ? 'rawText';

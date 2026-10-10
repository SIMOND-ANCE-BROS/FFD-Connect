-- Minimisation des données OCR déjà stockées (issue #224).
--
-- `ocrData` contenait `rawText`, les 500 premiers caractères du certificat
-- médical (donnée de santé, RGPD art. 9), et `name`, le nom lu sur le
-- certificat de licence. Le code n'écrit et ne relit plus que les champs
-- utiles (`renewal-ocr-data.util.ts`) ; les lignes existantes sont ramenées
-- ici à ces mêmes champs :
--   - MEDICAL_CERTIFICATE : isApte, date, doctorName ;
--   - LICENSE_CERTIFICATE : licenseNumber, expiryDate.
--
-- AUCUN CHANGEMENT DE SCHÉMA (ADR-0017) : seules des clés JSON que le code ne
-- lit pas sont retirées. La révision précédente, en cas de rollback, tourne à
-- l'identique : elle ne lit que ces mêmes champs.
--
-- Pourquoi une migration plutôt que la purge de rétention : la purge ne tourne
-- pas quand le stockage blob n'est pas configuré, et ne traite que les
-- documents échus. Une migration s'exécute une fois, partout, au démarrage.
--
-- La requête ne peut pas échouer : aucun cast, et le garde `jsonb_typeof`
-- écarte les valeurs non-objet. Une clé absente donne un NULL SQL que
-- `jsonb_build_object` écrit en `null` JSON, retiré par `jsonb_strip_nulls`
-- (les valeurs sont scalaires : rien d'imbriqué n'est touché). Idempotente :
-- une ligne déjà réduite ne porte plus de clé hors liste, le WHERE l'écarte.

UPDATE "LicenseRenewalDocument"
SET "ocrData" = jsonb_strip_nulls(
  CASE
    WHEN "type" = 'MEDICAL_CERTIFICATE' THEN jsonb_build_object(
      'isApte', "ocrData" -> 'isApte',
      'date', "ocrData" -> 'date',
      'doctorName', "ocrData" -> 'doctorName'
    )
    ELSE jsonb_build_object(
      'licenseNumber', "ocrData" -> 'licenseNumber',
      'expiryDate', "ocrData" -> 'expiryDate'
    )
  END
)
WHERE "ocrData" IS NOT NULL
  AND jsonb_typeof("ocrData") = 'object'
  AND EXISTS (
    SELECT 1
    FROM jsonb_object_keys("ocrData") AS k
    WHERE k <> ALL (
      CASE
        WHEN "type" = 'MEDICAL_CERTIFICATE'
          THEN ARRAY['isApte', 'date', 'doctorName']
        ELSE ARRAY['licenseNumber', 'expiryDate']
      END
    )
  );

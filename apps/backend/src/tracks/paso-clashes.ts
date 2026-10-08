/**
 * Paso doble — nombre maximal de clashs (appels/coups) d'une piste.
 *
 * Selon la coupe, une musique de compétition (España Cañí) comporte 2 ou
 * 3 clashs ; jamais davantage. Source unique pour l'édition admin
 * (PATCH /tracks/:id) et les propositions de correction (création et
 * validation).
 */
export const PASO_MAX_CLASHES = 3;

/** Message (utilisateur) d'un refus pour trop de clashs. */
export const PASO_MAX_CLASHES_MESSAGE = `Un paso doble comporte au plus ${PASO_MAX_CLASHES} clashs.`;

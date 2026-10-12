/**
 * Notes TESTEURS (« What to Test » TestFlight, notes de version Google Play) :
 * en français, rédigées pour un testeur, tirées de la section
 * « ## Pour les testeurs » de chaque PR incluse depuis le build précédent.
 *
 * Les messages de commit restent en anglais et techniques (convention du
 * dépôt) : ils alimentent la release GitHub, destinée à l'équipe. Les testeurs
 * ne voient que ce qu'une PR leur adresse explicitement ; une PR sans section
 * (CI, refactor, infra…) ne leur montre rien.
 *
 * Utilisé par `generate-changelog.mjs --format testers`.
 */

/** Titre de section attendu dans la description d'une PR (insensible à la casse). */
const SECTION = /^##\s+pour les testeurs\s*$/i;

/**
 * « Rien pour les testeurs », appliqué au texte NORMALISÉ (cf. normalize :
 * minuscules, sans accents, apostrophes droites, espaces réduits). Liste
 * fermée de tournures, pour ne jamais écarter un vrai contenu :
 * - une tête : « rien », « néant », « n/a », « sans objet », « aucun »,
 *   « aucun changement visible », « pas d'effet visible »… ;
 * - suivie d'une ou plusieurs précisions connues : « pour l'instant »,
 *   « de visible », « à tester », « dans l'application mobile »… ;
 * - puis la fin du texte, ou une ponctuation qui ouvre une justification :
 *   « Rien (back-office uniquement). », « Rien : … », « Rien. Back-office… ».
 * « Rien ne change, mais l'appli démarre plus vite » ou « Aucune régression
 * attendue sur X » sont gardés (pas de ponctuation après la tête).
 */
const NOTHING_HEAD = String.raw`(?:rien|neant|n/a|na|none|nothing|sans objet|non applicable|aucune?(?:\s+(?:changement|modification|effet|impact|nouveaute)s?)?|pas\s+(?:de\s+|d'\s*)(?:changement|modification|effet|impact|nouveaute)s?)`;
const NOTHING_MORE = String.raw`(?:visibles?|de visible|de nouveau|de special|de particulier|a tester|a signaler|a verifier|a voir|pour l'instant|pour le moment|pour les testeurs|pour le testeur|pour l'utilisateur|pour les utilisateurs|cote testeurs?|cote utilisateurs?|cote app(?:lication)?|cote mobile|dans l'app(?:lication)?(?:\s+mobile)?|dans l'appli)`;
const NOTHING = new RegExp(
  String.raw`^${NOTHING_HEAD}(?:\s+${NOTHING_MORE})*\s*(?:$|[.:;,!(\[—–-])`,
);

/** Minuscules, sans accents, apostrophes droites, puce de tête et espaces réduits. */
function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/^\s*[-*•]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Vrai si le texte (section entière ou une ligne) veut dire « rien à tester ». */
export function isNothing(text) {
  const t = normalize(text);
  // Vide ou seulement de la ponctuation : « - », « — », « … ».
  if (!/[\p{L}\p{N}]/u.test(t)) return true;
  return NOTHING.test(t);
}

/** Ligne de pied de page ajoutée aux descriptions de PR (hors section). */
const FOOTER =
  /^(?:\s*🤖|.*Generated with \[Claude Code\]|\s*https:\/\/claude\.ai\/code|\s*(?:-{3,}|\*{3,}|_{3,})\s*$)/u;

/**
 * Retire ce que les stores refusent (App Store Connect : « invalid
 * characters », ex. 🤖) : les pictogrammes emoji, y compris ceux du plan de
 * base (✨ ⚡ ✅ ⚠), tout hors du plan multilingue de base, les sélecteurs de
 * variante, ZWJ, keycap et caractères de contrôle. Accents, « », ’, …, •
 * restent intacts.
 */
export function sanitizeStoreText(text) {
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/\u20E3/g, '')
    .replace(/[\uD800-\uDFFF\uFE0F\u200D]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/** Numéro de la PR d'un commit squashé : la DERNIÈRE réf « (#N) » du sujet. */
export function prNumber(subject) {
  const refs = [...subject.matchAll(/\(#(\d+)\)/g)];
  return refs.length ? Number(refs[refs.length - 1][1]) : null;
}

/**
 * Section « Pour les testeurs » d'une description de PR, sans les
 * commentaires HTML du modèle ; null si absente, vide ou « rien ».
 */
export function extractTesterSection(body) {
  if (!body) return null;
  const lines = body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const start = lines.findIndex((line) => SECTION.test(line.trim()));
  if (start === -1) return null;
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break; // section suivante
    if (FOOTER.test(line)) break; // pied de page de la PR
    section.push(line);
  }
  const text = section.join('\n').trim();
  if (!text || isNothing(text)) return null;
  const kept = text
    .split('\n')
    .filter((line) => !isNothing(line))
    .join('\n')
    .trim();
  return kept || null;
}

/**
 * Puces texte brut (stores : pas de markdown, ni gras ni code) à partir d'une
 * section : une puce par élément de liste, sinon une puce pour le paragraphe
 * entier.
 */
export function toBullets(section) {
  const lines = section
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const items = lines.filter((line) => /^[-*•]\s+/.test(line));
  const bullets =
    items.length === 0
      ? [`• ${lines.join(' ')}`]
      : items.map((line) => `• ${line.replace(/^[-*•]\s+/, '')}`);
  return bullets
    .map((b) =>
      sanitizeStoreText(b)
        // Gras et code markdown : les stores les affichent tels quels.
        .replace(/\*\*|__|`/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .filter((b) => !isNothing(b));
}

/** Limites des stores, en caractères (longueur JS du texte final). */
export const STORE_LIMITS = Object.freeze({ ios: 4000, android: 500 });

const TO_TEST_TITLE = 'À tester en priorité';
const NOTES_TITLE = 'Nouveautés et corrections';
const FALLBACK = 'Corrections et améliorations diverses.';
/** Dernière ligne quand des points ne tiennent pas dans la limite du store. */
export const MORE = '… et d’autres corrections et améliorations.';

/** Points de « À tester en priorité » : champ du formulaire, séparés par « ; ». */
export function parseToTest(raw) {
  return (raw ?? '')
    .split(';')
    .map((item) => sanitizeStoreText(item).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((item) => `• ${item}`);
}

/** Coupe une ligne trop longue à elle seule (cas extrême), sans couper un emoji. */
function clip(line, max) {
  if (line.length <= max) return line;
  let kept = '';
  for (const char of Array.from(line)) {
    if (kept.length + char.length > max - 1) break;
    kept += char;
  }
  return `${kept.trimEnd()}…`;
}

/**
 * Ajoute des lignes ENTIÈRES à `text`, dans l'ordre, tant que le texte reste
 * dans `max` caractères en gardant la place de `reserve` (la ligne « … et
 * d'autres »). S'arrête à la première ligne qui ne tient pas : l'ordre reste
 * prévisible. Rend le texte et le nombre de lignes ajoutées.
 */
function fill(text, lines, max, reserve = '') {
  const room = (candidate) => candidate.length + (reserve ? reserve.length + 1 : 0) <= max;
  let out = text;
  let count = 0;
  for (const line of lines) {
    const next = out ? `${out}\n${line}` : line;
    if (!room(next)) break;
    out = next;
    count += 1;
  }
  return { text: out, count };
}

/**
 * Notes testeurs complètes, dans la limite `maxLength` du store.
 *
 * Structure : « À tester en priorité » (input toTest du workflow), puis
 * « Nouveautés et corrections » avec un point par élément des sections, dans
 * l'ordre des PR (de la plus ancienne à la plus récente).
 *
 * Priorisation quand tout ne tient pas :
 * 1. « À tester en priorité » passe en premier et en entier (si un point
 *    dépasse seul la limite, ce qui n'arrive qu'avec un formulaire mal rempli,
 *    il est coupé par « … » plutôt que d'envoyer un texte trop long) ;
 * 2. puis le titre et les points des PR, ENTIERS et dans l'ordre, jusqu'au
 *    premier qui ne tient plus ;
 * 3. puis une ligne « … et d'autres corrections et améliorations. ».
 * Le texte rendu (longueur JS, sans emoji) ne dépasse jamais `maxLength`.
 */
export function renderTesterNotes(sections, { toTest = [], maxLength = Infinity } = {}) {
  const max = maxLength;
  const bullets = sections.flatMap((section) => toBullets(section));
  // Place d'un point sous le titre « À tester en priorité ».
  const itemMax = max - TO_TEST_TITLE.length - 1;
  const items = toTest.map((item) => clip(sanitizeStoreText(item), itemMax));

  // 1. À tester en priorité.
  let text = '';
  if (items.length > 0) {
    const head = fill('', [TO_TEST_TITLE, ...items], max);
    text = head.count > 1 ? head.text : '';
    if (head.count < items.length + 1) {
      // Même « À tester » ne tient pas en entier : rien d'autre ne passera.
      return sanitizeStoreText(text);
    }
  }
  const sep = text ? '\n\n' : '';

  // 2. Nouveautés et corrections (ou le texte de repli).
  const body = bullets.length === 0 ? [FALLBACK] : [NOTES_TITLE, ...bullets];
  const full = `${text}${sep}${body.join('\n')}`;
  if (full.length <= max) return sanitizeStoreText(full);

  // Le texte de repli ne tient pas après « À tester » : on s'arrête là.
  if (bullets.length === 0) return sanitizeStoreText(text);

  // 3. Coupe : points entiers dans l'ordre, puis « … et d'autres ».
  const start = `${text}${sep}`.replace(/\n$/, '');
  const cut = fill(start, body, max, MORE);
  // Un titre sans aucun point n'apporte rien : on le retire.
  const kept = cut.count >= 2 ? cut.text : text;
  const withMore = kept ? `${kept}\n${kept === text ? '\n' : ''}${MORE}` : MORE;
  return sanitizeStoreText(withMore.length <= max ? withMore : kept);
}

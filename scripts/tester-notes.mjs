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

/** Contenu d'une section qui veut dire « rien pour les testeurs ». */
const NOTHING = /^(rien|aucun|aucune|néant|n\/a|na|-|—|–)\.?$/i;

/** Ligne de pied de page ajoutée aux descriptions de PR (hors section). */
const FOOTER =
  /^(?:\s*🤖|.*Generated with \[Claude Code\]|\s*https:\/\/claude\.ai\/code|\s*(?:-{3,}|\*{3,}|_{3,})\s*$)/u;

/**
 * Retire ce que les stores refusent (App Store Connect : « invalid
 * characters », ex. 🤖) : tout hors du plan multilingue de base, plus les
 * sélecteurs de variante et caractères de contrôle. Accents, « », ’, …, •
 * restent intacts.
 */
export function sanitizeStoreText(text) {
  return text
    .replace(/[\u{10000}-\u{10FFFF}]/gu, '')
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
  if (!text || NOTHING.test(text)) return null;
  const kept = text
    .split('\n')
    .filter((line) => !NOTHING.test(line.trim().replace(/^[-*•]\s+/, '')))
    .join('\n')
    .trim();
  return kept || null;
}

/**
 * Puces texte brut (stores : pas de markdown) à partir d'une section : une
 * puce par élément de liste, sinon une puce pour le paragraphe entier.
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
    .map((b) => sanitizeStoreText(b).trim())
    .filter((b) => b.replace(/^•\s*/, '') && !NOTHING.test(b.replace(/^•\s*/, '')));
}

/**
 * Notes testeurs complètes à partir des sections déjà extraites, dans l'ordre
 * des PR. Texte de repli si aucune PR ne s'adresse aux testeurs.
 */
export function renderTesterNotes(sections) {
  const bullets = sections.flatMap((section) => toBullets(section));
  if (bullets.length === 0) return 'Corrections et améliorations diverses.';
  return sanitizeStoreText(`Nouveautés et corrections\n${bullets.join('\n')}`);
}

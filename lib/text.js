// Mirrors public.disi_ascii_fold / public.disi_slugify (database/sql/017) so
// search input is normalized the same way as the database search_text column.

const EXTRA_FOLDS = { ø: 'o', ł: 'l', đ: 'd', ß: 'ss', æ: 'ae', œ: 'oe' }

/** @param {unknown} input */
export function foldText(input) {
  return String(input ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[øłđßæœ]/g, (c) => EXTRA_FOLDS[/** @type {keyof typeof EXTRA_FOLDS} */ (c)])
}

/** @param {unknown} input */
export function slugify(input) {
  return foldText(input).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Splits a free-text query into folded tokens that are safe to embed in a
 * PostgREST ilike pattern. LIKE wildcards (% _), PostgREST's * wildcard and
 * characters that are meaningful in PostgREST filter syntax are removed.
 * @param {unknown} query
 * @returns {string[]}
 */
export function searchTokens(query) {
  return foldText(query)
    .replace(/[%_*\\(),."':]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
}

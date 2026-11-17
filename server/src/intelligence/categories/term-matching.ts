/**
 * Term matching for category detection.
 *
 * A hand-rolled word-boundary matcher rather than a regular expression.
 * Compiling ~110 unicode-mode regular expressions cost roughly half a second
 * on the first lookup; plain string operations cost nothing to "compile" and
 * are fast enough to run on every call.
 */

/** ASCII word character test, avoiding a regular expression. */
function isWordChar(character: string): boolean {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) // a-z
  );
}

/**
 * Does `haystack` contain `needle` on a word boundary?
 * Devanagari terms are matched by containment, because Devanagari does not
 * use spaces between words.
 */
export function matchesTerm(haystack: string, needle: string): boolean {
  if (!needle) return false;

  if (/[\u0900-\u097F]/.test(needle)) {
    return haystack.includes(needle);
  }

  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const before = index === 0 ? '' : (haystack[index - 1] ?? '');
    const afterIndex = index + needle.length;
    const after = afterIndex >= haystack.length ? '' : (haystack[afterIndex] ?? '');
    if (!isWordChar(before) && !isWordChar(after)) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
}

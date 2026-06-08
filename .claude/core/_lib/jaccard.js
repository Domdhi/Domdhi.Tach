/**
 * Jaccard — similarity metric for two sets or two strings.
 *
 * Extracted from three duplicate implementations:
 *   - memory-compiler.js:369-377  (local jaccard inside groupEntries)
 *   - memory-compiler.js:1025-1033 (local jaccard inside generateCrossReferences, identical body)
 *   - memory-manager.js:962-968    (module-level jaccardSimilarity over text)
 *
 * Two shapes, one kernel: callers with pre-tokenized Sets use `jaccardFromSets`;
 * callers with raw text use `jaccardFromText`, which tokenizes internally.
 */

/**
 * Jaccard similarity between two Sets.
 * Empty-empty returns 0 (by convention — "undefined" would be correct but
 * callers downstream treat any number, including 0, as a valid similarity).
 *
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number} intersection / union, in [0, 1]
 */
function jaccardFromSets(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 0;
    let intersection = 0;
    for (const k of setA) {
        if (setB.has(k)) intersection++;
    }
    const unionSize = setA.size + setB.size - intersection;
    return unionSize === 0 ? 0 : intersection / unionSize;
}

/**
 * Jaccard similarity between two text strings. Tokenizes on non-word characters,
 * lowercases, keeps tokens whose length exceeds `minTokenLen` (default 2 — matches
 * the filter `w => w.length > 2` used in memory-manager's original jaccardSimilarity).
 *
 * @param {string} text1
 * @param {string} text2
 * @param {object} [opts]
 * @param {number} [opts.minTokenLen=2] Minimum length threshold — tokens with
 *                                      length STRICTLY GREATER than this are kept
 * @returns {number} in [0, 1]
 */
function jaccardFromText(text1, text2, { minTokenLen = 2 } = {}) {
    const tokenize = (s) =>
        new Set(
            String(s)
                .toLowerCase()
                .split(/\W+/)
                .filter((w) => w.length > minTokenLen)
        );
    return jaccardFromSets(tokenize(text1), tokenize(text2));
}

module.exports = { jaccardFromSets, jaccardFromText };

/**
 * Concept Reader — walks the concept-article tree and builds typed concept records.
 *
 * Unifies two nearly-identical implementations:
 *   - memory-promoter.js:loadConcepts  (returns slug, title, category, confidence,
 *     decayedConfidence, sources, usageCount, promotedTo, updated)
 *   - memory-curator.js:loadConcepts   (returns slug, title, category, content,
 *     confidence, decayedConfidence, sources)
 *
 * Shared shape: return the superset (content + usageCount + promotedTo always present).
 * Extra fields are harmless to callers that ignore them.
 *
 * Consumes _lib/frontmatter.js + _lib/memory-decay.js — the refactor this
 * extraction unlocks is the primary reason those came first.
 *
 * Not used by memory-compiler's generateIndex/generateCrossReferences, which do
 * merge-with-existing logic rather than a clean load.
 */

const fs = require('fs').promises;
const path = require('path');
const { parseFrontmatter } = require('./frontmatter');
const { calculateDecayedConfidence } = require('./memory-decay');

/**
 * Read every concept `.md` file under `conceptsDir/{category}/`, parse each
 * frontmatter, compute decayed confidence, and return a flat array of concepts.
 *
 * @param {object} args
 * @param {string}   args.conceptsDir           Absolute path to concepts root
 * @param {string[]} args.categories            Category subdir names to scan
 * @param {object}   args.activeDaysResolver    From createActiveDaysResolver; must
 *                                              expose `.getActiveDaysSince(iso)`
 * @returns {Promise<Array<{
 *   slug: string, title: string, category: string,
 *   content: string, confidence: number, decayedConfidence: number,
 *   sources: string[], usageCount: number, promotedTo: string|null, updated: string
 * }>>}
 */
async function readConcepts({ conceptsDir, categories, activeDaysResolver }) {
    const concepts = [];

    for (const category of categories) {
        const catDir = path.join(conceptsDir, category);
        let files;
        try {
            files = await fs.readdir(catDir);
        } catch {
            continue; // category dir may not exist
        }

        for (const file of files) {
            if (!file.endsWith('.md')) continue;
            try {
                const filePath = path.join(catDir, file);
                const content = await fs.readFile(filePath, 'utf-8');
                const fm = parseFrontmatter(content);
                if (!fm) continue;

                const slug = file.replace('.md', '');
                const confidence = parseFloat(fm.confidence) || 0.6;
                const updated = fm.updated || new Date().toISOString();
                const sources = fm.sources || [];
                const usageCount = parseInt(fm.usage_count) || 0;

                const decayed = calculateDecayedConfidence({
                    confidence,
                    category,
                    usageCount,
                    updated,
                    activeDays: activeDaysResolver.getActiveDaysSince(updated),
                });

                concepts.push({
                    slug,
                    title: fm.title || slug,
                    category,
                    content,
                    confidence,
                    decayedConfidence: decayed,
                    sources,
                    usageCount,
                    promotedTo: fm.promoted_to || null,
                    updated,
                });
            } catch {
                // skip unreadable files
            }
        }
    }

    return concepts;
}

module.exports = { readConcepts };

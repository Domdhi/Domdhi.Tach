/**
 * Cross-References — compute pairwise Jaccard similarity between concept
 * articles and write `cross-references.json`.
 *
 * Extracted from memory-compiler.js:generateCrossReferences (~80 LOC). Pairs
 * with similarity in the window [crossRefThreshold, similarityThreshold) are
 * recorded as "related" — pairs at or above similarityThreshold are assumed
 * to already be grouped into the same concept article.
 */

const fs = require('fs').promises;
const path = require('path');
const { parseFrontmatter } = require('./frontmatter');
const { jaccardFromSets } = require('./jaccard');

/**
 * Scan all concept articles, compute cross-references, write JSON.
 *
 * @param {object} opts
 * @param {string}   opts.conceptsDir
 * @param {string[]} opts.categories
 * @param {number}   opts.crossRefThreshold    Inclusive lower bound (e.g. 0.15)
 * @param {number}   opts.similarityThreshold  Exclusive upper bound (e.g. 0.3)
 * @returns {Promise<number>} The count of unique cross-reference pairs discovered.
 */
async function generateCrossReferences({ conceptsDir, categories, crossRefThreshold, similarityThreshold }) {
    const allConcepts = []; // { slug, category, keywords }

    for (const cat of categories) {
        const catDir = path.join(conceptsDir, cat);
        try {
            const files = await fs.readdir(catDir);
            for (const file of files) {
                if (!file.endsWith('.md')) continue;
                try {
                    const content = await fs.readFile(path.join(catDir, file), 'utf-8');
                    const fm = parseFrontmatter(content);
                    if (!fm) continue;

                    const slug = file.replace('.md', '');
                    const title = fm.title || slug;

                    const summaryMatch = content.match(/## Summary\s*\n+([\s\S]*?)(?=\n##|$)/);
                    const summaryText = summaryMatch ? summaryMatch[1].trim() : '';

                    // Simple keyword tokenizer: title + summary, split on whitespace,
                    // lowercase, filter words > 2 chars
                    const rawText = `${title} ${summaryText}`;
                    const keywords = new Set(
                        rawText
                            .toLowerCase()
                            .split(/\s+/)
                            .map(w => w.replace(/[^a-z0-9]/g, ''))
                            .filter(w => w.length > 2)
                    );

                    allConcepts.push({ slug, category: cat, keywords });
                } catch { /* skip unreadable files */ }
            }
        } catch { /* category dir may not exist */ }
    }

    // Build bidirectional cross-reference map: { slug: { related: [...], category } }
    const crossRefMap = {};
    for (const concept of allConcepts) {
        crossRefMap[concept.slug] = { related: [], category: concept.category };
    }

    let pairCount = 0;
    for (let i = 0; i < allConcepts.length; i++) {
        for (let j = i + 1; j < allConcepts.length; j++) {
            const sim = jaccardFromSets(allConcepts[i].keywords, allConcepts[j].keywords);
            if (sim >= crossRefThreshold && sim < similarityThreshold) {
                const slugA = allConcepts[i].slug;
                const slugB = allConcepts[j].slug;
                crossRefMap[slugA].related.push(slugB);
                crossRefMap[slugB].related.push(slugA);
                pairCount++;
            }
        }
    }

    // Preserve prior behavior: empty object when no concepts exist
    const outputMap = allConcepts.length === 0 ? {} : crossRefMap;
    const crossRefPath = path.join(conceptsDir, 'cross-references.json');
    await fs.writeFile(crossRefPath, JSON.stringify(outputMap, null, 2), 'utf-8');

    return pairCount;
}

module.exports = { generateCrossReferences };

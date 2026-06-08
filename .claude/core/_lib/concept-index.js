/**
 * Concept Index — generate the Obsidian MOC (Map of Content) index.md and
 * inject Related Concepts sections into each concept article.
 *
 * Extracted from memory-compiler.js:
 *   - generateIndex (~150 LOC)
 *   - injectRelatedConcepts (~77 LOC)
 *
 * Both operate on the concepts tree; both need `parseFrontmatter` and a list
 * of categories. Consolidated into one module to co-locate MOC-generation
 * logic.
 */

const fs = require('fs').promises;
const path = require('path');
const { parseFrontmatter } = require('./frontmatter');

const DEFAULT_CONFIDENCE = 0.6;

/**
 * Build a [HIGH]/[MED]/[LOW] indicator from a numeric confidence value.
 */
function confidenceIndicator(conf) {
    const c = typeof conf === 'number' ? conf : parseFloat(conf) || DEFAULT_CONFIDENCE;
    if (c >= 0.7) return '[HIGH]';
    if (c >= 0.4) return '[MED]';
    return '[LOW]';
}

/**
 * Generate the Obsidian MOC index.md at `{conceptsDir}/index.md`.
 * Merges in-run `concepts` with existing on-disk concepts.
 *
 * @param {Array<{title, category, filename, slug, description, confidence}>} concepts
 * @param {object} deps
 * @param {string}   deps.conceptsDir
 * @param {string[]} deps.categories
 * @param {(iso: string) => string} deps.formatDateOnly
 */
async function generateIndex(concepts, { conceptsDir, categories, formatDateOnly }) {
    const now = new Date().toISOString();
    const today = formatDateOnly(now);

    const byCategory = {};
    for (const cat of categories) byCategory[cat] = [];
    for (const concept of concepts) {
        if (concept && byCategory[concept.category]) {
            byCategory[concept.category].push(concept);
        }
    }

    // Merge in existing on-disk concepts that weren't in this compile run
    for (const cat of categories) {
        const catDir = path.join(conceptsDir, cat);
        try {
            const files = await fs.readdir(catDir);
            const existingSlugs = new Set(byCategory[cat].map(c => c.filename));
            for (const file of files) {
                if (!file.endsWith('.md') || existingSlugs.has(file)) continue;
                try {
                    const content = await fs.readFile(path.join(catDir, file), 'utf-8');
                    const fm = parseFrontmatter(content);
                    if (fm) {
                        const summaryMatch = content.match(/## Summary\s*\n+(?:> \[!abstract\][^\n]*\n)?> ?([^\n]+)/);
                        const plainMatch = content.match(/## Summary\s*\n+([^\n>]+)/);
                        const description = (summaryMatch ? summaryMatch[1].trim() : plainMatch ? plainMatch[1].trim() : fm.title || file.replace('.md', '')).slice(0, 120);
                        byCategory[cat].push({
                            title: fm.title || file.replace('.md', ''),
                            category: cat,
                            filename: file,
                            slug: file.replace('.md', ''),
                            description,
                            confidence: fm.confidence ? parseFloat(fm.confidence) : DEFAULT_CONFIDENCE,
                        });
                    }
                } catch { /* skip unreadable files */ }
            }
        } catch { /* category dir may not exist */ }
    }

    let totalConcepts = 0;
    for (const cat of categories) totalConcepts += byCategory[cat].length;

    const lines = [
        '---',
        'title: Memory Concepts Index',
        'cssclasses:',
        '  - moc',
        `updated: ${today}`,
        'tags:',
        '  - MOC',
        '  - memory-system',
        '---',
        '',
        '# Memory Concepts Index',
        '',
        `Last compiled: ${now}`,
        '',
        '> [!info] Quick Stats',
        `> **${totalConcepts}** concepts across **${categories.length}** categories`,
        '',
    ];

    for (const cat of categories) {
        lines.push(`## ${cat}`);
        lines.push('');
        const entries = byCategory[cat];
        if (entries.length === 0) {
            lines.push('_No concepts compiled yet._');
        } else {
            for (const entry of entries) {
                const indicator = confidenceIndicator(entry.confidence);
                const slug = entry.slug || entry.filename.replace('.md', '');
                lines.push(`- ${indicator} [[${slug}|${entry.title}]] — ${entry.description}`);
            }
        }
        lines.push('');
    }

    // Cross-References section (if cross-references.json exists)
    const crossRefPath = path.join(conceptsDir, 'cross-references.json');
    try {
        const crossRefContent = await fs.readFile(crossRefPath, 'utf-8');
        const crossRefMap = JSON.parse(crossRefContent);

        const pairs = new Set();
        for (const [slugA, data] of Object.entries(crossRefMap)) {
            for (const slugB of (data.related || [])) {
                const pair = slugA < slugB ? `${slugA}|${slugB}` : `${slugB}|${slugA}`;
                pairs.add(pair);
            }
        }

        lines.push('## Cross-References');
        lines.push('');
        if (pairs.size === 0) {
            lines.push('_No cross-references found._');
        } else {
            for (const pair of Array.from(pairs).sort()) {
                const [a, b] = pair.split('|');
                lines.push(`- [[${a}]] ↔ [[${b}]]`);
            }
        }
        lines.push('');
    } catch { /* cross-references.json may not exist — omit section */ }

    // Dataview dynamic query blocks
    lines.push('## Dynamic Views');
    lines.push('');
    lines.push('### Recently Updated');
    lines.push('```dataview');
    lines.push('TABLE confidence, date_range, source_count');
    lines.push('FROM ""');
    lines.push('WHERE confidence AND file.name != "index"');
    lines.push('SORT updated DESC');
    lines.push('LIMIT 10');
    lines.push('```');
    lines.push('');
    lines.push('### High Confidence');
    lines.push('```dataview');
    lines.push('TABLE category, date_range, source_count');
    lines.push('FROM ""');
    lines.push('WHERE confidence >= 0.7 AND file.name != "index"');
    lines.push('SORT confidence DESC');
    lines.push('```');
    lines.push('');

    const indexPath = path.join(conceptsDir, 'index.md');
    await fs.writeFile(indexPath, lines.join('\n'), 'utf-8');
    console.log(`  Index written: ${indexPath}`);
}

/**
 * Inject `## Related Concepts` sections with [[wiki-links]] into each concept
 * article, based on `cross-references.json`. Idempotent — replaces any
 * existing section on re-run.
 *
 * @param {Array} _writtenConcepts   Unused (kept for historical compat)
 * @param {object} deps
 * @param {string}   deps.conceptsDir
 * @param {string[]} deps.categories
 */
async function injectRelatedConcepts(_writtenConcepts, { conceptsDir, categories }) {
    const crossRefPath = path.join(conceptsDir, 'cross-references.json');
    let crossRefMap;
    try {
        const raw = await fs.readFile(crossRefPath, 'utf-8');
        crossRefMap = JSON.parse(raw);
    } catch {
        return; // No cross-references to inject
    }

    // Build slug → {title, category} lookup from all concept files
    const conceptLookup = new Map();
    for (const cat of categories) {
        const catDir = path.join(conceptsDir, cat);
        try {
            const files = await fs.readdir(catDir);
            for (const file of files) {
                if (!file.endsWith('.md')) continue;
                const slug = file.replace('.md', '');
                try {
                    const content = await fs.readFile(path.join(catDir, file), 'utf-8');
                    const fm = parseFrontmatter(content);
                    if (fm) conceptLookup.set(slug, { title: fm.title || slug, category: cat });
                } catch { /* skip */ }
            }
        } catch { /* skip */ }
    }

    let injected = 0;
    for (const [slug, data] of Object.entries(crossRefMap)) {
        const related = data.related || [];
        if (related.length === 0) continue;

        const info = conceptLookup.get(slug);
        if (!info) continue;

        const filePath = path.join(conceptsDir, info.category, `${slug}.md`);
        let content;
        try {
            content = await fs.readFile(filePath, 'utf-8');
        } catch { continue; }

        const links = related
            .map(relSlug => {
                const relInfo = conceptLookup.get(relSlug);
                if (!relInfo) return null;
                return `- [[${relSlug}|${relInfo.title}]]`;
            })
            .filter(Boolean);

        if (links.length === 0) continue;

        const relatedSection = `## Related Concepts\n\n${links.join('\n')}`;

        // Strip any existing Related Concepts section before injecting
        const cleaned = content.replace(/## Related Concepts\s*\n[\s\S]*?(?=\n## Evidence|$)/, '');
        const updated = cleaned.replace(/(\n## Evidence)/, `\n${relatedSection}\n$1`);

        if (updated !== content) {
            await fs.writeFile(filePath, updated, 'utf-8');
            injected++;
        }
    }

    if (injected > 0) {
        console.log(`  Related Concepts injected into ${injected} article(s).`);
    }
}

module.exports = { generateIndex, injectRelatedConcepts };

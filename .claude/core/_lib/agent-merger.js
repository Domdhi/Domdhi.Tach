/**
 * Agent Merger — section-aware merge logic for agent .md files.
 *
 * An agent file has four zones:
 *   frontmatter  — YAML between opening and closing ---
 *   soulZone     — from first `# ` heading to `## Skills` heading (exclusive)
 *   skillsZone   — from `## Skills` heading to `## Project Context` or end
 *   projectCtx   — from `## Project Context` to end, or '' if absent
 *
 * Merge strategy (when dest exists):
 *   - frontmatter: take src, but preserve nickname: and aliases: from dest; also
 *                  preserve a tuned description: when the agent is personalized or
 *                  specialized (those are written by /review:* commands, not the template)
 *   - soulZone:    preserve if dest is personalized (has nickname:); else take src
 *   - skillsZone:  always from src (template-owned)
 *   - projectCtx:  preserve if dest has it; otherwise omit
 *
 * Never calls process.cwd(). All paths are explicit srcPath / dstPath arguments.
 *
 * @module agent-merger
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Section Parser ─────────────────────────────────────────────────────────────

/**
 * Parse an agent .md file into its four zones.
 *
 * @param {string} content  — full file content (LF or CRLF)
 * @returns {{ frontmatter: string, soulZone: string, skillsZone: string, projectCtx: string }}
 */
function parseAgentSections(content) {
    // Normalize CRLF to LF so line comparisons work on Windows-edited files
    const lines = content.replace(/\r\n/g, '\n').split('\n');

    let frontmatterEnd = -1;  // index of closing ---
    let skillsStart = -1;     // index of ## Skills line
    let projectCtxStart = -1; // index of ## Project Context line

    // Find frontmatter block (must start at line 0)
    if (lines[0] === '---') {
        for (let i = 1; i < lines.length; i++) {
            if (lines[i] === '---') {
                frontmatterEnd = i;
                break;
            }
        }
    }

    // Search for section headings after frontmatter
    const searchStart = frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0;
    for (let i = searchStart; i < lines.length; i++) {
        if (skillsStart === -1 && lines[i].match(/^## Skills\s*$/)) {
            skillsStart = i;
        } else if (skillsStart !== -1 && projectCtxStart === -1 && lines[i].match(/^## Project Context\s*$/)) {
            projectCtxStart = i;
            break;
        }
    }

    // Extract frontmatter (lines between the two --- markers, no delimiters)
    const frontmatter = frontmatterEnd >= 0
        ? lines.slice(1, frontmatterEnd).join('\n')
        : '';

    // Soul zone: from line after closing --- to line before ## Skills (or end)
    const soulStart = frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0;
    const soulEnd = skillsStart >= 0 ? skillsStart : lines.length;
    let soulLines = lines.slice(soulStart, soulEnd);
    // Remove leading blank lines
    while (soulLines.length > 0 && soulLines[0].trim() === '') {
        soulLines.shift();
    }
    // Reassembly spacing: two leading newlines so the merged file has a blank line
    // between the closing `---` and the soul zone's first line (standard markdown
    // convention; was a one-newline bug that ran headings flush against frontmatter).
    const soulZone = soulLines.length > 0 ? '\n\n' + soulLines.join('\n') : '';

    // Skills zone: from ## Skills to ## Project Context or end
    const skillsEnd = projectCtxStart >= 0 ? projectCtxStart : lines.length;
    const skillsZone = skillsStart >= 0
        ? lines.slice(skillsStart, skillsEnd).join('\n')
        : '';

    // Project Context: from ## Project Context to end
    const projectCtx = projectCtxStart >= 0
        ? lines.slice(projectCtxStart).join('\n')
        : '';

    return { frontmatter, soulZone, skillsZone, projectCtx };
}

// ── Frontmatter Merge ─────────────────────────────────────────────────────────

/**
 * Detect whether an agent file has been personalized.
 * Personalization is indicated by a `nickname:` field in frontmatter.
 *
 * @param {string} frontmatter
 * @returns {boolean}
 */
function isPersonalized(frontmatter) {
    return /^nickname\s*:/m.test(frontmatter);
}

/**
 * Extract the line range [start, end) of a frontmatter field, including any
 * indented continuation lines — so YAML folded/block scalars (`description: >`
 * spanning several indented lines) are captured as a single unit.
 *
 * @param {string[]} lines
 * @param {string} key
 * @returns {{ start: number, end: number }|null}
 */
function extractFieldBlock(lines, key) {
    const re = new RegExp('^' + key + '\\s*:');
    const start = lines.findIndex(l => re.test(l));
    if (start === -1) return null;
    let end = start + 1;
    // Consume indented continuation lines (the folded/block scalar body).
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
    return { start, end };
}

/**
 * Extract the YAML list block for a `skills:` (block-sequence) field: the index of
 * the `skills:` line, the index just past its `- item` lines, and the item names.
 *
 * @param {string[]} lines
 * @returns {{ start: number, end: number, items: string[] }|null}
 */
function extractSkillsList(lines) {
    const start = lines.findIndex(l => /^skills\s*:/.test(l));
    if (start === -1) return null;
    let end = start + 1;
    const items = [];
    while (end < lines.length && /^\s*-\s+/.test(lines[end])) {
        items.push(lines[end].replace(/^\s*-\s+/, '').trim());
        end++;
    }
    return { start, end, items };
}

/**
 * Merge frontmatter strings: take src lines as the base, but preserve
 * `nickname:` and `aliases:` from dst if they exist. When opts.preserveDescription
 * is set, also preserve dst's `description:` block (multi-line safe) — used when the
 * agent is personalized/specialized so /review:* tuned descriptions survive updates.
 *
 * When opts.canonicalSkills + opts.targetSkills are provided, project-specific skills
 * in dst's `skills:` list are unioned into the result: a dst skill that is NOT shipped
 * by the template (not in canonicalSkills) but DOES exist as a skill dir in the target
 * (in targetSkills) is a specialization added by /review:specialize and must survive —
 * otherwise the template's base skills list silently strips it.
 *
 * @param {string} srcFm  — frontmatter string from src (no --- delimiters)
 * @param {string} dstFm  — frontmatter string from dst (no --- delimiters)
 * @param {object} [opts]
 * @param {boolean} [opts.preserveDescription]  — keep dst's description block
 * @param {Set<string>} [opts.canonicalSkills]  — skills shipped by the template
 * @param {Set<string>} [opts.targetSkills]     — skill dirs present in the target
 * @returns {string}       — merged frontmatter string (no --- delimiters)
 */
function mergeFrontmatter(srcFm, dstFm, opts) {
    opts = opts || {};
    const srcLines = srcFm.split('\n');
    const destLines = dstFm.split('\n');

    // Extract preserved lines from dest
    const nicknameMatch = destLines.find(l => /^nickname\s*:/.test(l));
    const aliasesMatch = destLines.find(l => /^aliases\s*:/.test(l));

    // Build result from src, replacing nickname/aliases lines if dest has them
    const result = srcLines.map(line => {
        if (nicknameMatch && /^nickname\s*:/.test(line)) return nicknameMatch;
        if (aliasesMatch && /^aliases\s*:/.test(line)) return aliasesMatch;
        return line;
    });

    // If src had no nickname line but dest does, insert after `name:` line
    const srcHasNickname = srcLines.some(l => /^nickname\s*:/.test(l));
    if (!srcHasNickname && nicknameMatch) {
        const nameIdx = result.findIndex(l => /^name\s*:/.test(l));
        if (nameIdx >= 0) {
            result.splice(nameIdx + 1, 0, nicknameMatch);
        }
    }

    // If src had no aliases line but dest does, insert after nickname or name
    const srcHasAliases = srcLines.some(l => /^aliases\s*:/.test(l));
    if (!srcHasAliases && aliasesMatch) {
        const afterIdx = result.findIndex(l => /^nickname\s*:/.test(l));
        const insertAfter = afterIdx >= 0 ? afterIdx : result.findIndex(l => /^name\s*:/.test(l));
        if (insertAfter >= 0) {
            result.splice(insertAfter + 1, 0, aliasesMatch);
        }
    }

    // Preserve a tuned description block from dest (multi-line / folded-scalar safe).
    // Descriptions are project specialization (written by /review:specialize and
    // /review:optimize-agents), so without this a template update reverts them to
    // the generic one-liner. Gated by opts.preserveDescription so unmodified agents
    // still pick up template description improvements.
    if (opts.preserveDescription) {
        const destDesc = extractFieldBlock(destLines, 'description');
        if (destDesc) {
            const destBlock = destLines.slice(destDesc.start, destDesc.end);
            const resDesc = extractFieldBlock(result, 'description');
            if (resDesc) {
                result.splice(resDesc.start, resDesc.end - resDesc.start, ...destBlock);
            } else {
                // src had no description — insert after aliases / nickname / name
                let insertAt = result.findIndex(l => /^aliases\s*:/.test(l));
                if (insertAt < 0) insertAt = result.findIndex(l => /^nickname\s*:/.test(l));
                if (insertAt < 0) insertAt = result.findIndex(l => /^name\s*:/.test(l));
                if (insertAt >= 0) result.splice(insertAt + 1, 0, ...destBlock);
            }
        }
    }

    // Union project-specific (bespoke) skills from dst into the result skills list.
    // Bespoke = in dst, not shipped by the template, and still a real skill dir in the
    // target. This is the fix for the merge stripping /review:specialize skills.
    if (opts.canonicalSkills && opts.targetSkills) {
        const destSkills = extractSkillsList(destLines);
        if (destSkills) {
            const resSkills = extractSkillsList(result);
            const existing = resSkills ? resSkills.items : [];
            const bespoke = destSkills.items.filter(s =>
                !opts.canonicalSkills.has(s) &&
                opts.targetSkills.has(s) &&
                !existing.includes(s));
            if (bespoke.length > 0 && resSkills) {
                // Append into the existing list, matching its item indentation.
                const sample = result[resSkills.start + 1] || '  - ';
                const indent = (sample.match(/^(\s*)-/) || [, '  '])[1];
                result.splice(resSkills.end, 0, ...bespoke.map(s => `${indent}- ${s}`));
            } else if (bespoke.length > 0) {
                // src has no `skills:` block at all — synthesize one so the project's
                // bespoke skills are not lost (the no-template-skills shape of the bug).
                const block = ['skills:', ...bespoke.map(s => `  - ${s}`)];
                const at = result.findIndex(l => /^name\s*:/.test(l));
                if (at >= 0) result.splice(at + 1, 0, ...block);
                else result.push(...block);
            }
        }
    }

    return result.join('\n');
}

// ── File Merge ────────────────────────────────────────────────────────────────

/**
 * Merge an agent .md file from srcPath into dstPath.
 *
 * If dstPath doesn't exist: simple copy (fresh install).
 * If dstPath exists:
 *   - Overwrite frontmatter (preserving nickname/aliases if personalized)
 *   - Overwrite Skills Zone with source
 *   - Preserve Soul Zone if personalized; otherwise take source
 *   - Preserve Project Context if it exists in dest; otherwise omit
 *
 * @param {string} srcPath
 * @param {string} dstPath
 * @param {object} [opts]
 * @returns {{ changed: boolean, diff?: string }}
 */
function mergeAgentFile(srcPath, dstPath, opts) {
    opts = opts || {};

    if (!fs.existsSync(dstPath)) {
        const srcContent = fs.readFileSync(srcPath, 'utf8');
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.writeFileSync(dstPath, srcContent, 'utf8');
        return { changed: true, detail: 'copied (fresh install)' };
    }

    const srcContent = fs.readFileSync(srcPath, 'utf8');
    const destContent = fs.readFileSync(dstPath, 'utf8');

    const src = parseAgentSections(srcContent);
    const dest = parseAgentSections(destContent);

    const personalized = isPersonalized(dest.frontmatter);
    const hasProjectCtx = dest.projectCtx.length > 0;
    // A description is project specialization once the agent has been personalized
    // or specialized (/review:personalize, /review:specialize, /review:optimize-agents
    // all author project-specific descriptions). Preserve it in those cases so the
    // generic template description doesn't clobber routing-tuned text on update.
    const preserveDescription = personalized || hasProjectCtx;

    // Merge frontmatter (preserves nickname/aliases always; description when tuned;
    // unions project-specific skills when the caller supplies the skill sets).
    const mergedFrontmatter = (preserveDescription || opts.canonicalSkills)
        ? mergeFrontmatter(src.frontmatter, dest.frontmatter, {
            preserveDescription,
            canonicalSkills: opts.canonicalSkills,
            targetSkills: opts.targetSkills,
        })
        : src.frontmatter;

    // Choose soul zone
    const mergedSoulZone = personalized ? dest.soulZone : src.soulZone;

    // Skills zone always from source
    const mergedSkillsZone = src.skillsZone;

    // Project context from dest if it exists
    const mergedProjectCtx = hasProjectCtx ? dest.projectCtx : '';

    // Reassemble
    let result = '---\n' + mergedFrontmatter + '\n---';
    result += mergedSoulZone;
    if (mergedSkillsZone) {
        // Ensure blank line before ## Skills if soul zone doesn't end with one
        if (!result.endsWith('\n\n') && !result.endsWith('\n')) result += '\n';
        if (!result.endsWith('\n\n')) result += '\n';
        result += mergedSkillsZone;
    }
    if (mergedProjectCtx) {
        if (!result.endsWith('\n\n') && !result.endsWith('\n')) result += '\n';
        if (!result.endsWith('\n\n')) result += '\n';
        result += mergedProjectCtx;
    }
    // Ensure trailing newline
    if (!result.endsWith('\n')) result += '\n';

    const changed = result !== destContent;
    if (changed) {
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.writeFileSync(dstPath, result, 'utf8');
    }

    const details = [];
    if (personalized) details.push('preserved Soul Zone');
    if (hasProjectCtx) details.push('preserved Project Context');
    if (preserveDescription && /^description\s*:/m.test(dest.frontmatter)) details.push('preserved description');
    const detail = details.length > 0
        ? `merged (${details.join(', ')})`
        : changed ? 'merged (no personalization)' : 'unchanged';

    return { changed, detail };
}

module.exports = {
    parseAgentSections,
    isPersonalized,
    extractFieldBlock,
    extractSkillsList,
    mergeFrontmatter,
    mergeAgentFile,
};

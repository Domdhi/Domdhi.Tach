/**
 * Organize Hook — Plans + Screenshots
 *
 * Moves loose files into dated folder structures:
 *   Plans:       docs/.output/plans/{YYYY-MM-DD}/{HHMM}-{story}-{slug}.md
 *   Screenshots: docs/.output/screenshots/{YYYY-MM-DD}/{task}/
 *
 * Also updates Work Document References in Epic TODO files (plans only).
 *
 * Triggers:
 *   - PostToolUse:ExitPlanMode (plans)
 *   - PostToolUse:Bash (screenshots)
 *   - Manual: node .claude/hooks/organize.cjs ["task description"]
 */

const fs = require('fs');
const path = require('path');

// ── Shared Utilities ────────────────────────────────────────────────

function toSlug(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
}

function dateFolder(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function timePrefix(date) {
    return `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
}

function uniquePath(targetPath) {
    if (!fs.existsSync(targetPath)) return targetPath;
    const ext = path.extname(targetPath);
    const base = targetPath.slice(0, -ext.length || undefined);
    let counter = 2;
    let candidate;
    do {
        candidate = ext ? `${base}-${counter}${ext}` : `${base}-${counter}`;
        counter++;
    } while (fs.existsSync(candidate));
    return candidate;
}

const isDateDir = (name) => /^\d{4}-\d{2}-\d{2}$/.test(name);

// ── Plans ───────────────────────────────────────────────────────────

function organizePlans(results) {
    const projectDir = process.env.CLAUDE_PROJECT_DIR ||
        path.resolve(__dirname, '..', '..');

    const sourceDirs = [
        path.join(projectDir, 'docs', '.output', 'plans'),
        path.join(projectDir, '.claude', 'plans'),
    ];
    const targetDir = path.join(projectDir, 'docs', '.output', 'plans');

    // Collect unorganized markdown files from all source directories
    const files = [];
    for (const plansDir of sourceDirs) {
        if (!fs.existsSync(plansDir)) continue;
        const dirFiles = fs.readdirSync(plansDir)
            .filter(f => f.endsWith('.md') && fs.statSync(path.join(plansDir, f)).isFile())
            .filter(f => !/^(?:\d{4}-\d{2}-\d{2}|\d{6}-\d{4})/.test(f)) // Not already organized: skip YYYY-MM-DD date folders AND YYMMDD-HHMM run-stamp prefixes (e.g. do/run-todo plans)
            .map(f => {
                const stat = fs.statSync(path.join(plansDir, f));
                return {
                    name: f,
                    path: path.join(plansDir, f),
                    created: stat.birthtime || stat.mtime
                };
            });
        files.push(...dirFiles);
    }

    if (files.length === 0) return;

    for (const plan of files) {
        const content = fs.readFileSync(plan.path, 'utf8');

        // Extract story number from content
        const storyMatch = content.match(/Story\s+(\d+\.\d+)/i);
        const storyNumber = storyMatch ? `story-${storyMatch[1]}` : null;

        // Extract topic from content
        let topic = null;
        const summaryMatch = content.match(/^##\s+(?:Executive\s+)?Summary\s*\n+([^\n#]+)/im);
        if (summaryMatch) {
            topic = summaryMatch[1].trim().replace(/^[-*]\s*/, '');
        }
        if (!topic) {
            const topicMatch = content.match(/^##\s+(?:Topic|Purpose|Goal)\s*\n+([^\n#]+)/im);
            if (topicMatch) {
                topic = topicMatch[1].trim().replace(/^[-*]\s*/, '');
            }
        }

        // Fall back to first heading
        const titleMatch = content.match(/^#\s+(?:Plan:\s*)?(.+)/m);
        let title = titleMatch ? titleMatch[1] : 'untitled-plan';
        title = title.replace(/Story\s+\d+\.\d+[:\s]*/i, '').trim();

        if (!topic) topic = title;

        // Clean topic for Work Refs table
        topic = topic
            .replace(/^(implementation|plan|research|fix|add|update|create)\s+(for\s+)?/i, '')
            .slice(0, 50)
            .trim();

        const slug = toSlug(title).slice(0, 50);
        const dateFolderName = dateFolder(plan.created);
        const time = timePrefix(plan.created);

        // Create target directory
        const dateFolderPath = path.join(targetDir, dateFolderName);
        fs.mkdirSync(dateFolderPath, { recursive: true });

        // Build new filename
        const nameParts = [time];
        if (storyNumber) nameParts.push(storyNumber);
        nameParts.push(slug);
        const newName = `${nameParts.join('-')}.md`;
        const newPath = uniquePath(path.join(dateFolderPath, newName));

        fs.renameSync(plan.path, newPath);
        const relativePath = path.relative(projectDir, newPath);
        const finalName = path.basename(newPath);
        results.push(`plan: ${plan.name} -> ${relativePath}`);

        // Update Work Document References in TODO files
        updateWorkRefs(projectDir, dateFolderName, finalName, storyNumber, topic, plan.name);
    }
}

function updateWorkRefs(projectDir, dateFolderName, finalName, storyNumber, topic, originalName) {
    const phaseNumber = storyNumber ? storyNumber.match(/story-(\d+)\./)?.[1] : null;
    const phaseFromFilename = originalName.match(/phase(\d+)/i)?.[1];
    const effectivePhase = phaseNumber || phaseFromFilename;

    if (!effectivePhase) return;

    // Dynamic TODO file discovery — sorted for determinism across filesystems
    const todoFilePaths = [];
    const todoSubDir = path.join(projectDir, 'docs', 'todo');
    if (fs.existsSync(todoSubDir)) {
        fs.readdirSync(todoSubDir)
            .filter(f => f.match(/TODO.*\.md$/i) || f.match(/^_.*\.md$/i))
            .sort()
            .forEach(f => todoFilePaths.push(path.join(todoSubDir, f)));
    }
    const docsRootDir = path.join(projectDir, 'docs');
    if (fs.existsSync(docsRootDir)) {
        fs.readdirSync(docsRootDir)
            .filter(f => f.match(/^TODO_.*\.md$/i))
            .sort()
            .forEach(f => todoFilePaths.push(path.join(docsRootDir, f)));
    }

    const todoFile = todoFilePaths[0];
    if (!todoFile || !fs.existsSync(todoFile)) return;

    let todoContent = fs.readFileSync(todoFile, 'utf8');
    const workRefsIndex = todoContent.indexOf('## Work Document References');
    if (workRefsIndex === -1) return;

    const afterHeader = todoContent.slice(workRefsIndex);
    const sepMatch = afterHeader.match(/\|[-\s]+\|[-\s]+\|[-\s]+\|[-\s]+\|/);
    if (!sepMatch || todoContent.includes(finalName)) return;

    const insertPoint = workRefsIndex + afterHeader.indexOf(sepMatch[0]) + sepMatch[0].length;
    const displayTopic = topic || 'Implementation';
    const storyDisplay = storyNumber ? storyNumber.replace('story-', '') : `Phase ${effectivePhase}`;
    const planAbsPath = path.join(projectDir, 'docs', '.output', 'plans', dateFolderName, finalName);
    const relLink = path.relative(path.dirname(todoFile), planAbsPath).replace(/\\/g, '/');
    const newRow = `\n| ${dateFolderName} | [${finalName}](${relLink}) | ${storyDisplay} | ${displayTopic} |`;

    todoContent = todoContent.slice(0, insertPoint) + newRow + todoContent.slice(insertPoint);
    fs.writeFileSync(todoFile, todoContent);
}

// ── Screenshots ─────────────────────────────────────────────────────

function organizeScreenshots(results) {
    const projectDir = process.env.CLAUDE_PROJECT_DIR ||
        path.resolve(__dirname, '..', '..');

    const verifyDir = path.join(projectDir, 'docs', '.output', 'screenshots');
    if (!fs.existsSync(verifyDir)) return;

    const description = process.argv[2] || '';

    function getSlug(fileNames) {
        if (description) return toSlug(description);
        const names = fileNames.map(f => f.replace(/\.[^.]+$/, ''));
        let prefix = names[0] || 'screenshots';
        for (const name of names.slice(1)) {
            while (!name.startsWith(prefix) && prefix.length > 0) {
                const lastHyphen = prefix.lastIndexOf('-');
                prefix = lastHyphen > 0 ? prefix.slice(0, lastHyphen) : '';
            }
        }
        return toSlug(prefix || 'manual-test');
    }

    // Case 1: Loose files in screenshots/ root
    const rootFiles = fs.readdirSync(verifyDir)
        .filter(f => fs.statSync(path.join(verifyDir, f)).isFile());

    if (rootFiles.length > 0) {
        const slug = getSlug(rootFiles);
        const earliest = rootFiles.reduce((min, f) => {
            const mt = fs.statSync(path.join(verifyDir, f)).mtime;
            return mt < min ? mt : min;
        }, fs.statSync(path.join(verifyDir, rootFiles[0])).mtime);

        const dateFolderName = dateFolder(earliest);
        const targetPath = uniquePath(path.join(verifyDir, dateFolderName, slug));
        fs.mkdirSync(targetPath, { recursive: true });

        for (const f of rootFiles) {
            fs.renameSync(path.join(verifyDir, f), path.join(targetPath, f));
        }
        results.push(`screenshots: ${rootFiles.length} root files -> ${path.relative(verifyDir, targetPath)}/`);
    }

    // Case 2: Loose files inside date folders (no task subfolder)
    const dateDirs = fs.readdirSync(verifyDir)
        .filter(f => isDateDir(f) && fs.statSync(path.join(verifyDir, f)).isDirectory());

    for (const dir of dateDirs) {
        const datePath = path.join(verifyDir, dir);
        const looseFiles = fs.readdirSync(datePath)
            .filter(f => fs.statSync(path.join(datePath, f)).isFile());

        if (looseFiles.length === 0) continue;

        const slug = getSlug(looseFiles);
        const targetPath = uniquePath(path.join(datePath, slug));
        fs.mkdirSync(targetPath, { recursive: true });

        for (const f of looseFiles) {
            fs.renameSync(path.join(datePath, f), path.join(targetPath, f));
        }
        results.push(`screenshots: ${looseFiles.length} files in ${dir}/ -> ${dir}/${path.basename(targetPath)}/`);
    }
}

// ── processEvent ────────────────────────────────────────────────────

/**
 * Called by Claude Code hooks (PostToolUse:ExitPlanMode, PostToolUse:Bash).
 * Re-callable: results array is local per invocation.
 *
 * @param {object} _parsedJson — Hook event payload (unused; files discovered via filesystem)
 * @returns {{ feedback: string } | null}
 */
function processEvent(_parsedJson) {
    const results = [];
    organizePlans(results);
    organizeScreenshots(results);

    if (results.length === 0) return null;

    return { feedback: `Organized ${results.length} item(s):\n${results.join('\n')}` };
}

// ── Main ────────────────────────────────────────────────────────────

if (require.main === module) {
    const result = processEvent({});

    if (!result) {
        process.exit(0);
    }

    console.log(JSON.stringify(result));
    process.exit(0);
}

module.exports = { processEvent, toSlug, dateFolder, timePrefix, uniquePath };

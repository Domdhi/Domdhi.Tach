/**
 * Generate _project-timeline.md from git history.
 *
 * Usage:
 *   node .claude/core/gen-timeline.js [full|update]
 *
 * - full:   regenerate from first commit (default if file doesn't exist)
 * - update: incremental from last documented commit
 *
 * Called by /timeline command. Can also run standalone.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Date helpers (timezone-safe, uses local date strings) ───────────────────

function getMonday(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]} ${months[date.getMonth()]} ${date.getDate()}`;
}

function formatWeekHeader(mondayStr) {
    const [y, m, d] = mondayStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `Week of ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

// ── Theme grouping (for days with >5 commits) ──────────────────────────────

function groupByTheme(dayCommits) {
    const groups = {};
    for (const c of dayCommits) {
        const prefixMatch = c.msg.match(/^(\w+)(?:\(([^)]+)\))?:/);
        let theme;
        if (prefixMatch) {
            const type = prefixMatch[1];
            const scope = prefixMatch[2];
            if (scope) {
                theme = scope.charAt(0).toUpperCase() + scope.slice(1);
            } else {
                const typeMap = {
                    feat: 'Features', fix: 'Fixes', docs: 'Documentation',
                    refactor: 'Refactoring', test: 'Testing', chore: 'Chores',
                    style: 'Styling', perf: 'Performance',
                };
                theme = typeMap[type] || type.charAt(0).toUpperCase() + type.slice(1);
            }
        } else {
            theme = 'Other';
        }
        if (!groups[theme]) groups[theme] = [];
        groups[theme].push(c);
    }
    return groups;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
    const timelinePath = path.join(projectDir, 'docs', '_project-timeline.md');
    const mode = process.argv[2] || (fs.existsSync(timelinePath) ? 'update' : 'full');

    // ── Gather git data ─────────────────────────────────────────────────────

    let gitCmd = 'git log --format="%H|%ai|%s" --reverse --numstat main';

    if (mode === 'update' && fs.existsSync(timelinePath)) {
        const existing = fs.readFileSync(timelinePath, 'utf8');
        const hashMatch = existing.match(/<!-- last:([a-f0-9]{40}) -->/);
        if (hashMatch) {
            gitCmd = `git log --format="%H|%ai|%s" --reverse --numstat ${hashMatch[1]}..HEAD`;
        }
    }

    let raw;
    try {
        raw = execSync(gitCmd, {
            cwd: projectDir,
            maxBuffer: 50 * 1024 * 1024,
            windowsHide: true,
        }).toString().trim();
    } catch (err) {
        console.log(JSON.stringify({ feedback: `git log failed: ${err.message}` }));
        process.exit(0);
    }

    // Parse numstat output: commit lines have |, stat lines have tabs
    const lines = raw.split('\n');
    const commits = [];
    let current = null;

    for (const line of lines) {
        if (line.match(/^[a-f0-9]{40}\|/)) {
            if (current) commits.push(current);
            const parts = line.split('|');
            const localDate = parts[1].trim().split(' ')[0]; // YYYY-MM-DD in local time
            current = {
                hash: parts[0],
                shortHash: parts[0].slice(0, 7),
                localDate,
                msg: (parts[2] || '').replace(/Co-Authored-By:.*/gi, '').trim(),
                files: 0,
            };
        } else if (current && (line.match(/^\d/) || line.match(/^-\t/))) {
            current.files++;
        }
    }
    if (current) commits.push(current);

    if (commits.length === 0) {
        console.log(JSON.stringify({ feedback: 'No new commits to process.' }));
        process.exit(0);
    }

    // ── Build week/day structure ────────────────────────────────────────────

    const weeks = new Map();

    for (const c of commits) {
        const monday = getMonday(c.localDate);
        if (!weeks.has(monday)) weeks.set(monday, new Map());
        const week = weeks.get(monday);
        if (!week.has(c.localDate)) week.set(c.localDate, []);
        week.get(c.localDate).push(c);
    }

    const sortedWeeks = [...weeks.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    const lastHash = commits[commits.length - 1].hash;

    // ── Format output ───────────────────────────────────────────────────────

    // Derive project name from directory
    const projectName = path.basename(projectDir);
    let output = `# ${projectName} Project Timeline\n\n`;
    output += `*Generated ${new Date().toISOString().split('T')[0]} — ${commits.length} commits, ${sortedWeeks.length} weeks*\n\n`;
    output += `<!-- last:${lastHash} -->\n\n`;

    for (const [monday, days] of sortedWeeks) {
        output += `## ${formatWeekHeader(monday)}\n\n`;
        const sortedDays = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]));

        for (const [dayStr, dayCommits] of sortedDays) {
            const totalFiles = dayCommits.reduce((sum, c) => sum + c.files, 0);
            output += `### ${formatDate(dayStr)} (${dayCommits.length} commit${dayCommits.length > 1 ? 's' : ''}, ${totalFiles} files)\n`;

            if (dayCommits.length <= 5) {
                for (const c of dayCommits) {
                    output += `- ${c.msg}\n`;
                }
            } else {
                const groups = groupByTheme(dayCommits);
                for (const [theme, themeCommits] of Object.entries(groups)) {
                    output += `**${theme}** (${themeCommits.length} commit${themeCommits.length > 1 ? 's' : ''})\n`;
                    for (const c of themeCommits) {
                        const cleanMsg = c.msg.replace(/^\w+(\([^)]+\))?:\s*/, '');
                        output += `- ${cleanMsg}\n`;
                    }
                    output += '\n';
                }
            }
            output += '\n';
        }
        output += '---\n\n';
    }

    // ── Write (full or incremental) ─────────────────────────────────────────

    if (mode === 'update' && fs.existsSync(timelinePath)) {
        // For update: prepend new weeks before existing content
        const existing = fs.readFileSync(timelinePath, 'utf8');
        // Replace header + last hash, keep week content
        const firstWeekIdx = existing.indexOf('\n## Week of');
        if (firstWeekIdx !== -1) {
            const existingWeeks = existing.slice(firstWeekIdx + 1);
            output = output + existingWeeks;
        }
    }

    fs.writeFileSync(timelinePath, output);

    console.log(JSON.stringify({
        feedback: `Timeline ${mode === 'full' ? 'generated' : 'updated'}: ${commits.length} commits, ${sortedWeeks.length} weeks (${commits[0].localDate} → ${commits[commits.length - 1].localDate})`,
    }));
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}

module.exports = { getMonday, formatDate, formatWeekHeader, groupByTheme, main };

// AC→source map (Dispatch port-back 2026-06-02 / epic-overlap):
//   extractEpicFiles(backlogPath) → Map<epicKey, Set<filePath>>
//     - epic heading: ### Epic <id>: <name>
//     - files come from `* **Files:**` blocks; path is first backtick-delimited token
//   findOverlaps(map) → [{epicA, epicB, sharedFiles}] — each pair once, epicA<epicB, files sorted
//   read failure → throw with path in message

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { extractEpicFiles, findOverlaps } = require('../epic-overlap');

let dir;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-overlap-'));
});
afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

function writeBacklog(body) {
    const p = path.join(dir, '_backlog.md');
    fs.writeFileSync(p, body);
    return p;
}

const BACKLOG = `# Backlog

### Epic 1: Authentication

#### Story 1.1: Login
* **Files:**
  * \`src/auth/login.ts\` — new
  * \`src/shared/db.ts\` — modified

### Epic 2: Billing

#### Story 2.1: Checkout
* **Files:**
  * \`src/billing/checkout.ts\` — new
  * \`src/shared/db.ts\` — modified

### Epic 3: Docs

#### Story 3.1: README
* **Files:**
  * \`README.md\` — modified
`;

describe('extractEpicFiles', () => {
    it('maps each epic heading to the set of files its stories claim', () => {
        const map = extractEpicFiles(writeBacklog(BACKLOG));
        expect([...map.keys()]).toEqual([
            'Epic 1: Authentication',
            'Epic 2: Billing',
            'Epic 3: Docs',
        ]);
        expect([...map.get('Epic 1: Authentication')]).toEqual(['src/auth/login.ts', 'src/shared/db.ts']);
        expect([...map.get('Epic 3: Docs')]).toEqual(['README.md']);
    });

    it('keeps only the path inside the first backticks, dropping the description', () => {
        const map = extractEpicFiles(writeBacklog(BACKLOG));
        expect(map.get('Epic 2: Billing').has('src/billing/checkout.ts')).toBe(true);
    });

    it('throws with the path when the file cannot be read', () => {
        expect(() => extractEpicFiles(path.join(dir, 'nope.md'))).toThrow(/nope\.md/);
    });
});

describe('findOverlaps', () => {
    it('reports each sharing pair once with sorted shared files, epicA<epicB', () => {
        const map = extractEpicFiles(writeBacklog(BACKLOG));
        const overlaps = findOverlaps(map);
        expect(overlaps).toEqual([
            { epicA: 'Epic 1: Authentication', epicB: 'Epic 2: Billing', sharedFiles: ['src/shared/db.ts'] },
        ]);
    });

    it('returns an empty array when no epics share files', () => {
        const map = new Map([
            ['Epic 1: A', new Set(['a.ts'])],
            ['Epic 2: B', new Set(['b.ts'])],
        ]);
        expect(findOverlaps(map)).toEqual([]);
    });
});

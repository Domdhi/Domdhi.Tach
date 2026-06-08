import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('gen-timeline', () => {
    it('loads without side effects and exports helpers', () => {
        const exports = require('../gen-timeline');
        expect(exports).toBeDefined();
        expect(typeof exports.getMonday).toBe('function');
        expect(typeof exports.formatDate).toBe('function');
        expect(typeof exports.formatWeekHeader).toBe('function');
        expect(typeof exports.groupByTheme).toBe('function');
    });

    it('getMonday returns the Monday for a known date', () => {
        const { getMonday } = require('../gen-timeline');
        // 2026-04-19 is a Sunday — Monday of that week is 2026-04-13
        expect(getMonday('2026-04-19')).toBe('2026-04-13');
        // 2026-04-14 is a Tuesday — Monday of that week is 2026-04-13
        expect(getMonday('2026-04-14')).toBe('2026-04-13');
    });
});

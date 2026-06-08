import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('cleanup-logs', () => {
    it('loads without side effects and exports helpers', () => {
        const exports = require('../cleanup-logs');
        expect(exports).toBeDefined();
        expect(typeof exports.cleanupLogs).toBe('function');
        expect(typeof exports.getFolderSize).toBe('function');
        expect(typeof exports.formatBytes).toBe('function');
    });

    it('formatBytes handles zero and various sizes', () => {
        const { formatBytes } = require('../cleanup-logs');
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(1024)).toBe('1 KB');
        expect(formatBytes(1024 * 1024)).toBe('1 MB');
    });
});

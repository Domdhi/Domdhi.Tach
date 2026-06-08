import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('memory-health-check', () => {
    it('loads without side effects and exports MemoryHealthChecker', () => {
        const MemoryHealthChecker = require('../memory-health-check');
        expect(MemoryHealthChecker).toBeDefined();
        expect(typeof MemoryHealthChecker).toBe('function');
    });

    it('can be instantiated without throwing', () => {
        const MemoryHealthChecker = require('../memory-health-check');
        const checker = new MemoryHealthChecker();
        expect(checker).toBeDefined();
        expect(checker.results).toBeDefined();
        expect(Array.isArray(checker.results.passed)).toBe(true);
    });
});

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('memory-ingester', () => {
    it('loads without side effects and exports MemoryIngester class', () => {
        const MemoryIngester = require('../memory-ingester');
        expect(MemoryIngester).toBeDefined();
        expect(typeof MemoryIngester).toBe('function');
    });
});

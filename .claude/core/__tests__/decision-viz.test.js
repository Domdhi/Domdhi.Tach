import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('decision-viz', () => {
    it('loads without side effects and exports helpers', () => {
        const exports = require('../decision-viz');
        expect(exports).toBeDefined();
        expect(typeof exports.collectData).toBe('function');
        expect(typeof exports.generateHtml).toBe('function');
        expect(typeof exports.printTextSummary).toBe('function');
        expect(typeof exports.esc).toBe('function');
    });

    it('esc() escapes HTML special characters', () => {
        const { esc } = require('../decision-viz');
        expect(esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        expect(esc('normal text')).toBe('normal text');
    });
});

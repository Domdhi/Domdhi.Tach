// AC→source map (P1.1 / hook-input):
//   Exports: readHookInput(opts?), parseHookPayload(jsonText), getHookProfile(),
//            shouldRunInProfile(required), frozenRead(absPath)
//   Preserve per-caller stdin timeout semantics (1000ms default; null disables).
//   Profile gate: DOMDHI_HOOK_PROFILE ∈ {minimal, standard, strict}, default 'standard'.
//   frozenRead: per-process cache keyed by absolute path, no invalidation.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const fs = require('node:fs');
const path = require('node:path');
const { createTmpDir } = require('../../__tests__/_helpers/tmp-dir');

// The module-under-test is resolved lazily per test so env mutations take effect.
function loadModule() {
    delete require.cache[require.resolve('../hook-input')];
    return require('../hook-input');
}

function makeStdin(chunks, { emitError = false, emitEnd = true } = {}) {
    const readable = new Readable({ read() {} });
    // Drive via events on process.nextTick to give the reader time to subscribe.
    process.nextTick(() => {
        for (const c of chunks) readable.emit('data', c);
        if (emitError) readable.emit('error', new Error('stdin exploded'));
        if (emitEnd) readable.emit('end');
    });
    return readable;
}

function withStdin(stream, fn) {
    const orig = Object.getOwnPropertyDescriptor(process, 'stdin');
    Object.defineProperty(process, 'stdin', { configurable: true, get: () => stream });
    return Promise.resolve(fn()).finally(() => {
        if (orig) Object.defineProperty(process, 'stdin', orig);
    });
}

// -----------------------------------------------------------------------------
// readHookInput — stdin semantics
// -----------------------------------------------------------------------------

describe('readHookInput', () => {
    it('resolves empty string when stdin is a TTY', async () => {
        const { readHookInput } = loadModule();
        const fakeTty = new Readable({ read() {} });
        fakeTty.isTTY = true;
        await withStdin(fakeTty, async () => {
            const result = await readHookInput();
            expect(result).toBe('');
        });
    });

    it('concatenates a single data chunk', async () => {
        const { readHookInput } = loadModule();
        const stream = makeStdin(['hello']);
        await withStdin(stream, async () => {
            const result = await readHookInput();
            expect(result).toBe('hello');
        });
    });

    it('concatenates multi-chunk stdin into one string', async () => {
        const { readHookInput } = loadModule();
        const stream = makeStdin(['{"a":', '1', '}']);
        await withStdin(stream, async () => {
            const result = await readHookInput();
            expect(result).toBe('{"a":1}');
        });
    });

    it('resolves empty string when stdin error event fires with no data', async () => {
        const { readHookInput } = loadModule();
        const stream = makeStdin([], { emitError: true, emitEnd: false });
        await withStdin(stream, async () => {
            const result = await readHookInput();
            expect(result).toBe('');
        });
    });

    it('resolves accumulated data on 1000ms timeout (default)', async () => {
        const { readHookInput } = loadModule();
        // Stream that never emits 'end' — only data.
        const stream = new Readable({ read() {} });
        process.nextTick(() => stream.emit('data', 'partial'));
        const start = Date.now();
        await withStdin(stream, async () => {
            const result = await readHookInput();
            const elapsed = Date.now() - start;
            expect(result).toBe('partial');
            expect(elapsed).toBeGreaterThanOrEqual(900);
            expect(elapsed).toBeLessThan(1500);
        });
    }, 2000);

    it('honors custom timeoutMs (500ms for memory-capture parity)', async () => {
        const { readHookInput } = loadModule();
        const stream = new Readable({ read() {} });
        process.nextTick(() => stream.emit('data', 'x'));
        const start = Date.now();
        await withStdin(stream, async () => {
            const result = await readHookInput({ timeoutMs: 500 });
            const elapsed = Date.now() - start;
            expect(result).toBe('x');
            expect(elapsed).toBeGreaterThanOrEqual(400);
            expect(elapsed).toBeLessThan(900);
        });
    }, 2000);

    it('disables timeout when timeoutMs is null (damage-control / guardrail parity)', async () => {
        const { readHookInput } = loadModule();
        const stream = makeStdin(['done']);
        await withStdin(stream, async () => {
            const result = await readHookInput({ timeoutMs: null });
            expect(result).toBe('done');
        });
    });
});

// -----------------------------------------------------------------------------
// parseHookPayload
// -----------------------------------------------------------------------------

describe('parseHookPayload', () => {
    it('returns parsed object for valid JSON', () => {
        const { parseHookPayload } = loadModule();
        expect(parseHookPayload('{"x":1}')).toEqual({ x: 1 });
    });

    it('returns null on invalid JSON', () => {
        const { parseHookPayload } = loadModule();
        expect(parseHookPayload('{not json')).toBeNull();
    });

    it('returns null on empty string', () => {
        const { parseHookPayload } = loadModule();
        expect(parseHookPayload('')).toBeNull();
    });
});

// -----------------------------------------------------------------------------
// getHookProfile + shouldRunInProfile — A1 (ECC)
// -----------------------------------------------------------------------------

describe('getHookProfile', () => {
    const PROFILE_ENV = 'DOMDHI_HOOK_PROFILE';
    let prior;

    beforeEach(() => { prior = process.env[PROFILE_ENV]; delete process.env[PROFILE_ENV]; });
    afterEach(() => { if (prior === undefined) delete process.env[PROFILE_ENV]; else process.env[PROFILE_ENV] = prior; });

    it('defaults to "standard" when env var is unset', () => {
        const { getHookProfile } = loadModule();
        expect(getHookProfile()).toBe('standard');
    });

    it('honors DOMDHI_HOOK_PROFILE=minimal', () => {
        process.env[PROFILE_ENV] = 'minimal';
        const { getHookProfile } = loadModule();
        expect(getHookProfile()).toBe('minimal');
    });

    it('honors DOMDHI_HOOK_PROFILE=strict', () => {
        process.env[PROFILE_ENV] = 'strict';
        const { getHookProfile } = loadModule();
        expect(getHookProfile()).toBe('strict');
    });

    it('falls back to "standard" on unknown value', () => {
        process.env[PROFILE_ENV] = 'loudest';
        const { getHookProfile } = loadModule();
        expect(getHookProfile()).toBe('standard');
    });
});

describe('shouldRunInProfile', () => {
    const PROFILE_ENV = 'DOMDHI_HOOK_PROFILE';
    let prior;

    beforeEach(() => { prior = process.env[PROFILE_ENV]; delete process.env[PROFILE_ENV]; });
    afterEach(() => { if (prior === undefined) delete process.env[PROFILE_ENV]; else process.env[PROFILE_ENV] = prior; });

    it('minimal profile runs only minimal hooks, skips standard/strict', () => {
        process.env[PROFILE_ENV] = 'minimal';
        const { shouldRunInProfile } = loadModule();
        expect(shouldRunInProfile('minimal')).toBe(true);
        expect(shouldRunInProfile('standard')).toBe(false);
        expect(shouldRunInProfile('strict')).toBe(false);
    });

    it('standard profile runs minimal + standard, skips strict', () => {
        process.env[PROFILE_ENV] = 'standard';
        const { shouldRunInProfile } = loadModule();
        expect(shouldRunInProfile('minimal')).toBe(true);
        expect(shouldRunInProfile('standard')).toBe(true);
        expect(shouldRunInProfile('strict')).toBe(false);
    });

    it('strict profile runs everything', () => {
        process.env[PROFILE_ENV] = 'strict';
        const { shouldRunInProfile } = loadModule();
        expect(shouldRunInProfile('minimal')).toBe(true);
        expect(shouldRunInProfile('standard')).toBe(true);
        expect(shouldRunInProfile('strict')).toBe(true);
    });
});

// -----------------------------------------------------------------------------
// frozenRead — A5 (Hermes)
// -----------------------------------------------------------------------------

describe('frozenRead', () => {
    let tmp;
    beforeEach(() => { tmp = createTmpDir({ prefix: 'hook-input-frozen-' }); });
    afterEach(() => { tmp.cleanup(); });

    it('first call reads from disk, second call returns cached value', () => {
        const { frozenRead } = loadModule();
        const file = tmp.write('config.txt', 'first');
        const a = frozenRead(file);
        // Mutate on disk — frozenRead should NOT see the new content.
        fs.writeFileSync(file, 'changed');
        const b = frozenRead(file);
        expect(a).toBe('first');
        expect(b).toBe('first');
    });

    it('caches independently per absolute path', () => {
        const { frozenRead } = loadModule();
        const a = tmp.write('a.txt', 'alpha');
        const b = tmp.write('b.txt', 'beta');
        expect(frozenRead(a)).toBe('alpha');
        expect(frozenRead(b)).toBe('beta');
        fs.writeFileSync(a, 'mutated-a');
        fs.writeFileSync(b, 'mutated-b');
        expect(frozenRead(a)).toBe('alpha');
        expect(frozenRead(b)).toBe('beta');
    });

    it('throws if the file does not exist (not cached)', () => {
        const { frozenRead } = loadModule();
        const nonexistent = path.join(tmp.root, 'missing.txt');
        expect(() => frozenRead(nonexistent)).toThrow();
    });
});

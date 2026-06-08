/**
 * Story 5.2 — clipboardWrite capability declared in the manifest.
 *
 * The popup writes the YouTube transcript to the clipboard on explicit user
 * action (the "Copy Transcript" button, Story 5.3). MV3 declares this capability
 * as the `clipboardWrite` permission. This guard asserts the permission is
 * present AND that no UNJUSTIFIED extra permissions creep in alongside it
 * (Chrome Web Store review — every permission must be justified, NFR-S5).
 */
const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'manifest.json'), 'utf8'));

describe('Story 5.2 — clipboardWrite permission', () => {
    test('manifest declares the clipboardWrite permission', () => {
        expect(Array.isArray(manifest.permissions)).toBe(true);
        expect(manifest.permissions).toContain('clipboardWrite');
    });

    test('permission set stays minimal: exactly storage + clipboardWrite', () => {
        // Keep the justified set tight — any new permission must be added here
        // deliberately AND justified in docs/_project-context.md.
        expect(manifest.permissions.slice().sort())
            .toEqual(['clipboardWrite', 'storage']);
    });

    test('host_permissions unchanged (<all_urls>) — no new host scope', () => {
        expect(manifest.host_permissions).toEqual(['<all_urls>']);
    });
});

describe('Story 5.2 — clipboard justification recorded (NFR-S5)', () => {
    const contextDoc = fs.readFileSync(
        path.join(__dirname, '..', 'docs', '_project-context.md'), 'utf8');

    test('_project-context.md documents the clipboardWrite justification', () => {
        expect(contextDoc).toMatch(/clipboardWrite/);
    });

    test('justification notes explicit-user-action only (NFR-S6)', () => {
        // The justification must state the clipboard is written only on an
        // explicit user action (the Copy Transcript button), not silently.
        expect(contextDoc.toLowerCase()).toMatch(/explicit user action|user action|button/);
    });
});

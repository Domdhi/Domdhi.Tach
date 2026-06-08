/**
 * Unit tests for content-youtube.js — YouTube cleanup module (Epic 5).
 *
 * Story 4.1 (scaffold): settings read via the 3.1 pattern, MutationObserver
 * shell, fail-safe selector handling (NFR-R2), both-OFF = page unmodified.
 * Story 4.2 (hide Shorts) and 4.4 (hide comments / live-chat) add their own
 * describe blocks below as they land.
 */
const fs = require('fs');
const path = require('path');
const { setupChromeMock } = require('./chrome-mock');

// chrome + MutationObserver must exist BEFORE requiring the module, because it
// runs init() at load time (same pattern as content.js).
setupChromeMock();
global.MutationObserver = class {
    constructor(callback) { this._callback = callback; }
    observe() {}
    disconnect() {}
};

const yt = require('../src/content-youtube');

// ---- Helpers ----

/** Reset jsdom body to a known state between tests. */
function resetDom() {
    document.body.innerHTML = '';
    document.documentElement
        .querySelectorAll('.vsc-yt-hidden')
        .forEach((el) => el.remove());
}

afterEach(() => {
    resetDom();
    // Remove the fullscreen-chat <style> the suppression injects into <head> so
    // it never leaks across tests (resetDom only clears <body>).
    document.getElementById('vsc-yt-fs-chat-style')?.remove();
    yt._setSettings({ hideShorts: false, hideComments: false, hideChatFullscreen: false, skipAds: false });
    yt.stopAdSkip(); // ensure no ad-skip timer leaks across tests
});

// ---- Story 4.1: scaffold ----

describe('Story 4.1 — settings schema (3.1 pattern)', () => {
    test('DEFAULT_SETTINGS includes hideShorts/hideComments default OFF', () => {
        expect(yt.DEFAULT_SETTINGS.hideShorts).toBe(false);
        expect(yt.DEFAULT_SETTINGS.hideComments).toBe(false);
    });

    test('schema matches content.js verbatim (ADR-002 duplication)', () => {
        const content = require('../src/content');
        expect(yt.DEFAULT_SETTINGS).toEqual(content.DEFAULT_SETTINGS);
    });

    test('resolveSettings fills defaults for an empty store', () => {
        const r = yt.resolveSettings({});
        expect(r.hideShorts).toBe(false);
        expect(r.hideComments).toBe(false);
    });

    test('resolveSettings preserves stored toggle values', () => {
        const r = yt.resolveSettings({ hideShorts: true, hideComments: true });
        expect(r.hideShorts).toBe(true);
        expect(r.hideComments).toBe(true);
    });

    test('resolveSettings defaults hideChatFullscreen ON, but honors a stored false', () => {
        expect(yt.resolveSettings({}).hideChatFullscreen).toBe(true);
        expect(yt.resolveSettings({ hideChatFullscreen: false }).hideChatFullscreen).toBe(false);
    });

    test('resolveSettings defaults skipAds OFF, but honors a stored true', () => {
        expect(yt.resolveSettings({}).skipAds).toBe(false);
        expect(yt.resolveSettings({ skipAds: true }).skipAds).toBe(true);
    });

    test('getSettings reads from chrome.storage.sync and resolves toggles', (done) => {
        const chrome = setupChromeMock();
        chrome._setStorageData('hideShorts', true);
        // re-require not needed; getSettings reads global.chrome live
        yt.getSettings((settings) => {
            expect(settings.hideShorts).toBe(true);
            expect(settings.hideComments).toBe(false);
            done();
        });
    });
});

describe('Story 4.1 — manifest registration', () => {
    const manifest = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'src', 'manifest.json'), 'utf8'));

    test('content-youtube.js is registered as a content script', () => {
        const entry = manifest.content_scripts.find(
            (cs) => cs.js.includes('content-youtube.js'));
        expect(entry).toBeDefined();
    });

    test('the module is scoped to YouTube only', () => {
        const entry = manifest.content_scripts.find(
            (cs) => cs.js.includes('content-youtube.js'));
        expect(entry.matches).toEqual(['*://*.youtube.com/*']);
    });

    test('the YouTube content-script entry declares no permissions of its own', () => {
        // Story 4.1's intent: registering content-youtube.js added NO permission.
        // The permission set is owned/asserted by tests/manifest-permissions.test.js
        // (Epic 6 Story 5.2 added the justified `clipboardWrite`). Here we only
        // assert the YT content-script registration itself is permission-free and
        // adds no host scope.
        const entry = manifest.content_scripts.find(
            (cs) => cs.js.includes('content-youtube.js'));
        expect(entry.permissions).toBeUndefined();
        expect(manifest.host_permissions).toEqual(['<all_urls>']);
        expect(manifest.permissions).toContain('storage');
    });
});

describe('Story 4.1 — applyCleanup with both toggles OFF', () => {
    test('leaves the page unmodified (nothing hidden)', () => {
        document.body.innerHTML =
            '<div id="comments"></div><div id="shorts"></div>';
        yt._setSettings({ hideShorts: false, hideComments: false });
        const hidden = yt.applyCleanup(document);
        expect(hidden).toBe(0);
        expect(document.querySelectorAll('.vsc-yt-hidden').length).toBe(0);
        expect(document.getElementById('comments').style.display).toBe('');
    });
});

describe('Story 4.1 — fail-safe selector handling (NFR-R2)', () => {
    test('a selector matching nothing no-ops and returns 0', () => {
        document.body.innerHTML = '<div class="real"></div>';
        expect(yt.hideBySelectors(['.does-not-exist'], document)).toBe(0);
    });

    test('an invalid selector is skipped without throwing', () => {
        document.body.innerHTML = '<div class="real"></div>';
        expect(() => yt.hideBySelectors(['::::bad', '.real'], document))
            .not.toThrow();
        // the valid selector after the bad one still applied
        expect(document.querySelector('.real').style.display).toBe('none');
    });

    test('hideBySelectors hides matching nodes with display:none !important', () => {
        document.body.innerHTML = '<div class="target"></div>';
        const n = yt.hideBySelectors(['.target'], document);
        expect(n).toBe(1);
        const el = document.querySelector('.target');
        expect(el.style.getPropertyValue('display')).toBe('none');
        expect(el.style.getPropertyPriority('display')).toBe('important');
        expect(el.classList.contains('vsc-yt-hidden')).toBe(true);
    });

    test('applyCleanup never throws even if a feature is enabled', () => {
        yt._setSettings({ hideShorts: true, hideComments: true });
        expect(() => yt.applyCleanup(document)).not.toThrow();
    });
});

// ---- Story 4.2: hide Shorts (FR-14) ----

describe('Story 4.2 — hide Shorts', () => {
    /** True when an element has been hidden by the module. */
    function isHidden(el) {
        return el.style.getPropertyValue('display') === 'none'
            && el.classList.contains('vsc-yt-hidden');
    }

    test('SHORTS_SELECTORS is populated', () => {
        expect(Array.isArray(yt.SHORTS_SELECTORS)).toBe(true);
        expect(yt.SHORTS_SELECTORS.length).toBeGreaterThan(0);
    });

    test('hideShorts ON hides the Shorts shelf and entry points', () => {
        document.body.innerHTML = `
            <ytd-reel-shelf-renderer id="shelf"></ytd-reel-shelf-renderer>
            <ytd-rich-shelf-renderer is-shorts id="rich"></ytd-rich-shelf-renderer>
            <ytd-mini-guide-entry-renderer aria-label="Shorts" id="mini"></ytd-mini-guide-entry-renderer>`;
        yt._setSettings({ hideShorts: true, hideComments: false });
        yt.applyCleanup(document);
        expect(isHidden(document.getElementById('shelf'))).toBe(true);
        expect(isHidden(document.getElementById('rich'))).toBe(true);
        expect(isHidden(document.getElementById('mini'))).toBe(true);
    });

    test('does NOT hide a normal (non-Shorts) rich shelf', () => {
        document.body.innerHTML =
            '<ytd-rich-shelf-renderer id="normal"></ytd-rich-shelf-renderer>';
        yt._setSettings({ hideShorts: true, hideComments: false });
        yt.applyCleanup(document);
        // No is-shorts attribute → must remain visible.
        expect(document.getElementById('normal').style.display).toBe('');
    });

    test('hideShorts OFF leaves Shorts visible', () => {
        document.body.innerHTML =
            '<ytd-reel-shelf-renderer id="shelf"></ytd-reel-shelf-renderer>';
        yt._setSettings({ hideShorts: false, hideComments: false });
        yt.applyCleanup(document);
        expect(document.getElementById('shelf').style.display).toBe('');
    });

    test('a Shorts node rendered after load (SPA) is hidden by a re-apply', () => {
        document.body.innerHTML = '';
        yt._setSettings({ hideShorts: true, hideComments: false });
        yt.applyCleanup(document); // initial pass — nothing yet
        // Simulate YouTube SPA rendering a Shorts shelf later, then the re-apply
        // the MutationObserver schedules. This covers the HIDE LOGIC on a
        // post-load node — NOT the observer→debounce→setTimeout timing chain
        // itself (jsdom does not drive the module's load-time observer instance;
        // the real <200ms timing is exercised in the headed extension). The
        // debounce-budget assertion below guards the timing CONSTANT.
        const late = document.createElement('ytd-reel-shelf-renderer');
        late.id = 'late';
        document.body.appendChild(late);
        yt.applyCleanup(document);
        expect(isHidden(document.getElementById('late'))).toBe(true);
    });

    test('cleanup debounce constant is under the NFR-P5 200ms budget', () => {
        // Guards the timing CONSTANT only (see note on the SPA test above for why
        // the end-to-end observer timing is not unit-covered).
        expect(yt.CLEANUP_DEBOUNCE_MS).toBeLessThan(200);
    });
});

// ---- Story 4.4: hide comments + live-chat (FR-15) ----

describe('Story 4.4 — hide comments and live chat', () => {
    function isHidden(el) {
        return el.style.getPropertyValue('display') === 'none'
            && el.classList.contains('vsc-yt-hidden');
    }

    test('COMMENTS_SELECTORS is populated', () => {
        expect(Array.isArray(yt.COMMENTS_SELECTORS)).toBe(true);
        expect(yt.COMMENTS_SELECTORS.length).toBeGreaterThan(0);
    });

    test('hideComments ON hides the static comments section on a watch page', () => {
        document.body.innerHTML =
            '<ytd-comments id="comments"></ytd-comments>';
        yt._setSettings({ hideShorts: false, hideComments: true });
        yt.applyCleanup(document);
        expect(isHidden(document.getElementById('comments'))).toBe(true);
    });

    test('hideComments ON hides the live/premiere live-chat panel', () => {
        // ytd-live-chat-frame is the panel that stays open on live + premiere
        // videos (the user-reported case).
        document.body.innerHTML = `
            <ytd-live-chat-frame id="chat"></ytd-live-chat-frame>
            <div id="chat-container"></div>
            <iframe id="chatframe"></iframe>`;
        yt._setSettings({ hideShorts: false, hideComments: true });
        yt.applyCleanup(document);
        expect(isHidden(document.querySelector('ytd-live-chat-frame'))).toBe(true);
        expect(isHidden(document.getElementById('chat-container'))).toBe(true);
        expect(isHidden(document.getElementById('chatframe'))).toBe(true);
    });

    test('live-chat panel uses display:none !important so it survives fullscreen re-show', () => {
        document.body.innerHTML =
            '<ytd-live-chat-frame id="chat"></ytd-live-chat-frame>';
        yt._setSettings({ hideShorts: false, hideComments: true });
        yt.applyCleanup(document);
        const panel = document.getElementById('chat');
        // !important inline declaration wins over YouTube's stylesheet rules that
        // re-show the chat in fullscreen — assert the priority is actually set.
        expect(panel.style.getPropertyValue('display')).toBe('none');
        expect(panel.style.getPropertyPriority('display')).toBe('important');
        // If YouTube mutates the inline style directly to re-show it, the
        // MutationObserver re-fires applyCleanup and we re-hide it.
        panel.style.display = 'block';
        yt.applyCleanup(document);
        expect(panel.style.getPropertyValue('display')).toBe('none');
        expect(panel.style.getPropertyPriority('display')).toBe('important');
    });

    test('hideComments OFF leaves comments and chat visible (no artifacts)', () => {
        document.body.innerHTML = `
            <ytd-comments id="comments"></ytd-comments>
            <ytd-live-chat-frame id="chat"></ytd-live-chat-frame>`;
        yt._setSettings({ hideShorts: false, hideComments: false });
        yt.applyCleanup(document);
        expect(document.getElementById('comments').style.display).toBe('');
        expect(document.getElementById('chat').style.display).toBe('');
        expect(document.querySelectorAll('.vsc-yt-hidden').length).toBe(0);
    });

    test('ON then OFF restores hidden nodes (symmetric toggle, E5-1/E5-2)', () => {
        // The transition test that the steady-state OFF test masked: a node hidden
        // while ON must be restored when the feature flips OFF — not stranded
        // until reload.
        document.body.innerHTML =
            '<ytd-comments id="comments"></ytd-comments>';
        yt._setSettings({ hideShorts: false, hideComments: true });
        yt.applyCleanup(document);
        const node = document.getElementById('comments');
        expect(isHidden(node)).toBe(true);
        // User flips the toggle OFF on the live page — the onChanged path runs
        // unhideAll() then applyCleanup(). Simulate it directly.
        yt._setSettings({ hideShorts: false, hideComments: false });
        yt.unhideAll(document);
        yt.applyCleanup(document);
        expect(node.style.getPropertyValue('display')).toBe('');
        expect(node.classList.contains('vsc-yt-hidden')).toBe(false);
    });

    test('unhideAll restores every tagged node and returns the count', () => {
        document.body.innerHTML = `
            <ytd-comments id="comments"></ytd-comments>
            <ytd-live-chat-frame id="chat"></ytd-live-chat-frame>`;
        yt._setSettings({ hideShorts: false, hideComments: true });
        yt.applyCleanup(document);
        const restored = yt.unhideAll(document);
        expect(restored).toBe(2);
        expect(document.querySelectorAll('.vsc-yt-hidden').length).toBe(0);
        expect(document.getElementById('comments').style.display).toBe('');
        expect(document.getElementById('chat').style.display).toBe('');
    });

    test('flipping OFF one of two features re-hides the other (symmetric)', () => {
        document.body.innerHTML = `
            <ytd-reel-shelf-renderer id="shelf"></ytd-reel-shelf-renderer>
            <ytd-comments id="comments"></ytd-comments>`;
        yt._setSettings({ hideShorts: true, hideComments: true });
        yt.applyCleanup(document);
        expect(isHidden(document.getElementById('shelf'))).toBe(true);
        expect(isHidden(document.getElementById('comments'))).toBe(true);
        // Turn comments OFF, keep Shorts ON — the onChanged unhideAll+reapply path.
        yt._setSettings({ hideShorts: true, hideComments: false });
        yt.unhideAll(document);
        yt.applyCleanup(document);
        expect(isHidden(document.getElementById('shelf'))).toBe(true);   // still hidden
        expect(document.getElementById('comments').style.display).toBe(''); // restored
    });

    test('comments stay hidden across a simulated SPA watch-page navigation', () => {
        yt._setSettings({ hideShorts: false, hideComments: true });
        // First watch page.
        document.body.innerHTML = '<ytd-comments id="comments"></ytd-comments>';
        yt.applyCleanup(document);
        const first = document.getElementById('comments');
        expect(isHidden(first)).toBe(true);
        // SPA navigates to another watch page — YouTube re-renders the comments
        // section under the SAME stable id ("comments"). Assert the FRESH node
        // (different element instance) is hidden by the re-apply.
        document.body.innerHTML = '<ytd-comments id="comments"></ytd-comments>';
        const second = document.getElementById('comments');
        expect(second).not.toBe(first);
        yt.applyCleanup(document);
        expect(isHidden(second)).toBe(true);
    });
});

// ---- FR-17: suppress live/premiere chat in FULLSCREEN (Integration #5) ----

describe('FR-17 — hide chat in fullscreen (CSS-scoped, self-reverting)', () => {
    /** The injected <style> element, or null when not present. */
    function styleEl() {
        return document.getElementById(yt.FS_CHAT_STYLE_ID);
    }

    test('FS_CHAT_CSS hides the PANELS COLUMN (not just the chat) only in fullscreen', () => {
        expect(yt.FS_CHAT_CSS).toContain('ytd-watch-flexy[fullscreen]');
        // GOTCHA 1: must target the whole panels column so the player reflows to
        // full width — hiding only ytd-live-chat-frame leaves a black 402px gap.
        expect(yt.FS_CHAT_CSS).toContain('#panels-full-bleed-container');
        // Scoped to when the column actually holds chat (leaves a fullscreen
        // transcript panel alone).
        expect(yt.FS_CHAT_CSS).toContain(':has(ytd-live-chat-frame)');
        expect(yt.FS_CHAT_CSS).toMatch(/display:\s*none\s*!important/);
        // Must NOT hide the panel column unconditionally (windowed/other panels).
        expect(yt.FS_CHAT_CSS).not.toMatch(/^\s*#panels-full-bleed-container\s*\{/m);
    });

    test('enabled → injects the style into <head> with the fullscreen-scoped rule', () => {
        yt.applyFullscreenChatStyle(true);
        const el = styleEl();
        expect(el).not.toBeNull();
        expect(el.tagName.toLowerCase()).toBe('style');
        expect(el.parentElement).toBe(document.head);
        expect(el.textContent).toBe(yt.FS_CHAT_CSS);
    });

    test('disabled → removes a previously injected style (symmetric toggle)', () => {
        yt.applyFullscreenChatStyle(true);
        expect(styleEl()).not.toBeNull();
        yt.applyFullscreenChatStyle(false);
        expect(styleEl()).toBeNull();
    });

    test('enabling twice is idempotent (single style element, no duplicates)', () => {
        yt.applyFullscreenChatStyle(true);
        yt.applyFullscreenChatStyle(true);
        expect(document.querySelectorAll('#' + yt.FS_CHAT_STYLE_ID).length).toBe(1);
    });

    test('disabling when nothing was injected is a harmless no-op', () => {
        expect(() => yt.applyFullscreenChatStyle(false)).not.toThrow();
        expect(styleEl()).toBeNull();
    });

    test('the panels-column target matches only inside a fullscreen watch-flexy', () => {
        // Prove the ancestor/id scoping with Element.matches. (The `:has()` clause
        // is asserted textually above — jsdom's selector engine does not implement
        // :has, so we keep it out of matches() here.)
        document.body.innerHTML = `
            <ytd-watch-flexy fullscreen>
              <div id="full-bleed-container">
                <div id="player-full-bleed-container"></div>
                <div id="panels-full-bleed-container">
                  <ytd-live-chat-frame id="chat"></ytd-live-chat-frame>
                </div>
              </div>
            </ytd-watch-flexy>`;
        const panels = document.getElementById('panels-full-bleed-container');
        expect(panels.matches('ytd-watch-flexy[fullscreen] #panels-full-bleed-container')).toBe(true);
        // Windowed (no fullscreen attr) → must NOT match.
        document.querySelector('ytd-watch-flexy').removeAttribute('fullscreen');
        expect(panels.matches('ytd-watch-flexy[fullscreen] #panels-full-bleed-container')).toBe(false);
    });

    test('never throws on a document with no <head> (NFR-R2)', () => {
        const headless = { head: null };
        expect(() => yt.applyFullscreenChatStyle(true, headless)).not.toThrow();
    });
});

describe('FR-17 — nudgePlayerResize (force YouTube to re-size <video>)', () => {
    /** A fake window that records dispatched event types. */
    function fakeWindow() {
        const events = [];
        return { events, dispatchEvent: (e) => { events.push(e.type); return true; } };
    }

    test('fires a window resize immediately and again at each delay', () => {
        const win = fakeWindow();
        const scheduled = [];
        const setTimeoutFn = (fn, ms) => { scheduled.push([fn, ms]); return 0; };
        yt.nudgePlayerResize({ window: win, setTimeoutFn });
        // Immediate fire (delay 0) happened synchronously.
        expect(win.events).toEqual(['resize']);
        // The remaining delays were scheduled (not 0).
        expect(scheduled.map((s) => s[1])).toEqual(
            yt.FS_RESIZE_NUDGE_DELAYS_MS.filter((d) => d !== 0));
        // Running the scheduled callbacks fires the rest.
        scheduled.forEach(([fn]) => fn());
        expect(win.events.length).toBe(yt.FS_RESIZE_NUDGE_DELAYS_MS.length);
        expect(win.events.every((t) => t === 'resize')).toBe(true);
    });

    test('the nudge schedule includes a late fire to outlast YouTube settling', () => {
        // GOTCHA 2: an immediate-only resize loses to YouTube's own fullscreen
        // layout pass — there must be at least one fire well after t=0.
        expect(yt.FS_RESIZE_NUDGE_DELAYS_MS).toContain(0);
        expect(Math.max(...yt.FS_RESIZE_NUDGE_DELAYS_MS)).toBeGreaterThanOrEqual(500);
    });

    test('no window available → no throw (NFR-R2)', () => {
        expect(() => yt.nudgePlayerResize({ window: null })).not.toThrow();
    });
});

describe('FR-17 — handleFullscreenChange (nudge gated by the toggle)', () => {
    let dispatchSpy;
    /** resize-type events seen by the spy. */
    const resizeCount = () => dispatchSpy.mock.calls
        .filter(([e]) => e && e.type === 'resize').length;

    beforeEach(() => {
        jest.useFakeTimers();
        // The handler resolves the real jsdom window; spy on its dispatchEvent.
        dispatchSpy = jest.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
    });
    afterEach(() => {
        dispatchSpy.mockRestore();
        jest.useRealTimers();
    });

    test('enabled → nudges the player on a fullscreen transition', () => {
        yt._setSettings({ hideChatFullscreen: true });
        yt.handleFullscreenChange();
        jest.runOnlyPendingTimers(); // flush the delayed nudges
        // Immediate + each delayed fire.
        expect(resizeCount()).toBe(yt.FS_RESIZE_NUDGE_DELAYS_MS.length);
    });

    test('disabled → does NOT touch the player (inert when off)', () => {
        yt._setSettings({ hideChatFullscreen: false });
        yt.handleFullscreenChange();
        jest.runOnlyPendingTimers();
        expect(resizeCount()).toBe(0);
    });
});

// ---- Integration #4: skip YouTube ads (seek-to-end) ----
//
// Mechanism confirmed by the 2026-06-06 feasibility spike: maxing playbackRate is
// reset by YouTube and the skip button rejects synthetic clicks (needs isTrusted),
// but seeking the ad <video> to its end IS honored and walks through ad pods.
//
// seekAdToEnd is tested with DUCK-TYPED fake roots: jsdom's <video>.duration is
// read-only/NaN, so a real element can't exercise the duration/currentTime
// branches. The fake root returns a fake ad-player element for the ad selector
// (null when no ad) and a fake {duration, currentTime} video for 'video'.
describe('Integration #4 — seekAdToEnd (skip ads by seeking to end)', () => {
    /** Build a fake document root the way seekAdToEnd queries it. The ad <video>
     * is reached via the matched player's OWN querySelector (sweep M1 fix), so the
     * fake player carries it; the root's `video` getter mirrors it for assertions. */
    function adRoot({ duration = 30, currentTime = 5, hasAd = true, hasVideo = true } = {}) {
        const video = hasVideo ? { duration, currentTime } : null;
        const player = { querySelector: (sel) => (sel === 'video' ? video : null) };
        return {
            video,
            querySelector(sel) {
                if (sel.indexOf('ad-showing') !== -1) return hasAd ? player : null;
                if (sel === 'video') return video;
                return null;
            },
        };
    }

    test('in an ad with a loaded video far from the end → seeks to duration-0.1, returns true', () => {
        const r = adRoot({ duration: 30, currentTime: 5 });
        expect(yt.seekAdToEnd(r)).toBe(true);
        expect(r.video.currentTime).toBeCloseTo(30 - 0.1, 5);
    });

    test('no ad showing → no-op, returns false', () => {
        const r = adRoot({ hasAd: false, duration: 30, currentTime: 5 });
        expect(yt.seekAdToEnd(r)).toBe(false);
        expect(r.video.currentTime).toBe(5); // untouched
    });

    test('ad video not yet loaded (duration 0, the buffering 0/0 frame) → no-op', () => {
        const r = adRoot({ duration: 0, currentTime: 0 });
        expect(yt.seekAdToEnd(r)).toBe(false);
        expect(r.video.currentTime).toBe(0);
    });

    test('NaN duration → no-op (NFR-R2), returns false', () => {
        const r = adRoot({ duration: NaN, currentTime: 0 });
        expect(yt.seekAdToEnd(r)).toBe(false);
    });

    test('Infinity duration (live-stream ad) → no-op (Number.isFinite guard, sweep m1)', () => {
        const r = adRoot({ duration: Infinity, currentTime: 5 });
        expect(yt.seekAdToEnd(r)).toBe(false);
    });

    test('M1: seeks the ad player\'s OWN <video>, not the first <video> in the document', () => {
        // The page also holds a content/hover-preview <video> earlier in DOM order.
        // seekAdToEnd must seek the ad player's video (via player.querySelector),
        // never document.querySelector('video') — else it fast-forwards the wrong one.
        const adVideo = { duration: 30, currentTime: 5 };
        const contentVideo = { duration: 600, currentTime: 120 };
        const player = { querySelector: (sel) => (sel === 'video' ? adVideo : null) };
        const root = {
            querySelector(sel) {
                if (sel.indexOf('ad-showing') !== -1) return player;
                if (sel === 'video') return contentVideo; // first in DOM order — NOT the ad
                return null;
            },
        };
        expect(yt.seekAdToEnd(root)).toBe(true);
        expect(adVideo.currentTime).toBeCloseTo(30 - 0.1, 5); // ad video seeked
        expect(contentVideo.currentTime).toBe(120);           // content video untouched
    });

    test('already near the end (debounce — would re-seek the same creative) → no-op', () => {
        // currentTime 29 with duration 30 is within the 1.5s near-end window.
        const r = adRoot({ duration: 30, currentTime: 29 });
        expect(yt.seekAdToEnd(r)).toBe(false);
        expect(r.video.currentTime).toBe(29);
    });

    test('ad present but no <video> element → no-op, returns false', () => {
        const r = adRoot({ hasVideo: false });
        expect(yt.seekAdToEnd(r)).toBe(false);
    });

    test('null / non-DOM root → never throws (NFR-R2)', () => {
        expect(() => yt.seekAdToEnd(null)).not.toThrow();
        expect(yt.seekAdToEnd({})).toBe(false); // no querySelector
    });
});

describe('Integration #4 — start/stop ad-skip polling (symmetric live handler)', () => {
    afterEach(() => yt.stopAdSkip());

    test('startAdSkip schedules a single interval at AD_SKIP_POLL_MS', () => {
        const setIntervalFn = jest.fn(() => 123);
        yt.startAdSkip({ setIntervalFn });
        expect(setIntervalFn).toHaveBeenCalledTimes(1);
        expect(setIntervalFn.mock.calls[0][1]).toBe(yt.AD_SKIP_POLL_MS);
        expect(yt._isAdSkipRunning()).toBe(true);
    });

    test('startAdSkip is idempotent — calling twice does not double-schedule', () => {
        const setIntervalFn = jest.fn(() => 123);
        yt.startAdSkip({ setIntervalFn });
        yt.startAdSkip({ setIntervalFn });
        expect(setIntervalFn).toHaveBeenCalledTimes(1);
    });

    test('stopAdSkip clears the interval (symmetric with start)', () => {
        const setIntervalFn = jest.fn(() => 123);
        const clearIntervalFn = jest.fn();
        yt.startAdSkip({ setIntervalFn });
        yt.stopAdSkip({ clearIntervalFn });
        expect(clearIntervalFn).toHaveBeenCalledWith(123);
        expect(yt._isAdSkipRunning()).toBe(false);
    });

    test('stopAdSkip when not running → no-op, never throws', () => {
        const clearIntervalFn = jest.fn();
        expect(() => yt.stopAdSkip({ clearIntervalFn })).not.toThrow();
        expect(clearIntervalFn).not.toHaveBeenCalled();
    });
});

// ---- Story 5.1: transcript extraction (FR-16) ----

describe('Story 5.1 — extractTranscript (YouTube DOM → plain text)', () => {
    /** Build a transcript panel of N segments from [timestamp, text] pairs. */
    function buildTranscript(pairs) {
        const segs = pairs.map(([ts, text]) => `
            <ytd-transcript-segment-renderer>
              <div class="segment">
                <div class="segment-timestamp">${ts}</div>
                <yt-formatted-string class="segment-text">${text}</yt-formatted-string>
              </div>
            </ytd-transcript-segment-renderer>`).join('');
        return `<ytd-transcript-renderer>${segs}</ytd-transcript-renderer>`;
    }

    test('TRANSCRIPT_SEGMENT_SELECTOR targets the transcript segment row', () => {
        expect(typeof yt.TRANSCRIPT_SEGMENT_SELECTOR).toBe('string');
        expect(yt.TRANSCRIPT_SEGMENT_SELECTOR).toContain('transcript-segment');
    });

    test('AC1: available transcript → returns plain text, timestamps stripped', () => {
        document.body.innerHTML = buildTranscript([
            ['0:00', 'Hello and welcome'],
            ['0:04', 'to the channel'],
            ['1:12', 'today we build a thing'],
        ]);
        const result = yt.extractTranscript(document);
        expect(result.available).toBe(true);
        // The three segment texts, joined, in order.
        expect(result.text).toBe(
            'Hello and welcome\nto the channel\ntoday we build a thing');
        // No timestamp tokens leaked through.
        expect(result.text).not.toMatch(/\d+:\d{2}/);
    });

    test('AC1: collapses internal whitespace/newlines within a segment', () => {
        document.body.innerHTML = buildTranscript([
            ['0:00', '  ragged   spacing\n   here  '],
        ]);
        const result = yt.extractTranscript(document);
        expect(result.available).toBe(true);
        expect(result.text).toBe('ragged spacing here');
    });

    test('AC2: no transcript panel → available:false and empty text', () => {
        document.body.innerHTML = '<div id="not-a-transcript"></div>';
        const result = yt.extractTranscript(document);
        expect(result.available).toBe(false);
        expect(result.text).toBe('');
    });

    test('AC2: transcript panel present but zero segments → available:false', () => {
        document.body.innerHTML = '<ytd-transcript-renderer></ytd-transcript-renderer>';
        const result = yt.extractTranscript(document);
        expect(result.available).toBe(false);
        expect(result.text).toBe('');
    });

    test('AC3: fail-safe — a root whose querySelectorAll throws never throws', () => {
        const hostileRoot = {
            querySelectorAll() { throw new Error('boom'); },
        };
        let result;
        expect(() => { result = yt.extractTranscript(hostileRoot); }).not.toThrow();
        expect(result.available).toBe(false);
        expect(result.text).toBe('');
    });

    test('AC3: fail-safe — a segment that throws on read is skipped, rest survive', () => {
        document.body.innerHTML = buildTranscript([
            ['0:00', 'good line one'],
            ['0:05', 'good line two'],
        ]);
        const segs = document.querySelectorAll('ytd-transcript-segment-renderer');
        // Make the first segment hostile: reading its text node throws. (Text is
        // read via querySelectorAll; the timestamp path uses querySelector, so
        // override both to be safe against a single segment blowing up.)
        const boom = () => { throw new Error('boom'); };
        Object.defineProperty(segs[0], 'querySelectorAll', { value: boom });
        Object.defineProperty(segs[0], 'querySelector', { value: boom });
        let result;
        expect(() => { result = yt.extractTranscript(document); }).not.toThrow();
        expect(result.available).toBe(true);
        expect(result.text).toBe('good line two');
    });

    test('null/undefined root falls back to document (no throw)', () => {
        document.body.innerHTML = '<div></div>';
        expect(() => yt.extractTranscript()).not.toThrow();
        expect(yt.extractTranscript().available).toBe(false);
    });
});

// ---- Bugfix 2026-06-06: new transcript UI variant + timestamps option ----

describe('extractTranscript — new view-model UI + includeTimestamps', () => {
    /** Build the NEW (view-model) transcript UI confirmed live on YouTube. */
    function buildNewUiTranscript(pairs) {
        const segs = pairs.map(([ts, text]) => `
            <transcript-segment-view-model class="ytwTranscriptSegmentViewModelHost">
              <div class="ytwTranscriptSegmentViewModelTimestamp">${ts}</div>
              <div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">${ts} a11y label</div>
              <span class="ytAttributedStringHost">${text}</span>
            </transcript-segment-view-model>`).join('');
        return `<div>${segs}</div>`;
    }
    /** Build the OLD (Polymer) transcript UI. */
    function buildOldUiTranscript(pairs) {
        const segs = pairs.map(([ts, text]) => `
            <ytd-transcript-segment-renderer>
              <div class="segment-timestamp">${ts}</div>
              <yt-formatted-string class="segment-text">${text}</yt-formatted-string>
            </ytd-transcript-segment-renderer>`).join('');
        return segs;
    }

    test('reads the new transcript-segment-view-model structure', () => {
        document.body.innerHTML = buildNewUiTranscript([
            ['0:05', 'The number seven battle of the week.'],
            ['0:09', 'Welcome everyone.'],
        ]);
        const result = yt.extractTranscript(document);
        expect(result.available).toBe(true);
        expect(result.text).toBe('The number seven battle of the week.\nWelcome everyone.');
    });

    test('new UI: the timestamp + a11y label never leak into the text', () => {
        document.body.innerHTML = buildNewUiTranscript([['0:05', 'just the words']]);
        const result = yt.extractTranscript(document);
        expect(result.text).toBe('just the words');
        expect(result.text).not.toMatch(/\d+:\d{2}/);
        expect(result.text).not.toMatch(/a11y/);
    });

    test('includeTimestamps prefixes each line (old UI)', () => {
        document.body.innerHTML = buildOldUiTranscript([
            ['0:00', 'first line'],
            ['0:04', 'second line'],
        ]);
        const result = yt.extractTranscript(document, { includeTimestamps: true });
        expect(result.text).toBe('0:00\tfirst line\n0:04\tsecond line');
    });

    test('includeTimestamps prefixes each line (new UI)', () => {
        document.body.innerHTML = buildNewUiTranscript([['0:05', 'hello there']]);
        const result = yt.extractTranscript(document, { includeTimestamps: true });
        expect(result.text).toBe('0:05\thello there');
    });

    test('old UI takes precedence when both structures somehow coexist', () => {
        document.body.innerHTML =
            buildOldUiTranscript([['0:00', 'old line']]) +
            buildNewUiTranscript([['0:05', 'new line']]);
        const result = yt.extractTranscript(document);
        expect(result.text).toBe('old line');
    });
});

describe('openTranscriptPanel — clicks the VISIBLE Show-transcript button', () => {
    test('skips a hidden duplicate and clicks the visible button', () => {
        document.body.innerHTML = `
            <button id="hidden-dup" aria-label="Show transcript"></button>
            <button id="visible-btn" aria-label="Show transcript"></button>`;
        const hidden = document.getElementById('hidden-dup');
        const visible = document.getElementById('visible-btn');
        // jsdom has no layout, so force the visibility signals the real DOM gives.
        Object.defineProperty(hidden, 'offsetParent', { get: () => null });
        Object.defineProperty(visible, 'offsetParent', { get: () => document.body });
        visible.getBoundingClientRect = () => ({ width: 130, height: 36, x: 0, y: 0 });
        const hiddenSpy = jest.fn(); hidden.addEventListener('click', hiddenSpy);
        const visibleSpy = jest.fn(); visible.addEventListener('click', visibleSpy);

        const clicked = yt.openTranscriptPanel(document);
        expect(clicked).toBe(true);
        expect(visibleSpy).toHaveBeenCalledTimes(1);
        expect(hiddenSpy).not.toHaveBeenCalled();
    });

    test('falls back to the first match when layout metrics are unavailable (jsdom)', () => {
        document.body.innerHTML = '<button aria-label="Show transcript"></button>';
        const btn = document.querySelector('button[aria-label="Show transcript"]');
        const spy = jest.fn(); btn.addEventListener('click', spy);
        expect(yt.openTranscriptPanel(document)).toBe(true);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    test('never matches a "Close transcript" button', () => {
        document.body.innerHTML = '<button aria-label="Close transcript"></button>';
        const closeSpy = jest.fn();
        document.querySelector('button').addEventListener('click', closeSpy);
        yt.openTranscriptPanel(document);
        expect(closeSpy).not.toHaveBeenCalled();
    });
});

describe('Story 5.1 — handleMessage (getTranscript contract)', () => {
    test('getTranscript responds with the extraction result', () => {
        document.body.innerHTML = `
            <ytd-transcript-segment-renderer>
              <yt-formatted-string class="segment-text">one line</yt-formatted-string>
            </ytd-transcript-segment-renderer>`;
        const sendResponse = jest.fn();
        yt.handleMessage({ action: 'getTranscript' }, { id: 'tach-test-ext', tab: { id: 1 } }, sendResponse);
        expect(sendResponse).toHaveBeenCalledTimes(1);
        const resp = sendResponse.mock.calls[0][0];
        expect(resp).toEqual({ available: true, text: 'one line' });
    });

    test('getTranscript with no transcript (and nothing to open) polls then responds available:false', () => {
        // No segments and no Show-transcript button → the poll budget elapses and
        // the handler resolves available:false. (Async now: it opens + polls.)
        jest.useFakeTimers();
        document.body.innerHTML = '<div></div>';
        const sendResponse = jest.fn();
        yt.handleMessage({ action: 'getTranscript' }, { id: 'tach-test-ext', tab: { id: 1 } }, sendResponse);
        // Advance well past the default poll budget (20 × 250ms).
        jest.advanceTimersByTime(20 * 250 + 100);
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({ available: false, text: '' });
        jest.useRealTimers();
    });

    test('forwards includeTimestamps so the response carries timestamps', () => {
        document.body.innerHTML = `
            <ytd-transcript-segment-renderer>
              <div class="segment-timestamp">0:07</div>
              <yt-formatted-string class="segment-text">timed line</yt-formatted-string>
            </ytd-transcript-segment-renderer>`;
        const sendResponse = jest.fn();
        yt.handleMessage({ action: 'getTranscript', includeTimestamps: true }, { id: 'tach-test-ext', tab: { id: 1 } }, sendResponse);
        expect(sendResponse).toHaveBeenCalledWith({ available: true, text: '0:07\ttimed line' });
    });

    test('an unrelated action is ignored (sendResponse not called)', () => {
        const sendResponse = jest.fn();
        yt.handleMessage({ action: 'somethingElse' }, { id: 'tach-test-ext', tab: { id: 1 } }, sendResponse);
        expect(sendResponse).not.toHaveBeenCalled();
    });

    test('a null/garbage message never throws', () => {
        const sendResponse = jest.fn();
        expect(() => yt.handleMessage(null, { id: 'tach-test-ext', tab: { id: 1 } }, sendResponse)).not.toThrow();
        expect(() => yt.handleMessage(undefined, { id: 'tach-test-ext', tab: { id: 1 } }, sendResponse)).not.toThrow();
    });

    test('returns true (async response channel) and does not propagate a throwing sendResponse', () => {
        document.body.innerHTML = `
            <ytd-transcript-segment-renderer>
              <yt-formatted-string class="segment-text">x</yt-formatted-string>
            </ytd-transcript-segment-renderer>`;
        // getTranscript now opens the transcript panel + polls for the async
        // segment list, so the handler returns true to keep the message port
        // open for the late sendResponse (investigation 2026-06-06). NFR-R2 still
        // holds: a responder that throws must not propagate out of the handler.
        const throwingResponse = () => { throw new Error('sendResponse blew up'); };
        let ret;
        expect(() => { ret = yt.handleMessage({ action: 'getTranscript' }, { id: 'tach-test-ext', tab: { id: 1 } }, throwingResponse); })
            .not.toThrow();
        expect(ret).toBe(true);
    });

    test('sender-guard: rejects a foreign sender and does not call sendResponse', () => {
        // Fix 1 — sender.id !== chrome.runtime.id must reject non-extension senders.
        document.body.innerHTML = `
            <ytd-transcript-segment-renderer>
              <yt-formatted-string class="segment-text">x</yt-formatted-string>
            </ytd-transcript-segment-renderer>`;
        const sendResponse = jest.fn();
        const result = yt.handleMessage(
            { action: 'getTranscript' },
            { id: 'someone-else' },
            sendResponse
        );
        expect(sendResponse).not.toHaveBeenCalled();
        expect(result).toBeFalsy();
    });
});

// ---- Bugfix 2026-06-06: transcript segments load lazily (open panel + poll) ----

describe('getTranscriptText — open the transcript panel and poll for segments', () => {
    /** A runner that invokes scheduled callbacks synchronously, so a poll loop
     *  resolves within the test without real timers. */
    const syncSetTimeout = (fn) => { fn(); return 0; };

    /** One rendered transcript segment, ready for extractTranscript. */
    function segmentHtml(text) {
        return `<ytd-transcript-segment-renderer>
                  <yt-formatted-string class="segment-text">${text}</yt-formatted-string>
                </ytd-transcript-segment-renderer>`;
    }

    test('already-loaded transcript resolves synchronously (fast path, no panel click)', () => {
        document.body.innerHTML = segmentHtml('hello world');
        const cb = jest.fn();
        yt.getTranscriptText(cb, { setTimeoutFn: syncSetTimeout });
        expect(cb).toHaveBeenCalledWith({ available: true, text: 'hello world' });
    });

    test('absent segments → clicks "Show transcript", then resolves once they render', () => {
        // Button whose click injects the segment (mimics YouTube populating the
        // panel after it opens). Proves the bug fix: we open the panel, then the
        // next poll picks up the now-rendered segments.
        document.body.innerHTML = '<button aria-label="Show transcript"></button>';
        const btn = document.querySelector('button[aria-label="Show transcript"]');
        btn.addEventListener('click', () => {
            document.body.insertAdjacentHTML('beforeend', segmentHtml('lazy line'));
        });

        const cb = jest.fn();
        yt.getTranscriptText(cb, { maxTries: 5, setTimeoutFn: syncSetTimeout });
        expect(cb).toHaveBeenCalledWith({ available: true, text: 'lazy line' });
    });

    test('does NOT re-click when the panel is already expanded (avoids toggling it shut)', () => {
        // Panel present + expanded but segments not yet rendered. We must poll,
        // not click the button again (a second click would close it).
        document.body.innerHTML = `
            <div target-id="engagement-panel-searchable-transcript"
                 visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"></div>
            <button aria-label="Show transcript"></button>`;
        const clickSpy = jest.fn();
        document.querySelector('button[aria-label="Show transcript"]')
            .addEventListener('click', clickSpy);

        const cb = jest.fn();
        yt.getTranscriptText(cb, { maxTries: 3, setTimeoutFn: syncSetTimeout });
        expect(clickSpy).not.toHaveBeenCalled();
        expect(cb).toHaveBeenCalledWith({ available: false, text: '' });
    });

    test('gives up with available:false after maxTries when segments never load', () => {
        document.body.innerHTML = '<div></div>';
        const cb = jest.fn();
        yt.getTranscriptText(cb, { maxTries: 4, setTimeoutFn: syncSetTimeout });
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({ available: false, text: '' });
    });

    test('isTranscriptPanelOpen reflects the panel visibility attribute', () => {
        document.body.innerHTML =
            '<div target-id="engagement-panel-searchable-transcript" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"></div>';
        expect(yt.isTranscriptPanelOpen(document)).toBe(true);
        document.body.innerHTML =
            '<div target-id="engagement-panel-searchable-transcript" visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"></div>';
        expect(yt.isTranscriptPanelOpen(document)).toBe(false);
        document.body.innerHTML = '<div></div>';
        expect(yt.isTranscriptPanelOpen(document)).toBe(false);
    });

    test('never throws on a hostile document (NFR-R2)', () => {
        document.body.innerHTML = '<div></div>';
        const cb = jest.fn();
        expect(() => yt.getTranscriptText(cb, { maxTries: 1, setTimeoutFn: syncSetTimeout }))
            .not.toThrow();
    });
});

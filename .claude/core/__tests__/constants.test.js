// AC→source: MEMORY_DECAY.RATES (nested), MEMORY_CATEGORIES is an object — see TDD-2.1

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const constants = require('../constants');

describe('constants', () => {
  it('memoryDecay_rates_containsExpectedCategories', () => {
    // Arrange
    const rates = constants.MEMORY_DECAY.RATES;

    // Act / Assert
    for (const key of ['decisions', 'constraints', 'patterns', 'workflows']) {
      expect(typeof rates[key]).toBe('number');
      expect(rates[key]).toBeGreaterThanOrEqual(0.9);
      expect(rates[key]).toBeLessThanOrEqual(0.99);
    }
  });

  it('memoryFilters_maxPerCategory_is50', () => {
    // Arrange / Act / Assert — the single source of truth for the per-category
    // cap (env-overridden at call sites). Static 50 keeps require() deterministic.
    expect(constants.MEMORY_FILTERS.MEMORY_MAX_PER_CATEGORY).toBe(50);
  });

  it('memoryCategories_values_matchExpectedStrings', () => {
    // Arrange
    const expected = ['patterns', 'workflows', 'constraints', 'decisions', 'rejected-approaches'];

    // Act
    const values = Object.values(constants.MEMORY_CATEGORIES);

    // Assert
    for (const cat of expected) {
      expect(values).toContain(cat);
    }
  });

  it('phaseArtifacts_existsAndNonEmpty', () => {
    // Arrange
    const pa = constants.PHASE_ARTIFACTS;

    // Act / Assert
    expect(pa).toBeDefined();
    expect(typeof pa).toBe('object');
    for (const key of [1, 2, 3, 4]) {
      expect(Array.isArray(pa[key])).toBe(true);
      expect(pa[key].length).toBeGreaterThan(0);
    }
  });

  it('docChain_existsAndHasFeeds', () => {
    // Arrange
    const dc = constants.DOC_CHAIN;

    // Act
    const entriesWithFeeds = Object.values(dc).filter(
      (entry) => Array.isArray(entry.feeds) && entry.feeds.length > 0
    );

    // Assert
    expect(dc).toBeDefined();
    expect(typeof dc).toBe('object');
    expect(entriesWithFeeds.length).toBeGreaterThan(0);
  });
});

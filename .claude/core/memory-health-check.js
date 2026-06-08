#!/usr/bin/env node

/**
 * Memory System Health Check
 * Validates memory system configuration and performance using constants
 */

const fs = require('fs').promises;
const path = require('path');
const CONSTANTS = require('./constants');
const MemoryManager = require('./memory-manager');

class MemoryHealthChecker {
    constructor() {
        this.manager = new MemoryManager();
        this.results = {
            passed: [],
            warnings: [],
            errors: []
        };
    }

    async checkMemoryDirectories() {
        console.log('📁 Checking memory directories...');
        const projectRoot = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
        const memoriesDir = path.join(projectRoot, 'docs', '.output', 'memories');

        for (const category of Object.values(CONSTANTS.MEMORY_CATEGORIES)) {
            const categoryPath = path.join(memoriesDir, category);
            try {
                await fs.access(categoryPath);
                this.results.passed.push(`✅ Category '${category}' directory exists`);
            } catch {
                this.results.errors.push(`❌ Category '${category}' directory missing`);
            }
        }
    }

    async checkBackend() {
        console.log('🔎 Checking memory search backend...');
        const report = await this.manager.generateReport();
        const storage = report.storage || {};
        const { sqliteBackend, sqliteSupportsFts5 } = storage;

        if (sqliteSupportsFts5) {
            this.results.passed.push(
                `✅ FTS5 search active (backend: ${sqliteBackend})`
            );
        } else {
            // Genuine degradation only — on Node 24+ the built-in node:sqlite
            // ships FTS5 and this branch never fires. Warn, don't fail.
            this.results.warnings.push(
                `⚠️  FTS5 search unavailable (backend: ${sqliteBackend || 'json-only'}) — ` +
                `memory search is falling back to a slower JSON linear scan. ` +
                `To enable FTS5: run on Node 24+ (built-in node:sqlite ships FTS5, ` +
                `zero deps) or 'npm install' for the optional better-sqlite3 fallback.`
            );
        }
    }

    async checkMemoryPerformance() {
        console.log('⚡ Checking memory performance...');

        // Test memory creation speed.
        // Fixed key (not a timestamped id) + delete-after so the diagnostic never
        // pollutes the curated store. The old `health_check_${Date.now()}` left a
        // new junk memory on EVERY run, inflating the store unboundedly.
        const startCreate = Date.now();
        const testId = '_health_check_probe';
        await this.manager.createMemory(CONSTANTS.MEMORY_CATEGORIES.PATTERNS, testId, {
            test: true,
            timestamp: new Date().toISOString()
        });
        const createTime = Date.now() - startCreate;

        if (createTime < CONSTANTS.PERFORMANCE.CACHE_HIT_MS * 10) { // Should be very fast
            this.results.passed.push(`✅ Memory creation: ${createTime}ms (excellent)`);
        } else if (createTime < CONSTANTS.PERFORMANCE.CACHE_HIT_MS * 100) {
            this.results.warnings.push(`⚠️  Memory creation: ${createTime}ms (acceptable)`);
        } else {
            this.results.errors.push(`❌ Memory creation: ${createTime}ms (too slow)`);
        }

        // Test memory search speed
        const startSearch = Date.now();
        await this.manager.searchMemories('test');
        const searchTime = Date.now() - startSearch;

        if (searchTime < CONSTANTS.PERFORMANCE.SIMPLE_QUERY_MS) {
            this.results.passed.push(`✅ Memory search: ${searchTime}ms (within target)`);
        } else {
            this.results.warnings.push(`⚠️  Memory search: ${searchTime}ms (exceeds ${CONSTANTS.PERFORMANCE.SIMPLE_QUERY_MS}ms target)`);
        }

        // Clean up the probe — diagnostics must not accumulate in the curated store.
        try {
            await this.manager.deleteMemory(CONSTANTS.MEMORY_CATEGORIES.PATTERNS, testId);
        } catch { /* non-fatal — fixed key means next run overwrites anyway */ }
    }

    async checkMemoryQuality() {
        console.log('📊 Checking memory quality metrics...');

        const report = await this.manager.generateReport();

        for (const [category, data] of Object.entries(report.categories)) {
            if (data.count === 0) {
                this.results.warnings.push(`⚠️  Category '${category}' is empty`);
                continue;
            }

            // Check average confidence
            if (data.avg_confidence >= CONSTANTS.MEMORY_FILTERS.HIGH_CONFIDENCE_THRESHOLD) {
                this.results.passed.push(
                    `✅ ${category}: High confidence (${data.avg_confidence.toFixed(2)})`
                );
            } else if (data.avg_confidence > 0.5) {
                this.results.warnings.push(
                    `⚠️  ${category}: Medium confidence (${data.avg_confidence.toFixed(2)})`
                );
            } else {
                this.results.errors.push(
                    `❌ ${category}: Low confidence (${data.avg_confidence.toFixed(2)})`
                );
            }

            // Check usage patterns
            if (data.total_usage >= CONSTANTS.MEMORY_FILTERS.HIGH_USAGE_THRESHOLD) {
                this.results.passed.push(
                    `✅ ${category}: Well-used (${data.total_usage} total uses)`
                );
            }
        }
    }

    async checkRecentMemories() {
        console.log('📅 Checking recent memory updates...');

        let recentCount = 0;
        let oldCount = 0;

        for (const category of Object.values(CONSTANTS.MEMORY_CATEGORIES)) {
            const memories = await this.manager.listMemories(category);

            for (const memory of memories) {
                const daysSinceUpdate =
                    (Date.now() - new Date(memory.updated)) / CONSTANTS.TIME.MS_PER_DAY;

                if (daysSinceUpdate <= CONSTANTS.MEMORY_FILTERS.RECENT_DAYS) {
                    recentCount++;
                } else if (daysSinceUpdate > CONSTANTS.MEMORY_FILTERS.RECENT_DAYS * 4) {
                    oldCount++;
                }
            }
        }

        if (recentCount > 0) {
            this.results.passed.push(
                `✅ ${recentCount} memories updated in last ${CONSTANTS.MEMORY_FILTERS.RECENT_DAYS} days`
            );
        }

        if (oldCount > 0) {
            this.results.warnings.push(
                `⚠️  ${oldCount} memories haven't been updated in over ${CONSTANTS.MEMORY_FILTERS.RECENT_DAYS * 4} days`
            );
        }
    }

    async runHealthCheck() {
        console.log('\n' + '='.repeat(60));
        console.log('🏥 MEMORY SYSTEM HEALTH CHECK');
        console.log('='.repeat(60) + '\n');

        await this.checkMemoryDirectories();
        await this.checkBackend();
        await this.checkMemoryPerformance();
        await this.checkMemoryQuality();
        await this.checkRecentMemories();

        // Display results
        console.log('\n' + '='.repeat(60));
        console.log('📊 HEALTH CHECK RESULTS');
        console.log('='.repeat(60) + '\n');

        if (this.results.passed.length > 0) {
            console.log('✅ PASSED CHECKS:');
            this.results.passed.forEach(msg => console.log('  ' + msg));
        }

        if (this.results.warnings.length > 0) {
            console.log('\n⚠️  WARNINGS:');
            this.results.warnings.forEach(msg => console.log('  ' + msg));
        }

        if (this.results.errors.length > 0) {
            console.log('\n❌ ERRORS:');
            this.results.errors.forEach(msg => console.log('  ' + msg));
        }

        // Summary
        const total = this.results.passed.length +
                     this.results.warnings.length +
                     this.results.errors.length;

        console.log('\n' + '='.repeat(60));
        console.log(`SUMMARY: ${this.results.passed.length}/${total} checks passed`);

        if (this.results.errors.length === 0) {
            console.log('🎉 Memory system is healthy!');
        } else {
            console.log('⚠️  Memory system needs attention');
        }

        console.log('='.repeat(60) + '\n');

        // Configuration reference
        console.log('📋 CONFIGURATION REFERENCE:');
        console.log(`  Recent threshold: ${CONSTANTS.MEMORY_FILTERS.RECENT_DAYS} days`);
        console.log(`  High confidence: ≥${CONSTANTS.MEMORY_FILTERS.HIGH_CONFIDENCE_THRESHOLD}`);
        console.log(`  High usage: ≥${CONSTANTS.MEMORY_FILTERS.HIGH_USAGE_THRESHOLD} uses`);
        console.log(`  Query target: <${CONSTANTS.PERFORMANCE.SIMPLE_QUERY_MS}ms`);
        console.log(`  Default limit: ${CONSTANTS.MEMORY_FILTERS.DEFAULT_LIMIT} memories`);

        return this.results.errors.length === 0;
    }
}

// Run health check
if (require.main === module) {
    const checker = new MemoryHealthChecker();
    checker.runHealthCheck()
        .then(healthy => process.exit(healthy ? 0 : 1))
        .catch(error => {
            console.error('Health check failed:', error);
            process.exit(1);
        });
}

module.exports = MemoryHealthChecker;
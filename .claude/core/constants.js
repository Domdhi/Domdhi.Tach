/**
 * System-wide constants to avoid magic numbers and strings
 * All configurable values should be defined here
 */

module.exports = {
    // Memory scoring weights
    MEMORY_SCORING: {
        RECENCY_MAX_POINTS: 30,           // Maximum points for recent memories
        RECENCY_DAYS_THRESHOLD: 1,        // Days for max recency bonus
        USAGE_MULTIPLIER: 5,              // Points per usage
        CONFIDENCE_MULTIPLIER: 20,        // Maximum confidence points
        RELEVANCE_MULTIPLIER: 50,         // Maximum relevance points
        MIN_WORD_LENGTH: 3                // Minimum word length for relevance matching
    },

    // Memory filtering thresholds
    MEMORY_FILTERS: {
        RECENT_DAYS: 7,                   // Days for "recent" filter
        DEFAULT_LIMIT: 10,                // Default maximum memories to load
        HIGH_USAGE_THRESHOLD: 5,          // Threshold for "frequently used"
        HIGH_CONFIDENCE_THRESHOLD: 0.8,   // Threshold for "high confidence"
        // Per-category memory cap. Static here (no process.env read — keeps
        // require('./constants') deterministic). The env override
        // (MEMORY_MAX_PER_CATEGORY) is applied at the two call sites
        // (memory-manager.js, memory-guard.cjs) with an identical expression.
        MEMORY_MAX_PER_CATEGORY: 50,
        // Min active-work-days since `created` for a never-recalled memory to
        // appear in the dead-weight review queue (decay-independent flagger).
        // Static here; env override (MEMORY_EXPOSURE_MIN_DAYS) applied at the
        // memory-manager.js call site with an identical expression.
        EXPOSURE_MIN_ACTIVE_DAYS: 30,
        // Write-time importance score (1–5) assigned to a memory when authored;
        // the retention floor. Default 3 (mid-scale) when the author omits it and
        // for legacy memories with no importance field (backfill-on-read). Static
        // here; env override (MEMORY_IMPORTANCE_DEFAULT) applied at the call site.
        IMPORTANCE_DEFAULT: 3,
    },

    // Agent limits
    AGENT_LIMITS: {
        MAX_CONCURRENT_SUBAGENTS: 5,      // Maximum concurrent sub-agents
        TOOLS_PER_AGENT_MIN: 2,           // Minimum tools per agent
        TOOLS_PER_AGENT_MAX: 5,           // Maximum tools per traditional agent
    },

    // Context management
    CONTEXT_LIMITS: {
        PER_AGENT_PERCENT: 10,            // Maximum context % per agent
        TOTAL_SESSION_PERCENT: 50,        // Total session context before compact
        COMPACT_TARGET_PERCENT: 30,       // Target after compacting
    },

    // Performance targets (milliseconds)
    PERFORMANCE: {
        SIMPLE_QUERY_MS: 2000,            // 2 seconds
        CODE_GENERATION_MS: 30000,        // 30 seconds
        COMPLEX_REFACTOR_MS: 120000,      // 2 minutes
        FULL_FEATURE_MS: 300000,          // 5 minutes
        CACHE_HIT_MS: 5,                  // 5ms for cached responses
    },

    // Quality metrics
    QUALITY_TARGETS: {
        FIRST_ATTEMPT_SUCCESS: 0.8,       // 80% success rate
        BUILD_SUCCESS_RATE: 0.95,          // 95% build success
        TEST_PASS_RATE: 0.9,               // 90% test pass rate
        ERROR_CLASSIFICATION_ACCURACY: 0.95, // 95% accuracy
        PATTERN_RECOGNITION_RATE: 0.9,     // 90% pattern match rate
        MIN_TEST_COVERAGE: 0.8,            // 80% test coverage target
    },

    // Time constants (milliseconds)
    TIME: {
        MS_PER_SECOND: 1000,
        MS_PER_MINUTE: 60000,
        MS_PER_HOUR: 3600000,
        MS_PER_DAY: 86400000,
        SECONDS_PER_MINUTE: 60,
        MINUTES_PER_HOUR: 60,
        HOURS_PER_DAY: 24,
        DAYS_PER_WEEK: 7,
    },

    // Memory categories
    // Key insertion order is load-bearing: `Object.values(MEMORY_CATEGORIES)` is
    // the canonical iteration order consumed by memory-manager, memory-curator,
    // memory-promoter, decision-viz, session-start-prime hook,
    // and test fixtures. Changing this order changes the section order of the
    // compiled concept index (docs/.output/memories/concepts/index.md).
    MEMORY_CATEGORIES: {
        PATTERNS: 'patterns',
        CONSTRAINTS: 'constraints',
        DECISIONS: 'decisions',
        WORKFLOWS: 'workflows',
        REJECTED_APPROACHES: 'rejected-approaches',  // AMEM-5.1: approaches that were tried and abandoned
    },

    // Memory profile — controls how much of the memory pipeline runs
    // Read at hook-run time via .claude/core/profile.js (getProfile, isAtLeast)
    // - minimal:  pre-compaction baseline only
    // - standard: + Stop pipeline (capture + compile), commit capture, guard warnings (DEFAULT)
    // - strict:   + Haiku extraction, edit capture, curator, benchmark
    MEMORY_PROFILE: {
        MINIMAL: 'minimal',
        STANDARD: 'standard',
        STRICT: 'strict',
        DEFAULT: 'standard',
        ORDER: ['minimal', 'standard', 'strict']
    },

    // Memory confidence decay — category-specific rates and thresholds
    MEMORY_DECAY: {
        // Decay is based on active work days (days with git commits), not calendar days.
        // A project untouched for months has zero decay — memories stay valid until
        // active development produces changes that could invalidate them.
        RATES: {
            decisions: 0.98,              // half-life ~35 active work days
            constraints: 0.97,            // half-life ~23 active work days
            patterns: 0.95,               // half-life ~14 active work days
            workflows: 0.93,              // half-life ~10 active work days
            'rejected-approaches': 0.90   // half-life ~7 active work days (fade fast — codebase changes invalidate old rejections)
        },
        DEFAULT_RATE: 0.95,
        USAGE_BOOST: 0.01,
        RECENT_UPDATE_BOOST: 0.1,
        RECENT_UPDATE_DAYS: 7,
        ECHO_BOOST: 0.05,        // confidence bump per commit-echo match (AMEM-4.1)
        STALE_THRESHOLD: 0.3,
        ARCHIVE_THRESHOLD: 0.1,
        // Usage-counter halving period in active-work-days (ME-4.1). The honest
        // usage signal halves after this many silent active days so a once-popular
        // memory's count stops being a permanent ratchet (TinyLFU-style aging).
        USAGE_HALVE_EVERY_DAYS: 14
    },

    // Session phases
    SESSION_PHASES: {
        INITIALIZATION: 'initialization',
        RESEARCH: 'research',
        IMPLEMENTATION: 'implementation',
        BUILD_TEST: 'build-test',
        VALIDATION: 'validation',
        COMPLETED: 'completed',
        FAILED: 'failed',
    },

    // Error severity levels
    ERROR_SEVERITY: {
        SEVERE: 'SEVERE',
        OOPSIE: 'OOPSIE',
        WARNING: 'WARNING',
        INFO: 'INFO',
        SUCCESS: 'SUCCESS',
    },

    // Agent roles
    AGENT_ROLES: {
        RESEARCH: 'research',
        IMPLEMENTATION: 'implementation',
        BUILD_TEST: 'build-test',
        DOCUMENTATION: 'documentation',
        ORCHESTRATOR: 'orchestrator',
    },

    // File patterns
    FILE_PATTERNS: {
        JSON_EXTENSION: '.json',
        MARKDOWN_EXTENSION: '.md',
        JAVASCRIPT_EXTENSION: '.js',
        JSONL_EXTENSION: '.jsonl',
    },

    // Project lifecycle phases
    PROJECT_PHASES: {
        UNINITIALIZED: 0,
        ANALYSIS: 1,
        PLANNING: 2,
        SOLUTIONING: 3,
        IMPLEMENTATION: 4,
    },

    // Artifacts produced by each phase
    PHASE_ARTIFACTS: {
        1: ['_brainstorm.md', '_research.md', '_project-brief.md'],
        2: ['_project-requirements.md', 'design/_project-design.md'],
        3: ['_project-architecture.md', 'todo/_backlog.md'],
        4: ['source code', 'tests'],
    },

    // Document dependency chain (upstream → downstream)
    DOC_CHAIN: {
        '_brainstorm.md': { feeds: ['_project-brief.md'] },
        '_research.md': { feeds: ['_project-brief.md', '_project-requirements.md'] },
        '_project-brief.md': { feeds: ['_project-requirements.md'] },
        '_project-requirements.md': { feeds: ['_project-architecture.md', 'design/_project-design.md', 'todo/_backlog.md'] },
        'design/_project-design.md': { feeds: ['_project-architecture.md'] },
        '_project-architecture.md': { feeds: ['todo/_backlog.md'] },
        'todo/_backlog.md': { feeds: ['implementation'] },
    },

    // Agent system (official Claude Code subagent format)
    AGENTS: {
        DIRECTORY: '.claude/agents',             // Agent definition directory
        FILE_PATTERN: '*.md',                    // Flat .md files (official format)
    },

    // Command line defaults
    CLI_DEFAULTS: {
        LIST_SESSIONS_LIMIT: 10,
        MEMORY_SEARCH_LIMIT: 10,
        DEFAULT_COMPLETION_STATUS: 'completed',
    }
};
module.exports = {
    testEnvironment: 'jsdom',
    testMatch: ['**/tests/**/*.test.js'],
    // Don't scan deps or the published public mirror (_Domdhi.Tach/ is an
    // independent repo synced by tools/publish.js; it carries copies of tests/
    // that would otherwise be collected and run twice).
    testPathIgnorePatterns: ['/node_modules/', '/_Domdhi\\.Tach/'],
};

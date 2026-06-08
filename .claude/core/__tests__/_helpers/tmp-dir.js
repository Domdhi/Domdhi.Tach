/**
 * Shared tmp-dir helper for test suites.
 * CommonJS (not ESM) — loaded via createRequire() bridge in test files.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Creates a temporary directory and returns a helper object for working inside it.
 *
 * @param {{ prefix?: string }} [options]
 * @returns {{ root: string, write: Function, mkdir: Function, read: Function, cleanup: Function }}
 */
function createTmpDir({ prefix = 'domdhi-test-' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  return {
    root,

    /**
     * Write content to a relative path inside root, creating parent dirs as needed.
     * @param {string} relPath
     * @param {string} content
     * @returns {string} absolute path written
     */
    write(relPath, content) {
      const full = path.join(root, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      return full;
    },

    /**
     * Create a directory (and any parents) inside root.
     * @param {string} relPath
     * @returns {string} absolute path created
     */
    mkdir(relPath) {
      const full = path.join(root, relPath);
      fs.mkdirSync(full, { recursive: true });
      return full;
    },

    /**
     * Read a file inside root as UTF-8 text.
     * @param {string} relPath
     * @returns {string}
     */
    read(relPath) {
      return fs.readFileSync(path.join(root, relPath), 'utf8');
    },

    /**
     * Remove the entire tmp directory tree.
     */
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Async wrapper: creates a tmp dir, passes it to fn, cleans up in finally.
 *
 * @param {(tmp: ReturnType<typeof createTmpDir>) => Promise<any>} fn
 * @returns {Promise<any>}
 */
async function withTmpDir(fn) {
  const tmp = createTmpDir();
  try {
    return await fn(tmp);
  } finally {
    tmp.cleanup();
  }
}

module.exports = { createTmpDir, withTmpDir };

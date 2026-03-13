'use strict';

const log = require('./logger');

function createChecker(name) {
  const results = [];

  function record(ok, label, expected, actual) {
    results.push({ label, ok, expected, actual });
    return ok;
  }

  return {
    name,
    results,

    equal(label, actual, expected) {
      return record(actual === expected, label, expected, actual);
    },

    atLeast(label, actual, minimum) {
      return record(actual >= minimum, label, `>= ${minimum}`, actual);
    },

    isTrue(label, actual) {
      return record(actual === true, label, true, actual);
    },

    get passed() {
      return results.every((r) => r.ok);
    },

    /** Prints every check, not just failures — the passing ones localise the bug. */
    summary() {
      log.raw('');
      log.raw(`  ${name}`);
      log.raw('  ' + '─'.repeat(72));
      for (const r of results) {
        const mark = r.ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
        const detail = r.ok ? `${r.actual}` : `expected ${r.expected}, got ${r.actual}`;
        log.raw(`  ${mark}  ${r.label.padEnd(46)} ${detail}`);
      }
      log.raw('  ' + '─'.repeat(72));
      return this.passed;
    },
  };
}

module.exports = { createChecker };
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { config } = require('./config');
const log = require('./logger');

function renderTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length))
  );
  const line = (cells) => '  ' + cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  const divider = '  ' + widths.map((w) => '─'.repeat(w)).join('  ');
  return [line(headers), divider, ...rows.map(line)].join('\n');
}

function nodeDistribution(results) {
  const byNode = new Map();
  for (const r of results) {
    const key = r.node || (r.error ? '(network error)' : '(unknown)');
    const entry = byNode.get(key) || { allowed: 0, denied: 0, errored: 0 };
    if (r.status === 200) entry.allowed += 1;
    else if (r.status === 429) entry.denied += 1;
    else entry.errored += 1;
    byNode.set(key, entry);
  }
  return [...byNode.entries()]
    .map(([node, counts]) => ({ node, ...counts, total: counts.allowed + counts.denied + counts.errored }))
    .sort((a, b) => a.node.localeCompare(b.node));
}

function saveReport(name, payload) {
  if (!config.saveReports) return null;
  try {
    const dir = path.resolve(__dirname, '..', config.reportsDir);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${name}-${stamp}.json`);
    // Config is saved with the results: a benchmark without its parameters is not reproducible.
    fs.writeFileSync(
      file,
      `${JSON.stringify({ name, generatedAt: new Date().toISOString(), config, ...payload }, null, 2)}\n`
    );
    log.info('report_saved', { file });
    return file;
  } catch (err) {
    log.warn('report_save_failed', { error: err.message });
    return null;
  }
}

module.exports = { renderTable, nodeDistribution, saveReport };
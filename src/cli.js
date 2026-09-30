#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { compareReports, parseReport, queryPaths, toSarif } from './index.js';

const args = process.argv.slice(2); const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const load = (file, format) => parseReport(readFileSync(file, 'utf8'), format ?? 'auto');
try {
  const command = args[0] ?? 'parse';
  if (command === 'parse') {
    const report = load(args[1], value('--format')); const output = value('--output'); const text = JSON.stringify(report, null, 2);
    if (output) writeFileSync(output, text + '\n'); else console.log(text);
  } else if (command === 'paths') {
    const report = load(args[1], value('--format'));
    console.log(JSON.stringify(queryPaths(report, { status: value('--status'), clock: value('--clock'), limit: Number(value('--limit') ?? Infinity) }), null, 2));
  } else if (command === 'compare') {
    const result = compareReports(load(args[1], value('--format')), load(args[2], value('--format')), { minWorstSlackNs: Number(value('--min-slack') ?? 0), maxSlackRegressionNs: Number(value('--max-regression') ?? 0), maxNewViolations: Number(value('--max-new-violations') ?? 0) });
    console.log(JSON.stringify(result, null, 2)); if (!result.pass) process.exitCode = 2;
  } else if (command === 'sarif') {
    const output = value('--output'); const text = JSON.stringify(toSarif(load(args[1], value('--format')), args[1]), null, 2);
    if (output) writeFileSync(output, text + '\n'); else console.log(text);
  } else throw new Error(`Unknown command: ${command}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }

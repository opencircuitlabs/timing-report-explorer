import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareReports, detectFormat, finalize, histogram, parseReport, queryPaths, toSarif } from '../src/index.js';

const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

test('detects three supported timing formats', () => {
  assert.equal(detectFormat(fixture('nextpnr.txt')), 'nextpnr');
  assert.equal(detectFormat(fixture('vivado.txt')), 'vivado');
  assert.equal(detectFormat(fixture('opensta.txt')), 'opensta');
});

test('nextpnr parser extracts frequency, decomposition, and warnings', () => {
  const report = parseReport(fixture('nextpnr.txt'));
  assert.equal(report.clocks[0].achievedMHz, 125);
  assert.equal(report.clocks[0].status, 'met');
  assert.equal(report.paths.find((p) => p.type === 'max').delayNs, 8);
  assert.equal(report.warnings.length, 1);
});

test('Vivado parser normalizes summary and detailed path', () => {
  const report = parseReport(fixture('vivado.txt'));
  assert.equal(report.summary.status, 'violated');
  assert.equal(report.summary.worstSlackNs, -0.25);
  assert.equal(report.paths[0].routingDelayNs, 6.7);
  assert.equal(report.clocks[0].requestedMHz, 100);
});

test('OpenSTA parser extracts met and violated paths', () => {
  const report = parseReport(fixture('opensta.txt'));
  assert.equal(report.paths.length, 2);
  assert.equal(report.summary.violatingPaths, 1);
  assert.equal(report.summary.worstSlackNs, -0.3);
});

test('path queries filter and rank worst slack first', () => {
  const paths = queryPaths(parseReport(fixture('opensta.txt')), { status: 'violated', limit: 1 });
  assert.equal(paths.length, 1); assert.equal(paths[0].startpoint, 'slow_reg/Q');
});

test('histogram handles negative values and edge maximum', () => {
  const bins = histogram([-1, -0.5, 0, 0.5, 1], { bins: 2 });
  assert.deepEqual(bins.map((x) => x.count), [2, 3]);
});

test('comparison passes improvements and fails regressions', () => {
  const baseline = parseReport(fixture('opensta.txt'));
  const improved = structuredClone(baseline); improved.paths[1].slackNs = 0.2; improved.paths[1].status = 'met';
  finalize(improved);
  assert.equal(compareReports(baseline, improved).pass, true);
  const regression = compareReports(improved, baseline);
  assert.equal(regression.pass, false); assert.ok(regression.failures.length >= 1);
});

test('SARIF contains one result per violating detailed path', () => {
  const sarif = toSarif(parseReport(fixture('opensta.txt')), 'report.txt');
  assert.equal(sarif.runs[0].results.length, 1);
  assert.equal(sarif.runs[0].results[0].ruleId, 'TIMING_VIOLATION');
});

test('empty and unknown reports fail clearly', () => {
  assert.throws(() => parseReport(''), /empty/);
  assert.throws(() => parseReport('hello'), /Unable to detect/);
});

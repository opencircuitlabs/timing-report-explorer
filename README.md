# Timing Report Explorer

A dependency-free parser, query engine, regression gate, and SARIF exporter for FPGA/ASIC static timing reports.

It normalizes reports from nextpnr, AMD/Xilinx Vivado, and OpenSTA into one JSON model so CI and dashboards can reason about clocks, critical paths, worst slack, total negative slack, violations, logic-versus-routing delay, and regressions without tool-specific text processing.

## Quick start

```bash
npm install
npm test
node src/cli.js parse tests/fixtures/nextpnr.txt
node src/cli.js paths tests/fixtures/opensta.txt --status violated --limit 10
node src/cli.js compare baseline.txt current.txt --min-slack 0 --max-regression 0.05
node src/cli.js sarif current.txt --output timing.sarif
```

The `compare` command exits with status `2` when a timing gate fails, and `1` for input or parser errors. This makes a real regression distinguishable from infrastructure failure in CI.

## JavaScript API

```js
import { parseReport, queryPaths, compareReports } from '@opencircuitlabs/timing-report-explorer';

const current = parseReport(reportText); // automatic tool detection
const worst = queryPaths(current, { status: 'violated', limit: 20 });
const gate = compareReports(baseline, current, {
  minWorstSlackNs: 0,
  maxSlackRegressionNs: 0.05,
  maxNewViolations: 0
});
```

## Normalized model

Every parser produces:

- tool identity, warnings, and tool-specific metadata;
- clocks with requested/achieved frequency and derived slack where available;
- detailed paths with endpoints, clock group, delay decomposition, type, status, and slack;
- a common summary with timing status, WNS, TNS, violating-path count, path count, and clock count.

`queryPaths` combines clock, path type, status, slack ceiling, limit, and worst-first ranking. `histogram` creates bounded numeric buckets for UIs. `toSarif` maps violations into GitHub code-scanning-compatible SARIF 2.1.0.

## Regression semantics

Comparisons report WNS/TNS deltas, new violations, and per-clock frequency regressions. Gates can require non-negative slack and cap regression or newly introduced violations. Missing metrics remain `null`; they are not fabricated or treated as zero.

Timing report formats vary between tool versions. Parsers are deliberately tolerant around surrounding prose but strict about numeric fields. Add redacted fixtures when extending a parser.

## License

MIT

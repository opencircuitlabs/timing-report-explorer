const number = (value) => value == null ? null : Number(value);
const clean = (value) => value?.trim().replace(/^['"]|['"]$/g, '');

export function detectFormat(text) {
  if (/Max frequency for clock/i.test(text) || /Info:.*MHz.*requested/i.test(text)) return 'nextpnr';
  if (/Startpoint:.*Path Group:/is.test(text) && /Path Type:\s*(?:max|min)/i.test(text)) return 'opensta';
  if (/Design Timing Summary|Slack \(MET\)|Slack \(VIOLATED\)/i.test(text)) return 'vivado';
  if (/report_checks/i.test(text)) return 'opensta';
  throw new Error('Unable to detect timing report format; pass an explicit format');
}

function base(tool) { return { schemaVersion: 1, tool, clocks: [], paths: [], warnings: [], metadata: {} }; }

export function parseNextpnr(text) {
  const report = base('nextpnr');
  for (const match of text.matchAll(/Max frequency for clock\s+['"]?([^:'"]+)['"]?:\s*([0-9.]+)\s*MHz(?:\s*\(PASS at\s*([0-9.]+)\s*MHz\))?/gi)) {
    const achieved = number(match[2]); const requested = number(match[3]);
    report.clocks.push({ name: clean(match[1]), achievedMHz: achieved, requestedMHz: requested, slackNs: requested ? 1000 / requested - 1000 / achieved : null, status: !requested || achieved >= requested ? 'met' : 'violated' });
  }
  for (const match of text.matchAll(/Info:\s*([0-9.]+)\s*ns logic,\s*([0-9.]+)\s*ns routing\s*\((\d+) logic,\s*(\d+) routing\)/gi)) {
    report.paths.push({ type: 'max', delayNs: number(match[1]) + number(match[2]), logicDelayNs: number(match[1]), routingDelayNs: number(match[2]), logicLevels: number(match[3]), routingSegments: number(match[4]) });
  }
  for (const match of text.matchAll(/Info:\s*Critical path report for clock ['"]?([^:'"]+)['"]?/gi)) report.paths.push({ type: 'critical-path-marker', clock: clean(match[1]) });
  for (const match of text.matchAll(/Warning:\s*(.+)$/gim)) report.warnings.push(match[1].trim());
  if (!report.clocks.length) report.warnings.push('No clock frequency summaries found');
  return finalize(report);
}

export function parseVivado(text) {
  const report = base('vivado');
  const summary = text.match(/WNS\(ns\).*?TNS\(ns\).*?TNS Failing Endpoints.*?\n\s*[-\s]+\n\s*(-?[0-9.]+)\s+(-?[0-9.]+)\s+(\d+)\s+(\d+)/is);
  if (summary) report.metadata.summary = { wnsNs: number(summary[1]), tnsNs: number(summary[2]), failingEndpoints: number(summary[3]), totalEndpoints: number(summary[4]) };
  for (const block of text.split(/(?=Slack\s+\((?:MET|VIOLATED)\))/gi).filter((part) => /^Slack\s+\(/i.test(part))) {
    const slack = block.match(/Slack\s+\((MET|VIOLATED)\)\s*:\s*(-?[0-9.]+)ns/i);
    const source = block.match(/Source:\s*(\S+)/i); const destination = block.match(/Destination:\s*(\S+)/i);
    const delay = block.match(/Data Path Delay:\s*([0-9.]+)ns\s*\(logic\s*([0-9.]+)ns[\s\S]*?route\s*([0-9.]+)ns/i);
    if (slack && source && destination) report.paths.push({ status: slack[1].toLowerCase() === 'met' ? 'met' : 'violated', slackNs: number(slack[2]), startpoint: source[1], endpoint: destination[1], delayNs: number(delay?.[1]), logicDelayNs: number(delay?.[2]), routingDelayNs: number(delay?.[3]), type: 'max' });
  }
  for (const match of text.matchAll(/Clock Summary[\s\S]*?Clock\s+Waveform\(ns\)\s+Period\(ns\)\s+Frequency\(MHz\)([\s\S]*?)(?:\n\s*\n|$)/gi)) {
    for (const row of match[1].split(/\r?\n/)) {
      const fields = row.trim().match(/^(\S+)\s+\{[^}]+\}\s+([0-9.]+)\s+([0-9.]+)/);
      if (fields) report.clocks.push({ name: fields[1], periodNs: number(fields[2]), requestedMHz: number(fields[3]) });
    }
  }
  if (!summary) report.warnings.push('Design timing summary not found');
  return finalize(report);
}

export function parseOpenSta(text) {
  const report = base('opensta');
  const blocks = text.split(/(?=Startpoint:)/g).filter((block) => block.startsWith('Startpoint:'));
  for (const block of blocks) {
    const start = block.match(/Startpoint:\s*(\S+)/); const end = block.match(/Endpoint:\s*(\S+)/);
    const group = block.match(/Path Group:\s*(\S+)/); const type = block.match(/Path Type:\s*(max|min)/i);
    const slack = block.match(/slack\s+\((MET|VIOLATED)\)\s+(-?[0-9.]+)/i) ?? block.match(/slack\s+(-?[0-9.]+)/i);
    const arrival = block.match(/data arrival time\s+(-?[0-9.]+)/i);
    if (start && end && slack) report.paths.push({ startpoint: start[1], endpoint: end[1], clock: group?.[1] ?? null, type: type?.[1]?.toLowerCase() ?? 'max', slackNs: number(slack[2] ?? slack[1]), delayNs: number(arrival?.[1]), status: number(slack[2] ?? slack[1]) >= 0 ? 'met' : 'violated' });
  }
  for (const match of text.matchAll(/create_clock.*?-period\s+([0-9.]+).*?\[get_ports\s+([^\]]+)\]/gi)) report.clocks.push({ name: clean(match[2]), periodNs: number(match[1]), requestedMHz: 1000 / number(match[1]) });
  if (!report.paths.length) report.warnings.push('No timing paths found');
  return finalize(report);
}

export function parseReport(text, format = 'auto') {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Timing report is empty');
  const selected = format === 'auto' ? detectFormat(text) : format.toLowerCase();
  if (selected === 'nextpnr') return parseNextpnr(text);
  if (selected === 'vivado') return parseVivado(text);
  if (selected === 'opensta') return parseOpenSta(text);
  throw new Error(`Unsupported format: ${format}`);
}

export function finalize(report) {
  const timed = report.paths.filter((path) => Number.isFinite(path.slackNs));
  const slacks = timed.map((path) => path.slackNs);
  const clockSlacks = report.clocks.map((clock) => clock.slackNs).filter(Number.isFinite);
  const all = [...slacks, ...clockSlacks];
  const calculatedTns = slacks.filter((x) => x < 0).reduce((sum, x) => sum + x, 0);
  const calculatedViolations = timed.filter((path) => path.slackNs < 0).length;
  report.summary = {
    status: all.some((x) => x < 0) || report.metadata.summary?.failingEndpoints > 0 ? 'violated' : all.length || report.clocks.length ? 'met' : 'unknown',
    worstSlackNs: all.length ? Math.min(...all) : report.metadata.summary?.wnsNs ?? null,
    totalNegativeSlackNs: calculatedTns !== 0 ? calculatedTns : (report.metadata.summary?.tnsNs ?? 0),
    violatingPaths: calculatedViolations !== 0 ? calculatedViolations : (report.metadata.summary?.failingEndpoints ?? 0),
    pathCount: report.paths.filter((path) => path.type !== 'critical-path-marker').length,
    clockCount: report.clocks.length
  };
  return report;
}

export function queryPaths(report, options = {}) {
  let paths = report.paths.filter((p) => p.type !== 'critical-path-marker');
  if (options.status) paths = paths.filter((p) => p.status === options.status);
  if (options.clock) paths = paths.filter((p) => p.clock === options.clock);
  if (options.type) paths = paths.filter((p) => p.type === options.type);
  if (options.maxSlackNs != null) paths = paths.filter((p) => p.slackNs <= options.maxSlackNs);
  paths.sort((a, b) => (a.slackNs ?? Infinity) - (b.slackNs ?? Infinity));
  return paths.slice(0, options.limit ?? paths.length);
}

export function histogram(values, options = {}) {
  values = values.filter(Number.isFinite);
  if (!values.length) return [];
  const count = Math.max(1, options.bins ?? 10); const min = options.min ?? Math.min(...values); const max = options.max ?? Math.max(...values);
  const width = max === min ? 1 : (max - min) / count;
  const bins = Array.from({ length: count }, (_, i) => ({ min: min + i * width, max: i === count - 1 ? max : min + (i + 1) * width, count: 0 }));
  for (const value of values) bins[Math.min(count - 1, Math.max(0, Math.floor((value - min) / width)))].count++;
  return bins;
}

export function compareReports(baseline, current, thresholds = {}) {
  const before = baseline.summary; const after = current.summary;
  const delta = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
  const comparison = {
    worstSlackDeltaNs: delta(before.worstSlackNs, after.worstSlackNs),
    tnsDeltaNs: delta(before.totalNegativeSlackNs, after.totalNegativeSlackNs),
    violatingPathDelta: after.violatingPaths - before.violatingPaths,
    clockRegressions: []
  };
  const oldClocks = new Map(baseline.clocks.map((x) => [x.name, x]));
  for (const clock of current.clocks) {
    const old = oldClocks.get(clock.name); if (!old) continue;
    const metric = delta(old.achievedMHz ?? old.requestedMHz, clock.achievedMHz ?? clock.requestedMHz);
    if (metric != null && metric < 0) comparison.clockRegressions.push({ name: clock.name, deltaMHz: metric });
  }
  const failures = [];
  if (after.worstSlackNs != null && after.worstSlackNs < (thresholds.minWorstSlackNs ?? 0)) failures.push(`worst slack ${after.worstSlackNs} ns is below ${thresholds.minWorstSlackNs ?? 0} ns`);
  if (comparison.worstSlackDeltaNs != null && comparison.worstSlackDeltaNs < -(thresholds.maxSlackRegressionNs ?? 0)) failures.push(`worst slack regressed by ${-comparison.worstSlackDeltaNs} ns`);
  if (comparison.violatingPathDelta > (thresholds.maxNewViolations ?? 0)) failures.push(`${comparison.violatingPathDelta} new violating paths`);
  return { pass: failures.length === 0, failures, ...comparison };
}

export function toSarif(report, source = 'timing-report.txt') {
  return { version: '2.1.0', $schema: 'https://json.schemastore.org/sarif-2.1.0.json', runs: [{ tool: { driver: { name: 'OpenCircuitLabs Timing Report Explorer', rules: [{ id: 'TIMING_VIOLATION', shortDescription: { text: 'Static timing violation' } }] } }, results: queryPaths(report, { status: 'violated' }).map((path) => ({ ruleId: 'TIMING_VIOLATION', level: 'error', message: { text: `${path.startpoint ?? '?'} → ${path.endpoint ?? '?'} slack ${path.slackNs} ns` }, locations: [{ physicalLocation: { artifactLocation: { uri: source } } }] })) }] };
}

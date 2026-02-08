// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: chart-bar;

// Display Run Metrics
// Shows aggregated + per-parser metrics for Scriptable runs.

const BRAND = {
  primary: '#667eea',
  secondary: '#ff6b6b',
  text: '#ffffff',
  textMuted: '#e6ebff',
  textSoft: '#f5f7ff',
  success: '#2ed573',
  warning: '#feca57',
  danger: '#ff6b6b',
  neutral: '#a7b0cc'
};

const CHART_STYLE = {
  line: '#ffe66d',
  lineSecondary: '#9b8cff',
  fillOpacity: 0.25,
  lineWidth: 2,
  padding: 6
};

const DEBUG_CHART_POINTS = true;

const CHART_AXIS_LABELS = {
  runs: 'Runs (oldest to newest)',
  finalEvents: 'Final events',
  durationMinutes: 'Duration (min)'
};

const CHART_SERIES_COLORS = [
  CHART_STYLE.line,
  CHART_STYLE.lineSecondary,
  '#ff9f43',
  '#2ed573',
  '#54a0ff',
  '#ff6b6b'
];

const MAX_PARSER_DURATION_SERIES = 4;

const WIDGET_STYLE = {
  rowBackground: '#ffffff',
  rowBackgroundAlpha: 0.12,
  rowBackgroundAlphaCompact: 0.08,
  rowPadding: { top: 6, left: 8, bottom: 6, right: 8 },
  rowPaddingCompact: { top: 4, left: 6, bottom: 4, right: 6 },
  rowRadius: 8,
  rowSpacing: 6,
  badgePadding: { top: 2, left: 6, bottom: 2, right: 6 },
  badgeRadius: 10,
  badgeAlpha: 0.22
};

const FONT_SIZES = {
  widget: {
    title: 13,
    label: 12,
    small: 11,
    metric: 20
  },
  app: {
    title: 18,
    label: 14,
    small: 12,
    metric: 24
  }
};

const STATUS_ICONS = {
  healthy: 'checkmark.circle.fill',
  warning: 'exclamationmark.triangle.fill',
  failed: 'xmark.octagon.fill',
  'no-events': 'minus.circle.fill',
  'not-run': 'circle.dashed'
};

const PARSER_ICON_RULES = [
  { match: ['eventbrite'], symbol: 'ticket.fill' },
  { match: ['bearracuda'], symbol: 'music.note.list' },
  { match: ['ticketleap'], symbol: 'ticket' },
  { match: ['linktree', 'linktr.ee'], symbol: 'link' }
];

const LOGO_URL = 'https://chunky.dad/favicons/logo-hero.png';
const DISPLAY_METRICS_SCRIPT = 'display-run-metrics';
const DISPLAY_SAVED_RUN_SCRIPT = 'display-saved-run';

class LineChart {
  constructor(width, height, values, options = {}) {
    this.ctx = new DrawContext();
    this.ctx.size = new Size(width, height);
    this.ctx.respectScreenScale = true;
    this.ctx.opaque = false;
    this.values = Array.isArray(values) ? values : [];
    this.minValue = Number.isFinite(options.minValue) ? options.minValue : 0;
    this.maxValue = Number.isFinite(options.maxValue) ? options.maxValue : null;
    this.padding = Number.isFinite(options.padding) ? options.padding : CHART_STYLE.padding;
  }

  getImage(style = {}) {
    const points = this.getPoints();
    if (style.logPoints) {
      this.logPoints(points, style);
    }
    if (points.length === 0) {
      return this.ctx.getImage();
    }

    const fillColor = style.fillColor || null;
    const lineColor = style.lineColor || null;
    const lineWidth = Number.isFinite(style.lineWidth) ? style.lineWidth : CHART_STYLE.lineWidth;
    const showDots = !!style.showDots;
    const dotRadius = Number.isFinite(style.dotRadius) ? style.dotRadius : 2;
    const dotColor = style.dotColor || lineColor;

    if (fillColor) {
      const fillPath = this.getSmoothPath(points, true);
      this.ctx.setFillColor(fillColor);
      this.ctx.addPath(fillPath);
      this.ctx.fillPath();
    }

    if (lineColor) {
      const linePath = this.getSmoothPath(points, false);
      this.ctx.setStrokeColor(lineColor);
      this.ctx.setLineWidth(lineWidth);
      this.ctx.addPath(linePath);
      this.ctx.strokePath();
    }

    if (showDots && dotColor) {
      this.ctx.setFillColor(dotColor);
      points.forEach(point => {
        const rect = new Rect(point.x - dotRadius, point.y - dotRadius, dotRadius * 2, dotRadius * 2);
        this.ctx.fillEllipse(rect);
      });
    }

    return this.ctx.getImage();
  }

  logPoints(points, style = {}) {
    const count = this.values.length;
    const limit = Number.isFinite(style.logLimit) ? style.logLimit : 30;
    const label = style.logLabel ? ` (${style.logLabel})` : '';
    const width = this.ctx.size.width;
    const height = this.ctx.size.height;
    const padding = this.padding;
    const numericValues = this.values.filter(value => Number.isFinite(value));
    const maxFromValues = numericValues.length ? Math.max(...numericValues, this.minValue) : this.minValue;
    const maxValue = Number.isFinite(this.maxValue)
      ? this.maxValue
      : (maxFromValues > this.minValue ? maxFromValues : this.minValue + 1);
    const diff = maxValue - this.minValue || 1;
    const previewCount = Math.min(limit, count);
    const valuesPreview = this.values.slice(0, previewCount).map(value => (
      Number.isFinite(value) ? Number(value.toFixed(3)) : value
    ));
    const pointsPreview = points.slice(0, previewCount).map(point => ({
      x: Number(point.x.toFixed(2)),
      y: Number(point.y.toFixed(2))
    }));
    const truncation = count > limit ? ` (first ${limit} of ${count})` : '';
    console.log(
      `Metrics chart${label}: count=${count}, size=${width}x${height}, padding=${padding}, min=${this.minValue}, max=${Number(maxValue.toFixed(3))}, diff=${Number(diff.toFixed(3))}${truncation}`
    );
    console.log(`Metrics chart${label} values${truncation}: ${JSON.stringify(valuesPreview)}`);
    console.log(`Metrics chart${label} points${truncation}: ${JSON.stringify(pointsPreview)}`);
  }

  getPoints() {
    const count = this.values.length;
    if (count === 0) return [];

    const width = this.ctx.size.width;
    const height = this.ctx.size.height;
    const padding = this.padding;
    const usableWidth = Math.max(1, width - (padding * 2));
    const usableHeight = Math.max(1, height - (padding * 2));
    const step = count === 1 ? 0 : usableWidth / (count - 1);

    const maxFromValues = Math.max(...this.values, this.minValue);
    const maxValue = Number.isFinite(this.maxValue)
      ? this.maxValue
      : (maxFromValues > this.minValue ? maxFromValues : this.minValue + 1);
    const diff = maxValue - this.minValue || 1;

    return this.values.map((current, index) => {
      const x = padding + (step * index);
      const normalized = (current - this.minValue) / diff;
      const y = padding + (1 - normalized) * usableHeight;
      return new Point(x, y);
    });
  }

  getSmoothPath(points, closePath) {
    const width = this.ctx.size.width;
    const height = this.ctx.size.height;
    const padding = this.padding;
    const baseY = height - padding;
    const path = new Path();

    if (points.length === 1) {
      if (closePath) {
        path.move(new Point(padding, baseY));
        path.addLine(points[0]);
        path.addLine(new Point(width - padding, baseY));
        path.closeSubpath();
      } else {
        path.move(points[0]);
      }
      return path;
    }

    if (closePath) {
      path.move(new Point(padding, baseY));
      path.addLine(points[0]);
    } else {
      path.move(points[0]);
    }

    for (let i = 0; i < points.length - 1; i += 1) {
      const current = points[i];
      const next = points[i + 1];
      const xAvg = (current.x + next.x) / 2;
      const yAvg = (current.y + next.y) / 2;
      const avg = new Point(xAvg, yAvg);
      const cp1 = new Point((xAvg + current.x) / 2, current.y);
      const cp2 = new Point((xAvg + next.x) / 2, next.y);
      path.addQuadCurve(avg, cp1);
      path.addQuadCurve(next, cp2);
    }

    if (closePath) {
      path.addLine(new Point(width - padding, baseY));
      path.closeSubpath();
    }

    return path;
  }
}

class MetricsDisplay {
  constructor() {
    this.fm = FileManager.iCloud();
    const documentsDir = this.fm.documentsDirectory();
    this.baseDir = this.fm.joinPath(documentsDir, 'chunky-dad-scraper');
    this.metricsDir = this.fm.joinPath(this.baseDir, 'metrics');
    this.cacheDir = this.fm.joinPath(this.baseDir, 'cache');
    this.runtime = this.getRuntimeContext();
  }

  getRuntimeContext() {
    const runtime = {
      runsInWidget: false,
      widgetFamily: null,
      widgetParameter: null,
      queryParameters: {}
    };

    try {
      if (typeof config !== 'undefined') {
        runtime.runsInWidget = !!config.runsInWidget;
        runtime.widgetFamily = config.widgetFamily || null;
      }
      if (typeof args !== 'undefined') {
        runtime.widgetParameter = args.widgetParameter || null;
        runtime.queryParameters = args.queryParameters || {};
      }
    } catch (error) {
      console.log(`Metrics: Runtime detection failed: ${error.message}`);
    }

    return runtime;
  }

  ensureDir(path) {
    if (!this.fm.fileExists(path)) {
      this.fm.createDirectory(path, true);
    }
  }

  async ensureDirs() {
    this.ensureDir(this.baseDir);
    this.ensureDir(this.metricsDir);
    this.ensureDir(this.cacheDir);
  }

  async loadLogoImage() {
    const cachePath = this.fm.joinPath(this.cacheDir, 'logo-hero.png');
    try {
      if (this.fm.fileExists(cachePath)) {
        const mtime = this.fm.modificationDate(cachePath);
        if (mtime && (Date.now() - mtime.getTime()) < (7 * 24 * 60 * 60 * 1000)) {
          return Image.fromFile(cachePath);
        }
      }
    } catch (error) {
      console.log(`Metrics: Logo cache read failed: ${error.message}`);
    }

    try {
      const request = new Request(LOGO_URL);
      const image = await request.loadImage();
      this.fm.writeImage(cachePath, image);
      return image;
    } catch (error) {
      console.log(`Metrics: Logo download failed: ${error.message}`);
      return null;
    }
  }

  getMetricsFilePath() {
    return this.fm.joinPath(this.metricsDir, 'metrics.ndjson');
  }

  getMetricsSummaryPath() {
    return this.fm.joinPath(this.metricsDir, 'metrics-summary.json');
  }

  async loadMetricsRecords() {
    const path = this.getMetricsFilePath();
    if (!this.fm.fileExists(path)) {
      return [];
    }

    try {
      await this.fm.downloadFileFromiCloud(path);
    } catch (error) {
      console.log(`Metrics: iCloud download failed: ${error.message}`);
    }

    const content = this.fm.readString(path) || '';
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    if (lines.length === 0) {
      return [];
    }

    const records = [];
    lines.forEach(line => {
      try {
        const record = JSON.parse(line);
        if (record) {
          records.push(this.normalizeMetricsRecord(record));
        }
      } catch (_) {
        return;
      }
    });

    records.sort((a, b) => {
      const aTime = a?.finished_at ? new Date(a.finished_at).getTime() : 0;
      const bTime = b?.finished_at ? new Date(b.finished_at).getTime() : 0;
      return aTime - bTime;
    });

    return records;
  }

  async loadLatestRecord() {
    const records = await this.loadMetricsRecords();
    return records.length ? records[records.length - 1] : null;
  }

  async loadSummary() {
    const path = this.getMetricsSummaryPath();
    if (!this.fm.fileExists(path)) {
      return null;
    }

    try {
      await this.fm.downloadFileFromiCloud(path);
      const content = this.fm.readString(path);
      return JSON.parse(content);
    } catch (error) {
      console.log(`Metrics: Failed to load summary: ${error.message}`);
      return null;
    }
  }

  async loadRunDetails(record) {
    const runPath = record?.run_file_path || null;
    if (!runPath) return null;
    if (!this.fm.fileExists(runPath)) {
      return null;
    }
    try {
      await this.fm.downloadFileFromiCloud(runPath);
      const content = this.fm.readString(runPath);
      return JSON.parse(content);
    } catch (error) {
      console.log(`Metrics: Failed to load run details: ${error.message}`);
      return null;
    }
  }

  getConfiguredParsers() {
    try {
      const scraperConfig = importModule('scraper-input');
      const parsers = Array.isArray(scraperConfig?.parsers) ? scraperConfig.parsers : [];
      return parsers
        .filter(parser => parser && parser.name)
        .map(parser => parser.name);
    } catch (error) {
      console.log(`Metrics: Could not load scraper-input: ${error.message}`);
      return [];
    }
  }

  createActionCounts() {
    return {
      new: 0,
      merge: 0,
      conflict: 0,
      missing_calendar: 0,
      other: 0
    };
  }

  createParserTotals() {
    return {
      total_events: 0,
      raw_bear_events: 0,
      final_bear_events: 0,
      duplicates_removed: 0
    };
  }

  createStatusCounts() {
    return {
      success: 0,
      warning: 0,
      failed: 0
    };
  }

  normalizeStatusCounts(counts) {
    return {
      success: counts?.success || 0,
      warning: counts?.warning ?? counts?.partial ?? 0,
      failed: counts?.failed || 0
    };
  }

  getRunStatusBucketKey(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'success') return 'success';
    if (normalized === 'partial' || normalized === 'warning') return 'warning';
    if (normalized === 'failed') return 'failed';
    return null;
  }

  getWarningActionCount(actions) {
    if (!actions) return 0;
    return (actions.conflict || 0) + (actions.missing_calendar || 0) + (actions.other || 0);
  }

  getRunWarningCount(record) {
    const baseWarnings = Number.isFinite(record?.warnings_count) ? record.warnings_count : 0;
    const actionWarnings = this.getWarningActionCount(record?.actions);
    if (baseWarnings >= actionWarnings) return baseWarnings;
    return baseWarnings + actionWarnings;
  }

  normalizeMetricsRecord(record) {
    if (!record || typeof record !== 'object') return record;
    const errorsCount = Number.isFinite(record.errors_count) ? record.errors_count : 0;
    const warningsCount = this.getRunWarningCount(record);
    const status = this.getRunStatusFromCounts(errorsCount, warningsCount, record.status);
    return { ...record, warnings_count: warningsCount, status };
  }

  sumActions(actions) {
    if (!actions) return 0;
    return Object.keys(actions).reduce((sum, key) => sum + (actions[key] || 0), 0);
  }

  sumDisplayActions(actions) {
    if (!actions) return 0;
    return (actions.new || 0) + (actions.merge || 0) + (actions.conflict || 0);
  }

  getParserLastRuns(records) {
    const lastRuns = {};
    if (!Array.isArray(records)) return lastRuns;
    records.forEach(record => {
      const parserRecords = Array.isArray(record?.parsers) ? record.parsers : [];
      parserRecords.forEach(parserRecord => {
        if (parserRecord?.parser_name) {
          lastRuns[parserRecord.parser_name] = {
            record,
            parser: parserRecord
          };
        }
      });
    });
    return lastRuns;
  }

  buildParserHistoryMap(records) {
    const history = {};
    if (!Array.isArray(records)) return history;
    records.forEach(record => {
      const parserRecords = Array.isArray(record?.parsers) ? record.parsers : [];
      parserRecords.forEach(parserRecord => {
        const name = parserRecord?.parser_name;
        if (!name) return;
        if (!history[name]) {
          history[name] = {
            runs: 0,
            totals: this.createParserTotals(),
            actions: this.createActionCounts(),
            durationMsTotal: 0,
            statusCounts: this.createStatusCounts()
          };
        }
        const bucket = history[name];
        bucket.runs += 1;
        bucket.durationMsTotal += parserRecord?.duration_ms || 0;
        bucket.totals.total_events += parserRecord?.total_events || 0;
        bucket.totals.raw_bear_events += parserRecord?.raw_bear_events || 0;
        bucket.totals.final_bear_events += parserRecord?.final_bear_events || 0;
        bucket.totals.duplicates_removed += parserRecord?.duplicates_removed || 0;
        const actions = parserRecord?.actions || {};
        Object.keys(bucket.actions).forEach(key => {
          bucket.actions[key] += actions[key] || 0;
        });
        const statusKey = this.getRunStatusBucketKey(record?.status);
        if (statusKey && bucket.statusCounts) {
          bucket.statusCounts[statusKey] = (bucket.statusCounts[statusKey] || 0) + 1;
        }
      });
    });
    return history;
  }

  buildParserErrorCounts(runData, parserNames) {
    const counts = {};
    const errors = Array.isArray(runData?.errors) ? runData.errors : [];
    if (!errors.length) return counts;
    const names = Array.isArray(parserNames) ? parserNames.filter(Boolean) : [];
    if (!names.length) return counts;
    const normalizedErrors = errors.map(error => String(error).toLowerCase());
    names.forEach(name => {
      const needle = String(name).toLowerCase();
      if (!needle) return;
      let matched = 0;
      normalizedErrors.forEach(error => {
        if (error.includes(needle)) matched += 1;
      });
      if (matched > 0) {
        counts[name] = matched;
      }
    });
    return counts;
  }

  buildParserHealth(records, latestRecord, configuredParsers, latestErrorCounts = {}, summary = null) {
    const lastRuns = this.getParserLastRuns(records);
    const historyByParser = this.buildParserHistoryMap(records);
    const latestParserRecords = Array.isArray(latestRecord?.parsers) ? latestRecord.parsers : [];
    const latestParserMap = {};
    latestParserRecords.forEach(record => {
      if (record?.parser_name) {
        latestParserMap[record.parser_name] = record;
      }
    });

    const hasConfig = configuredParsers.length > 0;
    const summaryParsers = summary?.by_parser_name || {};
    const summaryNames = Object.keys(summaryParsers);
    const parserNames = hasConfig
      ? configuredParsers
      : Array.from(new Set([...Object.keys(lastRuns), ...summaryNames]));

    const hasLatestRecord = !!latestRecord;
    const items = parserNames.map(name => {
      const lastRun = lastRuns[name] || null;
      const record = lastRun?.parser || null;
      const actions = record?.actions ? record.actions : this.createActionCounts();
      const totalEvents = record?.total_events || 0;
      const summaryTotals = summaryParsers?.[name]?.totals || null;
      const allTimeRuns = summaryTotals?.runs || 0;
      const allTimeTotals = summaryTotals?.totals || this.createParserTotals();
      const allTimeActions = summaryTotals?.actions || this.createActionCounts();
      const allTimeDurationMs = summaryTotals?.duration_ms_total || 0;
      const historyTotals = historyByParser?.[name]?.totals || this.createParserTotals();
      const historyActions = historyByParser?.[name]?.actions || this.createActionCounts();
      const historyRuns = historyByParser?.[name]?.runs || 0;
      const historyDurationMs = historyByParser?.[name]?.durationMsTotal || 0;
      const ran = !!record || allTimeRuns > 0 || historyRuns > 0;
      const warningCount = this.getWarningActionCount(actions);

      return {
        name,
        parserType: record?.parser_type || null,
        urlCount: record?.url_count || 0,
        ran,
        ranInLatest: !!latestParserMap[name],
        hasLatestRecord,
        totalEvents,
        finalBearEvents: record?.final_bear_events || 0,
        durationMs: record?.duration_ms || null,
        actions,
        warningCount,
        lastRunAt: lastRun?.record?.finished_at || null,
        lastRunId: lastRun?.record?.run_id || null,
        latestErrorCount: latestErrorCounts?.[name] || 0,
        allTimeRuns,
        allTimeTotals,
        allTimeActions,
        allTimeDurationMs,
        historyRuns,
        historyTotals,
        historyActions,
        historyDurationMs
      };
    });

    return {
      hasConfig,
      configuredCount: configuredParsers.length,
      ranCount: latestParserRecords.length,
      items
    };
  }

  buildAllTimeParserRows(records, summary) {
    const historyByParser = this.buildParserHistoryMap(records);
    const summaryParsers = summary?.by_parser_name || {};
    const names = Array.from(new Set([
      ...Object.keys(summaryParsers),
      ...Object.keys(historyByParser)
    ]));
    return names.map(name => {
      const summaryTotals = summaryParsers?.[name]?.totals || null;
      const historyTotals = historyByParser?.[name] || null;
      const actions = summaryTotals?.actions || historyTotals?.actions || this.createActionCounts();
      const runs = Number.isFinite(summaryTotals?.runs) ? summaryTotals.runs : (historyTotals?.runs || 0);
      const statusCounts = this.normalizeStatusCounts(
        summaryTotals?.statuses || historyTotals?.statusCounts || this.createStatusCounts()
      );
      return {
        name,
        actions,
        runs,
        statusCounts
      };
    });
  }

  formatNumber(value) {
    if (!Number.isFinite(value)) return '0';
    return Math.round(value).toLocaleString();
  }

  formatPercent(value, total) {
    if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 'n/a';
    const percent = (value / total) * 100;
    return `${Math.round(percent)}%`;
  }

  formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '0s';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  formatRelativeTime(isoString) {
    if (!isoString) return 'Unknown';
    const time = new Date(isoString).getTime();
    if (!Number.isFinite(time)) return isoString;
    const diffMs = Date.now() - time;
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  formatActions(actions) {
    if (!actions) return 'n/a';
    const parts = [];
    if (actions.new) parts.push(`adds ${actions.new}`);
    if (actions.merge) parts.push(`merges ${actions.merge}`);
    if (actions.conflict) parts.push(`conflicts ${actions.conflict}`);
    if (parts.length === 0) return 'none';
    return parts.join(', ');
  }

  formatActionsCompact(actions) {
    if (!actions) return 'Adds 0 • Merges 0 • Conflicts 0';
    const addCount = actions.new || 0;
    const mergeCount = actions.merge || 0;
    const conflictCount = actions.conflict || 0;
    return `Adds ${addCount} • Merges ${mergeCount} • Conflicts ${conflictCount}`;
  }

  formatActionsIssues(actions) {
    if (!actions) return 'Conflicts 0';
    const conflictCount = actions.conflict || 0;
    return `Conflicts ${conflictCount}`;
  }

  formatLastRunLabel(isoString) {
    if (!isoString) return 'Never';
    return this.formatRelativeTime(isoString);
  }

  formatAllTimeSummary(item, options = {}) {
    const runs = item?.allTimeRuns || 0;
    if (runs <= 0) return 'No historical data';
    const totals = item?.allTimeTotals || {};
    const finalEvents = this.formatNumber(totals.final_bear_events || 0);
    const totalEvents = this.formatNumber(totals.total_events || 0);
    const runLabel = this.formatNumber(runs);
    if (options.compact) {
      return `All-time ${finalEvents} final • ${runLabel} runs`;
    }
    if (options.includeTotal === false) {
      return `All-time final ${finalEvents} • Runs ${runLabel}`;
    }
    return `All-time final ${finalEvents} • Total ${totalEvents} • Runs ${runLabel}`;
  }

  formatHistorySummary(item, options = {}) {
    const runs = item?.historyRuns || 0;
    if (runs <= 0) return 'No recent history';
    const totals = item?.historyTotals || {};
    const finalEvents = this.formatNumber(totals.final_bear_events || 0);
    const totalEvents = this.formatNumber(totals.total_events || 0);
    const runLabel = this.formatNumber(runs);
    if (options.compact) {
      return `Recent ${finalEvents} final • ${runLabel} runs`;
    }
    if (options.includeTotal === false) {
      return `Recent final ${finalEvents} • Runs ${runLabel}`;
    }
    return `Recent final ${finalEvents} • Total ${totalEvents} • Runs ${runLabel}`;
  }

  formatLastRunSummary(item, options = {}) {
    if (!item?.lastRunAt) return 'Last run unknown';
    const finalEvents = this.formatNumber(item?.finalBearEvents || 0);
    const totalEvents = this.formatNumber(item?.totalEvents || 0);
    const when = this.formatLastRunLabel(item.lastRunAt);
    if (options.compact) {
      return `Last ${when} • ${finalEvents} final`;
    }
    return `Last run ${when} • Final ${finalEvents} • Total ${totalEvents}`;
  }

  formatEventSummary(item) {
    if (!item?.ran) return 'No run data';
    if (!item?.lastRunAt) return 'No last run';
    const finalEvents = this.formatNumber(item?.finalBearEvents || 0);
    const totalEvents = this.formatNumber(item?.totalEvents || 0);
    return `Final ${finalEvents} • Total ${totalEvents}`;
  }

  formatRunId(runId) {
    if (!runId) return 'n/a';
    const raw = String(runId);
    if (raw.length <= 8) return raw;
    return `${raw.slice(0, 4)}...${raw.slice(-3)}`;
  }

  buildRunItems(records) {
    if (!Array.isArray(records)) return [];
    return records.map(record => {
      const parsers = Array.isArray(record?.parsers) ? record.parsers : [];
      const parserNames = parsers.map(parser => parser?.parser_name).filter(Boolean);
      const warningsCount = this.getRunWarningCount(record);
      return {
        runId: record?.run_id || null,
        finishedAt: record?.finished_at || null,
        startedAt: record?.started_at || null,
        durationMs: record?.duration_ms || null,
        status: record?.status || null,
        triggerType: record?.trigger_type || null,
        errorsCount: record?.errors_count || 0,
        warningsCount,
        actions: record?.actions ? record.actions : this.createActionCounts(),
        totals: record?.totals || {},
        finalEvents: record?.totals?.final_bear_events || 0,
        totalEvents: record?.totals?.total_events || 0,
        calendarEvents: record?.totals?.calendar_events || 0,
        parsersCount: parsers.length,
        parserNames
      };
    });
  }

  normalizeRunStatusFilter(value) {
    if (!value) return null;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return null;
    if (['success', 'succeeded', 'ok', 'pass'].includes(normalized)) return 'success';
    if (['partial', 'warning', 'warn', 'partial-success'].includes(normalized)) return 'partial';
    if (['failed', 'failure', 'fail', 'error', 'errors'].includes(normalized)) return 'failed';
    if (['issues', 'issue', 'problems', 'problem'].includes(normalized)) return 'issues';
    if (['all', 'any', 'none'].includes(normalized)) return null;
    return null;
  }

  applyRunFilters(items, filters) {
    if (!Array.isArray(items) || !filters) return items || [];
    let filtered = [...items];
    const statusFilter = this.normalizeRunStatusFilter(filters.status);
    const parserFilter = filters.parserFilter ? String(filters.parserFilter).toLowerCase() : null;
    const daysFilter = Number.isFinite(filters.days) ? filters.days : null;

    if (statusFilter) {
      if (statusFilter === 'issues') {
        filtered = filtered.filter(item => (item.errorsCount || 0) > 0 || (item.warningsCount || 0) > 0);
      } else {
        filtered = filtered.filter(item => String(item.status || '').toLowerCase() === statusFilter);
      }
    }

    if (parserFilter) {
      filtered = filtered.filter(item => {
        const names = Array.isArray(item.parserNames) ? item.parserNames : [];
        return names.some(name => String(name).toLowerCase().includes(parserFilter));
      });
    }

    if (daysFilter && daysFilter > 0) {
      const cutoff = Date.now() - (daysFilter * 24 * 60 * 60 * 1000);
      filtered = filtered.filter(item => {
        const time = this.getTimeValue(item.finishedAt);
        return time >= cutoff;
      });
    }

    return filtered;
  }

  formatRunFilterLabel(filters) {
    if (!filters) return 'All Runs';
    const parts = [];
    const statusFilter = this.normalizeRunStatusFilter(filters.status);
    if (statusFilter) {
      const statusLabel = statusFilter === 'issues'
        ? 'Issues'
        : this.formatStatusLabel(statusFilter);
      parts.push(`Status ${statusLabel}`);
    }
    if (filters.parserFilter) {
      parts.push(`Parser "${filters.parserFilter}"`);
    }
    if (Number.isFinite(filters.days) && filters.days > 0) {
      parts.push(`Last ${filters.days}d`);
    }
    return parts.length ? parts.join(' • ') : 'All Runs';
  }

  truncateText(value, maxLength) {
    const raw = String(value || '');
    if (!Number.isFinite(maxLength) || maxLength <= 0) return raw;
    if (raw.length <= maxLength) return raw;
    const head = Math.max(1, maxLength - 3);
    return `${raw.slice(0, head)}...`;
  }

  formatStatusLabel(status) {
    if (!status) return 'Unknown';
    const normalized = String(status).toLowerCase();
    if (normalized === 'partial') return 'Warning';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  getRunStatusFromCounts(errorsCount, warningsCount, fallbackStatus) {
    const errors = Number.isFinite(errorsCount) ? errorsCount : 0;
    const warnings = Number.isFinite(warningsCount) ? warningsCount : 0;
    if (errors > 0) return 'failed';
    if (warnings > 0) return 'partial';
    if (fallbackStatus) return String(fallbackStatus).toLowerCase();
    return 'success';
  }

  getStatusMeta(status) {
    const normalized = (status || '').toLowerCase();
    if (normalized === 'success') {
      return { label: 'Success', color: new Color(BRAND.success) };
    }
    if (normalized === 'partial') {
      return { label: 'Warning', color: new Color(BRAND.warning) };
    }
    if (normalized === 'failed') {
      return { label: 'Failed', color: new Color(BRAND.danger) };
    }
    return { label: this.formatStatusLabel(status), color: new Color(BRAND.textMuted) };
  }

  getRunStatusEmoji(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'success') return '✅';
    if (normalized === 'partial') return '⚠️';
    if (normalized === 'failed') return '❌';
    return '➖';
  }

  getParserStatusKey(item) {
    if (!item) return 'unknown';
    if ((item.latestErrorCount || 0) > 0) return 'failed';
    if (!item.ran) return 'not-run';
    const warningCount = Number.isFinite(item.warningCount)
      ? item.warningCount
      : this.getWarningActionCount(item.actions);
    if (warningCount > 0) return 'warning';
    return 'healthy';
  }

  getParserStatusMeta(item) {
    const key = this.getParserStatusKey(item);
    if (key === 'healthy') {
      return { key, label: 'Healthy', color: new Color(BRAND.success), icon: STATUS_ICONS.healthy, rank: 2 };
    }
    if (key === 'warning') {
      return { key, label: 'Warning', color: new Color(BRAND.warning), icon: STATUS_ICONS.warning, rank: 3 };
    }
    if (key === 'failed') {
      return { key, label: 'Failed', color: new Color(BRAND.danger), icon: STATUS_ICONS.failed, rank: 4 };
    }
    if (key === 'no-events') {
      return { key, label: 'No events', color: new Color(BRAND.textMuted), icon: STATUS_ICONS['no-events'], rank: 2 };
    }
    if (key === 'not-run') {
      return { key, label: 'Not run', color: new Color(BRAND.textMuted), icon: STATUS_ICONS['not-run'], rank: 1 };
    }
    return { key, label: 'Unknown', color: new Color(BRAND.textMuted), icon: STATUS_ICONS['not-run'], rank: 1 };
  }

  getParserStatusEmoji(item) {
    const key = this.getParserStatusKey(item);
    if (key === 'healthy') return '✅';
    if (key === 'warning') return '⚠️';
    if (key === 'failed') return '❌';
    if (key === 'no-events') return '➖';
    if (key === 'not-run') return '⏸️';
    return '➖';
  }

  getParserStatusRank(item) {
    return this.getParserStatusMeta(item).rank || 0;
  }

  getParserStatusCounts(items) {
    const counts = {
      total: 0,
      healthy: 0,
      warning: 0,
      failed: 0,
      notRun: 0,
      running: 0
    };
    if (!Array.isArray(items)) return counts;
    counts.total = items.length;
    items.forEach(item => {
      const key = this.getParserStatusKey(item);
      if (key === 'healthy') {
        counts.healthy += 1;
      } else if (key === 'warning') {
        counts.warning += 1;
      } else if (key === 'failed') {
        counts.failed += 1;
      } else if (key === 'not-run') {
        counts.notRun += 1;
      } else {
        counts.notRun += 1;
      }
    });
    counts.running = Math.max(0, counts.total - counts.notRun);
    return counts;
  }

  getRunHealthSummary(records) {
    const summary = {
      failureStreak: 0,
      lastSuccessAt: null,
      latestStatus: null
    };
    if (!Array.isArray(records) || records.length === 0) return summary;
    let counting = true;
    for (let i = records.length - 1; i >= 0; i -= 1) {
      const record = records[i];
      const errorsCount = Number.isFinite(record?.errors_count) ? record.errors_count : 0;
      const warningsCount = this.getRunWarningCount(record);
      const status = this.getRunStatusFromCounts(errorsCount, warningsCount, record?.status);
      if (summary.latestStatus === null) summary.latestStatus = status;
      if (!summary.lastSuccessAt && status === 'success' && record?.finished_at) {
        summary.lastSuccessAt = record.finished_at;
      }
      if (counting) {
        if (status === 'success') {
          counting = false;
        } else {
          summary.failureStreak += 1;
        }
      }
    }
    return summary;
  }

  getDaysSince(isoString) {
    if (!isoString) return null;
    const time = new Date(isoString).getTime();
    if (!Number.isFinite(time)) return null;
    const diffMs = Date.now() - time;
    if (!Number.isFinite(diffMs)) return null;
    return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
  }

  getWidgetChartSize() {
    const family = this.runtime.widgetFamily || 'medium';
    if (family === 'small') return { width: 120, height: 56 };
    if (family === 'large') return { width: 240, height: 110 };
    return { width: 170, height: 72 };
  }

  getWidgetHistoryLimit() {
    const family = this.runtime.widgetFamily || 'medium';
    if (family === 'small') return 7;
    if (family === 'large') return 14;
    return 10;
  }

  getAppChartSize() {
    return { width: 320, height: 120 };
  }

  getAppHistoryLimit() {
    return 0;
  }

  getWidgetMetricFontSize() {
    const family = this.runtime.widgetFamily || 'medium';
    if (family === 'small') return 18;
    if (family === 'large') return 22;
    return FONT_SIZES.widget.metric;
  }

  getWidgetRowPadding(family) {
    if (family === 'small') return WIDGET_STYLE.rowPaddingCompact;
    return WIDGET_STYLE.rowPadding;
  }

  getWidgetColumnCount(family) {
    if (family === 'small') return 1;
    return 2;
  }

  getWidgetCellPadding(family, columns) {
    if (family === 'small') return WIDGET_STYLE.rowPaddingCompact;
    if (columns > 1) return WIDGET_STYLE.rowPaddingCompact;
    return WIDGET_STYLE.rowPadding;
  }

  addWidgetRow(widget, family) {
    const row = widget.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    row.spacing = WIDGET_STYLE.rowSpacing;
    const alpha = family === 'small' ? WIDGET_STYLE.rowBackgroundAlphaCompact : WIDGET_STYLE.rowBackgroundAlpha;
    row.backgroundColor = new Color(WIDGET_STYLE.rowBackground, alpha);
    row.cornerRadius = WIDGET_STYLE.rowRadius;
    const padding = this.getWidgetRowPadding(family);
    row.setPadding(padding.top, padding.left, padding.bottom, padding.right);
    return row;
  }

  addWidgetCell(container, family, columns) {
    const cell = container.addStack();
    cell.layoutVertically();
    cell.spacing = 2;
    const alpha = family === 'small' ? WIDGET_STYLE.rowBackgroundAlphaCompact : WIDGET_STYLE.rowBackgroundAlpha;
    cell.backgroundColor = new Color(WIDGET_STYLE.rowBackground, alpha);
    cell.cornerRadius = WIDGET_STYLE.rowRadius;
    const padding = this.getWidgetCellPadding(family, columns);
    cell.setPadding(padding.top, padding.left, padding.bottom, padding.right);
    return cell;
  }

  getWidgetBadgeColors(variant) {
    const palette = {
      success: BRAND.success,
      warning: BRAND.warning,
      danger: BRAND.danger,
      neutral: BRAND.neutral || BRAND.textMuted
    };
    const base = palette[variant] || palette.neutral;
    return {
      text: new Color(base),
      background: new Color(base, WIDGET_STYLE.badgeAlpha)
    };
  }

  addWidgetBadge(container, label, variant, options = {}) {
    const colors = this.getWidgetBadgeColors(variant);
    const badge = container.addStack();
    badge.backgroundColor = colors.background;
    badge.cornerRadius = WIDGET_STYLE.badgeRadius;
    const padding = WIDGET_STYLE.badgePadding;
    badge.setPadding(padding.top, padding.left, padding.bottom, padding.right);
    const displayLabel = String(label || '').trim() || 'Unknown';
    const text = badge.addText(displayLabel);
    text.font = Font.boldSystemFont(options.fontSize || FONT_SIZES.widget.small);
    text.textColor = colors.text;
    text.lineLimit = 1;
    return badge;
  }

  getRecentRecords(records, limit) {
    if (!Array.isArray(records) || records.length === 0) return [];
    if (!Number.isFinite(limit) || limit <= 0) return [...records];
    return records.slice(-limit);
  }

  getSeries(records, selector) {
    if (!Array.isArray(records)) return [];
    return records.map(record => {
      const value = selector(record);
      return Number.isFinite(value) ? value : 0;
    });
  }

  getSeriesAverage(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const total = values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
    return total / values.length;
  }

  getParserSeries(records, parserName) {
    if (!Array.isArray(records) || !parserName) return [];
    const series = [];
    records.forEach(record => {
      const parserRecords = Array.isArray(record?.parsers) ? record.parsers : [];
      const match = parserRecords.find(item => item?.parser_name === parserName);
      if (!match) return;
      const value = match?.final_bear_events;
      series.push(Number.isFinite(value) ? value : 0);
    });
    return series;
  }

  getParserDurationSeries(records, parserName) {
    if (!Array.isArray(records) || !parserName) return [];
    const series = [];
    records.forEach(record => {
      const parserRecords = Array.isArray(record?.parsers) ? record.parsers : [];
      const match = parserRecords.find(item => item?.parser_name === parserName);
      if (!match) return;
      series.push(this.getDurationMinutes(match?.duration_ms));
    });
    return series;
  }

  getParserNamesByRecentRuns(records, limit) {
    if (!Array.isArray(records)) return [];
    const counts = {};
    records.forEach(record => {
      const parserRecords = Array.isArray(record?.parsers) ? record.parsers : [];
      parserRecords.forEach(parserRecord => {
        const name = parserRecord?.parser_name;
        if (!name) return;
        counts[name] = (counts[name] || 0) + 1;
      });
    });
    const sorted = Object.keys(counts).sort((a, b) => {
      const diff = (counts[b] || 0) - (counts[a] || 0);
      if (diff !== 0) return diff;
      return String(a).localeCompare(String(b));
    });
    if (!Number.isFinite(limit) || limit <= 0) return sorted;
    return sorted.slice(0, limit);
  }

  getDurationMinutes(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return ms / 60000;
  }

  getTimeValue(isoString) {
    if (!isoString) return 0;
    const time = new Date(isoString).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  sortParserItems(items, sortState) {
    if (!Array.isArray(items)) return [];
    const sortKey = sortState?.key || 'status';
    const direction = sortState?.direction === 'asc' ? 1 : -1;
    const sorted = [...items];
    sorted.sort((a, b) => {
      let diff = 0;
      if (sortKey === 'name') {
        diff = String(a?.name || '').localeCompare(String(b?.name || ''));
      } else if (sortKey === 'events') {
        diff = (a?.finalBearEvents || 0) - (b?.finalBearEvents || 0);
      } else if (sortKey === 'actions') {
        diff = this.sumDisplayActions(a?.actions) - this.sumDisplayActions(b?.actions);
      } else if (sortKey === 'new') {
        diff = (a?.actions?.new || 0) - (b?.actions?.new || 0);
      } else if (sortKey === 'merge') {
        diff = (a?.actions?.merge || 0) - (b?.actions?.merge || 0);
      } else if (sortKey === 'conflict') {
        diff = (a?.actions?.conflict || 0) - (b?.actions?.conflict || 0);
      } else if (sortKey === 'last-run') {
        diff = this.getTimeValue(a?.lastRunAt) - this.getTimeValue(b?.lastRunAt);
      } else if (sortKey === 'duration') {
        diff = (a?.durationMs || 0) - (b?.durationMs || 0);
      } else if (sortKey === 'status') {
        diff = this.getParserStatusRank(a) - this.getParserStatusRank(b);
        if (diff === 0) {
          diff = this.sumDisplayActions(a?.actions) - this.sumDisplayActions(b?.actions);
        }
      }
      if (diff === 0) {
        diff = String(a?.name || '').localeCompare(String(b?.name || ''));
      }
      return diff * direction;
    });
    return sorted;
  }

  sortAggregateParserRows(items, sortState) {
    if (!Array.isArray(items)) return [];
    const sortKey = sortState?.key || 'runs';
    const direction = sortState?.direction === 'asc' ? 1 : -1;
    const sorted = [...items];
    sorted.sort((a, b) => {
      let diff = 0;
      if (sortKey === 'name') {
        diff = String(a?.name || '').localeCompare(String(b?.name || ''));
      } else if (sortKey === 'new') {
        diff = (a?.actions?.new || 0) - (b?.actions?.new || 0);
      } else if (sortKey === 'merge') {
        diff = (a?.actions?.merge || 0) - (b?.actions?.merge || 0);
      } else if (sortKey === 'conflict') {
        diff = (a?.actions?.conflict || 0) - (b?.actions?.conflict || 0);
      } else if (sortKey === 'runs') {
        diff = (a?.runs || 0) - (b?.runs || 0);
      } else if (sortKey === 'success') {
        diff = (a?.statusCounts?.success || 0) - (b?.statusCounts?.success || 0);
      } else if (sortKey === 'warning') {
        diff = (a?.statusCounts?.warning || 0) - (b?.statusCounts?.warning || 0);
      } else if (sortKey === 'failed') {
        diff = (a?.statusCounts?.failed || 0) - (b?.statusCounts?.failed || 0);
      }
      if (diff === 0) {
        diff = String(a?.name || '').localeCompare(String(b?.name || ''));
      }
      return diff * direction;
    });
    return sorted;
  }

  getRunStatusRank(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'failed') return 3;
    if (normalized === 'partial') return 2;
    if (normalized === 'success') return 1;
    return 0;
  }

  sortRunItems(items, sortState) {
    if (!Array.isArray(items)) return [];
    const sortKey = sortState?.key || 'finished';
    const direction = sortState?.direction === 'asc' ? 1 : -1;
    const sorted = [...items];
    sorted.sort((a, b) => {
      let diff = 0;
      if (sortKey === 'run-id') {
        diff = String(a?.runId || '').localeCompare(String(b?.runId || ''));
      } else if (sortKey === 'finished') {
        diff = this.getTimeValue(a?.finishedAt) - this.getTimeValue(b?.finishedAt);
      } else if (sortKey === 'status') {
        diff = this.getRunStatusRank(a?.status) - this.getRunStatusRank(b?.status);
      } else if (sortKey === 'new') {
        diff = (a?.actions?.new || 0) - (b?.actions?.new || 0);
      } else if (sortKey === 'merge') {
        diff = (a?.actions?.merge || 0) - (b?.actions?.merge || 0);
      } else if (sortKey === 'conflict') {
        diff = (a?.actions?.conflict || 0) - (b?.actions?.conflict || 0);
      } else if (sortKey === 'issues') {
        const aIssues = (a?.errorsCount || 0) + (a?.warningsCount || 0);
        const bIssues = (b?.errorsCount || 0) + (b?.warningsCount || 0);
        diff = aIssues - bIssues;
      } else if (sortKey === 'errors') {
        diff = (a?.errorsCount || 0) - (b?.errorsCount || 0);
      } else if (sortKey === 'warnings') {
        diff = (a?.warningsCount || 0) - (b?.warningsCount || 0);
      } else if (sortKey === 'duration') {
        diff = (a?.durationMs || 0) - (b?.durationMs || 0);
      } else if (sortKey === 'final-events') {
        diff = (a?.finalEvents || 0) - (b?.finalEvents || 0);
      } else if (sortKey === 'total-events') {
        diff = (a?.totalEvents || 0) - (b?.totalEvents || 0);
      } else if (sortKey === 'parsers') {
        diff = (a?.parsersCount || 0) - (b?.parsersCount || 0);
      }
      if (diff === 0) {
        diff = this.getTimeValue(a?.finishedAt) - this.getTimeValue(b?.finishedAt);
      }
      return diff * direction;
    });
    return sorted;
  }

  buildLineChartImage(values, size, style = {}) {
    const safeValues = Array.isArray(values) && values.length ? values : [0];
    const chart = new LineChart(size.width, size.height, safeValues, {
      minValue: Number.isFinite(style.minValue) ? style.minValue : 0,
      maxValue: Number.isFinite(style.maxValue) ? style.maxValue : null,
      padding: Number.isFinite(style.padding) ? style.padding : CHART_STYLE.padding
    });

    const lineColor = style.lineColor || new Color(CHART_STYLE.line);
    const fillColor = style.fillColor === null
      ? null
      : (style.fillColor || new Color(CHART_STYLE.line, CHART_STYLE.fillOpacity));
    const logPoints = style.logPoints ?? this.shouldLogChartPoints();

    return chart.getImage({
      lineColor,
      fillColor,
      lineWidth: Number.isFinite(style.lineWidth) ? style.lineWidth : CHART_STYLE.lineWidth,
      showDots: !!style.showDots,
      dotRadius: style.dotRadius,
      dotColor: style.dotColor || lineColor,
      logPoints,
      logLabel: style.logLabel,
      logLimit: style.logLimit
    });
  }

  buildMultiLineChartImage(seriesList, size, style = {}) {
    const safeSeries = Array.isArray(seriesList)
      ? seriesList.filter(series => series && Array.isArray(series.values) && series.values.length)
      : [];
    if (!safeSeries.length) return null;

    const flattened = [];
    safeSeries.forEach(series => {
      series.values.forEach(value => {
        if (Number.isFinite(value)) flattened.push(value);
      });
    });

    const minValue = Number.isFinite(style.minValue) ? style.minValue : 0;
    const maxFromValues = flattened.length ? Math.max(...flattened, minValue) : minValue;
    const maxValue = Number.isFinite(style.maxValue)
      ? style.maxValue
      : (maxFromValues > minValue ? maxFromValues : minValue + 1);
    const padding = Number.isFinite(style.padding) ? style.padding : CHART_STYLE.padding;
    const lineWidth = Number.isFinite(style.lineWidth) ? style.lineWidth : CHART_STYLE.lineWidth;
    const showDots = !!style.showDots;
    const dotRadius = Number.isFinite(style.dotRadius) ? style.dotRadius : 2;
    const logPoints = style.logPoints ?? this.shouldLogChartPoints();

    const ctx = new DrawContext();
    ctx.size = new Size(size.width, size.height);
    ctx.respectScreenScale = true;
    ctx.opaque = false;

    safeSeries.forEach((series, index) => {
      const rawColor = series.color || CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length] || CHART_STYLE.line;
      const lineColor = rawColor instanceof Color ? rawColor : new Color(rawColor);
      const seriesLabel = series.label || series.name || null;
      const logLabel = logPoints
        ? (style.logLabel && seriesLabel ? `${style.logLabel} - ${seriesLabel}` : (style.logLabel || seriesLabel || `Series ${index + 1}`))
        : null;
      const chart = new LineChart(size.width, size.height, series.values, {
        minValue,
        maxValue,
        padding
      });
      const lineImage = chart.getImage({
        lineColor,
        fillColor: null,
        lineWidth,
        showDots,
        dotRadius,
        dotColor: lineColor,
        logPoints,
        logLabel,
        logLimit: style.logLimit
      });
      ctx.drawImageAtPoint(lineImage, new Point(0, 0));
    });

    return ctx.getImage();
  }

  buildStatusDot(color, size = 10) {
    const ctx = new DrawContext();
    ctx.size = new Size(size, size);
    ctx.opaque = false;
    ctx.setFillColor(color);
    ctx.fillEllipse(new Rect(0, 0, size, size));
    return ctx.getImage();
  }

  buildSymbolImage(symbolName, size = 12, color = null) {
    if (!symbolName) return null;
    try {
      const symbol = SFSymbol.named(symbolName);
      if (!symbol) return null;
      symbol.applyFont(Font.systemFont(size));
      if (color) {
        symbol.tintColor = color;
      }
      return symbol.image;
    } catch (_) {
      return null;
    }
  }

  buildStatusIcon(statusMeta, size = 12) {
    const color = statusMeta?.color || new Color(BRAND.textMuted);
    const iconName = statusMeta?.icon || null;
    const image = iconName ? this.buildSymbolImage(iconName, size, color) : null;
    return image || this.buildStatusDot(color, size);
  }

  getParserIconSymbol(item) {
    const parserType = String(item?.parserType || '').toLowerCase();
    const parserName = String(item?.name || '').toLowerCase();
    const haystack = `${parserType} ${parserName}`;
    for (const rule of PARSER_ICON_RULES) {
      if (rule.match.some(match => haystack.includes(match))) {
        return rule.symbol;
      }
    }
    return 'calendar';
  }

  buildScriptableUrl(scriptName, params = {}) {
    const base = `scriptable:///run?scriptName=${encodeURIComponent(scriptName)}`;
    const query = Object.keys(params)
      .filter(key => params[key] !== undefined && params[key] !== null)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    return query ? `${base}&${query}` : base;
  }

  buildWidgetDashboardUrl(view, sortState, runSortState, runFilters) {
    const safeView = view?.mode ? view : { mode: 'parsers' };
    const normalizedMode = this.normalizeViewToken(safeView.mode) || safeView.mode;
    if (normalizedMode === 'runs') {
      const sort = runSortState || this.getDefaultRunSort();
      return this.buildRunListUrl(sort, runFilters || null);
    }
    if (normalizedMode === 'parsers') {
      const sort = sortState || this.getDefaultSortForView(safeView);
      return this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, {
        view: 'parsers',
        sort: sort?.key || null,
        dir: sort?.direction || null
      });
    }
    if (normalizedMode === 'parser') {
      if (safeView.parserName) {
        return this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, { parser: safeView.parserName });
      }
      return this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, { view: 'parsers' });
    }
    return this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, { view: 'parsers' });
  }

  getQueryParams() {
    return this.runtime.queryParameters || {};
  }

  shouldLogChartPoints() {
    if (this.runtime?.runsInWidget) return false;
    const query = this.getQueryParams() || {};
    const raw = query.debugCharts ?? query.debugChart ?? null;
    if (raw !== null && raw !== undefined) {
      const normalized = String(raw).trim().toLowerCase();
      if (!normalized) return false;
      if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
      return true;
    }
    return DEBUG_CHART_POINTS;
  }

  normalizeViewToken(value) {
    if (!value) return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    if (['parsers', 'parser-health', 'parserhealth', 'health', 'recent', 'latest'].includes(raw)) return 'parsers';
    if (['runs', 'run-history', 'history', 'all-runs', 'allruns', 'runlist', 'run-list'].includes(raw)) return 'runs';
    return null;
  }

  parseWidgetParams(param) {
    const payload = {
      view: null,
      parserName: null,
      sortKey: null,
      sortDirection: null,
      status: null,
      parserFilter: null,
      days: null
    };
    if (!param) return payload;
    const raw = String(param).trim();
    if (!raw) return payload;
    const tokens = raw.split(/[|;,&?]+/).map(token => token.trim()).filter(Boolean);
    if (tokens.length === 0) {
      tokens.push(raw);
    }
    tokens.forEach(token => {
      const lower = token.toLowerCase();
      if (lower.startsWith('parser:')) {
        const parserName = token.slice(token.indexOf(':') + 1).trim();
        payload.view = 'parser';
        payload.parserName = parserName || null;
        return;
      }
      if (lower.startsWith('view=')) {
        const viewValue = token.split('=').slice(1).join('=');
        const view = this.normalizeViewToken(viewValue);
        if (view) payload.view = view;
        return;
      }
      if (lower.startsWith('status=')) {
        payload.status = token.split('=').slice(1).join('=').trim();
        return;
      }
      if (lower.startsWith('status:')) {
        payload.status = token.slice(token.indexOf(':') + 1).trim();
        return;
      }
      if (lower.startsWith('parserfilter=')
        || lower.startsWith('parser-filter=')
        || lower.startsWith('runparser=')
        || lower.startsWith('run-parser=')
        || lower.startsWith('filterparser=')
        || lower.startsWith('filter-parser=')) {
        payload.parserFilter = token.split('=').slice(1).join('=').trim();
        return;
      }
      if (lower.startsWith('parserfilter:') || lower.startsWith('parser-filter:')) {
        payload.parserFilter = token.slice(token.indexOf(':') + 1).trim();
        return;
      }
      if (lower.startsWith('days=')) {
        const rawDays = token.split('=').slice(1).join('=').trim();
        const parsedDays = Number.parseInt(rawDays, 10);
        if (Number.isFinite(parsedDays) && parsedDays > 0) {
          payload.days = parsedDays;
        }
        return;
      }
      if (lower.startsWith('days:')) {
        const rawDays = token.slice(token.indexOf(':') + 1).trim();
        const parsedDays = Number.parseInt(rawDays, 10);
        if (Number.isFinite(parsedDays) && parsedDays > 0) {
          payload.days = parsedDays;
        }
        return;
      }
      if (lower.startsWith('sort=')) {
        payload.sortKey = token.split('=').slice(1).join('=').trim();
        return;
      }
      if (lower.startsWith('dir=') || lower.startsWith('direction=')) {
        payload.sortDirection = token.split('=').slice(1).join('=').trim();
        return;
      }
      if (lower === 'asc' || lower === 'desc') {
        payload.sortDirection = lower;
        return;
      }
      const viewToken = this.normalizeViewToken(token);
      if (viewToken) {
        payload.view = viewToken;
      }
    });
    if (!payload.view) {
      payload.view = this.normalizeViewToken(raw);
    }
    return payload;
  }

  parseViewParam(param) {
    const parsed = this.parseWidgetParams(param);
    if (!parsed.view) return null;
    if (parsed.view === 'parser') {
      return parsed.parserName ? { mode: 'parser', parserName: parsed.parserName } : { mode: 'parsers' };
    }
    return { mode: parsed.view };
  }

  parseViewFromQuery(query) {
    if (!query) return null;
    const parserName = query.parser || query.parserName || null;
    if (parserName) {
      return { mode: 'parser', parserName: String(parserName) };
    }
    const viewValue = query.view || query.mode || null;
    const viewToken = this.normalizeViewToken(viewValue);
    return viewToken ? { mode: viewToken } : null;
  }

  normalizeSortKey(value) {
    if (!value) return null;
    const normalized = String(value).toLowerCase().replace(/[^a-z]/g, '');
    if (['name', 'parser'].includes(normalized)) return 'name';
    if (['events', 'finalevents', 'final', 'bear'].includes(normalized)) return 'events';
    if (['actions', 'action', 'activity'].includes(normalized)) return 'actions';
    if (['status', 'health', 'state'].includes(normalized)) return 'status';
    if (['lastrun', 'last', 'run'].includes(normalized)) return 'last-run';
    if (['duration', 'time', 'runtime'].includes(normalized)) return 'duration';
    if (['new', 'add', 'adds', 'added'].includes(normalized)) return 'new';
    if (['merge', 'merged', 'mrg'].includes(normalized)) return 'merge';
    if (['conflict', 'conflicts', 'conf', 'cnf'].includes(normalized)) return 'conflict';
    return null;
  }

  normalizeSortDirection(value) {
    if (!value) return null;
    const normalized = String(value).toLowerCase();
    if (['asc', 'ascending', 'up'].includes(normalized)) return 'asc';
    if (['desc', 'descending', 'down'].includes(normalized)) return 'desc';
    return null;
  }

  getDefaultSortDirection(sortKey) {
    return sortKey === 'name' ? 'asc' : 'desc';
  }

  getDefaultSortForView(view) {
    if (view?.mode === 'parsers') {
      return { key: 'status', direction: 'desc' };
    }
    return null;
  }

  getSortFromQuery(query) {
    if (!query) return null;
    const key = this.normalizeSortKey(query.sort || query.order || query.sortBy || null);
    if (!key) return null;
    const direction = this.normalizeSortDirection(query.dir || query.direction || null);
    return { key, direction: direction || this.getDefaultSortDirection(key) };
  }

  getSortFromParam(param) {
    const parsed = this.parseWidgetParams(param);
    const key = this.normalizeSortKey(parsed.sortKey);
    if (!key) return null;
    const direction = this.normalizeSortDirection(parsed.sortDirection);
    return { key, direction: direction || this.getDefaultSortDirection(key) };
  }

  resolveSort(view) {
    if (!view || view.mode !== 'parsers') return null;
    const fromQuery = this.getSortFromQuery(this.getQueryParams());
    if (fromQuery) return fromQuery;
    const fromParam = this.getSortFromParam(this.runtime.widgetParameter);
    if (fromParam) return fromParam;
    return this.getDefaultSortForView(view);
  }

  normalizeAggregateSortKey(value) {
    if (!value) return null;
    const normalized = String(value).toLowerCase().replace(/[^a-z]/g, '');
    if (['name', 'parser'].includes(normalized)) return 'name';
    if (['new', 'add', 'adds', 'added'].includes(normalized)) return 'new';
    if (['merge', 'merged', 'mrg'].includes(normalized)) return 'merge';
    if (['conflict', 'conflicts', 'conf', 'cnf'].includes(normalized)) return 'conflict';
    if (['runs', 'run'].includes(normalized)) return 'runs';
    if (['success', 'suc'].includes(normalized)) return 'success';
    if (['warning', 'warnings', 'warn', 'partial'].includes(normalized)) return 'warning';
    if (['failed', 'fail'].includes(normalized)) return 'failed';
    return null;
  }

  getDefaultAggregateSort() {
    return { key: 'runs', direction: 'desc' };
  }

  getAggregateSortFromQuery(query) {
    if (!query) return null;
    const key = this.normalizeAggregateSortKey(query.sort || query.order || query.sortBy || null);
    if (!key) return null;
    const direction = this.normalizeSortDirection(query.dir || query.direction || null);
    return { key, direction: direction || this.getDefaultSortDirection(key) };
  }

  getAggregateSortFromParam(param) {
    const parsed = this.parseWidgetParams(param);
    const key = this.normalizeAggregateSortKey(parsed.sortKey);
    if (!key) return null;
    const direction = this.normalizeSortDirection(parsed.sortDirection);
    return { key, direction: direction || this.getDefaultSortDirection(key) };
  }

  resolveAggregateSort(view) {
    if (!view || view.mode !== 'runs') return null;
    const fromQuery = this.getAggregateSortFromQuery(this.getQueryParams());
    if (fromQuery) return fromQuery;
    const fromParam = this.getAggregateSortFromParam(this.runtime.widgetParameter);
    if (fromParam) return fromParam;
    return this.getDefaultAggregateSort();
  }

  normalizeRunSortKey(value) {
    if (!value) return null;
    const normalized = String(value).toLowerCase().replace(/[^a-z]/g, '');
    if (['run', 'runid', 'id'].includes(normalized)) return 'run-id';
    if (['finished', 'finish', 'finishedat', 'date', 'time', 'latest', 'last', 'run'].includes(normalized)) return 'finished';
    if (['status', 'state'].includes(normalized)) return 'status';
    if (['new', 'add', 'adds', 'added'].includes(normalized)) return 'new';
    if (['merge', 'merged', 'mrg'].includes(normalized)) return 'merge';
    if (['conflict', 'conflicts', 'conf', 'cnf'].includes(normalized)) return 'conflict';
    if (['issues', 'issue', 'problems', 'problem'].includes(normalized)) return 'issues';
    if (['errors', 'error'].includes(normalized)) return 'errors';
    if (['warnings', 'warning', 'warn'].includes(normalized)) return 'warnings';
    if (['duration', 'runtime', 'length'].includes(normalized)) return 'duration';
    if (['finalevents', 'finalevent', 'final', 'bear', 'events'].includes(normalized)) return 'final-events';
    if (['totalevents', 'total', 'all'].includes(normalized)) return 'total-events';
    if (['parsers', 'parser', 'parsercount'].includes(normalized)) return 'parsers';
    return null;
  }

  getDefaultRunSortDirection(sortKey) {
    if (sortKey === 'finished') return 'desc';
    if (sortKey === 'status') return 'desc';
    return 'desc';
  }

  getDefaultRunSort() {
    return { key: 'finished', direction: 'desc' };
  }

  getRunSortFromQuery(query) {
    if (!query) return null;
    const key = this.normalizeRunSortKey(query.sort || query.order || query.sortBy || null);
    if (!key) return null;
    const direction = this.normalizeSortDirection(query.dir || query.direction || null);
    return { key, direction: direction || this.getDefaultRunSortDirection(key) };
  }

  getRunSortFromParam(param) {
    const parsed = this.parseWidgetParams(param);
    const key = this.normalizeRunSortKey(parsed.sortKey);
    if (!key) return null;
    const direction = this.normalizeSortDirection(parsed.sortDirection);
    return { key, direction: direction || this.getDefaultRunSortDirection(key) };
  }

  resolveRunSort(view) {
    if (!view || view.mode !== 'runs') return null;
    const fromQuery = this.getRunSortFromQuery(this.getQueryParams());
    if (fromQuery) return fromQuery;
    const fromParam = this.getRunSortFromParam(this.runtime.widgetParameter);
    if (fromParam) return fromParam;
    return this.getDefaultRunSort();
  }

  getRunFiltersFromQuery(query) {
    if (!query) return {};
    const status = this.normalizeRunStatusFilter(query.status || query.runStatus || query.state || null);
    const parserFilter = query.parserFilter || query.runParser || query.parserContains || query.filterParser || null;
    const rawDays = query.days || query.lastDays || query.sinceDays || null;
    const parsedDays = rawDays ? Number.parseInt(rawDays, 10) : null;
    return {
      status,
      parserFilter: parserFilter ? String(parserFilter).trim() : null,
      days: Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : null
    };
  }

  getRunFiltersFromParam(param) {
    const parsed = this.parseWidgetParams(param);
    return {
      status: this.normalizeRunStatusFilter(parsed.status),
      parserFilter: parsed.parserFilter ? String(parsed.parserFilter).trim() : null,
      days: Number.isFinite(parsed.days) && parsed.days > 0 ? parsed.days : null
    };
  }

  resolveRunFilters(view) {
    if (!view || view.mode !== 'runs') return null;
    const fromParam = this.getRunFiltersFromParam(this.runtime.widgetParameter);
    const fromQuery = this.getRunFiltersFromQuery(this.getQueryParams());
    return {
      ...fromParam,
      ...fromQuery
    };
  }

  async resolveView() {
    const queryView = this.parseViewFromQuery(this.getQueryParams());
    if (queryView) return queryView;
    const paramView = this.parseViewParam(this.runtime.widgetParameter);
    if (paramView) return paramView;
    if (this.runtime.runsInWidget) return { mode: 'parsers' };
    return { mode: 'parsers' };
  }

  getWidgetMaxRows() {
    const family = this.runtime.widgetFamily || 'medium';
    if (family === 'small') return 3;
    if (family === 'large') return 8;
    return 5;
  }

  getCompactSortLabel(sortState) {
    if (!sortState?.key) return null;
    const options = this.getParserSortOptions();
    const match = options.find(option => option.key === sortState.key);
    const label = match ? match.label : sortState.key;
    return label.replace(/\s*\(.*?\)\s*/g, '').trim();
  }

  getWidgetViewLabel(view) {
    if (!view) return 'Parser Health';
    if (view.mode === 'parser') {
      return view.parserName ? `Parser ${view.parserName}` : 'Parser Detail';
    }
    if (view.mode === 'parsers') return 'Parser Health';
    if (view.mode === 'runs') return 'All Runs';
    return 'Parser Health';
  }

  getWidgetHeaderText(context, view, sortState) {
    if (view?.mode === 'parsers') return 'Parser Health';
    if (view?.mode === 'runs') return 'All Runs';
    if (view?.mode === 'parser') {
      return view.parserName ? `Parser ${view.parserName}` : 'Parser Detail';
    }
    return 'Parser Health';
  }

  addWidgetHeader(widget, logoImage, headerText) {
    const family = this.runtime.widgetFamily || 'medium';
    const header = widget.addStack();
    header.centerAlignContent();
    header.spacing = family === 'small' ? 4 : 6;
    if (logoImage) {
      const image = header.addImage(logoImage);
      const size = family === 'small' ? 20 : 24;
      image.imageSize = new Size(size, size);
    }
    const title = header.addText(headerText || (family === 'small' ? 'Metrics' : 'Chunky Dad Metrics'));
    title.font = Font.boldSystemFont(family === 'small' ? FONT_SIZES.widget.small : FONT_SIZES.widget.label);
    title.textColor = new Color(BRAND.text);
    title.lineLimit = 1;
    widget.addSpacer(family === 'small' ? 4 : 6);
  }

  renderWidgetDashboard(widget, context) {
    const latest = context.latest;
    const recentRecords = context.recentRecords;
    const chartSize = context.chartSize;
    const family = this.runtime.widgetFamily || 'medium';

    const finalEvents = latest?.totals?.final_bear_events || 0;
    const calendarEvents = latest?.totals?.calendar_events || 0;
    const statusMeta = this.getStatusMeta(latest?.status);
    const series = this.getSeries(recentRecords, record => record?.totals?.final_bear_events || 0);
    const chartImage = this.buildLineChartImage(series, chartSize, {
      lineColor: new Color(CHART_STYLE.line),
      fillColor: new Color(CHART_STYLE.line, CHART_STYLE.fillOpacity)
    });

    if (family === 'small') {
      const value = widget.addText(this.formatNumber(finalEvents));
      value.font = Font.boldSystemFont(this.getWidgetMetricFontSize());
      value.textColor = new Color(BRAND.text);

      const label = widget.addText('Final events');
      label.font = Font.systemFont(FONT_SIZES.widget.label);
      label.textColor = new Color(BRAND.textMuted);

      widget.addSpacer(4);
      const chart = widget.addImage(chartImage);
      chart.imageSize = new Size(chartSize.width, chartSize.height);

      widget.addSpacer(4);
      const statusLine = widget.addText(`${statusMeta.label} • ${this.formatDuration(latest?.duration_ms)}`);
      statusLine.font = Font.systemFont(FONT_SIZES.widget.small);
      statusLine.textColor = statusMeta.color;
      return;
    }

    const mainStack = widget.addStack();
    mainStack.layoutHorizontally();
    mainStack.spacing = 10;

    const left = mainStack.addStack();
    left.layoutVertically();
    left.spacing = 2;

    const value = left.addText(this.formatNumber(finalEvents));
    value.font = Font.boldSystemFont(this.getWidgetMetricFontSize());
    value.textColor = new Color(BRAND.text);

    const label = left.addText('Final events');
    label.font = Font.systemFont(FONT_SIZES.widget.label);
    label.textColor = new Color(BRAND.textMuted);

    const statusLine = left.addText(`${statusMeta.label} • ${this.formatDuration(latest?.duration_ms)}`);
    statusLine.font = Font.systemFont(FONT_SIZES.widget.small);
    statusLine.textColor = statusMeta.color;

    const issues = left.addText(`Err ${latest?.errors_count || 0} • Warn ${latest?.warnings_count || 0}`);
    issues.font = Font.systemFont(FONT_SIZES.widget.small);
    issues.textColor = new Color(BRAND.textMuted);

    const calendarLine = left.addText(`Calendar ${this.formatNumber(calendarEvents)}`);
    calendarLine.font = Font.systemFont(FONT_SIZES.widget.small);
    calendarLine.textColor = new Color(BRAND.textMuted);

    mainStack.addSpacer();
    const chartStack = mainStack.addStack();
    const chart = chartStack.addImage(chartImage);
    chart.imageSize = new Size(chartSize.width, chartSize.height);

    if (family === 'large') {
      widget.addSpacer(6);
      const durationSeries = this.getSeries(recentRecords, record => this.getDurationMinutes(record?.duration_ms));
      const durationChart = this.buildLineChartImage(durationSeries, { width: chartSize.width, height: 48 }, {
        lineColor: new Color(CHART_STYLE.lineSecondary),
        fillColor: new Color(CHART_STYLE.lineSecondary, CHART_STYLE.fillOpacity)
      });
      const durationLabel = widget.addText('Duration (minutes)');
      durationLabel.font = Font.systemFont(FONT_SIZES.widget.small);
      durationLabel.textColor = new Color(BRAND.textMuted);
      const durationImage = widget.addImage(durationChart);
      durationImage.imageSize = new Size(chartSize.width, 48);
    }
  }

  renderWidgetParserHealth(widget, context) {
    const parserHealth = context.parserHealth;
    const sortState = context.sortState;
    const family = this.runtime.widgetFamily || 'medium';
    const latestRunId = context.latest?.run_id || null;

    const columns = this.getWidgetColumnCount(family);
    const maxRows = this.getWidgetMaxRows();
    const sortedItems = this.sortParserItems(parserHealth.items, sortState);
    const items = sortedItems.slice(0, maxRows * columns);
    const nameLimit = family === 'small' ? 14 : (family === 'large' ? 20 : 16);
    const showDetails = family === 'large';

    for (let index = 0; index < items.length; index += columns) {
      if (index > 0) widget.addSpacer(4);
      const row = widget.addStack();
      row.layoutHorizontally();
      row.spacing = WIDGET_STYLE.rowSpacing;

      for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
        const item = items[index + columnIndex];
        if (!item) {
          row.addSpacer();
          continue;
        }
        const statusMeta = this.getParserStatusMeta(item);
        const cell = this.addWidgetCell(row, family, columns);
        const runId = item?.lastRunId || latestRunId;
        if (runId) {
          cell.url = this.buildScriptableUrl(DISPLAY_SAVED_RUN_SCRIPT, {
            runId,
            readOnly: true
          });
        }

        const header = cell.addStack();
        header.layoutHorizontally();
        header.centerAlignContent();
        header.spacing = 4;

        const iconSymbol = this.getParserIconSymbol(item);
        const iconImage = this.buildSymbolImage(iconSymbol, 11, new Color(BRAND.textSoft));
        if (iconImage) {
          const icon = header.addImage(iconImage);
          icon.imageSize = new Size(11, 11);
        }

        const name = header.addText(this.truncateText(item.name, nameLimit));
        name.font = Font.boldSystemFont(FONT_SIZES.widget.small);
        name.textColor = new Color(BRAND.text);
        name.lineLimit = 1;

        header.addSpacer();

        const statusIcon = this.buildStatusIcon(statusMeta, 11);
        if (statusIcon) {
          const statusImage = header.addImage(statusIcon);
          statusImage.imageSize = new Size(11, 11);
        }

        const actions = item.actions || this.createActionCounts();
        const issuesCount = item.latestErrorCount || 0;
        const lastRunLabel = this.formatLastRunLabel(item?.lastRunAt);
        const summaryLabel = `➕${this.formatNumber(actions.new || 0)} 🔀${this.formatNumber(actions.merge || 0)} ⚠️${this.formatNumber(actions.conflict || 0)}`;
        const summaryRow = cell.addStack();
        summaryRow.layoutHorizontally();
        summaryRow.centerAlignContent();
        const summary = summaryRow.addText(summaryLabel);
        summary.font = Font.systemFont(FONT_SIZES.widget.small);
        summary.textColor = new Color(BRAND.textMuted);
        summary.lineLimit = 1;
        summaryRow.addSpacer();
        const lastRun = summaryRow.addText(lastRunLabel);
        lastRun.font = Font.systemFont(FONT_SIZES.widget.small);
        lastRun.textColor = new Color(BRAND.textMuted);
        lastRun.lineLimit = 1;

        if (showDetails && issuesCount > 0) {
          cell.addSpacer(2);
          const issues = cell.addText(`Issues ${issuesCount}`);
          issues.font = Font.systemFont(FONT_SIZES.widget.small);
          issues.textColor = new Color(BRAND.textMuted);
          issues.lineLimit = 1;
        }
      }
    }

    if (parserHealth.items.length > items.length) {
      const more = widget.addText(`+${parserHealth.items.length - items.length} more`);
      more.font = Font.systemFont(FONT_SIZES.widget.small);
      more.textColor = new Color(BRAND.textMuted);
    }
  }

  renderWidgetParserDetail(widget, context, view) {
    const parserHealth = context.parserHealth;
    const recentRecords = context.recentRecords;
    const chartSize = context.chartSize;
    const record = parserHealth.items.find(item => item.name === view.parserName);
    const family = this.runtime.widgetFamily || 'medium';

    const title = widget.addText(`Parser: ${view.parserName}`);
    title.font = Font.boldSystemFont(FONT_SIZES.widget.label);
    title.textColor = new Color(BRAND.text);
    widget.addSpacer(4);

    if (recentRecords.length > 0) {
      const series = this.getParserSeries(recentRecords, view.parserName);
      if (series.length > 0) {
        const chartImage = this.buildLineChartImage(series, chartSize, {
          lineColor: new Color(CHART_STYLE.lineSecondary),
          fillColor: new Color(CHART_STYLE.lineSecondary, CHART_STYLE.fillOpacity)
        });
        const chart = widget.addImage(chartImage);
        chart.imageSize = new Size(chartSize.width, chartSize.height);
        widget.addSpacer(4);
      }
    }

    const hasAllTime = (record?.allTimeRuns || 0) > 0;
    const hasHistory = (record?.historyRuns || 0) > 0;
    const hasLastRun = !!record?.lastRunAt;

    if (!record || (!record.ran && !hasAllTime && !hasHistory)) {
      const none = widget.addText('No parser metrics yet.');
      none.font = Font.systemFont(FONT_SIZES.widget.small);
      none.textColor = new Color(BRAND.text);
      return;
    }

    if (hasAllTime) {
      const allTime = widget.addText(this.formatAllTimeSummary(record, {
        compact: family === 'small',
        includeTotal: family !== 'small'
      }));
      allTime.font = Font.systemFont(FONT_SIZES.widget.label);
      allTime.textColor = new Color(BRAND.text);
    } else if (hasHistory) {
      const recent = widget.addText(this.formatHistorySummary(record, {
        compact: family === 'small',
        includeTotal: family !== 'small'
      }));
      recent.font = Font.systemFont(FONT_SIZES.widget.label);
      recent.textColor = new Color(BRAND.text);
    } else {
      const summaryMissing = widget.addText('History summary unavailable.');
      summaryMissing.font = Font.systemFont(FONT_SIZES.widget.small);
      summaryMissing.textColor = new Color(BRAND.textMuted);
    }

    const lastRunLabel = hasLastRun
      ? this.formatLastRunSummary(record, { compact: family === 'small' })
      : 'No recent run data.';
    const lastRun = widget.addText(lastRunLabel);
    lastRun.font = Font.systemFont(FONT_SIZES.widget.small);
    lastRun.textColor = new Color(BRAND.textMuted);

    if (family !== 'small') {
      const durationMs = hasLastRun
        ? record.durationMs
        : (hasAllTime && record.allTimeRuns > 0 ? Math.round(record.allTimeDurationMs / record.allTimeRuns) : null)
          || (hasHistory && record.historyRuns > 0 ? Math.round(record.historyDurationMs / record.historyRuns) : null);
      if (durationMs) {
        const durationLabel = hasLastRun ? 'Duration' : 'Avg duration';
        const duration = widget.addText(`${durationLabel}: ${this.formatDuration(durationMs)}`);
        duration.font = Font.systemFont(FONT_SIZES.widget.small);
        duration.textColor = new Color(BRAND.textMuted);
      }

      const actionSource = hasLastRun
        ? record.actions
        : (hasAllTime ? record.allTimeActions : record.historyActions);
      const actions = widget.addText(`Actions: ${this.formatActions(actionSource)}`);
      actions.font = Font.systemFont(FONT_SIZES.widget.small);
      actions.textColor = new Color(BRAND.textMuted);
    }
  }

  renderWidgetRuns(widget, context) {
    const runItems = Array.isArray(context.runItems) ? context.runItems : [];
    const runSortState = context.runSortState || this.getDefaultRunSort();
    const runFilters = context.runFilters || null;
    const family = this.runtime.widgetFamily || 'medium';

    const title = widget.addText('All Runs');
    title.font = Font.boldSystemFont(FONT_SIZES.widget.label);
    title.textColor = new Color(BRAND.text);
    widget.addSpacer(4);

    if (runFilters && (runFilters.status || runFilters.parserFilter || runFilters.days)) {
      const filterLine = widget.addText(this.formatRunFilterLabel(runFilters));
      filterLine.font = Font.systemFont(FONT_SIZES.widget.small);
      filterLine.textColor = new Color(BRAND.textMuted);
    }

    if (runSortState && family !== 'small') {
      const sortLabel = widget.addText(`Sort ${this.getRunSortLabel(runSortState)}`);
      sortLabel.font = Font.systemFont(FONT_SIZES.widget.small);
      sortLabel.textColor = new Color(BRAND.textMuted);
      widget.addSpacer(2);
    }

    const filtered = this.applyRunFilters(runItems, runFilters);
    const sorted = this.sortRunItems(filtered, runSortState);
    const columns = this.getWidgetColumnCount(family);
    const maxRows = this.getWidgetMaxRows();
    const items = sorted.slice(0, maxRows * columns);

    if (items.length === 0) {
      const none = widget.addText('No runs match filters.');
      none.font = Font.systemFont(FONT_SIZES.widget.small);
      none.textColor = new Color(BRAND.text);
      return;
    }

    for (let index = 0; index < items.length; index += columns) {
      if (index > 0) widget.addSpacer(4);
      const row = widget.addStack();
      row.layoutHorizontally();
      row.spacing = WIDGET_STYLE.rowSpacing;

      for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
        const run = items[index + columnIndex];
        if (!run) {
          row.addSpacer();
          continue;
        }
        const statusMeta = this.getStatusMeta(run.status);
        const cell = this.addWidgetCell(row, family, columns);
        if (run.runId) {
          cell.url = this.buildScriptableUrl(DISPLAY_SAVED_RUN_SCRIPT, {
            runId: run.runId,
            readOnly: true
          });
        }

        const header = cell.addStack();
        header.layoutHorizontally();
        header.centerAlignContent();
        header.spacing = 4;

        const titleLine = header.addText(this.formatRunId(run.runId));
        titleLine.font = Font.boldSystemFont(FONT_SIZES.widget.small);
        titleLine.textColor = new Color(BRAND.text);
        titleLine.lineLimit = 1;

        header.addSpacer();

        const statusIcon = this.buildStatusIcon(statusMeta, 11);
        if (statusIcon) {
          const statusImage = header.addImage(statusIcon);
          statusImage.imageSize = new Size(11, 11);
        }

        const finalLabel = this.formatNumber(run.finalEvents || 0);
        const errors = run.errorsCount || 0;
        const warnings = run.warningsCount || 0;
        const issuesTotal = errors + warnings;
        const summaryParts = [`Final ${finalLabel}`];
        if (issuesTotal > 0) {
          summaryParts.push(`Issues ${issuesTotal}`);
        } else if (run.finishedAt) {
          summaryParts.push(this.formatLastRunLabel(run.finishedAt));
        }
        const summary = cell.addText(summaryParts.join(' • '));
        summary.font = Font.systemFont(FONT_SIZES.widget.small);
        summary.textColor = new Color(BRAND.textMuted);
        summary.lineLimit = 1;

        if (family === 'large') {
          const metaParts = [];
          if (run.parsersCount) metaParts.push(`Parsers ${run.parsersCount}`);
          if (run.durationMs) metaParts.push(this.formatDuration(run.durationMs));
          metaParts.push(`Finished ${this.formatLastRunLabel(run.finishedAt)}`);
          const metaLine = cell.addText(metaParts.join(' • '));
          metaLine.font = Font.systemFont(FONT_SIZES.widget.small);
          metaLine.textColor = new Color(BRAND.textMuted);
          metaLine.lineLimit = 1;
        }
      }
    }

    if (filtered.length > items.length) {
      const more = widget.addText(`+${filtered.length - items.length} more`);
      more.font = Font.systemFont(FONT_SIZES.widget.small);
      more.textColor = new Color(BRAND.textMuted);
    }
  }

  renderWidgetAggregate(widget, context) {
    const summary = context.summary;

    if (!summary?.totals) {
      const message = widget.addText('No summary metrics yet.');
      message.font = Font.systemFont(FONT_SIZES.widget.label);
      message.textColor = new Color(BRAND.text);
      return;
    }

    const totals = summary.totals;
    const statusCounts = this.normalizeStatusCounts(totals.statuses);
    const actions = totals.actions || this.createActionCounts();
    const runs = totals.runs || 0;
    const parserCount = Array.isArray(context?.parserHealth?.items) ? context.parserHealth.items.length : 0;
    const successPercent = this.formatPercent(statusCounts.success || 0, runs);
    const warningPercent = this.formatPercent(statusCounts.warning || 0, runs);
    const failedPercent = this.formatPercent(statusCounts.failed || 0, runs);
    const runsLine = `Runs ${this.formatNumber(runs)} • Parsers ${this.formatNumber(parserCount)}`;
    const runsText = widget.addText(runsLine);
    runsText.font = Font.systemFont(FONT_SIZES.widget.label);
    runsText.textColor = new Color(BRAND.text);

    const statusLine = [
      `Success ${this.formatNumber(statusCounts.success || 0)} (${successPercent})`,
      `Warnings ${this.formatNumber(statusCounts.warning || 0)} (${warningPercent})`,
      `Failed ${this.formatNumber(statusCounts.failed || 0)} (${failedPercent})`
    ].join(' • ');
    const statusText = widget.addText(statusLine);
    statusText.font = Font.systemFont(FONT_SIZES.widget.small);
    statusText.textColor = new Color(BRAND.textMuted);

    const actionsLine = `Adds ${this.formatNumber(actions.new || 0)} • Merges ${this.formatNumber(actions.merge || 0)} • Conflicts ${this.formatNumber(actions.conflict || 0)}`;
    const actionsText = widget.addText(actionsLine);
    actionsText.font = Font.systemFont(FONT_SIZES.widget.small);
    actionsText.textColor = new Color(BRAND.textMuted);
  }

  async renderWidget(data, view) {
    const widget = new ListWidget();
    widget.backgroundColor = new Color(BRAND.primary);
    widget.setPadding(12, 12, 12, 12);

    const normalizedMode = this.normalizeViewToken(view?.mode) || view?.mode || 'parsers';
    const normalizedView = view?.mode ? { ...view, mode: normalizedMode } : { mode: normalizedMode };

    const logoImage = await this.loadLogoImage();

    const latest = data.latestRecord;
    const summary = data.summary;
    const parserHealth = data.parserHealth;
    const records = Array.isArray(data.records) ? data.records : [];
    const allTimeParserRows = summary ? this.buildAllTimeParserRows(records, summary) : [];
    const sortState = data.sortState || this.resolveSort(view);
    const runSortState = data.runSortState || this.resolveRunSort(view);
    const runFilters = data.runFilters || this.resolveRunFilters(view);
    const runItems = Array.isArray(data.runItems) ? data.runItems : this.buildRunItems(records);
    const recentRecords = this.getRecentRecords(records, this.getWidgetHistoryLimit());
    const chartSize = this.getWidgetChartSize();
    const widgetUrl = this.buildWidgetDashboardUrl(normalizedView, sortState, runSortState, runFilters);
    const headerText = this.getWidgetHeaderText({ latest, parserHealth }, normalizedView, sortState);
    this.addWidgetHeader(widget, logoImage, headerText);

    if (!latest && normalizedView.mode !== 'runs') {
      const message = widget.addText('No metrics found yet.');
      message.font = Font.systemFont(FONT_SIZES.widget.label);
      message.textColor = new Color(BRAND.text);
      if (widgetUrl) widget.url = widgetUrl;
      return widget;
    }
    if (normalizedView.mode === 'runs' && runItems.length === 0) {
      const message = widget.addText('No run metrics yet.');
      message.font = Font.systemFont(FONT_SIZES.widget.label);
      message.textColor = new Color(BRAND.text);
      if (widgetUrl) widget.url = widgetUrl;
      return widget;
    }

    const context = {
      latest,
      summary,
      parserHealth,
      records,
      recentRecords,
      chartSize,
      sortState,
      runSortState,
      runFilters,
      runItems
    };

    if (normalizedView.mode === 'parsers') {
      this.renderWidgetParserHealth(widget, context);
    } else if (normalizedView.mode === 'runs') {
      this.renderWidgetRuns(widget, context);
    } else if (normalizedView.mode === 'parser') {
      this.renderWidgetParserDetail(widget, context, normalizedView);
    } else {
      this.renderWidgetParserHealth(widget, context);
    }

    if (widgetUrl) widget.url = widgetUrl;

    return widget;
  }

  escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  imageToDataUri(image) {
    if (!image) return null;
    try {
      const data = Data.fromPNG(image);
      return `data:image/png;base64,${data.toBase64String()}`;
    } catch (_) {
      return null;
    }
  }

  getRunStatusBadgeClass(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'success') return 'success';
    if (normalized === 'partial') return 'warning';
    if (normalized === 'failed') return 'danger';
    return 'neutral';
  }

  getParserStatusBadgeClass(statusKey) {
    if (statusKey === 'healthy') return 'success';
    if (statusKey === 'warning') return 'warning';
    if (statusKey === 'failed') return 'danger';
    return 'neutral';
  }

  async renderAppHtml(data, view, sortState) {
    const html = await this.buildAppHtml(data, view, sortState);
    await WebView.loadHTML(html, null, null, true);
  }

  async buildAppHtml(data, view, sortState) {
    const latest = data.latestRecord;
    const summary = data.summary;
    const parserHealth = data.parserHealth || {};
    const parserItems = Array.isArray(parserHealth.items) ? parserHealth.items : [];
    const records = Array.isArray(data.records) ? data.records : [];
    const allTimeParserRows = summary ? this.buildAllTimeParserRows(records, summary) : [];
    const parserSort = sortState || data.sortState || this.resolveSort(view);
    const parserSortResolved = parserSort || this.getDefaultSortForView({ mode: 'parsers' });
    const runSortState = data.runSortState || this.resolveRunSort(view);
    const runSortResolved = runSortState || this.getDefaultRunSort();
    const aggregateSortState = data.aggregateSortState || this.resolveAggregateSort(view);
    const aggregateSortResolved = aggregateSortState || this.getDefaultAggregateSort();
    const runFilters = data.runFilters || this.resolveRunFilters(view);
    const runItems = Array.isArray(data.runItems) ? data.runItems : this.buildRunItems(records);
    const filteredRuns = this.applyRunFilters(runItems, runFilters);
    const sortedRuns = this.sortRunItems(filteredRuns, runSortResolved);
    const recentRecords = this.getRecentRecords(records, this.getAppHistoryLimit());
    const chartSize = this.getAppChartSize();
    const safeView = view?.mode ? view : { mode: 'parsers' };
    const viewMode = this.normalizeViewToken(safeView.mode) || safeView.mode;
    const initialParserName = viewMode === 'parser' ? (safeView.parserName || '') : '';

    const escapeHtml = value => this.escapeHtml(value);

    const buildLink = (label, url, className = '', dataAttrs = '') => {
      const classes = className ? ` class="${className}"` : '';
      const extra = dataAttrs ? ` ${dataAttrs.trim()}` : '';
      return `<a${classes} href="${escapeHtml(url)}"${extra}>${escapeHtml(label)}</a>`;
    };

    const buildChip = (label, url, isActive = false, dataAttrs = '') => {
      const className = `chip${isActive ? ' active' : ''}`;
      return buildLink(label, url, className, dataAttrs);
    };

    const buildNavAttributes = (viewTarget, parserTarget, isTab = false) => {
      if (!viewTarget) return '';
      const attrs = [`data-nav-view="${escapeHtml(viewTarget)}"`];
      if (parserTarget) {
        attrs.push(`data-nav-parser="${escapeHtml(parserTarget)}"`);
      }
      if (isTab) {
        attrs.push('data-nav-tab="true"');
      }
      return attrs.join(' ');
    };

    const buildBadge = (label, variant) => `<span class="badge ${variant}">${escapeHtml(label)}</span>`;
    const buildMetricChip = (label, value, variant = '') => {
      const variantClass = variant ? ` ${variant}` : '';
      return `<span class="metric-chip${variantClass}"><span class="metric-chip-label">${escapeHtml(label)}</span><span class="metric-chip-value">${escapeHtml(value)}</span></span>`;
    };

    const buildMetric = (label, value, subvalue = null) => `
      <div class="metric">
        <div class="metric-value">
          ${escapeHtml(value)}
          ${subvalue ? `<span class="metric-subvalue">${escapeHtml(subvalue)}</span>` : ''}
        </div>
        <div class="metric-label">${escapeHtml(label)}</div>
      </div>`;

    const buildSortHeader = (label, key, sortState, viewKey, defaultDirection, extraClass = '') => {
      if (!key) {
        const className = extraClass ? ` class="${extraClass}"` : '';
        return `<th${className}>${escapeHtml(label)}</th>`;
      }
      const safeDefaultDir = defaultDirection || 'desc';
      const isActive = sortState?.key === key;
      const direction = isActive && sortState?.direction === 'asc' ? 'asc' : 'desc';
      const nextDirection = isActive ? (direction === 'asc' ? 'desc' : 'asc') : safeDefaultDir;
      const arrow = isActive ? (direction === 'asc' ? '▲' : '▼') : '';
      const classes = ['sortable', extraClass].filter(Boolean).join(' ');
      const dataAttrs = [
        `data-sort-view="${escapeHtml(viewKey)}"`,
        `data-sort-key="${escapeHtml(key)}"`,
        `data-sort-dir="${escapeHtml(nextDirection)}"`,
        `data-sort-default-dir="${escapeHtml(safeDefaultDir)}"`,
        `data-sort-label="${escapeHtml(label)}"`
      ].join(' ');
      return `
        <th class="${classes}">
          <button class="sort-button${isActive ? ' active' : ''}" type="button" ${dataAttrs}>
            <span class="sort-label">${escapeHtml(label)}</span>
            <span class="sort-arrow">${arrow}</span>
          </button>
        </th>`;
    };

    const buildSection = (title, body, subtitleHtml) => `
      <div class="card">
        <div class="section-title">${escapeHtml(title)}</div>
        ${subtitleHtml ? `<div class="section-subtitle">${subtitleHtml}</div>` : ''}
        ${body}
      </div>`;

    const buildEmptyCard = (title, subtitle) => buildSection(
      title,
      subtitle ? `<div class="muted">${escapeHtml(subtitle)}</div>` : '',
      null
    );

    const buildChartLegend = seriesList => {
      if (!Array.isArray(seriesList) || seriesList.length === 0) return '';
      const items = seriesList.map(item => {
        const label = item?.label || item?.name || '';
        const color = item?.color || CHART_STYLE.line;
        if (!label) return '';
        return `
          <span class="chart-legend-item">
            <span class="chart-swatch" style="background:${escapeHtml(color)}"></span>
            ${escapeHtml(label)}
          </span>`;
      }).filter(Boolean).join('');
      if (!items) return '';
      return `<div class="chart-legend">${items}</div>`;
    };

    const buildChartCard = (title, imageData, subtitle, options = {}) => {
      if (!imageData) return '';
      const xLabel = options.xLabel || '';
      const yLabel = options.yLabel || '';
      const legendHtml = options.legendHtml || '';
      return `
      <div class="card">
        <div class="section-title">${escapeHtml(title)}</div>
        <div class="chart-wrapper">
          <div class="chart-axis-y">${escapeHtml(yLabel)}</div>
          <div class="chart-axis-main">
            <img class="chart" src="${escapeHtml(imageData)}" alt="${escapeHtml(title)}">
            <div class="chart-axis-x">${escapeHtml(xLabel)}</div>
          </div>
        </div>
        ${legendHtml}
        ${subtitle ? `<div class="chart-subtitle">${escapeHtml(subtitle)}</div>` : ''}
      </div>`;
    };

    const buildParserTable = (items, sortState) => {
      if (!items.length) {
        return `<div class="muted">No parser metrics available.</div>`;
      }
      const rows = items.map(item => {
        const statusMeta = this.getParserStatusMeta(item);
        const parserUrl = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, { parser: item.name });
        const parserNavAttrs = buildNavAttributes('parser', item.name);
        const statusRank = this.getParserStatusRank(item);
        const actions = item.actions || this.createActionCounts();
        const actionTotal = this.sumDisplayActions(actions);
        const lastRunValue = this.getTimeValue(item.lastRunAt);
        const durationMs = Number.isFinite(item?.durationMs) ? item.durationMs : 0;
        const statusEmoji = this.getParserStatusEmoji(item);
        const statusLabel = statusMeta?.label || 'Unknown';
        const rowAttrs = [
          `data-parser-name="${escapeHtml(item.name || '')}"`,
          `data-parser-status="${escapeHtml(statusMeta.key)}"`,
          `data-parser-status-rank="${statusRank}"`,
          `data-parser-final-events="${item.finalBearEvents || 0}"`,
          `data-parser-actions="${actionTotal}"`,
          `data-parser-new="${actions.new || 0}"`,
          `data-parser-merge="${actions.merge || 0}"`,
          `data-parser-conflict="${actions.conflict || 0}"`,
          `data-parser-last-run="${lastRunValue}"`,
          `data-parser-duration="${durationMs}"`
        ].join(' ');
        const lastRun = this.formatLastRunLabel(item.lastRunAt);
        const durationLabel = durationMs > 0 ? this.formatDuration(durationMs) : '-';
        return `
          <tr data-row="parser" ${rowAttrs}>
            <td>
              <div class="cell-title">
                ${buildLink(item.name || 'Unknown parser', parserUrl, 'row-link', parserNavAttrs)}
              </div>
            </td>
            <td class="num tight">
              <div class="cell-title">${escapeHtml(this.formatNumber(actions.new || 0))}</div>
            </td>
            <td class="num tight">
              <div class="cell-title">${escapeHtml(this.formatNumber(actions.merge || 0))}</div>
            </td>
            <td class="num tight">
              <div class="cell-title">${escapeHtml(this.formatNumber(actions.conflict || 0))}</div>
            </td>
            <td>
              <div class="cell-title">${escapeHtml(lastRun)}</div>
            </td>
            <td class="num">
              <div class="cell-title">${escapeHtml(durationLabel)}</div>
            </td>
            <td class="status-cell">
              <span class="status-emoji" title="${escapeHtml(statusLabel)}">${escapeHtml(statusEmoji)}</span>
            </td>
          </tr>`;
      }).join('');
      return `
        <div class="table-wrapper">
          <table class="metrics-table list-table">
            <thead>
              <tr>
                ${buildSortHeader('Parser', 'name', sortState, 'parsers', 'asc')}
                ${buildSortHeader('Add', 'new', sortState, 'parsers', 'desc', 'num tight')}
                ${buildSortHeader('Mrg', 'merge', sortState, 'parsers', 'desc', 'num tight')}
                ${buildSortHeader('Cnf', 'conflict', sortState, 'parsers', 'desc', 'num tight')}
                ${buildSortHeader('Last', 'last-run', sortState, 'parsers', 'desc')}
                ${buildSortHeader('Dur', 'duration', sortState, 'parsers', 'desc', 'num')}
                ${buildSortHeader('Stat', 'status', sortState, 'parsers', 'desc', 'status-cell')}
              </tr>
            </thead>
            <tbody data-list="parsers">
              ${rows}
            </tbody>
          </table>
        </div>`;
    };

    const buildAggregateParserTable = (items, sortState) => {
      if (!items.length) {
        return `<div class="muted">No parser totals available.</div>`;
      }
      const rows = items.map(item => {
        const parserUrl = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, { parser: item.name });
        const parserNavAttrs = buildNavAttributes('parser', item.name);
        const actions = item.actions || this.createActionCounts();
        const statusCounts = this.normalizeStatusCounts(item.statusCounts || this.createStatusCounts());
        const runs = item.runs || 0;
        const successPercentValue = runs > 0 ? ((statusCounts.success || 0) / runs) * 100 : 0;
        const warningPercentValue = runs > 0 ? ((statusCounts.warning || 0) / runs) * 100 : 0;
        const failedPercentValue = runs > 0 ? ((statusCounts.failed || 0) / runs) * 100 : 0;
        const successPercent = this.formatPercent(statusCounts.success || 0, runs);
        const warningPercent = this.formatPercent(statusCounts.warning || 0, runs);
        const failedPercent = this.formatPercent(statusCounts.failed || 0, runs);
        const rowAttrs = [
          `data-aggregate-name="${escapeHtml(item.name || '')}"`,
          `data-aggregate-new="${actions.new || 0}"`,
          `data-aggregate-merge="${actions.merge || 0}"`,
          `data-aggregate-conflict="${actions.conflict || 0}"`,
          `data-aggregate-runs="${runs}"`,
          `data-aggregate-success="${statusCounts.success || 0}"`,
          `data-aggregate-success-percent="${successPercentValue}"`,
          `data-aggregate-warning="${statusCounts.warning || 0}"`,
          `data-aggregate-warning-percent="${warningPercentValue}"`,
          `data-aggregate-failed="${statusCounts.failed || 0}"`,
          `data-aggregate-failed-percent="${failedPercentValue}"`
        ].join(' ');
        return `
          <tr data-row="aggregate-parser" ${rowAttrs}>
            <td>
              <div class="cell-title">
                ${buildLink(item.name || 'Unknown parser', parserUrl, 'row-link', parserNavAttrs)}
              </div>
            </td>
            <td class="num tight">
              <div class="cell-title">${escapeHtml(this.formatNumber(actions.new || 0))}</div>
            </td>
            <td class="num tight">
              <div class="cell-title">${escapeHtml(this.formatNumber(actions.merge || 0))}</div>
            </td>
            <td class="num tight">
              <div class="cell-title">${escapeHtml(this.formatNumber(actions.conflict || 0))}</div>
            </td>
            <td class="num">
              <div class="cell-title">${escapeHtml(this.formatNumber(runs))}</div>
            </td>
            <td class="num tight">
              <div class="cell-title">
                <span class="value-count">${escapeHtml(this.formatNumber(statusCounts.success || 0))}</span>
                <span class="value-percent">${escapeHtml(successPercent)}</span>
              </div>
            </td>
            <td class="num tight">
              <div class="cell-title">
                <span class="value-count">${escapeHtml(this.formatNumber(statusCounts.warning || 0))}</span>
                <span class="value-percent">${escapeHtml(warningPercent)}</span>
              </div>
            </td>
            <td class="num tight">
              <div class="cell-title">
                <span class="value-count">${escapeHtml(this.formatNumber(statusCounts.failed || 0))}</span>
                <span class="value-percent">${escapeHtml(failedPercent)}</span>
              </div>
            </td>
          </tr>`;
      }).join('');
      return `
        <div class="table-wrapper">
          <table class="metrics-table list-table">
            <thead>
              <tr>
                ${buildSortHeader('Parser', 'name', sortState, 'aggregate', 'asc')}
                ${buildSortHeader('Add', 'new', sortState, 'aggregate', 'desc', 'num tight')}
                ${buildSortHeader('Mrg', 'merge', sortState, 'aggregate', 'desc', 'num tight')}
                ${buildSortHeader('Cnf', 'conflict', sortState, 'aggregate', 'desc', 'num tight')}
                ${buildSortHeader('Runs', 'runs', sortState, 'aggregate', 'desc', 'num')}
                ${buildSortHeader('Suc', 'success', sortState, 'aggregate', 'desc', 'num tight')}
                ${buildSortHeader('Wrn', 'warning', sortState, 'aggregate', 'desc', 'num tight')}
                ${buildSortHeader('Fail', 'failed', sortState, 'aggregate', 'desc', 'num tight')}
              </tr>
            </thead>
            <tbody data-list="aggregate-parsers">
              ${rows}
            </tbody>
          </table>
        </div>`;
    };

    const buildRunTable = (items, sortState) => {
      if (!items.length) {
        return `<div class="muted">No runs match filters.</div>`;
      }
      const rows = items.map(run => {
        const statusMeta = this.getStatusMeta(run.status);
        const runUrl = this.buildScriptableUrl(DISPLAY_SAVED_RUN_SCRIPT, {
          runId: run.runId,
          readOnly: true
        });
        const finishedValue = this.getTimeValue(run.finishedAt);
        const statusRank = this.getRunStatusRank(run.status);
        const statusEmoji = this.getRunStatusEmoji(run.status);
        const parserNames = Array.isArray(run.parserNames) ? run.parserNames : [];
        const parserNamesValue = parserNames.join('|');
        const issuesTotal = (run.errorsCount || 0) + (run.warningsCount || 0);
        const actions = run.actions || this.createActionCounts();
        const actionTotal = this.sumDisplayActions(actions);
        const rowAttrs = [
          `data-run-id="${escapeHtml(String(run.runId || ''))}"`,
          `data-run-finished="${finishedValue}"`,
          `data-run-status="${escapeHtml(String(run.status || ''))}"`,
          `data-run-status-rank="${statusRank}"`,
          `data-run-actions="${actionTotal}"`,
          `data-run-new="${actions.new || 0}"`,
          `data-run-merge="${actions.merge || 0}"`,
          `data-run-conflict="${actions.conflict || 0}"`,
          `data-run-errors="${run.errorsCount || 0}"`,
          `data-run-warnings="${run.warningsCount || 0}"`,
          `data-run-issues="${issuesTotal}"`,
          `data-run-duration="${run.durationMs || 0}"`,
          `data-run-final-events="${run.finalEvents || 0}"`,
          `data-run-total-events="${run.totalEvents || 0}"`,
          `data-run-parsers="${run.parsersCount || 0}"`,
          `data-run-parser-names="${escapeHtml(parserNamesValue)}"`
        ].join(' ');
        const addLabel = this.formatNumber(actions.new || 0);
        const mergeLabel = this.formatNumber(actions.merge || 0);
        const conflictLabel = this.formatNumber(actions.conflict || 0);
        const durationLabel = run.durationMs ? this.formatDuration(run.durationMs) : '-';
        return `
          <tr data-row="run" ${rowAttrs}>
            <td>
              <div class="cell-title">${buildLink(this.formatRunId(run.runId), runUrl, 'row-link')}</div>
            </td>
            <td class="num tight">
              <div class="cell-title">${escapeHtml(addLabel)}</div>
            </td>
            <td class="num tight">
              <div class="cell-title">${escapeHtml(mergeLabel)}</div>
            </td>
            <td class="num tight">
              <div class="cell-title">${escapeHtml(conflictLabel)}</div>
            </td>
            <td>
              <div class="cell-title">${escapeHtml(this.formatLastRunLabel(run.finishedAt))}</div>
            </td>
            <td class="num">
              <div class="cell-title">${escapeHtml(durationLabel)}</div>
            </td>
            <td class="status-cell">
              <span class="status-emoji" title="${escapeHtml(statusMeta.label)}">${escapeHtml(statusEmoji)}</span>
            </td>
          </tr>`;
      }).join('');
      return `
        <div class="table-wrapper">
          <table class="metrics-table list-table">
            <thead>
              <tr>
                ${buildSortHeader('Run', 'run-id', sortState, 'runs', 'desc')}
                ${buildSortHeader('Add', 'new', sortState, 'runs', 'desc', 'num tight')}
                ${buildSortHeader('Mrg', 'merge', sortState, 'runs', 'desc', 'num tight')}
                ${buildSortHeader('Cnf', 'conflict', sortState, 'runs', 'desc', 'num tight')}
                ${buildSortHeader('Last', 'finished', sortState, 'runs', 'desc')}
                ${buildSortHeader('Dur', 'duration', sortState, 'runs', 'desc', 'num')}
                ${buildSortHeader('Stat', 'status', sortState, 'runs', 'desc', 'status-cell')}
              </tr>
            </thead>
            <tbody data-list="runs">
              ${rows}
            </tbody>
          </table>
        </div>`;
    };

    const buildSortChips = (options, currentSort, viewKey, directionResolver) => {
      return options.map(option => {
        const defaultDirection = option.defaultDirection || directionResolver(option.key);
        const isActive = currentSort?.key === option.key;
        const activeDirection = currentSort?.direction || defaultDirection;
        const nextDirection = isActive
          ? (activeDirection === 'asc' ? 'desc' : 'asc')
          : defaultDirection;
        const label = `${option.label}${isActive ? ` (${activeDirection})` : ''}`;
        const url = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, {
          view: viewKey,
          sort: option.key,
          dir: nextDirection
        });
        const dataAttrs = [
          `data-sort-view="${escapeHtml(viewKey)}"`,
          `data-sort-key="${escapeHtml(option.key)}"`,
          `data-sort-dir="${escapeHtml(nextDirection)}"`,
          `data-sort-default-dir="${escapeHtml(defaultDirection)}"`,
          `data-sort-label="${escapeHtml(option.label)}"`
        ].join(' ');
        return buildChip(label, url, isActive, dataAttrs);
      }).join('');
    };

    const runFilterState = {
      status: runFilters?.status || null,
      parserFilter: runFilters?.parserFilter || null,
      days: runFilters?.days || null
    };

    const buildRunFilterChip = (label, overrides, isActive, filterType, filterValue) => {
      const nextFilters = { ...runFilterState, ...overrides };
      const url = this.buildRunListUrl(runSortResolved, nextFilters);
      const normalizedValue = filterValue === null || filterValue === undefined ? '' : String(filterValue);
      const dataAttrs = [
        'data-filter-view="runs"',
        `data-filter-type="${escapeHtml(filterType)}"`,
        `data-filter-value="${escapeHtml(normalizedValue)}"`
      ].join(' ');
      return buildChip(label, url, isActive, dataAttrs);
    };

    const statusFilter = this.normalizeRunStatusFilter(runFilters?.status);
    const statusOptions = [
      { label: 'All', value: null },
      { label: 'Success', value: 'success' },
      { label: 'Warning', value: 'partial' },
      { label: 'Failed', value: 'failed' },
      { label: 'Issues', value: 'issues' }
    ];
    const statusChips = statusOptions.map(option => buildRunFilterChip(
      option.label,
      { status: option.value },
      statusFilter === option.value || (!statusFilter && !option.value),
      'status',
      option.value
    )).join('');

    const dayOptions = [
      { label: 'Any time', value: null },
      { label: '7d', value: 7 },
      { label: '30d', value: 30 },
      { label: '90d', value: 90 }
    ];
    const dayChips = dayOptions.map(option => buildRunFilterChip(
      option.label,
      { days: option.value },
      (runFilters?.days || null) === option.value,
      'days',
      option.value
    )).join('');

    const parserNames = Array.from(new Set(parserItems.map(item => item?.name).filter(Boolean))).slice(0, 8);
    const activeParserFilter = runFilters?.parserFilter ? String(runFilters.parserFilter).toLowerCase() : null;
    const parserChips = ['All parsers', ...parserNames].map((name, index) => {
      if (index === 0) {
        return buildRunFilterChip(name, { parserFilter: null }, !activeParserFilter, 'parser', '');
      }
      const isActive = activeParserFilter === String(name).toLowerCase();
      return buildRunFilterChip(name, { parserFilter: name }, isActive, 'parser', name);
    }).join('');

    const runAxisLabel = CHART_AXIS_LABELS.runs;
    const finalEventsAxisLabel = CHART_AXIS_LABELS.finalEvents;
    const durationAxisLabel = CHART_AXIS_LABELS.durationMinutes;

    const buildCardsForView = viewState => {
      const safeView = viewState?.mode ? viewState : { mode: 'parsers' };
      const viewMode = this.normalizeViewToken(safeView.mode) || safeView.mode;
      const cards = [];
      if (!latest && viewMode !== 'runs') {
        cards.push(buildEmptyCard('No metrics found yet.', 'Run the scraper to generate metrics.'));
      } else if (viewMode === 'runs' && runItems.length === 0) {
        cards.push(buildEmptyCard('No run metrics found.', 'Run the scraper to generate metrics.'));
      } else if (viewMode === 'parsers') {
        const lastRun = latest?.finished_at ? this.formatRelativeTime(latest.finished_at) : 'Unknown';
        const latestErrors = Number.isFinite(latest?.errors_count) ? latest.errors_count : 0;
        const latestWarnings = this.getRunWarningCount(latest);
        const totals = latest?.totals || {};
        const finalEvents = totals.final_bear_events || 0;
        const historyCount = Math.max(recentRecords.length, 1);
        const parserCounts = this.getParserStatusCounts(parserItems);
        const runningCount = parserCounts.running;
        const overallHealthValue = this.formatPercent(parserCounts.healthy, runningCount);
        const healthSummary = runningCount > 0
          ? `Healthy ${this.formatNumber(parserCounts.healthy)}/${this.formatNumber(runningCount)} running • Warnings ${this.formatNumber(parserCounts.warning)} • Failed ${this.formatNumber(parserCounts.failed)} • Idle ${this.formatNumber(parserCounts.notRun)} • Total ${this.formatNumber(parserCounts.total)}`
          : `Warnings ${this.formatNumber(parserCounts.warning)} • Failed ${this.formatNumber(parserCounts.failed)} • Idle ${this.formatNumber(parserCounts.notRun)} • Total ${this.formatNumber(parserCounts.total)}`;
        const runHealth = this.getRunHealthSummary(records);
        const failureStreak = runHealth.failureStreak || 0;
        const lastSuccessAt = runHealth.lastSuccessAt;
        const lastSuccessLabel = lastSuccessAt ? this.formatRelativeTime(lastSuccessAt) : 'Never';
        const latestStatusLabel = this.formatStatusLabel(runHealth.latestStatus);

        const lastSuccessSummary = lastSuccessAt
          ? `Last success: ${lastSuccessLabel}`
          : 'Last success: Never';
        const latestRunSummary = `Status: ${latestStatusLabel} • Errors ${this.formatNumber(latestErrors)} • Warnings ${this.formatNumber(latestWarnings)}`;
        const dashboardBody = `
          <div class="metrics-grid">
            ${buildMetric('Parser health', overallHealthValue, healthSummary)}
            ${buildMetric('Issue streak', this.formatNumber(failureStreak), lastSuccessSummary)}
            ${buildMetric('Last run', lastRun, latestRunSummary)}
          </div>`;
        cards.push(buildSection('Parser Health Snapshot', dashboardBody));

        const sortedItems = this.sortParserItems(parserItems, parserSortResolved).slice(0, 8);
        let parserTableHtml = buildParserTable(sortedItems, parserSortResolved);
        if (parserItems.length > sortedItems.length) {
          parserTableHtml += `<div class="table-footer">+${parserItems.length - sortedItems.length} more parsers not shown</div>`;
        }
        cards.push(buildSection('Parser Health (Latest)', parserTableHtml));

        const finalSeries = this.getSeries(recentRecords, record => record?.totals?.final_bear_events || 0);
        const finalChart = this.buildLineChartImage(finalSeries, chartSize, {
          lineColor: new Color(CHART_STYLE.line),
          fillColor: new Color(CHART_STYLE.line, CHART_STYLE.fillOpacity)
        });
        const finalChartData = this.imageToDataUri(finalChart);
        cards.push(buildChartCard(`Final Events (Last ${historyCount} Runs)`, finalChartData, `Latest: ${this.formatNumber(finalEvents)}`, {
          xLabel: runAxisLabel,
          yLabel: finalEventsAxisLabel
        }));

        const durationSeries = this.getSeries(recentRecords, record => this.getDurationMinutes(record?.duration_ms));
        const durationChart = this.buildLineChartImage(durationSeries, chartSize, {
          lineColor: new Color(CHART_STYLE.lineSecondary),
          fillColor: new Color(CHART_STYLE.lineSecondary, CHART_STYLE.fillOpacity)
        });
        const durationChartData = this.imageToDataUri(durationChart);
        cards.push(buildChartCard(`Duration (Minutes, Last ${historyCount} Runs)`, durationChartData, `Latest: ${this.formatDuration(latest?.duration_ms)}`, {
          xLabel: runAxisLabel,
          yLabel: durationAxisLabel
        }));

        const durationParserNames = this.getParserNamesByRecentRuns(recentRecords, MAX_PARSER_DURATION_SERIES);
        const allDurationParserNames = this.getParserNamesByRecentRuns(recentRecords, 0);
        if (durationParserNames.length > 0) {
          const buildDurationSeries = names => names.map((name, index) => ({
            label: name,
            values: this.getParserDurationSeries(recentRecords, name),
            color: CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]
          })).filter(series => Array.isArray(series.values) && series.values.length > 0);
          const parserDurationSeries = buildDurationSeries(durationParserNames);
          const parserDurationChart = this.buildMultiLineChartImage(parserDurationSeries, chartSize, {
            lineWidth: CHART_STYLE.lineWidth
          });
          const parserDurationData = parserDurationChart ? this.imageToDataUri(parserDurationChart) : null;
          const parserLegend = buildChartLegend(parserDurationSeries);
          const parserSubtitle = durationParserNames.length > 1
            ? `Top ${durationParserNames.length} parsers by recent runs`
            : `Parser duration over last ${historyCount} runs`;

          if (allDurationParserNames.length > durationParserNames.length) {
            const allDurationSeries = buildDurationSeries(allDurationParserNames);
            const allDurationChart = this.buildMultiLineChartImage(allDurationSeries, chartSize, {
              lineWidth: CHART_STYLE.lineWidth
            });
            const allDurationData = allDurationChart ? this.imageToDataUri(allDurationChart) : null;
            const allLegend = buildChartLegend(allDurationSeries);
            const allSubtitle = `All ${allDurationParserNames.length} parsers by recent runs`;
            if (parserDurationData && allDurationData) {
              const topLegendBlock = parserLegend ? `<div data-parser-duration-legend="top">${parserLegend}</div>` : '';
              const allLegendBlock = allLegend ? `<div class="is-hidden" data-parser-duration-legend="all">${allLegend}</div>` : '';
              const topSubtitleBlock = parserSubtitle
                ? `<div class="chart-subtitle" data-parser-duration-subtitle="top">${escapeHtml(parserSubtitle)}</div>`
                : '';
              const allSubtitleBlock = allSubtitle
                ? `<div class="chart-subtitle is-hidden" data-parser-duration-subtitle="all">${escapeHtml(allSubtitle)}</div>`
                : '';
              const chartCard = `
                <div class="card" data-parser-duration-card>
                  <div class="section-title">Parser Durations (Minutes, Last ${historyCount} Runs)</div>
                  <div class="chart-wrapper">
                    <div class="chart-axis-y">${escapeHtml(durationAxisLabel)}</div>
                    <div class="chart-axis-main">
                      <img class="chart" data-parser-duration-chart="top" src="${escapeHtml(parserDurationData)}" alt="Parser durations (top parsers)">
                      <img class="chart is-hidden" data-parser-duration-chart="all" src="${escapeHtml(allDurationData)}" alt="Parser durations (all parsers)">
                      <div class="chart-axis-x">${escapeHtml(runAxisLabel)}</div>
                    </div>
                  </div>
                  ${topLegendBlock}
                  ${allLegendBlock}
                  ${topSubtitleBlock}
                  ${allSubtitleBlock}
                  <div class="card-actions">
                    <button class="toggle-button" type="button" data-parser-duration-toggle>Show all parsers</button>
                  </div>
                </div>`;
              cards.push(chartCard);
            } else if (parserDurationData) {
              cards.push(buildChartCard(`Parser Durations (Minutes, Last ${historyCount} Runs)`, parserDurationData, parserSubtitle, {
                xLabel: runAxisLabel,
                yLabel: durationAxisLabel,
                legendHtml: parserLegend
              }));
            }
          } else if (parserDurationData) {
            cards.push(buildChartCard(`Parser Durations (Minutes, Last ${historyCount} Runs)`, parserDurationData, parserSubtitle, {
              xLabel: runAxisLabel,
              yLabel: durationAxisLabel,
              legendHtml: parserLegend
            }));
          }
        }

        if (summary?.totals) {
          const summaryTotals = summary.totals;
          const statusCounts = this.normalizeStatusCounts(summaryTotals.statuses);
          const actions = summaryTotals.actions || this.createActionCounts();
          const runs = summaryTotals.runs || 0;
          const parserCount = allTimeParserRows.length || parserItems.length;
          const totalsGrid = `
            <div class="metrics-grid">
              ${buildMetric('Runs', this.formatNumber(runs))}
              ${buildMetric('Parsers', this.formatNumber(parserCount))}
            </div>
            <div class="metrics-grid">
              ${buildMetric('Success', this.formatNumber(statusCounts.success || 0), this.formatPercent(statusCounts.success || 0, runs))}
              ${buildMetric('Warnings', this.formatNumber(statusCounts.warning || 0), this.formatPercent(statusCounts.warning || 0, runs))}
              ${buildMetric('Failed', this.formatNumber(statusCounts.failed || 0), this.formatPercent(statusCounts.failed || 0, runs))}
            </div>
            <div class="metrics-grid">
              ${buildMetric('Adds', this.formatNumber(actions.new || 0))}
              ${buildMetric('Merges', this.formatNumber(actions.merge || 0))}
              ${buildMetric('Conflicts', this.formatNumber(actions.conflict || 0))}
            </div>`;
          cards.push(buildSection('All Time Totals', totalsGrid));
        }
      } else if (viewMode === 'runs') {
        if (!summary?.totals) {
          cards.push(buildEmptyCard('No summary metrics found.', 'Run the scraper to generate summary metrics.'));
        } else {
          const totals = summary.totals;
          const statusCounts = this.normalizeStatusCounts(totals.statuses);
          const actions = totals.actions || this.createActionCounts();
          const runs = totals.runs || 0;
          const parserCount = allTimeParserRows.length || parserItems.length;
          const totalsGrid = `
            <div class="metrics-grid">
              ${buildMetric('Runs', this.formatNumber(runs))}
              ${buildMetric('Parsers', this.formatNumber(parserCount))}
            </div>
            <div class="metrics-grid">
              ${buildMetric('Success', this.formatNumber(statusCounts.success || 0), this.formatPercent(statusCounts.success || 0, runs))}
              ${buildMetric('Warnings', this.formatNumber(statusCounts.warning || 0), this.formatPercent(statusCounts.warning || 0, runs))}
              ${buildMetric('Failed', this.formatNumber(statusCounts.failed || 0), this.formatPercent(statusCounts.failed || 0, runs))}
            </div>
            <div class="metrics-grid">
              ${buildMetric('Adds', this.formatNumber(actions.new || 0))}
              ${buildMetric('Merges', this.formatNumber(actions.merge || 0))}
              ${buildMetric('Conflicts', this.formatNumber(actions.conflict || 0))}
            </div>`;
          cards.push(buildSection('All Time Totals', totalsGrid));
          const parserTotals = allTimeParserRows;
          const sortedParserTotals = this.sortAggregateParserRows(parserTotals, aggregateSortResolved);
          if (sortedParserTotals.length > 0) {
            const totalsTable = buildAggregateParserTable(sortedParserTotals, aggregateSortResolved);
            const totalsBody = `
              <div class="table-controls">
                <div class="table-control-label">Status Columns</div>
                <button class="toggle-button" type="button" data-aggregate-toggle>Show %</button>
              </div>
              ${totalsTable}`;
            cards.push(buildSection('Per-Parser Totals', totalsBody));
          }
        }
        const filtersHtml = `
          <div class="filter-block">
            <div class="filter-label">Status</div>
            <div class="chip-group">${statusChips}</div>
          </div>
          <div class="filter-block">
            <div class="filter-label">Age</div>
            <div class="chip-group">${dayChips}</div>
          </div>
          <div class="filter-block">
            <div class="filter-label">Parser</div>
            <div class="chip-group">${parserChips}</div>
          </div>`;
        const runsBody = `
          ${filtersHtml}
          ${buildRunTable(sortedRuns, runSortResolved)}`;
        cards.push(buildSection('All Runs', runsBody));
      } else if (viewMode === 'parser') {
        const parserName = safeView.parserName || 'Parser';
        const record = parserItems.find(item => item.name === safeView.parserName);
        const hasAllTime = (record?.allTimeRuns || 0) > 0;
        const hasHistory = (record?.historyRuns || 0) > 0;
        const hasLastRun = !!record?.lastRunAt;

        if (!record || (!record.ran && !hasAllTime && !hasHistory)) {
          cards.push(buildEmptyCard('No parser metrics available.', 'Run the parser to collect metrics.'));
        } else {
          if (hasLastRun) {
            const lastRunUrl = record?.lastRunId
              ? this.buildScriptableUrl(DISPLAY_SAVED_RUN_SCRIPT, { runId: record.lastRunId, readOnly: true })
              : null;
            const lastRunAction = lastRunUrl
              ? `<div class="card-actions">${buildLink('Open run details', lastRunUrl, 'button small')}</div>`
              : '';
            const lastRunBody = `
              <div class="metrics-grid">
                ${buildMetric('Final events', this.formatNumber(record.finalBearEvents || 0))}
                ${buildMetric('Duration', this.formatDuration(record.durationMs))}
                ${buildMetric('Actions', this.formatActions(record.actions))}
              </div>
              ${lastRunAction}`;
            const lastRunSubtitle = `Last run ${this.formatRelativeTime(record.lastRunAt)}`;
            cards.push(buildSection('Latest Run', lastRunBody, escapeHtml(lastRunSubtitle)));
          } else {
            cards.push(buildEmptyCard('No recent run data.', 'Only historical totals are available.'));
          }

          if (hasAllTime || hasHistory) {
            const totals = hasAllTime ? (record.allTimeTotals || {}) : (record.historyTotals || {});
            const runsCount = hasAllTime ? record.allTimeRuns : record.historyRuns;
            const actions = hasAllTime ? record.allTimeActions : record.historyActions;
            const avgDurationMs = runsCount > 0
              ? Math.round((hasAllTime ? record.allTimeDurationMs : record.historyDurationMs) / runsCount)
              : null;
            const metricsGrid = `
              <div class="metrics-grid">
                ${buildMetric('Final events', this.formatNumber(totals.final_bear_events || 0))}
                ${buildMetric('Total events', this.formatNumber(totals.total_events || 0))}
                ${buildMetric('Runs', this.formatNumber(runsCount || 0))}
                ${buildMetric('Avg duration', avgDurationMs ? this.formatDuration(avgDurationMs) : 'n/a')}
              </div>
              <div class="meta-row">
                <div class="meta-item">
                  <span class="meta-label">Actions</span>
                  <span class="meta-value">${escapeHtml(this.formatActions(actions))}</span>
                </div>
              </div>`;
            cards.push(buildSection(hasAllTime ? 'All Time Totals' : 'Recent Totals', metricsGrid));
          } else {
            cards.push(buildEmptyCard('History summary unavailable.', 'Run the scraper to generate summary metrics.'));
          }

          const parserSeries = this.getParserSeries(recentRecords, safeView.parserName);
          if (parserSeries.length > 0) {
            const parserAverage = this.getSeriesAverage(parserSeries);
            const parserSeriesList = [
              { label: parserName, values: parserSeries, color: CHART_STYLE.lineSecondary }
            ];
            if (Number.isFinite(parserAverage)) {
              parserSeriesList.push({
                label: 'Average',
                values: new Array(parserSeries.length).fill(parserAverage),
                color: CHART_STYLE.line
              });
            }
            const parserChart = this.buildMultiLineChartImage(parserSeriesList, chartSize, {
              lineWidth: CHART_STYLE.lineWidth
            });
            const parserChartData = parserChart ? this.imageToDataUri(parserChart) : null;
            const parserLegend = buildChartLegend(parserSeriesList);
            const avgLabel = Number.isFinite(parserAverage)
              ? `Avg: ${this.formatNumber(Math.round(parserAverage))}`
              : null;
            const parserSubtitle = avgLabel ? avgLabel : null;
            const parserRunCount = parserSeries.length || 1;
            cards.push(buildChartCard(`Events Per Run (Last ${parserRunCount} Parser Runs)`, parserChartData, parserSubtitle, {
              xLabel: runAxisLabel,
              yLabel: finalEventsAxisLabel,
              legendHtml: parserLegend
            }));
          } else {
            cards.push(buildEmptyCard('Events Per Run', 'No recent parser runs to chart.'));
          }

          const parserDurationSeries = this.getParserDurationSeries(recentRecords, safeView.parserName);
          if (parserDurationSeries.length > 0) {
            const parserDurationAverage = this.getSeriesAverage(parserDurationSeries);
            const durationSeriesList = [
              { label: parserName, values: parserDurationSeries, color: CHART_STYLE.line }
            ];
            if (Number.isFinite(parserDurationAverage)) {
              durationSeriesList.push({
                label: 'Average',
                values: new Array(parserDurationSeries.length).fill(parserDurationAverage),
                color: CHART_STYLE.lineSecondary
              });
            }
            const parserDurationChart = this.buildMultiLineChartImage(durationSeriesList, chartSize, {
              lineWidth: CHART_STYLE.lineWidth
            });
            const parserDurationData = parserDurationChart ? this.imageToDataUri(parserDurationChart) : null;
            const durationLegend = buildChartLegend(durationSeriesList);
            const avgDurationMs = Number.isFinite(parserDurationAverage)
              ? Math.round(parserDurationAverage * 60000)
              : null;
            const durationSubtitleParts = [];
            if (avgDurationMs !== null) durationSubtitleParts.push(`Avg: ${this.formatDuration(avgDurationMs)}`);
            if (hasLastRun && record?.durationMs) durationSubtitleParts.push(`Latest: ${this.formatDuration(record.durationMs)}`);
            const durationSubtitle = durationSubtitleParts.length ? durationSubtitleParts.join(' • ') : null;
            const parserDurationRuns = parserDurationSeries.length || 1;
            cards.push(buildChartCard(`Duration (Minutes, Last ${parserDurationRuns} Parser Runs)`, parserDurationData, durationSubtitle, {
              xLabel: runAxisLabel,
              yLabel: durationAxisLabel,
              legendHtml: durationLegend
            }));
          } else {
            cards.push(buildEmptyCard('Duration', 'No recent parser runs to chart.'));
          }
        }
      } else {
        cards.push(buildEmptyCard('Unknown view.', 'Open Parser Health to get started.'));
      }
      return cards;
    };

    const buildViewSection = (viewState, cards) => {
      const label = this.getViewLabel(viewState);
      const mode = viewState?.mode || 'parsers';
      const parserName = viewState?.parserName || '';
      const isActive = mode === viewMode && (mode !== 'parser' || parserName === initialParserName);
      const parserAttr = parserName ? ` data-parser="${escapeHtml(parserName)}"` : '';
      return `
        <section class="view${isActive ? ' active' : ''}" data-view="${escapeHtml(mode)}"${parserAttr} data-view-label="${escapeHtml(label)}">
          ${cards.join('\n')}
        </section>`;
    };

    const viewSections = [];
    this.getViewOptions().forEach(option => {
      const viewState = { mode: option.mode };
      const cards = buildCardsForView(viewState);
      viewSections.push(buildViewSection(viewState, cards));
    });

    const parserDetailNames = Array.from(new Set(parserItems.map(item => item?.name).filter(Boolean)));
    const parserDetailViews = parserDetailNames.map(name => ({ mode: 'parser', parserName: name }));
    if (safeView.mode === 'parser') {
      const targetName = safeView.parserName || '';
      if (!targetName || !parserDetailNames.includes(targetName)) {
        parserDetailViews.push({ mode: 'parser', parserName: targetName });
      }
    }
    parserDetailViews.forEach(viewState => {
      const cards = buildCardsForView(viewState);
      viewSections.push(buildViewSection(viewState, cards));
    });

    const logoImage = await this.loadLogoImage();
    const logoData = this.imageToDataUri(logoImage);
    const latestRunLabel = latest?.finished_at ? this.formatRelativeTime(latest.finished_at) : 'No runs yet';
    const headerMeta = latest ? `Latest run ${latestRunLabel}` : 'No run data yet';
    const lastRunUrl = latest?.run_id
      ? this.buildScriptableUrl(DISPLAY_SAVED_RUN_SCRIPT, { runId: latest.run_id, readOnly: true })
      : null;
    const lastRunButton = lastRunUrl ? buildLink('Open last run', lastRunUrl, 'button') : '';
    const navLinks = this.getViewOptions().map(option => {
      const isActive = viewMode === option.mode || (viewMode === 'parser' && option.mode === 'parsers');
      const url = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, { view: option.mode });
      return buildChip(option.label, url, isActive, buildNavAttributes(option.mode, null, true));
    }).join('');
    const parserChipClass = viewMode === 'parser' ? 'chip parser-chip active' : 'chip parser-chip hidden';
    const parserChipLabel = `Parser: ${safeView.parserName || 'detail'}`;
    const parserChip = `<span class="${parserChipClass}" data-parser-chip>${escapeHtml(parserChipLabel)}</span>`;
    const navHtml = `${navLinks}${parserChip}`;

    const parserSortKey = parserSortResolved?.key || 'status';
    const parserSortDir = parserSortResolved?.direction || this.getDefaultSortDirection(parserSortKey);
    const runSortKey = runSortResolved?.key || 'finished';
    const runSortDir = runSortResolved?.direction || this.getDefaultRunSortDirection(runSortKey);
    const aggregateSortKey = aggregateSortResolved?.key || 'runs';
    const aggregateSortDir = aggregateSortResolved?.direction || this.getDefaultSortDirection(aggregateSortKey);
    const runFilterStatus = runFilters?.status ? String(runFilters.status) : '';
    const runFilterDays = Number.isFinite(runFilters?.days) ? String(runFilters.days) : '';
    const runFilterParser = runFilters?.parserFilter ? String(runFilters.parserFilter) : '';
    const aggregateDisplay = 'count';

    const isDarkMode = Device.isUsingDarkAppearance();
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chunky Dad Metrics</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary-color: ${BRAND.primary};
      --secondary-color: ${BRAND.secondary};
      --accent-color: #764ba2;
      --text-primary: #1f2544;
      --text-secondary: #5a637a;
      --text-inverse: #ffffff;
      --background-primary: #ffffff;
      --background-light: #f5f6ff;
      --border-color: rgba(102, 126, 234, 0.15);
      --card-shadow: 0 6px 18px rgba(35, 39, 71, 0.08);
      --card-hover: 0 8px 24px rgba(102, 126, 234, 0.18);
      --color-success: ${BRAND.success};
      --color-warning: ${BRAND.warning};
      --color-danger: ${BRAND.danger};
      --color-neutral: #a7b0cc;
    }
    ${isDarkMode ? `
    :root {
      --text-primary: #f1f2ff;
      --text-secondary: #c1c6e2;
      --background-primary: #1b1c2b;
      --background-light: #11121f;
      --border-color: rgba(255, 255, 255, 0.08);
      --card-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
      --card-hover: 0 8px 24px rgba(0, 0, 0, 0.4);
      --color-neutral: #b2b8d2;
    }
    ` : ''}
    * {
      box-sizing: border-box;
    }
    body {
      font-family: 'Poppins', system-ui, -apple-system, sans-serif;
      margin: 0;
      padding: 16px;
      background: var(--background-light);
      color: var(--text-primary);
    }
    a {
      color: inherit;
      text-decoration: none;
    }
    .header {
      background: linear-gradient(135deg, var(--primary-color) 0%, var(--accent-color) 100%);
      color: var(--text-inverse);
      padding: 18px;
      border-radius: 14px;
      box-shadow: var(--card-shadow);
      margin-bottom: 16px;
    }
    .header-main {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }
    .logo {
      width: 52px;
      height: 52px;
      border-radius: 0;
      background: transparent;
      object-fit: contain;
      padding: 0;
    }
    .header-text {
      min-width: 180px;
    }
    .header-title {
      font-size: 18px;
      font-weight: 700;
    }
    .header-subtitle {
      font-size: 12px;
      opacity: 0.85;
      margin-top: 2px;
    }
    .header-meta {
      font-size: 11px;
      opacity: 0.8;
      margin-top: 4px;
    }
    .header-actions {
      margin-left: auto;
    }
    .button {
      display: inline-flex;
      align-items: center;
      padding: 8px 14px;
      border-radius: 999px;
      background: #ffffff;
      color: var(--primary-color);
      font-weight: 600;
      font-size: 12px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
    }
    .button.small {
      padding: 6px 12px;
      font-size: 11px;
      box-shadow: none;
    }
    .nav-tabs {
      margin-top: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.2);
      color: var(--text-inverse);
      font-size: 12px;
      font-weight: 600;
      transition: all 0.2s ease;
    }
    .chip.active {
      background: #ffffff;
      color: var(--primary-color);
    }
    .chip.hidden {
      display: none;
    }
    .is-hidden {
      display: none;
    }
    .content {
      display: block;
    }
    .view {
      display: none;
    }
    .view.active {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .card {
      background: var(--background-primary);
      border-radius: 12px;
      padding: 12px;
      border: 1px solid var(--border-color);
      box-shadow: none;
    }
    .card-actions {
      margin-top: 10px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .section-title {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .section-subtitle {
      font-size: 12px;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 8px;
    }
    .metrics-grid + .metrics-grid {
      margin-top: 8px;
    }
    .metric {
      background: var(--background-light);
      padding: 8px;
      border-radius: 10px;
    }
    .metric-value {
      font-size: 16px;
      font-weight: 700;
    }
    .metric-subvalue {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .metric-label {
      font-size: 11px;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .table-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .table-control-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
    }
    .toggle-button {
      border: 1px solid var(--border-color);
      background: var(--background-light);
      color: var(--text-primary);
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .toggle-button.active {
      background: var(--primary-color);
      color: var(--text-inverse);
      border-color: transparent;
    }
    .value-count {
      display: block;
    }
    .value-percent {
      display: none;
      font-size: 10px;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    body[data-aggregate-display="percent"] .value-count {
      display: none;
    }
    body[data-aggregate-display="percent"] .value-percent {
      display: block;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 10px;
    }
    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .meta-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
    }
    .meta-value {
      font-size: 13px;
      font-weight: 600;
    }
    .muted {
      color: var(--text-secondary);
      font-size: 13px;
    }
    .chip-group {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 6px 0 10px;
    }
    .chip-group .chip {
      background: rgba(102, 126, 234, 0.12);
      color: var(--primary-color);
    }
    .chip-group .chip.active {
      background: var(--primary-color);
      color: #ffffff;
    }
    .filter-block {
      margin-bottom: 8px;
    }
    .filter-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .table-wrapper {
      overflow-x: auto;
    }
    .metrics-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .metrics-table th {
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      padding: 6px 6px;
      border-bottom: 1px solid var(--border-color);
    }
    .metrics-table th.sortable {
      cursor: pointer;
    }
    .sort-button {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      width: 100%;
      padding: 0;
      background: none;
      border: none;
      color: inherit;
      font: inherit;
      text-transform: inherit;
      letter-spacing: inherit;
      cursor: pointer;
    }
    .metrics-table th.num .sort-button {
      justify-content: flex-end;
    }
    .metrics-table th.status-cell .sort-button {
      justify-content: center;
    }
    .sort-arrow {
      display: inline-block;
      min-width: 10px;
      text-align: center;
      font-size: 10px;
      opacity: 0.75;
    }
    .status-cell {
      text-align: center;
    }
    .status-emoji {
      font-size: 14px;
      line-height: 1;
    }
    .metrics-table td {
      padding: 8px 6px;
      border-bottom: 1px solid var(--border-color);
      vertical-align: top;
    }
    .metrics-table th.tight,
    .metrics-table td.tight {
      padding-left: 4px;
      padding-right: 4px;
      width: 44px;
      white-space: nowrap;
    }
    .metrics-table tr.hidden {
      display: none;
    }
    .metrics-table tr:hover {
      background: rgba(102, 126, 234, 0.05);
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .cell-title {
      font-weight: 600;
    }
    .cell-title.inline {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .cell-subtitle {
      font-size: 10px;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .metrics-list {
      display: grid;
      gap: 12px;
    }
    .metrics-row {
      background: var(--background-light);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 12px 14px;
      display: grid;
      gap: 8px;
    }
    .metrics-row.hidden {
      display: none;
    }
    .row-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      font-weight: 600;
    }
    .row-subtitle {
      font-size: 12px;
      color: var(--text-secondary);
    }
    .row-metrics {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .row-meta {
      font-size: 12px;
      color: var(--text-secondary);
    }
    .metric-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(102, 126, 234, 0.12);
      color: var(--text-primary);
      font-size: 11px;
      font-weight: 600;
    }
    .metric-chip-label {
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 10px;
      color: var(--text-secondary);
    }
    .metric-chip-value {
      font-variant-numeric: tabular-nums;
    }
    .metric-chip.danger {
      background: rgba(255, 107, 107, 0.18);
      color: var(--color-danger);
    }
    .metric-chip.warning {
      background: rgba(254, 202, 87, 0.2);
      color: var(--color-warning);
    }
    .metric-chip.neutral {
      background: rgba(167, 176, 204, 0.22);
      color: var(--color-neutral);
    }
    .metric-chip.danger .metric-chip-label,
    .metric-chip.warning .metric-chip-label,
    .metric-chip.neutral .metric-chip-label {
      color: inherit;
    }
    .row-link {
      color: var(--primary-color);
    }
    .text-link {
      color: var(--primary-color);
      font-weight: 600;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 6px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .badge::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      display: inline-block;
    }
    .badge.success {
      background: rgba(46, 213, 115, 0.18);
      color: var(--color-success);
    }
    .badge.warning {
      background: rgba(254, 202, 87, 0.2);
      color: var(--color-warning);
    }
    .badge.danger {
      background: rgba(255, 107, 107, 0.18);
      color: var(--color-danger);
    }
    .badge.neutral {
      background: rgba(167, 176, 204, 0.22);
      color: var(--color-neutral);
    }
    .chart-wrapper {
      margin-top: 12px;
      display: flex;
      gap: 8px;
      align-items: stretch;
    }
    .chart-axis-y {
      font-size: 11px;
      color: var(--text-secondary);
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      text-align: center;
      letter-spacing: 0.3px;
    }
    .chart-axis-main {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .chart-axis-x {
      font-size: 11px;
      color: var(--text-secondary);
      margin-top: 6px;
      text-align: center;
    }
    .chart {
      width: 100%;
      border-radius: 12px;
      background: var(--background-light);
      padding: 8px;
    }
    .chart-legend {
      margin-top: 6px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 11px;
      color: var(--text-secondary);
    }
    .chart-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .chart-swatch {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--text-secondary);
    }
    .chart-subtitle {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 8px;
    }
    .table-footer {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 8px;
    }
    @media (max-width: 640px) {
      body {
        padding: 12px;
      }
      .header {
        padding: 16px;
      }
      .metrics-grid {
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      }
    }
  </style>
</head>
<body data-view-mode="${escapeHtml(viewMode)}" data-parser-name="${escapeHtml(initialParserName)}" data-parser-sort-key="${escapeHtml(parserSortKey)}" data-parser-sort-dir="${escapeHtml(parserSortDir)}" data-run-sort-key="${escapeHtml(runSortKey)}" data-run-sort-dir="${escapeHtml(runSortDir)}" data-aggregate-sort-key="${escapeHtml(aggregateSortKey)}" data-aggregate-sort-dir="${escapeHtml(aggregateSortDir)}" data-aggregate-display="${escapeHtml(aggregateDisplay)}" data-parser-duration-view="top" data-run-filter-status="${escapeHtml(runFilterStatus)}" data-run-filter-days="${escapeHtml(runFilterDays)}" data-run-filter-parser="${escapeHtml(runFilterParser)}">
  <div class="header">
    <div class="header-main">
      ${logoData ? `<img class="logo" src="${escapeHtml(logoData)}" alt="Chunky Dad">` : ''}
      <div class="header-text">
        <div class="header-title">Chunky Dad Metrics</div>
        <div class="header-meta">${escapeHtml(headerMeta)}</div>
      </div>
      ${lastRunButton ? `<div class="header-actions">${lastRunButton}</div>` : ''}
    </div>
    <div class="nav-tabs">${navHtml}</div>
  </div>
  <div class="content">
    ${viewSections.join('\n')}
  </div>
  <script>
    (() => {
      const body = document.body;
      const viewSections = Array.from(document.querySelectorAll('.view'));
      const navLinks = Array.from(document.querySelectorAll('[data-nav-view]'));
      const navTabs = navLinks.filter(link => link.hasAttribute('data-nav-tab'));
      const headerSubtitle = document.querySelector('.header-subtitle');
      const parserChip = document.querySelector('[data-parser-chip]');
      const parserSortButtons = Array.from(document.querySelectorAll('[data-sort-view="parsers"]'));
      const runSortButtons = Array.from(document.querySelectorAll('[data-sort-view="runs"]'));
      const aggregateSortButtons = Array.from(document.querySelectorAll('[data-sort-view="aggregate"]'));
      const runFilterChips = Array.from(document.querySelectorAll('[data-filter-view="runs"]'));
      const parserList = document.querySelector('[data-list="parsers"]');
      const runList = document.querySelector('[data-list="runs"]');
      const aggregateList = document.querySelector('section[data-view="runs"] [data-list="aggregate-parsers"]');
      const aggregateToggle = document.querySelector('[data-aggregate-toggle]');
      const parserDurationToggle = document.querySelector('[data-parser-duration-toggle]');
      const parserDurationCharts = {
        top: document.querySelector('[data-parser-duration-chart="top"]'),
        all: document.querySelector('[data-parser-duration-chart="all"]')
      };
      const parserDurationLegends = {
        top: document.querySelector('[data-parser-duration-legend="top"]'),
        all: document.querySelector('[data-parser-duration-legend="all"]')
      };
      const parserDurationSubtitles = {
        top: document.querySelector('[data-parser-duration-subtitle="top"]'),
        all: document.querySelector('[data-parser-duration-subtitle="all"]')
      };
      const hasParserDurationToggle = !!parserDurationToggle && !!parserDurationCharts.top && !!parserDurationCharts.all;

      const parseNumber = value => {
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
      };
      const formatNumber = value => {
        if (!Number.isFinite(value)) return '0';
        return Math.round(value).toLocaleString();
      };
      const normalizeDirection = value => (value === 'asc' ? 'asc' : 'desc');
      const normalizeText = value => String(value || '').toLowerCase();
      const toggleHidden = (element, shouldHide) => {
        if (!element) return;
        element.classList.toggle('is-hidden', shouldHide);
      };

      const parserSortState = {
        key: body.getAttribute('data-parser-sort-key') || 'status',
        direction: normalizeDirection(body.getAttribute('data-parser-sort-dir'))
      };
      const aggregateSortState = {
        key: body.getAttribute('data-aggregate-sort-key') || 'runs',
        direction: normalizeDirection(body.getAttribute('data-aggregate-sort-dir'))
      };
      const runSortState = {
        key: body.getAttribute('data-run-sort-key') || 'finished',
        direction: normalizeDirection(body.getAttribute('data-run-sort-dir'))
      };
      const rawDays = parseNumber(body.getAttribute('data-run-filter-days'));
      const runFilterState = {
        status: normalizeText(body.getAttribute('data-run-filter-status')) || null,
        days: rawDays > 0 ? rawDays : null,
        parser: normalizeText(body.getAttribute('data-run-filter-parser')) || null
      };
      const aggregateDisplayState = {
        mode: normalizeText(body.getAttribute('data-aggregate-display')) === 'percent' ? 'percent' : 'count'
      };

      const buildKey = (mode, parser) => (mode === 'parser' ? 'parser:' + (parser || '') : mode);
      const viewIndex = new Map();
      viewSections.forEach(section => {
        const mode = section.getAttribute('data-view') || '';
        const parser = section.getAttribute('data-parser') || '';
        viewIndex.set(buildKey(mode, parser), section);
      });

      const getSectionFor = (mode, parser) => {
        if (!mode) return null;
        const key = buildKey(mode, parser || '');
        if (viewIndex.has(key)) return viewIndex.get(key);
        if (mode === 'parser') {
          const fallbackKey = buildKey('parser', '');
          if (viewIndex.has(fallbackKey)) return viewIndex.get(fallbackKey);
        }
        const parserKey = buildKey('parsers', '');
        if (viewIndex.has(parserKey)) return viewIndex.get(parserKey);
        return viewSections[0] || null;
      };

      const setActiveView = (mode, parser) => {
        const section = getSectionFor(mode, parser);
        if (!section) return;
        viewSections.forEach(item => item.classList.toggle('active', item === section));
        const label = section.getAttribute('data-view-label') || '';
        if (headerSubtitle && label) {
          headerSubtitle.textContent = label;
        }
        const activeMode = section.getAttribute('data-view') || mode;
        const activeParser = section.getAttribute('data-parser') || '';
        const navMode = activeMode === 'parser' ? 'parsers' : activeMode;
        navTabs.forEach(tab => {
          const tabMode = tab.getAttribute('data-nav-view') || '';
          tab.classList.toggle('active', tabMode === navMode);
        });
        if (parserChip) {
          if (activeMode === 'parser') {
            parserChip.textContent = 'Parser: ' + (activeParser || 'detail');
            parserChip.classList.remove('hidden');
            parserChip.classList.add('active');
          } else {
            parserChip.classList.add('hidden');
            parserChip.classList.remove('active');
          }
        }
        body.setAttribute('data-view-mode', activeMode || '');
        body.setAttribute('data-parser-name', activeParser || '');
        window.scrollTo(0, 0);
      };

      const updateSortButtons = (buttons, state) => {
        buttons.forEach(button => {
          const key = button.getAttribute('data-sort-key') || '';
          const defaultDir = button.getAttribute('data-sort-default-dir') || 'desc';
          const isActive = key === state.key;
          const direction = state.direction === 'asc' ? 'asc' : 'desc';
          const nextDir = isActive ? (direction === 'asc' ? 'desc' : 'asc') : defaultDir;
          button.classList.toggle('active', isActive);
          button.setAttribute('data-sort-dir', nextDir);
          const arrow = button.querySelector('.sort-arrow');
          if (arrow) {
            arrow.textContent = isActive ? (direction === 'asc' ? '▲' : '▼') : '';
          }
        });
      };

      const updateFilterChips = () => {
        runFilterChips.forEach(chip => {
          const type = chip.getAttribute('data-filter-type') || '';
          const rawValue = chip.getAttribute('data-filter-value') || '';
          let isActive = false;
          if (type === 'status') {
            const value = normalizeText(rawValue);
            isActive = (runFilterState.status || '') === value;
            if (!runFilterState.status && !value) isActive = true;
          } else if (type === 'days') {
            const value = parseNumber(rawValue);
            const current = Number.isFinite(runFilterState.days) ? runFilterState.days : null;
            isActive = (current || null) === (value || null);
          } else if (type === 'parser') {
            const value = normalizeText(rawValue);
            isActive = (runFilterState.parser || '') === value;
            if (!runFilterState.parser && !value) isActive = true;
          }
          chip.classList.toggle('active', isActive);
        });
      };

      const setAggregateDisplay = mode => {
        const nextMode = mode === 'percent' ? 'percent' : 'count';
        aggregateDisplayState.mode = nextMode;
        body.setAttribute('data-aggregate-display', nextMode);
        if (aggregateToggle) {
          aggregateToggle.textContent = nextMode === 'percent' ? 'Show Counts' : 'Show %';
          aggregateToggle.classList.toggle('active', nextMode === 'percent');
          aggregateToggle.setAttribute('aria-pressed', nextMode === 'percent' ? 'true' : 'false');
        }
      };

      const setParserDurationView = mode => {
        if (!hasParserDurationToggle) return;
        const nextMode = mode === 'all' ? 'all' : 'top';
        const showAll = nextMode === 'all';
        toggleHidden(parserDurationCharts.top, showAll);
        toggleHidden(parserDurationCharts.all, !showAll);
        toggleHidden(parserDurationLegends.top, showAll);
        toggleHidden(parserDurationLegends.all, !showAll);
        toggleHidden(parserDurationSubtitles.top, showAll);
        toggleHidden(parserDurationSubtitles.all, !showAll);
        if (parserDurationToggle) {
          parserDurationToggle.textContent = showAll ? 'Show top parsers' : 'Show all parsers';
          parserDurationToggle.classList.toggle('active', showAll);
          parserDurationToggle.setAttribute('aria-pressed', showAll ? 'true' : 'false');
        }
        body.setAttribute('data-parser-duration-view', nextMode);
      };

      const sortParserRows = () => {
        if (!parserList) return;
        const rows = Array.from(parserList.querySelectorAll('[data-row="parser"]'));
        const direction = parserSortState.direction === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
          const aData = a.dataset;
          const bData = b.dataset;
          let diff = 0;
          if (parserSortState.key === 'name') {
            diff = String(aData.parserName || '').localeCompare(String(bData.parserName || ''));
          } else if (parserSortState.key === 'events') {
            diff = parseNumber(aData.parserFinalEvents) - parseNumber(bData.parserFinalEvents);
          } else if (parserSortState.key === 'actions') {
            diff = parseNumber(aData.parserActions) - parseNumber(bData.parserActions);
          } else if (parserSortState.key === 'new') {
            diff = parseNumber(aData.parserNew) - parseNumber(bData.parserNew);
          } else if (parserSortState.key === 'merge') {
            diff = parseNumber(aData.parserMerge) - parseNumber(bData.parserMerge);
          } else if (parserSortState.key === 'conflict') {
            diff = parseNumber(aData.parserConflict) - parseNumber(bData.parserConflict);
          } else if (parserSortState.key === 'last-run') {
            diff = parseNumber(aData.parserLastRun) - parseNumber(bData.parserLastRun);
          } else if (parserSortState.key === 'duration') {
            diff = parseNumber(aData.parserDuration) - parseNumber(bData.parserDuration);
          } else if (parserSortState.key === 'status') {
            diff = parseNumber(aData.parserStatusRank) - parseNumber(bData.parserStatusRank);
            if (diff === 0) {
              diff = parseNumber(aData.parserActions) - parseNumber(bData.parserActions);
            }
          }
          if (diff === 0) {
            diff = String(aData.parserName || '').localeCompare(String(bData.parserName || ''));
          }
          return diff * direction;
        });
        rows.forEach(row => parserList.appendChild(row));
      };

      const sortAggregateRows = () => {
        if (!aggregateList) return;
        const rows = Array.from(aggregateList.querySelectorAll('[data-row="aggregate-parser"]'));
        const direction = aggregateSortState.direction === 'asc' ? 1 : -1;
        const usePercent = aggregateDisplayState.mode === 'percent';
        rows.sort((a, b) => {
          const aData = a.dataset;
          const bData = b.dataset;
          let diff = 0;
          if (aggregateSortState.key === 'name') {
            diff = String(aData.aggregateName || '').localeCompare(String(bData.aggregateName || ''));
          } else if (aggregateSortState.key === 'new') {
            diff = parseNumber(aData.aggregateNew) - parseNumber(bData.aggregateNew);
          } else if (aggregateSortState.key === 'merge') {
            diff = parseNumber(aData.aggregateMerge) - parseNumber(bData.aggregateMerge);
          } else if (aggregateSortState.key === 'conflict') {
            diff = parseNumber(aData.aggregateConflict) - parseNumber(bData.aggregateConflict);
          } else if (aggregateSortState.key === 'runs') {
            diff = parseNumber(aData.aggregateRuns) - parseNumber(bData.aggregateRuns);
          } else if (aggregateSortState.key === 'success') {
            diff = usePercent
              ? parseNumber(aData.aggregateSuccessPercent) - parseNumber(bData.aggregateSuccessPercent)
              : parseNumber(aData.aggregateSuccess) - parseNumber(bData.aggregateSuccess);
          } else if (aggregateSortState.key === 'warning') {
            diff = usePercent
              ? parseNumber(aData.aggregateWarningPercent) - parseNumber(bData.aggregateWarningPercent)
              : parseNumber(aData.aggregateWarning) - parseNumber(bData.aggregateWarning);
          } else if (aggregateSortState.key === 'failed') {
            diff = usePercent
              ? parseNumber(aData.aggregateFailedPercent) - parseNumber(bData.aggregateFailedPercent)
              : parseNumber(aData.aggregateFailed) - parseNumber(bData.aggregateFailed);
          }
          if (diff === 0) {
            diff = String(aData.aggregateName || '').localeCompare(String(bData.aggregateName || ''));
          }
          return diff * direction;
        });
        rows.forEach(row => aggregateList.appendChild(row));
      };

      const matchesRunFilters = row => {
        const data = row.dataset;
        if (runFilterState.status) {
          if (runFilterState.status === 'issues') {
            const errors = parseNumber(data.runErrors);
            const warnings = parseNumber(data.runWarnings);
            if (errors <= 0 && warnings <= 0) return false;
          } else {
            const status = normalizeText(data.runStatus);
            if (status !== runFilterState.status) return false;
          }
        }
        if (runFilterState.parser) {
          const names = normalizeText(data.runParserNames || '');
          if (!names.includes(runFilterState.parser)) return false;
        }
        if (runFilterState.days) {
          const finished = parseNumber(data.runFinished);
          const cutoff = Date.now() - (runFilterState.days * 24 * 60 * 60 * 1000);
          if (finished < cutoff) return false;
        }
        return true;
      };

      const sortRunRows = rows => {
        const direction = runSortState.direction === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
          const aData = a.dataset;
          const bData = b.dataset;
          let diff = 0;
          if (runSortState.key === 'run-id') {
            diff = String(aData.runId || '').localeCompare(String(bData.runId || ''));
          } else if (runSortState.key === 'finished') {
            diff = parseNumber(aData.runFinished) - parseNumber(bData.runFinished);
          } else if (runSortState.key === 'status') {
            diff = parseNumber(aData.runStatusRank) - parseNumber(bData.runStatusRank);
          } else if (runSortState.key === 'new') {
            diff = parseNumber(aData.runNew) - parseNumber(bData.runNew);
          } else if (runSortState.key === 'merge') {
            diff = parseNumber(aData.runMerge) - parseNumber(bData.runMerge);
          } else if (runSortState.key === 'conflict') {
            diff = parseNumber(aData.runConflict) - parseNumber(bData.runConflict);
          } else if (runSortState.key === 'issues') {
            diff = parseNumber(aData.runIssues) - parseNumber(bData.runIssues);
          } else if (runSortState.key === 'errors') {
            diff = parseNumber(aData.runErrors) - parseNumber(bData.runErrors);
          } else if (runSortState.key === 'warnings') {
            diff = parseNumber(aData.runWarnings) - parseNumber(bData.runWarnings);
          } else if (runSortState.key === 'duration') {
            diff = parseNumber(aData.runDuration) - parseNumber(bData.runDuration);
          } else if (runSortState.key === 'final-events') {
            diff = parseNumber(aData.runFinalEvents) - parseNumber(bData.runFinalEvents);
          } else if (runSortState.key === 'total-events') {
            diff = parseNumber(aData.runTotalEvents) - parseNumber(bData.runTotalEvents);
          } else if (runSortState.key === 'parsers') {
            diff = parseNumber(aData.runParsers) - parseNumber(bData.runParsers);
          }
          if (diff === 0) {
            diff = parseNumber(aData.runFinished) - parseNumber(bData.runFinished);
          }
          return diff * direction;
        });
        return rows;
      };

      const applyRunFiltersAndSort = () => {
        if (!runList) return;
        const rows = Array.from(runList.querySelectorAll('[data-row="run"]'));
        const visibleRows = rows.filter(matchesRunFilters);
        const visibleSet = new Set(visibleRows);
        const hiddenRows = rows.filter(row => !visibleSet.has(row));
        const sortedVisible = sortRunRows(visibleRows);
        sortedVisible.forEach(row => {
          row.classList.remove('hidden');
          runList.appendChild(row);
        });
        hiddenRows.forEach(row => {
          row.classList.add('hidden');
          runList.appendChild(row);
        });
      };

      navLinks.forEach(link => {
        link.addEventListener('click', event => {
          const mode = link.getAttribute('data-nav-view');
          if (!mode) return;
          event.preventDefault();
          const parser = link.getAttribute('data-nav-parser') || '';
          setActiveView(mode, parser);
        });
      });

      parserSortButtons.forEach(button => {
        button.addEventListener('click', event => {
          const key = button.getAttribute('data-sort-key');
          const dir = button.getAttribute('data-sort-dir');
          if (!key || !dir) return;
          event.preventDefault();
          parserSortState.key = key;
          parserSortState.direction = normalizeDirection(dir);
          updateSortButtons(parserSortButtons, parserSortState);
          sortParserRows();
        });
      });

      aggregateSortButtons.forEach(button => {
        button.addEventListener('click', event => {
          const key = button.getAttribute('data-sort-key');
          const dir = button.getAttribute('data-sort-dir');
          if (!key || !dir) return;
          event.preventDefault();
          aggregateSortState.key = key;
          aggregateSortState.direction = normalizeDirection(dir);
          updateSortButtons(aggregateSortButtons, aggregateSortState);
          sortAggregateRows();
        });
      });

      runSortButtons.forEach(button => {
        button.addEventListener('click', event => {
          const key = button.getAttribute('data-sort-key');
          const dir = button.getAttribute('data-sort-dir');
          if (!key || !dir) return;
          event.preventDefault();
          runSortState.key = key;
          runSortState.direction = normalizeDirection(dir);
          updateSortButtons(runSortButtons, runSortState);
          applyRunFiltersAndSort();
        });
      });

      runFilterChips.forEach(chip => {
        chip.addEventListener('click', event => {
          const type = chip.getAttribute('data-filter-type');
          const rawValue = chip.getAttribute('data-filter-value') || '';
          if (!type) return;
          event.preventDefault();
          if (type === 'status') {
            runFilterState.status = normalizeText(rawValue) || null;
          } else if (type === 'days') {
            const value = parseNumber(rawValue);
            runFilterState.days = value > 0 ? value : null;
          } else if (type === 'parser') {
            runFilterState.parser = normalizeText(rawValue) || null;
          }
          updateFilterChips();
          applyRunFiltersAndSort();
        });
      });

      if (aggregateToggle) {
        aggregateToggle.addEventListener('click', event => {
          event.preventDefault();
          const nextMode = aggregateDisplayState.mode === 'percent' ? 'count' : 'percent';
          setAggregateDisplay(nextMode);
          sortAggregateRows();
        });
      }

      if (hasParserDurationToggle) {
        parserDurationToggle.addEventListener('click', event => {
          event.preventDefault();
          const current = body.getAttribute('data-parser-duration-view') || 'top';
          setParserDurationView(current === 'all' ? 'top' : 'all');
        });
      }

      const initialMode = body.getAttribute('data-view-mode') || 'parsers';
      const initialParser = body.getAttribute('data-parser-name') || '';
      setActiveView(initialMode, initialParser);
      setAggregateDisplay(aggregateDisplayState.mode);
      setParserDurationView(body.getAttribute('data-parser-duration-view') || 'top');
      updateSortButtons(parserSortButtons, parserSortState);
      updateSortButtons(aggregateSortButtons, aggregateSortState);
      updateSortButtons(runSortButtons, runSortState);
      updateFilterChips();
      sortParserRows();
      sortAggregateRows();
      applyRunFiltersAndSort();
    })();
  </script>
</body>
</html>`;

    return html;
  }

  async renderAppTable(data, view, sortState) {
    const table = new UITable();
    table.backgroundColor = new Color(BRAND.primary);
    table.showSeparators = false;

    const logoImage = await this.loadLogoImage();
    this.addTableHeader(table, logoImage);
    this.addViewSwitcherRow(table, view);

    const latest = data.latestRecord;
    const summary = data.summary;
    const parserHealth = data.parserHealth;
    const records = Array.isArray(data.records) ? data.records : [];
    const parserSort = sortState || data.sortState || this.resolveSort(view);
    const runSortState = data.runSortState || this.resolveRunSort(view);
    const runSortResolved = runSortState || this.getDefaultRunSort();
    const runFilters = data.runFilters || this.resolveRunFilters(view);
    const runItems = Array.isArray(data.runItems) ? data.runItems : this.buildRunItems(records);
    const filteredRuns = this.applyRunFilters(runItems, runFilters);
    const sortedRuns = this.sortRunItems(filteredRuns, runSortResolved);
    const recentRecords = this.getRecentRecords(records, this.getAppHistoryLimit());
    const chartSize = this.getAppChartSize();

    const isParserHealthView = view.mode === 'parsers';
    const isAllRunsView = view.mode === 'runs';

    if (!latest && !isAllRunsView) {
      this.addInfoRow(table, 'No metrics found yet.', 'Run the scraper to generate metrics.');
      await table.present();
      return;
    }
    if (isAllRunsView && runItems.length === 0) {
      this.addInfoRow(table, 'No run metrics found.', 'Run the scraper to generate metrics.');
      await table.present();
      return;
    }

    if (isParserHealthView) {
      const lastRun = latest?.finished_at ? this.formatRelativeTime(latest.finished_at) : 'Unknown';
      const latestErrors = Number.isFinite(latest?.errors_count) ? latest.errors_count : 0;
      const latestWarnings = this.getRunWarningCount(latest);
      const totals = latest?.totals || {};
      const finalEvents = totals.final_bear_events || 0;
      const historyCount = Math.max(recentRecords.length, 1);
      const parserCounts = this.getParserStatusCounts(parserHealth.items);
      const runningCount = parserCounts.running;
      const overallHealthValue = this.formatPercent(parserCounts.healthy, runningCount);
      const healthSummary = runningCount > 0
        ? `Healthy ${this.formatNumber(parserCounts.healthy)}/${this.formatNumber(runningCount)} running • Warnings ${this.formatNumber(parserCounts.warning)} • Failed ${this.formatNumber(parserCounts.failed)} • Idle ${this.formatNumber(parserCounts.notRun)}`
        : `Warnings ${this.formatNumber(parserCounts.warning)} • Failed ${this.formatNumber(parserCounts.failed)} • Idle ${this.formatNumber(parserCounts.notRun)}`;
      const runHealth = this.getRunHealthSummary(records);
      const failureStreak = runHealth.failureStreak || 0;
      const lastSuccessAt = runHealth.lastSuccessAt;
      const lastSuccessLabel = lastSuccessAt ? this.formatRelativeTime(lastSuccessAt) : 'Never';
      const latestStatusLabel = this.formatStatusLabel(runHealth.latestStatus);

      const lastSuccessSummary = lastSuccessAt
        ? `Last success: ${lastSuccessLabel}`
        : 'Last success: Never';
      this.addSectionHeader(table, 'Parser Health Snapshot');
      this.addMetricRow(table, overallHealthValue, 'Parser health');
      this.addInfoRow(table, healthSummary, `Total parsers: ${this.formatNumber(parserCounts.total)}`);
      this.addInfoRow(
        table,
        `Last run: ${lastRun} (${latestStatusLabel}) • Issue streak: ${this.formatNumber(failureStreak)}`,
        `Issues: Errors ${this.formatNumber(latestErrors)} • Warnings ${this.formatNumber(latestWarnings)} • ${lastSuccessSummary}`
      );

      this.addSectionHeader(table, 'Parser Health (Latest)');
      this.addParserTableHeader(table);

      const sortedItems = this.sortParserItems(parserHealth.items, parserSort).slice(0, 8);
      sortedItems.forEach(item => {
        this.addParserHealthRow(table, item);
      });
      if (parserHealth.items.length > sortedItems.length) {
        this.addInfoRow(table, `+${parserHealth.items.length - sortedItems.length} more parsers`, 'Showing top parsers by recent health.');
      }

      const finalSeries = this.getSeries(recentRecords, record => record?.totals?.final_bear_events || 0);
      const finalChart = this.buildLineChartImage(finalSeries, chartSize, {
        lineColor: new Color(CHART_STYLE.line),
        fillColor: new Color(CHART_STYLE.line, CHART_STYLE.fillOpacity)
      });
      this.addChartSection(table, `Final Events (Last ${historyCount} Runs)`, finalChart, {
        subtitle: `Latest: ${this.formatNumber(finalEvents)}`,
        xLabel: CHART_AXIS_LABELS.runs,
        yLabel: CHART_AXIS_LABELS.finalEvents
      });

      const durationSeries = this.getSeries(recentRecords, record => this.getDurationMinutes(record?.duration_ms));
      const durationChart = this.buildLineChartImage(durationSeries, chartSize, {
        lineColor: new Color(CHART_STYLE.lineSecondary),
        fillColor: new Color(CHART_STYLE.lineSecondary, CHART_STYLE.fillOpacity)
      });
      this.addChartSection(table, `Duration (Minutes, Last ${historyCount} Runs)`, durationChart, {
        subtitle: `Latest: ${this.formatDuration(latest?.duration_ms)}`,
        xLabel: CHART_AXIS_LABELS.runs,
        yLabel: CHART_AXIS_LABELS.durationMinutes
      });

      const durationParserNames = this.getParserNamesByRecentRuns(recentRecords, MAX_PARSER_DURATION_SERIES);
      if (durationParserNames.length > 0) {
        const parserDurationSeries = durationParserNames.map((name, index) => ({
          label: name,
          values: this.getParserDurationSeries(recentRecords, name),
          color: CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]
        }));
        const parserDurationChart = this.buildMultiLineChartImage(parserDurationSeries, chartSize, {
          lineWidth: CHART_STYLE.lineWidth
        });
        if (parserDurationChart) {
          const legend = `Parsers: ${durationParserNames.join(', ')}`;
          const subtitle = durationParserNames.length > 1
            ? `Top ${durationParserNames.length} parsers by recent runs`
            : `Parser duration over last ${historyCount} runs`;
          this.addChartSection(table, `Parser Durations (Minutes, Last ${historyCount} Runs)`, parserDurationChart, {
            subtitle,
            xLabel: CHART_AXIS_LABELS.runs,
            yLabel: CHART_AXIS_LABELS.durationMinutes,
            legend
          });
        }
      }

      if (summary?.totals) {
        this.addSectionHeader(table, 'All Time Totals');
        const summaryTotals = summary.totals;
        const statusCounts = this.normalizeStatusCounts(summaryTotals.statuses);
        const actions = summaryTotals.actions || this.createActionCounts();
        const runs = summaryTotals.runs || 0;
        const parserCount = allTimeParserRows.length || (parserHealth?.items?.length || 0);
        const successPercent = this.formatPercent(statusCounts.success || 0, runs);
        const warningPercent = this.formatPercent(statusCounts.warning || 0, runs);
        const failedPercent = this.formatPercent(statusCounts.failed || 0, runs);
        this.addInfoRow(
          table,
          `Runs: ${this.formatNumber(runs)}`,
          `Parsers: ${this.formatNumber(parserCount)}`
        );
        this.addInfoRow(
          table,
          `Success: ${this.formatNumber(statusCounts.success || 0)} (${successPercent})`,
          `Warnings: ${this.formatNumber(statusCounts.warning || 0)} (${warningPercent}) • Failed: ${this.formatNumber(statusCounts.failed || 0)} (${failedPercent})`
        );
        this.addInfoRow(
          table,
          `Adds: ${this.formatNumber(actions.new || 0)} • Merges: ${this.formatNumber(actions.merge || 0)}`,
          `Conflicts: ${this.formatNumber(actions.conflict || 0)}`
        );
      }
    } else if (isAllRunsView) {
      this.addSectionHeader(table, 'All Time Totals');
      if (!summary?.totals) {
        this.addInfoRow(table, 'No summary metrics found.', 'Run the scraper to generate summary metrics.');
      } else {
        const totals = summary.totals;
        const statusCounts = this.normalizeStatusCounts(totals.statuses);
        const actions = totals.actions || this.createActionCounts();
        const runs = totals.runs || 0;
        const parserCount = allTimeParserRows.length || (parserHealth?.items?.length || 0);
        const successPercent = this.formatPercent(statusCounts.success || 0, runs);
        const warningPercent = this.formatPercent(statusCounts.warning || 0, runs);
        const failedPercent = this.formatPercent(statusCounts.failed || 0, runs);
        this.addInfoRow(
          table,
          `Runs: ${this.formatNumber(runs)}`,
          `Parsers: ${this.formatNumber(parserCount)}`
        );
        this.addInfoRow(
          table,
          `Success: ${this.formatNumber(statusCounts.success || 0)} (${successPercent})`,
          `Warnings: ${this.formatNumber(statusCounts.warning || 0)} (${warningPercent}) • Failed: ${this.formatNumber(statusCounts.failed || 0)} (${failedPercent})`
        );
        this.addInfoRow(
          table,
          `Adds: ${this.formatNumber(actions.new || 0)} • Merges: ${this.formatNumber(actions.merge || 0)}`,
          `Conflicts: ${this.formatNumber(actions.conflict || 0)}`
        );

        const parserRows = allTimeParserRows;
        if (parserRows.length > 0) {
          const sortedParserRows = this.sortAggregateParserRows(parserRows, this.getDefaultAggregateSort());
          this.addSectionHeader(table, 'Per-Parser Totals');
          sortedParserRows.forEach(row => {
            const rowActions = row.actions || this.createActionCounts();
            const rowStatuses = this.normalizeStatusCounts(row.statusCounts);
            const rowRuns = row.runs || 0;
            const rowSuccessPercent = this.formatPercent(rowStatuses.success || 0, rowRuns);
            const rowWarningPercent = this.formatPercent(rowStatuses.warning || 0, rowRuns);
            const rowFailedPercent = this.formatPercent(rowStatuses.failed || 0, rowRuns);
            const summaryLine = [
              `Adds ${this.formatNumber(rowActions.new || 0)}`,
              `Merges ${this.formatNumber(rowActions.merge || 0)}`,
              `Conflicts ${this.formatNumber(rowActions.conflict || 0)}`,
              `Success ${this.formatNumber(rowStatuses.success || 0)} (${rowSuccessPercent})`,
              `Warnings ${this.formatNumber(rowStatuses.warning || 0)} (${rowWarningPercent})`,
              `Failed ${this.formatNumber(rowStatuses.failed || 0)} (${rowFailedPercent})`
            ].join(' • ');
            this.addInfoRow(
              table,
              `${row.name} • Runs ${this.formatNumber(row.runs || 0)}`,
              summaryLine
            );
          });
        }
      }
      this.addSectionHeader(table, 'All Runs');
      this.addRunFilterRow(table, runSortResolved, runFilters);
      this.addRunSortRow(table, runSortResolved, runFilters);
      this.addRunTableHeader(table);
      if (sortedRuns.length === 0) {
        this.addInfoRow(table, 'No runs match filters.', 'Adjust filters to see results.');
      } else {
        sortedRuns.forEach(run => {
          this.addRunRow(table, run);
        });
      }
    } else if (view.mode === 'parser') {
      this.addSectionHeader(table, `Parser Detail: ${view.parserName}`);
      const record = parserHealth.items.find(item => item.name === view.parserName);
      const hasAllTime = (record?.allTimeRuns || 0) > 0;
      const hasHistory = (record?.historyRuns || 0) > 0;
      const hasLastRun = !!record?.lastRunAt;
      if (!record || (!record.ran && !hasAllTime && !hasHistory)) {
        this.addInfoRow(table, 'No parser metrics available.', 'Run the parser to collect metrics.');
      } else {
        if (hasLastRun) {
          this.addSectionHeader(table, 'Latest Run');
          this.addInfoRow(
            table,
            `Last run: ${this.formatRelativeTime(record.lastRunAt)}`,
            `Final events: ${this.formatNumber(record.finalBearEvents)}`
          );
          this.addInfoRow(table, `Duration: ${this.formatDuration(record.durationMs)}`, `Actions: ${this.formatActions(record.actions)}`);
          if (record?.lastRunId) {
            const linkRow = new UITableRow();
            linkRow.backgroundColor = new Color(BRAND.secondary);
            const linkCell = linkRow.addText('Open last run details', `Run ID: ${record.lastRunId}`);
            linkCell.titleColor = new Color('#ffffff');
            linkCell.subtitleColor = new Color('#ffffff');
            linkCell.titleFont = Font.boldSystemFont(FONT_SIZES.app.label);
            linkCell.subtitleFont = Font.systemFont(FONT_SIZES.app.small);
            linkRow.onSelect = () => {
              const url = this.buildScriptableUrl(DISPLAY_SAVED_RUN_SCRIPT, {
                runId: record.lastRunId,
                readOnly: true
              });
              Safari.open(url);
            };
            table.addRow(linkRow);
          }
        } else {
          this.addInfoRow(table, 'No recent run data.', 'Only historical totals are available.');
        }

        if (hasAllTime) {
          const totals = record.allTimeTotals || {};
          this.addMetricRow(table, this.formatNumber(totals.final_bear_events || 0), 'All Time Final Events');
          this.addInfoRow(
            table,
            `Runs: ${this.formatNumber(record.allTimeRuns || 0)}`,
            `Total events: ${this.formatNumber(totals.total_events || 0)}`
          );
          this.addInfoRow(table, 'All Time Actions', this.formatActions(record.allTimeActions));
          const avgDurationMs = record.allTimeRuns > 0
            ? Math.round(record.allTimeDurationMs / record.allTimeRuns)
            : null;
          if (avgDurationMs) {
            this.addInfoRow(table, `Average duration: ${this.formatDuration(avgDurationMs)}`);
          }
        } else if (hasHistory) {
          const totals = record.historyTotals || {};
          this.addMetricRow(table, this.formatNumber(totals.final_bear_events || 0), 'Recent Final Events');
          this.addInfoRow(
            table,
            `Runs: ${this.formatNumber(record.historyRuns || 0)}`,
            `Total events: ${this.formatNumber(totals.total_events || 0)}`
          );
          this.addInfoRow(table, 'Recent Actions', this.formatActions(record.historyActions));
          const avgDurationMs = record.historyRuns > 0
            ? Math.round(record.historyDurationMs / record.historyRuns)
            : null;
          if (avgDurationMs) {
            this.addInfoRow(table, `Average duration: ${this.formatDuration(avgDurationMs)}`);
          }
        } else {
          this.addInfoRow(table, 'History summary unavailable.', 'Run the scraper to generate summary metrics.');
        }

        const series = this.getParserSeries(recentRecords, view.parserName);
        if (series.length > 0) {
          const parserAverage = this.getSeriesAverage(series);
          const parserSeriesList = [
            { label: view.parserName || 'Parser', values: series, color: CHART_STYLE.lineSecondary }
          ];
          if (Number.isFinite(parserAverage)) {
            parserSeriesList.push({
              label: 'Average',
              values: new Array(series.length).fill(parserAverage),
              color: CHART_STYLE.line
            });
          }
          const parserChart = this.buildMultiLineChartImage(parserSeriesList, chartSize, {
            lineWidth: CHART_STYLE.lineWidth
          });
          const parserLegend = parserSeriesList.map(item => item.label).filter(Boolean).join(' • ');
          const avgLabel = Number.isFinite(parserAverage)
            ? `Avg: ${this.formatNumber(Math.round(parserAverage))}`
            : null;
          const parserRunCount = series.length || 1;
          this.addChartSection(table, `Events Per Run (Last ${parserRunCount} Parser Runs)`, parserChart, {
            subtitle: avgLabel,
            xLabel: CHART_AXIS_LABELS.runs,
            yLabel: CHART_AXIS_LABELS.finalEvents,
            legend: parserLegend ? `Legend: ${parserLegend}` : null
          });
        } else {
          this.addInfoRow(table, 'No recent parser runs to chart.');
        }

        const durationSeries = this.getParserDurationSeries(recentRecords, view.parserName);
        if (durationSeries.length > 0) {
          const durationAverage = this.getSeriesAverage(durationSeries);
          const durationSeriesList = [
            { label: view.parserName || 'Parser', values: durationSeries, color: CHART_STYLE.line }
          ];
          if (Number.isFinite(durationAverage)) {
            durationSeriesList.push({
              label: 'Average',
              values: new Array(durationSeries.length).fill(durationAverage),
              color: CHART_STYLE.lineSecondary
            });
          }
          const durationChart = this.buildMultiLineChartImage(durationSeriesList, chartSize, {
            lineWidth: CHART_STYLE.lineWidth
          });
          const durationLegend = durationSeriesList.map(item => item.label).filter(Boolean).join(' • ');
          const avgDurationMs = Number.isFinite(durationAverage)
            ? Math.round(durationAverage * 60000)
            : null;
          const durationSubtitleParts = [];
          if (avgDurationMs !== null) durationSubtitleParts.push(`Avg: ${this.formatDuration(avgDurationMs)}`);
          if (hasLastRun && record?.durationMs) durationSubtitleParts.push(`Latest: ${this.formatDuration(record.durationMs)}`);
          const durationSubtitle = durationSubtitleParts.length ? durationSubtitleParts.join(' • ') : null;
          const durationRunCount = durationSeries.length || 1;
          this.addChartSection(table, `Duration (Minutes, Last ${durationRunCount} Parser Runs)`, durationChart, {
            subtitle: durationSubtitle,
            xLabel: CHART_AXIS_LABELS.runs,
            yLabel: CHART_AXIS_LABELS.durationMinutes,
            legend: durationLegend ? `Legend: ${durationLegend}` : null
          });
        } else {
          this.addInfoRow(table, 'No recent parser runs to chart.');
        }
      }
    } else {
      view.mode = 'parsers';
      await this.renderAppTable(data, view, parserSort);
      return;
    }

    if (latest?.run_id) {
      const linkRow = new UITableRow();
      linkRow.backgroundColor = new Color(BRAND.secondary);
      const linkCell = linkRow.addText('Open last run details', `Run ID: ${latest.run_id}`);
      linkCell.titleColor = new Color('#ffffff');
      linkCell.subtitleColor = new Color('#ffffff');
      linkCell.titleFont = Font.boldSystemFont(FONT_SIZES.app.label);
      linkCell.subtitleFont = Font.systemFont(FONT_SIZES.app.small);
      linkRow.onSelect = () => {
        const url = this.buildScriptableUrl(DISPLAY_SAVED_RUN_SCRIPT, {
          runId: latest.run_id,
          readOnly: true
        });
        Safari.open(url);
      };
      table.addRow(linkRow);
    }

    await table.present();
  }

  addTableHeader(table, logoImage) {
    const header = new UITableRow();
    header.backgroundColor = new Color(BRAND.primary);
    if (logoImage) {
      const img = header.addImage(logoImage);
      img.imageSize = new Size(34, 34);
    }
    const titleCell = header.addText('Chunky Dad Metrics', 'Scraper Dashboard');
    titleCell.titleFont = Font.boldSystemFont(FONT_SIZES.app.title);
    titleCell.titleColor = new Color(BRAND.text);
    titleCell.subtitleFont = Font.systemFont(FONT_SIZES.app.label);
    titleCell.subtitleColor = new Color(BRAND.textMuted);
    table.addRow(header);
  }

  getViewOptions() {
    return [
      { mode: 'parsers', label: 'Parser Health' },
      { mode: 'runs', label: 'All Runs' }
    ];
  }

  getViewLabel(view) {
    if (!view) return 'Parser Health';
    if (view.mode === 'parser') {
      return view.parserName ? `Parser Detail: ${view.parserName}` : 'Parser Detail';
    }
    const option = this.getViewOptions().find(item => item.mode === view.mode);
    return option ? option.label : 'Parser Health';
  }

  async presentViewPicker(currentView) {
    const options = this.getViewOptions();
    const alert = new Alert();
    alert.title = 'Choose view';
    alert.message = `Current: ${this.getViewLabel(currentView)}`;
    options.forEach(option => alert.addAction(option.label));
    alert.addCancelAction('Cancel');
    const idx = await alert.present();
    if (idx < 0 || idx >= options.length) return null;
    return options[idx].mode;
  }

  addViewSwitcherRow(table, view) {
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.secondary);
    const cell = row.addText(`View: ${this.getViewLabel(view)}`, 'Tap to switch');
    cell.titleFont = Font.boldSystemFont(FONT_SIZES.app.label);
    cell.subtitleFont = Font.systemFont(FONT_SIZES.app.small);
    cell.titleColor = new Color('#ffffff');
    cell.subtitleColor = new Color('#ffffff');
    row.onSelect = async () => {
      const nextView = await this.presentViewPicker(view);
      if (!nextView) return;
      const url = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, {
        view: nextView
      });
      Safari.open(url);
    };
    table.addRow(row);
  }

  addMetricRow(table, value, label) {
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);
    const cell = row.addText(value, label);
    cell.titleFont = Font.boldSystemFont(FONT_SIZES.app.metric);
    cell.subtitleFont = Font.systemFont(FONT_SIZES.app.label);
    cell.titleColor = new Color(BRAND.text);
    cell.subtitleColor = new Color(BRAND.textMuted);
    table.addRow(row);
  }

  addChartSection(table, title, image, options = null) {
    let subtitle = null;
    let xLabel = null;
    let yLabel = null;
    let legend = null;
    if (typeof options === 'string') {
      subtitle = options;
    } else if (options && typeof options === 'object') {
      subtitle = options.subtitle || null;
      xLabel = options.xLabel || null;
      yLabel = options.yLabel || null;
      legend = options.legend || null;
    }

    this.addSectionHeader(table, title);
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);
    const size = image?.size || new Size(320, 120);
    row.height = size.height + 12;
    const img = row.addImage(image);
    img.imageSize = new Size(size.width, size.height);
    table.addRow(row);

    if (xLabel || yLabel) {
      const axisParts = [];
      if (xLabel) axisParts.push(`X: ${xLabel}`);
      if (yLabel) axisParts.push(`Y: ${yLabel}`);
      this.addInfoRow(table, axisParts.join(' | '));
    }
    if (legend) {
      this.addInfoRow(table, legend);
    }
    if (subtitle) {
      this.addInfoRow(table, subtitle);
    }
  }

  getParserSortOptions() {
    return [
      { key: 'status', label: 'Status', defaultDirection: 'desc' },
      { key: 'last-run', label: 'Last run', defaultDirection: 'desc' },
      { key: 'duration', label: 'Duration', defaultDirection: 'desc' },
      { key: 'new', label: 'Adds', defaultDirection: 'desc' },
      { key: 'merge', label: 'Merges', defaultDirection: 'desc' },
      { key: 'conflict', label: 'Conflicts', defaultDirection: 'desc' },
      { key: 'name', label: 'Parser', defaultDirection: 'asc' }
    ];
  }

  getSortLabel(sortState) {
    if (!sortState) return 'Default';
    const options = this.getParserSortOptions();
    const match = options.find(option => option.key === sortState.key);
    const label = match ? match.label : sortState.key;
    const direction = sortState.direction === 'asc' ? 'asc' : 'desc';
    return `${label} ${direction}`;
  }

  async presentSortPicker(currentSort) {
    const options = this.getParserSortOptions();
    const alert = new Alert();
    alert.title = 'Sort parsers';
    alert.message = 'Choose the sort order';
    options.forEach(option => alert.addAction(option.label));
    alert.addCancelAction('Cancel');
    const idx = await alert.present();
    if (idx < 0 || idx >= options.length) return null;
    const chosen = options[idx];
    let direction = chosen.defaultDirection || this.getDefaultSortDirection(chosen.key);
    if (currentSort?.key === chosen.key) {
      direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    }
    return { key: chosen.key, direction };
  }

  addParserSortRow(table, sortState) {
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);
    const label = this.getSortLabel(sortState);
    const cell = row.addText(`Sort: ${label}`, 'Tap to change');
    cell.titleFont = Font.systemFont(FONT_SIZES.app.label);
    cell.subtitleFont = Font.systemFont(FONT_SIZES.app.small);
    cell.titleColor = new Color(BRAND.text);
    cell.subtitleColor = new Color(BRAND.textMuted);
    row.onSelect = async () => {
      const nextSort = await this.presentSortPicker(sortState);
      if (!nextSort) return;
      const url = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, {
        view: 'parsers',
        sort: nextSort.key,
        dir: nextSort.direction
      });
      Safari.open(url);
    };
    table.addRow(row);
  }

  getRunSortOptions() {
    return [
      { key: 'finished', label: 'Last run', defaultDirection: 'desc' },
      { key: 'run-id', label: 'Run id', defaultDirection: 'desc' },
      { key: 'new', label: 'Adds', defaultDirection: 'desc' },
      { key: 'merge', label: 'Merges', defaultDirection: 'desc' },
      { key: 'conflict', label: 'Conflicts', defaultDirection: 'desc' },
      { key: 'duration', label: 'Duration', defaultDirection: 'desc' },
      { key: 'status', label: 'Status', defaultDirection: 'desc' }
    ];
  }

  getRunSortLabel(sortState) {
    if (!sortState) return 'Default';
    const options = this.getRunSortOptions();
    const match = options.find(option => option.key === sortState.key);
    const label = match ? match.label : sortState.key;
    const direction = sortState.direction === 'asc' ? 'asc' : 'desc';
    return `${label} ${direction}`;
  }

  async presentRunSortPicker(currentSort) {
    const options = this.getRunSortOptions();
    const alert = new Alert();
    alert.title = 'Sort runs';
    alert.message = 'Choose the sort order';
    options.forEach(option => alert.addAction(option.label));
    alert.addCancelAction('Cancel');
    const idx = await alert.present();
    if (idx < 0 || idx >= options.length) return null;
    const chosen = options[idx];
    let direction = chosen.defaultDirection || this.getDefaultRunSortDirection(chosen.key);
    if (currentSort?.key === chosen.key) {
      direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    }
    return { key: chosen.key, direction };
  }

  buildRunListUrl(sortState, filters) {
    return this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, {
      view: 'runs',
      sort: sortState?.key || null,
      dir: sortState?.direction || null,
      status: filters?.status || null,
      parserFilter: filters?.parserFilter || null,
      days: filters?.days || null
    });
  }

  addRunSortRow(table, sortState, filters) {
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);
    const label = this.getRunSortLabel(sortState);
    const cell = row.addText(`Sort: ${label}`, 'Tap to change');
    cell.titleFont = Font.systemFont(FONT_SIZES.app.label);
    cell.subtitleFont = Font.systemFont(FONT_SIZES.app.small);
    cell.titleColor = new Color(BRAND.text);
    cell.subtitleColor = new Color(BRAND.textMuted);
    row.onSelect = async () => {
      const nextSort = await this.presentRunSortPicker(sortState);
      if (!nextSort) return;
      const url = this.buildRunListUrl(nextSort, filters);
      Safari.open(url);
    };
    table.addRow(row);
  }

  async presentRunFilterPicker(currentFilters) {
    const alert = new Alert();
    alert.title = 'Filter runs';
    alert.message = 'Set status, parser, or age filters';
    alert.addTextField('Parser contains', currentFilters?.parserFilter || '');
    alert.addTextField('Last N days (optional)', currentFilters?.days ? String(currentFilters.days) : '');
    const options = [
      { label: 'All statuses', value: null },
      { label: 'Success', value: 'success' },
      { label: 'Warning', value: 'partial' },
      { label: 'Failed', value: 'failed' },
      { label: 'Issues (errors/warnings)', value: 'issues' }
    ];
    options.forEach(option => alert.addAction(option.label));
    alert.addCancelAction('Cancel');
    const idx = await alert.present();
    if (idx < 0 || idx >= options.length) return null;
    const status = options[idx].value;
    const parserFilter = (alert.textFieldValue(0) || '').trim();
    const rawDays = (alert.textFieldValue(1) || '').trim();
    const parsedDays = rawDays ? Number.parseInt(rawDays, 10) : null;
    return {
      status,
      parserFilter: parserFilter || null,
      days: Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : null
    };
  }

  addRunFilterRow(table, sortState, filters) {
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);
    const label = this.formatRunFilterLabel(filters);
    const cell = row.addText(`Filter: ${label}`, 'Tap to change');
    cell.titleFont = Font.systemFont(FONT_SIZES.app.label);
    cell.subtitleFont = Font.systemFont(FONT_SIZES.app.small);
    cell.titleColor = new Color(BRAND.text);
    cell.subtitleColor = new Color(BRAND.textMuted);
    row.onSelect = async () => {
      const nextFilters = await this.presentRunFilterPicker(filters);
      if (!nextFilters) return;
      const url = this.buildRunListUrl(sortState, nextFilters);
      Safari.open(url);
    };
    table.addRow(row);
  }

  addRunTableHeader(table) {
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);
    const runCell = row.addText('Run');
    runCell.widthWeight = 44;
    const addCell = row.addText('Add');
    addCell.widthWeight = 7;
    const mergeCell = row.addText('Mrg');
    mergeCell.widthWeight = 7;
    const conflictCell = row.addText('Cnf');
    conflictCell.widthWeight = 7;
    const finishedCell = row.addText('Last');
    finishedCell.widthWeight = 16;
    const durationCell = row.addText('Dur');
    durationCell.widthWeight = 12;
    const statusCell = row.addText('Stat');
    statusCell.widthWeight = 7;

    [runCell, addCell, mergeCell, conflictCell, finishedCell, durationCell, statusCell].forEach(cell => {
      cell.titleFont = Font.boldSystemFont(FONT_SIZES.app.small);
      cell.titleColor = new Color(BRAND.textMuted);
    });
    table.addRow(row);
  }

  addRunRow(table, run) {
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);

    const runCell = row.addText(this.formatRunId(run.runId));
    runCell.titleFont = Font.systemFont(FONT_SIZES.app.label);
    runCell.titleColor = new Color(BRAND.text);
    runCell.widthWeight = 44;

    const actions = run.actions || this.createActionCounts();
    const addCell = row.addText(this.formatNumber(actions.new || 0));
    addCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    addCell.titleColor = new Color(BRAND.text);
    addCell.widthWeight = 7;

    const mergeCell = row.addText(this.formatNumber(actions.merge || 0));
    mergeCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    mergeCell.titleColor = new Color(BRAND.text);
    mergeCell.widthWeight = 7;

    const conflictCell = row.addText(this.formatNumber(actions.conflict || 0));
    conflictCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    conflictCell.titleColor = new Color(BRAND.text);
    conflictCell.widthWeight = 7;

    const finishedCell = row.addText(this.formatLastRunLabel(run.finishedAt));
    finishedCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    finishedCell.titleColor = new Color(BRAND.text);
    finishedCell.widthWeight = 16;

    const durationLabel = run.durationMs ? this.formatDuration(run.durationMs) : '-';
    const durationCell = row.addText(durationLabel);
    durationCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    durationCell.titleColor = new Color(BRAND.text);
    durationCell.widthWeight = 12;

    const statusMeta = this.getStatusMeta(run.status);
    const statusEmoji = this.getRunStatusEmoji(run.status);
    const statusCell = row.addText(statusEmoji);
    statusCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    statusCell.titleColor = statusMeta.color;
    statusCell.widthWeight = 7;

    row.onSelect = () => {
      if (!run.runId) return;
      const url = this.buildScriptableUrl(DISPLAY_SAVED_RUN_SCRIPT, {
        runId: run.runId,
        readOnly: true
      });
      Safari.open(url);
    };
    table.addRow(row);
  }

  addParserTableHeader(table) {
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);
    const iconCell = row.addText('');
    iconCell.widthWeight = 6;
    const parserCell = row.addText('Parser');
    parserCell.widthWeight = 38;
    const addCell = row.addText('Add');
    addCell.widthWeight = 7;
    const mergeCell = row.addText('Mrg');
    mergeCell.widthWeight = 7;
    const conflictCell = row.addText('Cnf');
    conflictCell.widthWeight = 7;
    const lastRunCell = row.addText('Last');
    lastRunCell.widthWeight = 16;
    const durationCell = row.addText('Dur');
    durationCell.widthWeight = 12;
    const statusCell = row.addText('Stat');
    statusCell.widthWeight = 7;

    [iconCell, parserCell, addCell, mergeCell, conflictCell, lastRunCell, durationCell, statusCell].forEach(cell => {
      cell.titleFont = Font.boldSystemFont(FONT_SIZES.app.small);
      cell.titleColor = new Color(BRAND.textMuted);
    });
    table.addRow(row);
  }

  addParserHealthRow(table, item) {
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);

    const iconSymbol = this.getParserIconSymbol(item);
    const iconImage = this.buildSymbolImage(iconSymbol, 14, new Color(BRAND.text));
    let iconCell = null;
    if (iconImage) {
      iconCell = row.addImage(iconImage);
      iconCell.imageSize = new Size(14, 14);
    } else {
      iconCell = row.addText('');
    }
    iconCell.widthWeight = 6;

    const parserCell = row.addText(item.name);
    parserCell.titleFont = Font.systemFont(FONT_SIZES.app.label);
    parserCell.titleColor = new Color(BRAND.text);
    parserCell.widthWeight = 38;

    const actions = item.actions || this.createActionCounts();
    const addCell = row.addText(this.formatNumber(actions.new || 0));
    addCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    addCell.titleColor = new Color(BRAND.text);
    addCell.widthWeight = 7;

    const mergeCell = row.addText(this.formatNumber(actions.merge || 0));
    mergeCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    mergeCell.titleColor = new Color(BRAND.text);
    mergeCell.widthWeight = 7;

    const conflictCell = row.addText(this.formatNumber(actions.conflict || 0));
    conflictCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    conflictCell.titleColor = new Color(BRAND.text);
    conflictCell.widthWeight = 7;

    const lastRunCell = row.addText(this.formatLastRunLabel(item.lastRunAt));
    lastRunCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    lastRunCell.titleColor = new Color(BRAND.text);
    lastRunCell.widthWeight = 16;

    const durationLabel = Number.isFinite(item?.durationMs) && item.durationMs > 0
      ? this.formatDuration(item.durationMs)
      : '-';
    const durationCell = row.addText(durationLabel);
    durationCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    durationCell.titleColor = new Color(BRAND.text);
    durationCell.widthWeight = 12;

    const statusMeta = this.getParserStatusMeta(item);
    const statusEmoji = this.getParserStatusEmoji(item);
    const statusCell = row.addText(statusEmoji);
    statusCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    statusCell.titleColor = statusMeta.color;
    statusCell.widthWeight = 7;

    row.onSelect = () => {
      if (!item?.name) return;
      const url = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, {
        parser: item.name
      });
      Safari.open(url);
    };

    table.addRow(row);
  }

  addParserRow(table, item) {
    this.addParserHealthRow(table, item);
  }

  addSectionHeader(table, title) {
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);
    const text = row.addText(title);
    text.titleFont = Font.boldSystemFont(FONT_SIZES.app.label);
    text.titleColor = new Color(BRAND.text);
    table.addRow(row);
  }

  addInfoRow(table, title, subtitle) {
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);
    const cell = subtitle ? row.addText(title, subtitle) : row.addText(title);
    cell.titleFont = Font.systemFont(FONT_SIZES.app.label);
    cell.titleColor = new Color(BRAND.text);
    if (subtitle) {
      cell.subtitleFont = Font.systemFont(FONT_SIZES.app.small);
      cell.subtitleColor = new Color(BRAND.textMuted);
    }
    table.addRow(row);
  }
}

async function runMetricsDisplay() {
  const display = new MetricsDisplay();
  await display.ensureDirs();

  const records = await display.loadMetricsRecords();
  const latestRecord = records.length ? records[records.length - 1] : null;
  const summary = await display.loadSummary();
  const configuredParsers = display.getConfiguredParsers();
  const latestRunData = latestRecord ? await display.loadRunDetails(latestRecord) : null;
  const fallbackParserNames = configuredParsers.length
    ? configuredParsers
    : Object.keys(display.getParserLastRuns(records));
  const latestErrorCounts = display.buildParserErrorCounts(latestRunData, fallbackParserNames);
  const parserHealth = display.buildParserHealth(records, latestRecord, configuredParsers, latestErrorCounts, summary);

  const view = await display.resolveView();
  const sortState = display.resolveSort(view);
  const runSortState = display.resolveRunSort(view);
  const runFilters = display.resolveRunFilters(view);
  const runItems = display.buildRunItems(records);
  const data = { latestRecord, summary, parserHealth, records, sortState, runSortState, runFilters, runItems };

  if (display.runtime.runsInWidget) {
    const widget = await display.renderWidget(data, view);
    Script.setWidget(widget);
  } else {
    await display.renderAppHtml(data, view, sortState);
  }

  Script.complete();
}

try {
  await runMetricsDisplay();
} catch (error) {
  console.log(`Metrics display failed: ${error.message}`);
  let runsInWidget = false;
  try {
    if (typeof config !== 'undefined') {
      runsInWidget = !!config.runsInWidget;
    }
  } catch (_) {
    runsInWidget = false;
  }
  if (runsInWidget) {
    const widget = new ListWidget();
    widget.backgroundColor = new Color(BRAND.primary);
    widget.setPadding(12, 12, 12, 12);
    const title = widget.addText('Metrics unavailable');
    title.font = Font.boldSystemFont(FONT_SIZES.widget.label);
    title.textColor = new Color(BRAND.text);
    const message = widget.addText(`${error.message}`);
    message.font = Font.systemFont(FONT_SIZES.widget.small);
    message.textColor = new Color(BRAND.textMuted);
    Script.setWidget(widget);
    Script.complete();
  } else {
    const alert = new Alert();
    alert.title = 'Metrics Display Error';
    alert.message = `${error.message}`;
    alert.addAction('OK');
    await alert.present();
  }
}

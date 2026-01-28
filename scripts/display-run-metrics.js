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
  danger: '#ff6b6b'
};

const CHART_STYLE = {
  line: '#ffe66d',
  lineSecondary: '#9b8cff',
  fillOpacity: 0.25,
  lineWidth: 2,
  padding: 6
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

  getPoints() {
    const count = this.values.length;
    if (count === 0) return [];

    const width = this.ctx.size.width;
    const height = this.ctx.size.height;
    const padding = this.padding;
    const usableWidth = Math.max(1, width - (padding * 2));
    const usableHeight = Math.max(1, height - (padding * 2));
    const step = count === 1 ? 0 : usableWidth / (count - 1);

    const maxFromValues = Math.max(...this.values, 0);
    const maxValue = Number.isFinite(this.maxValue) ? this.maxValue : Math.max(maxFromValues, this.minValue + 1);
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
          records.push(record);
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
        .filter(parser => parser && parser.name && parser.enabled !== false)
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
      update: 0,
      conflict: 0,
      missing_calendar: 0,
      other: 0
    };
  }

  sumActions(actions) {
    if (!actions) return 0;
    return Object.keys(actions).reduce((sum, key) => sum + (actions[key] || 0), 0);
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

  buildParserHealth(records, latestRecord, configuredParsers, latestErrorCounts = {}) {
    const lastRuns = this.getParserLastRuns(records);
    const latestParserRecords = Array.isArray(latestRecord?.parsers) ? latestRecord.parsers : [];
    const latestParserMap = {};
    latestParserRecords.forEach(record => {
      if (record?.parser_name) {
        latestParserMap[record.parser_name] = record;
      }
    });

    const hasConfig = configuredParsers.length > 0;
    const parserNames = hasConfig ? configuredParsers : Object.keys(lastRuns);

    const items = parserNames.map(name => {
      const lastRun = lastRuns[name] || null;
      const record = lastRun?.parser || null;
      const actions = record?.actions ? record.actions : this.createActionCounts();
      const totalEvents = record?.total_events || 0;
      const ran = !!record;
      return {
        name,
        parserType: record?.parser_type || null,
        urlCount: record?.url_count || 0,
        ran,
        ranInLatest: !!latestParserMap[name],
        totalEvents,
        finalBearEvents: record?.final_bear_events || 0,
        durationMs: record?.duration_ms || null,
        actions,
        lastRunAt: lastRun?.record?.finished_at || null,
        lastRunId: lastRun?.record?.run_id || null,
        latestErrorCount: latestErrorCounts?.[name] || 0
      };
    });

    return {
      hasConfig,
      configuredCount: configuredParsers.length,
      ranCount: latestParserRecords.length,
      items
    };
  }

  formatNumber(value) {
    if (!Number.isFinite(value)) return '0';
    return Math.round(value).toLocaleString();
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
    if (actions.new) parts.push(`new ${actions.new}`);
    if (actions.merge) parts.push(`merge ${actions.merge}`);
    if (actions.update) parts.push(`update ${actions.update}`);
    if (actions.conflict) parts.push(`conflict ${actions.conflict}`);
    if (actions.missing_calendar) parts.push(`missing cal ${actions.missing_calendar}`);
    if (actions.other) parts.push(`other ${actions.other}`);
    if (parts.length === 0) return 'none';
    return parts.join(', ');
  }

  formatActionsCompact(actions) {
    if (!actions) return 'N0 M0 U0';
    const newCount = actions.new || 0;
    const mergeCount = actions.merge || 0;
    const updateCount = actions.update || 0;
    return `N${newCount} M${mergeCount} U${updateCount}`;
  }

  formatActionsIssues(actions) {
    if (!actions) return 'C0 Miss0';
    const conflictCount = actions.conflict || 0;
    const missingCount = actions.missing_calendar || 0;
    const otherCount = actions.other || 0;
    return `C${conflictCount} Miss${missingCount} O${otherCount}`;
  }

  formatLastRunLabel(isoString) {
    if (!isoString) return 'Never';
    return this.formatRelativeTime(isoString);
  }

  formatEventSummary(item) {
    if (!item?.ran) return 'No run data';
    const finalEvents = this.formatNumber(item?.finalBearEvents || 0);
    const totalEvents = this.formatNumber(item?.totalEvents || 0);
    return `Final ${finalEvents} • Total ${totalEvents}`;
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
    const raw = String(status);
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  getStatusMeta(status) {
    const normalized = (status || '').toLowerCase();
    if (normalized === 'success') {
      return { label: 'Success', color: new Color(BRAND.success) };
    }
    if (normalized === 'partial') {
      return { label: 'Partial', color: new Color(BRAND.warning) };
    }
    if (normalized === 'failed') {
      return { label: 'Failed', color: new Color(BRAND.danger) };
    }
    return { label: this.formatStatusLabel(status), color: new Color(BRAND.textMuted) };
  }

  getParserStatusKey(item) {
    if (!item) return 'unknown';
    if ((item.latestErrorCount || 0) > 0) return 'failed';
    if (!item.ran) return 'not-run';
    const actionTotal = this.sumActions(item.actions);
    const totalEvents = item.totalEvents || 0;
    const hasEvents = totalEvents > 0 || (item.finalBearEvents || 0) > 0 || actionTotal > 0;
    if (!hasEvents) return 'no-events';
    const warningActions = (item.actions?.conflict || 0)
      + (item.actions?.missing_calendar || 0)
      + (item.actions?.other || 0);
    if (warningActions > 0) return 'warning';
    return 'healthy';
  }

  getParserStatusMeta(item) {
    const key = this.getParserStatusKey(item);
    if (key === 'healthy') {
      return { key, label: 'Healthy', color: new Color(BRAND.success), icon: STATUS_ICONS.healthy, rank: 1 };
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
      return { key, label: 'Not run', color: new Color(BRAND.textMuted), icon: STATUS_ICONS['not-run'], rank: 0 };
    }
    return { key, label: 'Unknown', color: new Color(BRAND.textMuted), icon: STATUS_ICONS['not-run'], rank: 0 };
  }

  getParserStatusRank(item) {
    return this.getParserStatusMeta(item).rank || 0;
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
    return 20;
  }

  getWidgetMetricFontSize() {
    const family = this.runtime.widgetFamily || 'medium';
    if (family === 'small') return 18;
    if (family === 'large') return 22;
    return FONT_SIZES.widget.metric;
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

  getParserSeries(records, parserName) {
    if (!Array.isArray(records) || !parserName) return [];
    return records.map(record => {
      const parserRecords = Array.isArray(record?.parsers) ? record.parsers : [];
      const match = parserRecords.find(item => item?.parser_name === parserName);
      return match?.final_bear_events || 0;
    });
  }

  getDurationMinutes(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return Math.round(ms / 60000);
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
        diff = this.sumActions(a?.actions) - this.sumActions(b?.actions);
      } else if (sortKey === 'new') {
        diff = (a?.actions?.new || 0) - (b?.actions?.new || 0);
      } else if (sortKey === 'merge') {
        diff = (a?.actions?.merge || 0) - (b?.actions?.merge || 0);
      } else if (sortKey === 'update') {
        diff = (a?.actions?.update || 0) - (b?.actions?.update || 0);
      } else if (sortKey === 'last-run') {
        diff = this.getTimeValue(a?.lastRunAt) - this.getTimeValue(b?.lastRunAt);
      } else if (sortKey === 'duration') {
        diff = (a?.durationMs || 0) - (b?.durationMs || 0);
      } else if (sortKey === 'status') {
        diff = this.getParserStatusRank(a) - this.getParserStatusRank(b);
      }
      if (diff === 0) {
        diff = String(a?.name || '').localeCompare(String(b?.name || ''));
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

    return chart.getImage({
      lineColor,
      fillColor,
      lineWidth: Number.isFinite(style.lineWidth) ? style.lineWidth : CHART_STYLE.lineWidth,
      showDots: !!style.showDots,
      dotRadius: style.dotRadius,
      dotColor: style.dotColor || lineColor
    });
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

  getQueryParams() {
    return this.runtime.queryParameters || {};
  }

  normalizeViewToken(value) {
    if (!value) return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    if (['parsers', 'parser-health', 'parserhealth', 'health'].includes(raw)) return 'parsers';
    if (['aggregate', 'summary', 'totals', 'all-time'].includes(raw)) return 'aggregate';
    if (['dashboard', 'overview', 'last-run'].includes(raw)) return 'dashboard';
    return null;
  }

  parseWidgetParams(param) {
    const payload = { view: null, parserName: null, sortKey: null, sortDirection: null };
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
    const viewValue = query.view || query.mode || query.dashboard || query.tab || null;
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
    if (['new', 'added', 'adds'].includes(normalized)) return 'new';
    if (['merge', 'merged'].includes(normalized)) return 'merge';
    if (['update', 'updated', 'updates'].includes(normalized)) return 'update';
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

  async resolveView() {
    const queryView = this.parseViewFromQuery(this.getQueryParams());
    if (queryView) return queryView;
    const paramView = this.parseViewParam(this.runtime.widgetParameter);
    if (paramView) return paramView;
    if (this.runtime.runsInWidget) return { mode: 'dashboard' };

    const alert = new Alert();
    alert.title = 'Metrics View';
    alert.message = 'Choose a view';
    alert.addAction('Dashboard');
    alert.addAction('Parser health');
    alert.addAction('All-time totals');
    alert.addCancelAction('Cancel');
    const idx = await alert.present();
    if (idx === 1) return { mode: 'parsers' };
    if (idx === 2) return { mode: 'aggregate' };
    return { mode: 'dashboard' };
  }

  getWidgetMaxRows() {
    const family = this.runtime.widgetFamily || 'medium';
    if (family === 'small') return 2;
    if (family === 'large') return 7;
    return 4;
  }

  addWidgetHeader(widget, logoImage) {
    const header = widget.addStack();
    header.centerAlignContent();
    header.spacing = 6;
    if (logoImage) {
      const image = header.addImage(logoImage);
      image.imageSize = new Size(24, 24);
    }
    const title = header.addText('Chunky Dad Metrics');
    title.font = Font.boldSystemFont(FONT_SIZES.widget.title);
    title.textColor = new Color(BRAND.text);
    widget.addSpacer(6);
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

    const title = widget.addText('Parser health');
    title.font = Font.boldSystemFont(FONT_SIZES.widget.label);
    title.textColor = new Color(BRAND.text);
    widget.addSpacer(4);

    const parserLine = parserHealth.hasConfig
      ? `Run ${parserHealth.ranCount} / ${parserHealth.configuredCount}`
      : `Run ${parserHealth.ranCount}`;
    const parserText = widget.addText(parserLine);
    parserText.font = Font.systemFont(FONT_SIZES.widget.label);
    parserText.textColor = new Color(BRAND.text);
    if (sortState && family !== 'small') {
      const sortLabel = widget.addText(`Sort ${this.getSortLabel(sortState)}`);
      sortLabel.font = Font.systemFont(FONT_SIZES.widget.small);
      sortLabel.textColor = new Color(BRAND.textMuted);
    }
    widget.addSpacer(4);

    const maxRows = this.getWidgetMaxRows();
    const sortedItems = this.sortParserItems(parserHealth.items, sortState);
    const items = sortedItems.slice(0, maxRows);
    const nameLimit = family === 'small' ? 14 : (family === 'large' ? 22 : 18);
    const showActions = family !== 'small';
    const showEvents = family === 'large';
    const showLastRun = family !== 'small';

    items.forEach((item, index) => {
      if (index > 0) widget.addSpacer(4);
      const statusMeta = this.getParserStatusMeta(item);
      const row = widget.addStack();
      row.layoutHorizontally();
      row.centerAlignContent();
      row.spacing = 6;

      const iconSymbol = this.getParserIconSymbol(item);
      const iconImage = this.buildSymbolImage(iconSymbol, 12, new Color(BRAND.textSoft));
      if (iconImage) {
        const icon = row.addImage(iconImage);
        icon.imageSize = new Size(12, 12);
      }

      const left = row.addStack();
      left.layoutVertically();

      const name = left.addText(this.truncateText(item.name, nameLimit));
      name.font = Font.boldSystemFont(FONT_SIZES.widget.small);
      name.textColor = new Color(BRAND.text);

      if (showActions) {
        const actions = left.addText(this.formatActionsCompact(item.actions));
        actions.font = Font.systemFont(FONT_SIZES.widget.small);
        actions.textColor = new Color(BRAND.textMuted);
      }

      if (showEvents) {
        const events = left.addText(this.formatEventSummary(item));
        events.font = Font.systemFont(FONT_SIZES.widget.small);
        events.textColor = new Color(BRAND.textMuted);
      }

      row.addSpacer();

      const right = row.addStack();
      right.layoutVertically();
      right.rightAlignContent();

      const statusIcon = this.buildStatusIcon(statusMeta, 12);
      const statusImage = right.addImage(statusIcon);
      statusImage.imageSize = new Size(12, 12);

      const infoLabel = showLastRun
        ? this.formatLastRunLabel(item.lastRunAt)
        : this.formatNumber(item.finalBearEvents || 0);
      const infoText = right.addText(infoLabel);
      infoText.font = Font.systemFont(FONT_SIZES.widget.small);
      infoText.textColor = new Color(BRAND.textMuted);
    });

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

    const title = widget.addText(`Parser: ${view.parserName}`);
    title.font = Font.boldSystemFont(FONT_SIZES.widget.label);
    title.textColor = new Color(BRAND.text);
    widget.addSpacer(4);

    if (recentRecords.length > 0) {
      const series = this.getParserSeries(recentRecords, view.parserName);
      const chartImage = this.buildLineChartImage(series, chartSize, {
        lineColor: new Color(CHART_STYLE.lineSecondary),
        fillColor: new Color(CHART_STYLE.lineSecondary, CHART_STYLE.fillOpacity)
      });
      const chart = widget.addImage(chartImage);
      chart.imageSize = new Size(chartSize.width, chartSize.height);
      widget.addSpacer(4);
    }

    if (!record || !record.ran) {
      const none = widget.addText('Not run in last run.');
      none.font = Font.systemFont(FONT_SIZES.widget.small);
      none.textColor = new Color(BRAND.text);
      return;
    }

    const stats = widget.addText(`Events: ${this.formatNumber(record.finalBearEvents)}`);
    stats.font = Font.systemFont(FONT_SIZES.widget.label);
    stats.textColor = new Color(BRAND.text);
    const duration = widget.addText(`Duration: ${this.formatDuration(record.durationMs)}`);
    duration.font = Font.systemFont(FONT_SIZES.widget.small);
    duration.textColor = new Color(BRAND.textMuted);
    const actions = widget.addText(`Actions: ${this.formatActions(record.actions)}`);
    actions.font = Font.systemFont(FONT_SIZES.widget.small);
    actions.textColor = new Color(BRAND.textMuted);
  }

  renderWidgetAggregate(widget, context) {
    const summary = context.summary;
    const recentRecords = context.recentRecords;
    const chartSize = context.chartSize;

    if (!summary?.totals) {
      const message = widget.addText('No summary metrics yet.');
      message.font = Font.systemFont(FONT_SIZES.widget.label);
      message.textColor = new Color(BRAND.text);
      return;
    }

    const totals = summary.totals;
    const runsLine = `Runs ${this.formatNumber(totals.runs || 0)} • Success ${totals.statuses?.success || 0}`;
    const runsText = widget.addText(runsLine);
    runsText.font = Font.systemFont(FONT_SIZES.widget.label);
    runsText.textColor = new Color(BRAND.text);

    const eventsLine = `Final events ${this.formatNumber(totals.totals?.final_bear_events || 0)}`;
    const eventsText = widget.addText(eventsLine);
    eventsText.font = Font.systemFont(FONT_SIZES.widget.small);
    eventsText.textColor = new Color(BRAND.textMuted);

    const series = this.getSeries(recentRecords, record => record?.totals?.final_bear_events || 0);
    const chartImage = this.buildLineChartImage(series, chartSize, {
      lineColor: new Color(CHART_STYLE.lineSecondary),
      fillColor: new Color(CHART_STYLE.lineSecondary, CHART_STYLE.fillOpacity)
    });
    widget.addSpacer(4);
    const chart = widget.addImage(chartImage);
    chart.imageSize = new Size(chartSize.width, chartSize.height);
  }

  async renderWidget(data, view) {
    const widget = new ListWidget();
    widget.backgroundColor = new Color(BRAND.primary);
    widget.setPadding(12, 12, 12, 12);

    const logoImage = await this.loadLogoImage();
    this.addWidgetHeader(widget, logoImage);

    const latest = data.latestRecord;
    const summary = data.summary;
    const parserHealth = data.parserHealth;
    const records = Array.isArray(data.records) ? data.records : [];
    const sortState = data.sortState || null;
    const recentRecords = this.getRecentRecords(records, this.getWidgetHistoryLimit());
    const chartSize = this.getWidgetChartSize();

    if (!latest && view.mode !== 'aggregate') {
      const message = widget.addText('No metrics found yet.');
      message.font = Font.systemFont(FONT_SIZES.widget.label);
      message.textColor = new Color(BRAND.text);
      return widget;
    }

    const context = {
      latest,
      summary,
      parserHealth,
      records,
      recentRecords,
      chartSize,
      sortState
    };

    if (view.mode === 'dashboard') {
      this.renderWidgetDashboard(widget, context);
    } else if (view.mode === 'parsers') {
      this.renderWidgetParserHealth(widget, context);
    } else if (view.mode === 'parser') {
      this.renderWidgetParserDetail(widget, context, view);
    } else if (view.mode === 'aggregate') {
      this.renderWidgetAggregate(widget, context);
    } else {
      this.renderWidgetDashboard(widget, context);
    }

    if (latest?.run_id) {
      widget.url = this.buildScriptableUrl(DISPLAY_SAVED_RUN_SCRIPT, {
        runId: latest.run_id,
        readOnly: true
      });
    }

    return widget;
  }

  async renderAppTable(data, view, sortState) {
    const table = new UITable();
    table.backgroundColor = new Color(BRAND.primary);
    table.showSeparators = false;

    const logoImage = await this.loadLogoImage();
    this.addTableHeader(table, logoImage);

    const latest = data.latestRecord;
    const summary = data.summary;
    const parserHealth = data.parserHealth;
    const records = Array.isArray(data.records) ? data.records : [];
    const parserSort = sortState || data.sortState || this.resolveSort(view);
    const recentRecords = this.getRecentRecords(records, this.getAppHistoryLimit());
    const chartSize = this.getAppChartSize();

    if (!latest && view.mode !== 'aggregate') {
      this.addInfoRow(table, 'No metrics found yet.', 'Run the scraper to generate metrics.');
      await table.present();
      return;
    }

    if (view.mode === 'dashboard') {
      const lastRun = latest?.finished_at ? this.formatRelativeTime(latest.finished_at) : 'Unknown';
      const statusMeta = this.getStatusMeta(latest?.status);
      const totals = latest?.totals || {};
      const finalEvents = totals.final_bear_events || 0;
      const historyCount = Math.max(recentRecords.length, 1);

      this.addSectionHeader(table, 'Dashboard');
      this.addMetricRow(table, this.formatNumber(finalEvents), 'Final bear events');
      this.addInfoRow(table, `Calendar events: ${this.formatNumber(totals.calendar_events || 0)}`, `Duplicates removed: ${this.formatNumber(totals.duplicates_removed || 0)}`);
      this.addInfoRow(table, `Last run: ${lastRun}`, `Duration: ${this.formatDuration(latest?.duration_ms)}`);
      this.addInfoRow(table, `Status: ${statusMeta.label}`, `Errors: ${latest?.errors_count || 0} • Warnings: ${latest?.warnings_count || 0}`);

      const finalSeries = this.getSeries(recentRecords, record => record?.totals?.final_bear_events || 0);
      const finalChart = this.buildLineChartImage(finalSeries, chartSize, {
        lineColor: new Color(CHART_STYLE.line),
        fillColor: new Color(CHART_STYLE.line, CHART_STYLE.fillOpacity)
      });
      this.addChartSection(table, `Final events (last ${historyCount} runs)`, finalChart, `Latest: ${this.formatNumber(finalEvents)}`);

      const durationSeries = this.getSeries(recentRecords, record => this.getDurationMinutes(record?.duration_ms));
      const durationChart = this.buildLineChartImage(durationSeries, chartSize, {
        lineColor: new Color(CHART_STYLE.lineSecondary),
        fillColor: new Color(CHART_STYLE.lineSecondary, CHART_STYLE.fillOpacity)
      });
      this.addChartSection(table, `Duration (minutes, last ${historyCount} runs)`, durationChart, `Latest: ${this.formatDuration(latest?.duration_ms)}`);

      this.addSectionHeader(table, 'Parser health');
      const parserLine = parserHealth.hasConfig
        ? `Parsers run: ${parserHealth.ranCount} / ${parserHealth.configuredCount}`
        : `Parsers run: ${parserHealth.ranCount}`;
      const sortLabel = parserSort ? `Sort: ${this.getSortLabel(parserSort)}` : null;
      this.addInfoRow(table, parserLine, sortLabel);
      this.addParserTableHeader(table);

      const sortedItems = this.sortParserItems(parserHealth.items, parserSort).slice(0, 8);
      sortedItems.forEach(item => {
        this.addParserHealthRow(table, item);
      });
      if (parserHealth.items.length > sortedItems.length) {
        this.addInfoRow(table, `+${parserHealth.items.length - sortedItems.length} more parsers`, 'Open parser health to see all.');
      }

      if (summary?.totals) {
        this.addSectionHeader(table, 'All-time totals');
        const summaryTotals = summary.totals;
        this.addInfoRow(table, `Runs: ${this.formatNumber(summaryTotals.runs || 0)}`, `Success: ${summaryTotals.statuses?.success || 0} • Partial: ${summaryTotals.statuses?.partial || 0} • Failed: ${summaryTotals.statuses?.failed || 0}`);
        this.addInfoRow(
          table,
          `Final bear events: ${this.formatNumber(summaryTotals.totals?.final_bear_events || 0)}`,
          `Calendar events: ${this.formatNumber(summaryTotals.totals?.calendar_events || 0)}`
        );
      }
    } else if (view.mode === 'parsers') {
      this.addSectionHeader(table, 'Parser health dashboard');
      const parserLine = parserHealth.hasConfig
        ? `Parsers run: ${parserHealth.ranCount} / ${parserHealth.configuredCount}`
        : `Parsers run: ${parserHealth.ranCount}`;
      this.addInfoRow(table, parserLine, parserHealth.hasConfig ? 'Status is based on last run per parser.' : 'Status is based on last run per parser.');

      this.addParserSortRow(table, parserSort);
      this.addParserTableHeader(table);

      const sortedItems = this.sortParserItems(parserHealth.items, parserSort);
      if (sortedItems.length === 0) {
        this.addInfoRow(table, 'No parser metrics available.', 'Run the scraper to collect parser health.');
      } else {
        sortedItems.forEach(item => {
          this.addParserHealthRow(table, item);
        });
      }
    } else if (view.mode === 'aggregate') {
      this.addSectionHeader(table, 'All-time totals');
      if (!summary?.totals) {
        this.addInfoRow(table, 'No summary metrics found.', 'Run the scraper to generate summary metrics.');
      } else {
        const totals = summary.totals;
        this.addInfoRow(table, `Runs: ${this.formatNumber(totals.runs || 0)}`, `Success: ${totals.statuses?.success || 0} • Partial: ${totals.statuses?.partial || 0} • Failed: ${totals.statuses?.failed || 0}`);
        this.addInfoRow(
          table,
          `Final bear events: ${this.formatNumber(totals.totals?.final_bear_events || 0)}`,
          `Calendar events: ${this.formatNumber(totals.totals?.calendar_events || 0)}`
        );
        this.addInfoRow(table, 'Actions', this.formatActions(totals.actions));

        const series = this.getSeries(recentRecords, record => record?.totals?.final_bear_events || 0);
        const totalsChart = this.buildLineChartImage(series, chartSize, {
          lineColor: new Color(CHART_STYLE.line),
          fillColor: new Color(CHART_STYLE.line, CHART_STYLE.fillOpacity)
        });
        this.addChartSection(table, `Final events (last ${Math.max(recentRecords.length, 1)} runs)`, totalsChart);

        const parserTotals = summary.by_parser_name || {};
        const parserRows = Object.keys(parserTotals).map(name => {
          const totalsBucket = parserTotals[name]?.totals;
          return {
            name,
            finalBearEvents: totalsBucket?.totals?.final_bear_events || 0,
            runs: totalsBucket?.runs || 0
          };
        }).sort((a, b) => b.finalBearEvents - a.finalBearEvents);

        if (parserRows.length > 0) {
          this.addSectionHeader(table, 'Top parsers (all-time)');
          parserRows.slice(0, 8).forEach(row => {
            this.addInfoRow(
              table,
              `${row.name}: ${this.formatNumber(row.finalBearEvents)} events`,
              `Runs: ${this.formatNumber(row.runs)}`
            );
          });
        }
      }
    } else if (view.mode === 'parser') {
      this.addSectionHeader(table, `Parser detail: ${view.parserName}`);
      const record = parserHealth.items.find(item => item.name === view.parserName);
      if (!record || !record.ran) {
        this.addInfoRow(table, 'Not run in latest metrics.', 'Run the parser to collect metrics.');
      } else {
        this.addMetricRow(table, this.formatNumber(record.finalBearEvents), 'Final bear events');
        this.addInfoRow(table, `Duration: ${this.formatDuration(record.durationMs)}`, `Actions: ${this.formatActions(record.actions)}`);

        const series = this.getParserSeries(recentRecords, view.parserName);
        const parserChart = this.buildLineChartImage(series, chartSize, {
          lineColor: new Color(CHART_STYLE.lineSecondary),
          fillColor: new Color(CHART_STYLE.lineSecondary, CHART_STYLE.fillOpacity)
        });
        this.addChartSection(table, `Events per run (last ${Math.max(recentRecords.length, 1)} runs)`, parserChart);
      }
    } else {
      view.mode = 'dashboard';
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
    const titleCell = header.addText('Chunky Dad Metrics', 'Scraper dashboard');
    titleCell.titleFont = Font.boldSystemFont(FONT_SIZES.app.title);
    titleCell.titleColor = new Color(BRAND.text);
    titleCell.subtitleFont = Font.systemFont(FONT_SIZES.app.label);
    titleCell.subtitleColor = new Color(BRAND.textMuted);
    table.addRow(header);
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

  addChartSection(table, title, image, subtitle) {
    this.addSectionHeader(table, title);
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);
    const size = image?.size || new Size(320, 120);
    row.height = size.height + 12;
    const img = row.addImage(image);
    img.imageSize = new Size(size.width, size.height);
    table.addRow(row);
    if (subtitle) {
      this.addInfoRow(table, subtitle);
    }
  }

  getParserSortOptions() {
    return [
      { key: 'status', label: 'Status (issues first)', defaultDirection: 'desc' },
      { key: 'events', label: 'Final events', defaultDirection: 'desc' },
      { key: 'actions', label: 'Actions total', defaultDirection: 'desc' },
      { key: 'new', label: 'New actions', defaultDirection: 'desc' },
      { key: 'merge', label: 'Merge actions', defaultDirection: 'desc' },
      { key: 'update', label: 'Update actions', defaultDirection: 'desc' },
      { key: 'last-run', label: 'Last run', defaultDirection: 'desc' },
      { key: 'duration', label: 'Duration', defaultDirection: 'desc' },
      { key: 'name', label: 'Name', defaultDirection: 'asc' }
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

  addParserTableHeader(table) {
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);
    const iconCell = row.addText('');
    iconCell.widthWeight = 6;
    const parserCell = row.addText('Parser');
    parserCell.widthWeight = 30;
    const actionsCell = row.addText('Actions');
    actionsCell.widthWeight = 28;
    const statusIconCell = row.addText('');
    statusIconCell.widthWeight = 6;
    const statusCell = row.addText('Status');
    statusCell.widthWeight = 14;
    const lastRunCell = row.addText('Last run');
    lastRunCell.widthWeight = 16;

    [iconCell, parserCell, actionsCell, statusIconCell, statusCell, lastRunCell].forEach(cell => {
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

    const parserCell = row.addText(item.name, this.formatEventSummary(item));
    parserCell.titleFont = Font.systemFont(FONT_SIZES.app.label);
    parserCell.subtitleFont = Font.systemFont(FONT_SIZES.app.small);
    parserCell.titleColor = new Color(BRAND.text);
    parserCell.subtitleColor = new Color(BRAND.textMuted);
    parserCell.widthWeight = 30;

    const actionsCell = row.addText(this.formatActionsCompact(item.actions), this.formatActionsIssues(item.actions));
    actionsCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    actionsCell.subtitleFont = Font.systemFont(FONT_SIZES.app.small);
    actionsCell.titleColor = new Color(BRAND.text);
    actionsCell.subtitleColor = new Color(BRAND.textMuted);
    actionsCell.widthWeight = 28;

    const statusMeta = this.getParserStatusMeta(item);
    const statusIcon = this.buildStatusIcon(statusMeta, 14);
    const statusIconCell = row.addImage(statusIcon);
    statusIconCell.imageSize = new Size(14, 14);
    statusIconCell.widthWeight = 6;

    const statusCell = row.addText(statusMeta.label);
    statusCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    statusCell.titleColor = statusMeta.color;
    statusCell.widthWeight = 14;

    const lastRunCell = row.addText(this.formatLastRunLabel(item.lastRunAt));
    lastRunCell.titleFont = Font.systemFont(FONT_SIZES.app.small);
    lastRunCell.titleColor = new Color(BRAND.text);
    lastRunCell.widthWeight = 16;

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
  const parserHealth = display.buildParserHealth(records, latestRecord, configuredParsers, latestErrorCounts);

  const view = await display.resolveView();
  const sortState = display.resolveSort(view);
  const data = { latestRecord, summary, parserHealth, records, sortState };

  if (display.runtime.runsInWidget) {
    const widget = await display.renderWidget(data, view);
    Script.setWidget(widget);
  } else {
    await display.renderAppTable(data, view, sortState);
  }

  Script.complete();
}

try {
  await runMetricsDisplay();
} catch (error) {
  console.log(`Metrics display failed: ${error.message}`);
  const alert = new Alert();
  alert.title = 'Metrics Display Error';
  alert.message = `${error.message}`;
  alert.addAction('OK');
  await alert.present();
}

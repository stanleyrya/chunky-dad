// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: chart-bar;

// Display Run Metrics
// Sources (per-website health from the source ledger, trouble first), host
// detail with the vanished list, the run history and Health & Guards.

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

// Off by default; enable per-render with ?debugCharts=1
const DEBUG_CHART_POINTS = false;

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

// Verdict colours for the Sources view and widget (SOURCE_VERDICT_ORDER in
// metrics-sections.js, worst first). "ok" stays quiet grey on purpose.
const SOURCE_VERDICT_COLORS = {
  dead: BRAND.danger,
  stopped: '#ff9f43',
  shrunk: BRAND.warning,
  empty: '#9b8cff',
  vanished: '#e056a0',
  quiet: '#54a0ff',
  ok: BRAND.neutral
};

// Host detail: how many ledger lines the run-by-run table shows.
const HOST_SERIES_ROW_LIMIT = 40;

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

const FAVICON_CACHE_TTL_DAYS = 14;

const LOGO_URL = 'https://chunky.dad/favicons/logo-hero.png';
const DISPLAY_METRICS_SCRIPT = 'display-run-metrics';
const DISPLAY_SAVED_RUN_SCRIPT = 'display-saved-run';

// Pure helpers shared with the scraper: run-health verdicts (run-log-summary)
// and the Health & Guards section builders (metrics-sections). Loaded
// defensively so the dashboard still renders if a module is missing on-device.
let RunLogSummary = null;
let MetricsSections = null;
try {
  RunLogSummary = importModule('run-log-summary').RunLogSummary;
} catch (error) {
  console.log(`Metrics: run-log-summary unavailable: ${error.message}`);
}
try {
  MetricsSections = importModule('metrics-sections').MetricsSections;
} catch (error) {
  console.log(`Metrics: metrics-sections unavailable: ${error.message}`);
}

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

  // Style flags (all optional): fillColor (a translucent Color; the fill is a
  // faux gradient of stacked bands unless gradient:false), lineColor, lineWidth,
  // showDots/dotRadius/dotColor, gridlines (faint horizontal rules),
  // emphasizeLast (halo + solid dot on the newest point), baselineValue
  // (dashed horizontal rule at that value), tintFromIndex/tintColor (a
  // translucent stretch from that point to the right edge).
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

    if (style.gridlines) {
      this.drawGridlines(style.gridColor || null);
    }

    if (Number.isFinite(style.tintFromIndex) && style.tintFromIndex >= 0 && style.tintFromIndex < points.length) {
      this.drawTint(points, style.tintFromIndex, style.tintColor || fillColor || lineColor);
    }

    if (fillColor) {
      if (style.gradient === false) {
        const fillPath = this.getSmoothPath(points, true);
        this.ctx.setFillColor(fillColor);
        this.ctx.addPath(fillPath);
        this.ctx.fillPath();
      } else {
        this.drawGradientArea(points, fillColor, style.gradientSteps);
      }
    }

    if (Number.isFinite(style.baselineValue)) {
      this.drawBaseline(style.baselineValue, style.baselineColor || null, style.baselineLabel);
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

    if (style.emphasizeLast) {
      const accent = style.lastPointColor || dotColor || lineColor || fillColor;
      if (accent) this.drawLastPoint(points[points.length - 1], accent, dotRadius + 1);
    }

    return this.ctx.getImage();
  }

  // Colour with a new alpha; Scriptable's Color exposes .hex (no alpha).
  static withAlpha(color, alpha) {
    const raw = color && color.hex ? String(color.hex) : CHART_STYLE.line;
    const hex = `#${raw.replace(/^#/, '').slice(0, 6)}`;
    return new Color(hex, Math.max(0, Math.min(1, alpha)));
  }

  getPlotFrame() {
    const width = this.ctx.size.width;
    const height = this.ctx.size.height;
    const padding = this.padding;
    return {
      left: padding,
      right: width - padding,
      top: padding,
      bottom: height - padding,
      width: Math.max(1, width - (padding * 2)),
      height: Math.max(1, height - (padding * 2))
    };
  }

  getScale() {
    const numericValues = this.values.filter(value => Number.isFinite(value));
    const maxFromValues = numericValues.length ? Math.max(...numericValues, this.minValue) : this.minValue;
    const maxValue = Number.isFinite(this.maxValue)
      ? this.maxValue
      : (maxFromValues > this.minValue ? maxFromValues : this.minValue + 1);
    return { minValue: this.minValue, maxValue, diff: maxValue - this.minValue || 1 };
  }

  valueToY(value) {
    const frame = this.getPlotFrame();
    const scale = this.getScale();
    const normalized = Math.max(0, Math.min(1, (value - scale.minValue) / scale.diff));
    return frame.top + (1 - normalized) * frame.height;
  }

  // Three faint rules at a quarter, a half and three quarters of the plot.
  drawGridlines(color) {
    const frame = this.getPlotFrame();
    const ruleColor = color || new Color('#ffffff', 0.14);
    this.ctx.setFillColor(ruleColor);
    [0.25, 0.5, 0.75].forEach(fraction => {
      const y = frame.top + frame.height * fraction;
      this.ctx.fillRect(new Rect(frame.left, y, frame.width, 0.5));
    });
  }

  // Translucent stretch from the given point to the right edge, with a thin
  // marker line where it starts (the run trouble began on).
  drawTint(points, index, color) {
    if (!color) return;
    const frame = this.getPlotFrame();
    const step = points.length > 1 ? points[1].x - points[0].x : frame.width;
    const startX = Math.max(frame.left, points[index].x - (step / 2));
    this.ctx.setFillColor(LineChart.withAlpha(color, 0.16));
    this.ctx.fillRect(new Rect(startX, frame.top, Math.max(1, frame.right - startX), frame.height));
    this.ctx.setFillColor(LineChart.withAlpha(color, 0.55));
    this.ctx.fillRect(new Rect(startX, frame.top, 1, frame.height));
  }

  // Dashed rule at a value (the baseline), labelled at the right edge when the
  // plot is tall enough for a 7pt caption.
  drawBaseline(value, color, label) {
    const frame = this.getPlotFrame();
    const y = this.valueToY(value);
    const ruleColor = color || new Color('#ffffff', 0.7);
    this.ctx.setFillColor(ruleColor);
    const dash = 4;
    const gap = 3;
    for (let x = frame.left; x < frame.right; x += dash + gap) {
      this.ctx.fillRect(new Rect(x, y - 0.5, Math.min(dash, frame.right - x), 1));
    }
    const caption = label === undefined ? 'baseline' : label;
    if (caption && frame.height >= 48) {
      this.ctx.setFont(Font.systemFont(7));
      this.ctx.setTextColor(ruleColor);
      this.ctx.setTextAlignedRight();
      const labelY = y - 10 < frame.top ? y + 1 : y - 10;
      this.ctx.drawTextInRect(String(caption), new Rect(frame.left, labelY, frame.width, 9));
    }
  }

  // Faux vertical gradient: the area is drawn `steps` times, each copy with
  // its floor raised a little, so the pixels nearest the curve are covered by
  // every band (opaque) and the pixels near the baseline by one (faint).
  drawGradientArea(points, color, steps) {
    const frame = this.getPlotFrame();
    const bands = Number.isFinite(steps) && steps > 0 ? Math.floor(steps) : 10;
    const baseAlpha = Number.isFinite(color.alpha) ? color.alpha : CHART_STYLE.fillOpacity;
    const topAlpha = Math.max(0.2, Math.min(0.85, baseAlpha * 2.2));
    const bandAlpha = 1 - Math.pow(1 - topAlpha, 1 / bands);
    const dense = this.sampleSmoothCurve(points, 8);
    const bandColor = LineChart.withAlpha(color, bandAlpha);
    for (let band = 0; band < bands; band += 1) {
      const floor = frame.bottom - (band * (frame.height / bands));
      const path = new Path();
      path.move(new Point(dense[0].x, floor));
      dense.forEach(sample => path.addLine(new Point(sample.x, Math.min(sample.y, floor))));
      path.addLine(new Point(dense[dense.length - 1].x, floor));
      path.closeSubpath();
      this.ctx.setFillColor(bandColor);
      this.ctx.addPath(path);
      this.ctx.fillPath();
    }
  }

  // Halo + solid dot on the newest point.
  drawLastPoint(point, color, radius) {
    const halo = radius * 2.6;
    this.ctx.setFillColor(LineChart.withAlpha(color, 0.28));
    this.ctx.fillEllipse(new Rect(point.x - halo, point.y - halo, halo * 2, halo * 2));
    this.ctx.setFillColor(LineChart.withAlpha(color, 1));
    this.ctx.fillEllipse(new Rect(point.x - radius, point.y - radius, radius * 2, radius * 2));
    this.ctx.setFillColor(new Color('#ffffff', 0.9));
    const core = Math.max(1, radius * 0.45);
    this.ctx.fillEllipse(new Rect(point.x - core, point.y - core, core * 2, core * 2));
  }

  // The same two quadratic curves per segment that getSmoothPath draws,
  // sampled into a polyline so clipped fills follow the stroked line exactly.
  sampleSmoothCurve(points, perSegment) {
    if (points.length < 2) return points.slice();
    const samples = [points[0]];
    const quad = (p0, c, p1, t) => new Point(
      ((1 - t) * (1 - t) * p0.x) + (2 * (1 - t) * t * c.x) + (t * t * p1.x),
      ((1 - t) * (1 - t) * p0.y) + (2 * (1 - t) * t * c.y) + (t * t * p1.y)
    );
    for (let i = 0; i < points.length - 1; i += 1) {
      const current = points[i];
      const next = points[i + 1];
      const avg = new Point((current.x + next.x) / 2, (current.y + next.y) / 2);
      const cp1 = new Point((avg.x + current.x) / 2, current.y);
      const cp2 = new Point((avg.x + next.x) / 2, next.y);
      for (let s = 1; s <= perSegment; s += 1) samples.push(quad(current, cp1, avg, s / perSegment));
      for (let s = 1; s <= perSegment; s += 1) samples.push(quad(avg, cp2, next, s / perSegment));
    }
    return samples;
  }

  logPoints(points, style = {}) {
    const count = this.values.length;
    const limit = Number.isFinite(style.logLimit) ? style.logLimit : 30;
    const label = style.logLabel ? ` (${style.logLabel})` : '';
    const width = this.ctx.size.width;
    const height = this.ctx.size.height;
    const padding = this.padding;
    const scale = this.getScale();
    const maxValue = scale.maxValue;
    const diff = scale.diff;
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

    const frame = this.getPlotFrame();
    const step = count === 1 ? 0 : frame.width / (count - 1);
    const scale = this.getScale();

    return this.values.map((current, index) => {
      const x = frame.left + (step * index);
      const safe = Number.isFinite(current) ? current : scale.minValue;
      const normalized = (safe - scale.minValue) / scale.diff;
      const y = frame.top + (1 - normalized) * frame.height;
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
    this.baseDir = this.resolveDataRoot(this.fm);
    this.metricsDir = this.fm.joinPath(this.baseDir, 'metrics');
    this.cacheDir = this.fm.joinPath(this.baseDir, 'cache');
    this.runtime = this.getRuntimeContext();
    this.iconCache = new Map();
    this.parserIconOverrides = this.getParserIconOverrides();
  }

  // The data folder, wherever it is: the chunky-dad-data file bookmark once
  // the data moved there (2026-10-06 — Scriptable's own folder held 2 GB and
  // took forever to open), else Documents/chunky-dad-scraper. Same choice as
  // ScriptableAdapter.resolveDataRoot (inlined: this display must not load the
  // whole adapter just to find a path). The bookmarked folder counts only
  // once it HOLDS the data (storage/ or calendar-snapshot/ inside it).
  resolveDataRoot(fm) {
    const legacy = fm.joinPath(fm.documentsDirectory(), 'chunky-dad-scraper');
    try {
      const local = typeof FileManager !== 'undefined' && typeof FileManager.local === 'function' ? FileManager.local() : null;
      if (!local || typeof local.bookmarkExists !== 'function' || !local.bookmarkExists('chunky-dad-data')) return legacy;
      const root = fm.bookmarkedPath('chunky-dad-data');
      if (!root || !fm.isDirectory(root)) return legacy;
      const populated = ['storage', 'calendar-snapshot', 'metrics'].some((name) => fm.isDirectory(fm.joinPath(root, name)));
      return populated ? root : legacy;
    } catch (_) {
      return legacy;
    }
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

  hashString(value) {
    const input = String(value || '');
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  getFaviconCachePath(url) {
    const hash = this.hashString(url);
    return this.fm.joinPath(this.cacheDir, `favicon-${hash}.png`);
  }

  async loadFaviconImage(url) {
    if (!url) return null;
    const cachePath = this.getFaviconCachePath(url);
    try {
      if (this.fm.fileExists(cachePath)) {
        const mtime = this.fm.modificationDate(cachePath);
        if (mtime && (Date.now() - mtime.getTime()) < (FAVICON_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)) {
          return Image.fromFile(cachePath);
        }
      }
    } catch (error) {
      console.log(`Metrics: Favicon cache read failed: ${error.message}`);
    }

    try {
      const request = new Request(url);
      const image = await request.loadImage();
      this.fm.writeImage(cachePath, image);
      return image;
    } catch (error) {
      console.log(`Metrics: Favicon download failed: ${error.message}`);
      return null;
    }
  }

  // Favicon URL for a website, named the way the site's favicon sync names its
  // files (favicon-<domain>-64px.ico; linktr.ee pages keyed by their path).
  getFaviconUrlForSiteUrl(url) {
    const match = String(url || '').match(/^https?:\/\/([^\/]+)(\/.*)?$/);
    if (!match) return null;
    return this.getFaviconUrlForHost(match[1], match[2] || '/');
  }

  getFaviconUrlForHost(host, pathname = '/') {
    const hostname = String(host || '').trim().toLowerCase();
    if (!hostname) return null;
    let filename;
    if (hostname === 'linktr.ee' || hostname === 'www.linktr.ee') {
      const cleanPath = String(pathname || '/').substring(1)
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      filename = `favicon-linktr.ee-${cleanPath}-64px.png`;
    } else {
      const cleanDomain = hostname
        .replace(/^www\./, '')
        .replace(/[^a-zA-Z0-9.-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      filename = `favicon-${cleanDomain}-64px.ico`;
    }
    return `https://chunky.dad/img/favicons/${filename}`;
  }

  // Parser name → icon URL from scraper-input: an explicit iconUrl/faviconUrl,
  // else the favicon derived from the parser's first URL. Ledger hosts carry
  // parsers[], so a host row inherits its parser's icon before falling back to
  // the host itself (getHostFaviconUrl).
  getParserIconOverrides() {
    try {
      const scraperConfig = importModule('scraper-input');
      const parsers = Array.isArray(scraperConfig?.parsers) ? scraperConfig.parsers : [];
      const overrides = {};
      parsers.forEach(parser => {
        const name = parser?.name ? String(parser.name).toLowerCase() : '';
        if (!name) return;
        const explicit = parser?.iconUrl || parser?.faviconUrl || null;
        const firstUrl = Array.isArray(parser?.urls) && parser.urls.length > 0 ? parser.urls[0] : null;
        const iconUrl = explicit || (firstUrl ? this.getFaviconUrlForSiteUrl(firstUrl) : null);
        if (iconUrl) overrides[name] = String(iconUrl);
      });
      return overrides;
    } catch (error) {
      console.log(`Metrics: Could not load parser icon overrides: ${error.message}`);
      return {};
    }
  }

  getHostFaviconUrl(row) {
    const overrides = this.parserIconOverrides || {};
    const parsers = Array.isArray(row?.parsers) ? row.parsers : [];
    for (const name of parsers) {
      const override = overrides[String(name || '').toLowerCase()];
      if (override) return override;
    }
    return this.getFaviconUrlForHost(row?.host);
  }

  async getHostIconImage(row) {
    const faviconUrl = this.getHostFaviconUrl(row);
    if (!faviconUrl) return null;
    const cacheKey = `favicon:${faviconUrl}`;
    if (this.iconCache.has(cacheKey)) return this.iconCache.get(cacheKey);
    const image = await this.loadFaviconImage(faviconUrl);
    this.iconCache.set(cacheKey, image);
    return image || null;
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

    const getFinishedTime = (record) => {
      const time = record?.finished_at ? new Date(record.finished_at).getTime() : 0;
      // A malformed finished_at yields NaN, which would corrupt the sort order
      return Number.isFinite(time) ? time : 0;
    };
    records.sort((a, b) => getFinishedTime(a) - getFinishedTime(b));

    return records;
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

  getSourceLedgerPath() {
    return this.fm.joinPath(this.metricsDir, 'sources.ndjson');
  }

  // The source ledger (metrics/sources.ndjson): one line per run per website
  // host, written by every run on every machine — unlike metrics.ndjson, which
  // only the phone writes. Returns { available, reason, health, records }; a
  // missing file is not an error, the views show the friendly empty card.
  async loadSourceHealth() {
    if (!MetricsSections
      || typeof MetricsSections.parseSourceLedger !== 'function'
      || typeof MetricsSections.assessSourceHealth !== 'function') {
      return { available: false, reason: 'metrics-sections module unavailable', health: null, records: [] };
    }
    const path = this.getSourceLedgerPath();
    if (!this.fm.fileExists(path)) {
      return { available: false, reason: null, health: null, records: [] };
    }
    try {
      await this.fm.downloadFileFromiCloud(path);
    } catch (error) {
      console.log(`Metrics: Source ledger iCloud download failed: ${error.message}`);
    }
    let records = [];
    try {
      records = MetricsSections.parseSourceLedger(this.fm.readString(path) || '');
    } catch (error) {
      console.log(`Metrics: Source ledger read failed: ${error.message}`);
      return { available: false, reason: error.message, health: null, records: [] };
    }
    if (!records.length) {
      return { available: false, reason: null, health: null, records: [] };
    }
    const health = MetricsSections.assessSourceHealth(records, { now: new Date() });
    console.log(`Metrics: Source ledger — ${records.length} lines, ${health.hosts} hosts, ${health.troubled} troubled`);
    return { available: true, reason: null, health, records };
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

  createCalendarActionCounts() {
    return {
      create: 0,
      update: 0,
      skip: 0,
      failed: 0,
      other: 0
    };
  }

  normalizeStatusCounts(counts) {
    return {
      success: counts?.success || 0,
      warning: counts?.warning ?? counts?.partial ?? 0,
      failed: counts?.failed || 0
    };
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
    const calendarActions = {
      ...this.createCalendarActionCounts(),
      ...(record?.calendar_actions || {})
    };
    const parsers = Array.isArray(record?.parsers)
      ? record.parsers.map(parser => ({
          ...parser,
          actions: { ...this.createActionCounts(), ...(parser?.actions || {}) },
          calendar_actions: { ...this.createCalendarActionCounts(), ...(parser?.calendar_actions || {}) }
        }))
      : [];
    return {
      ...record,
      warnings_count: warningsCount,
      status,
      actions: { ...this.createActionCounts(), ...(record?.actions || {}) },
      calendar_actions: calendarActions,
      parsers
    };
  }

  sumDisplayActions(actions) {
    if (!actions) return 0;
    return (actions.new || 0) + (actions.merge || 0) + (actions.conflict || 0);
  }

  // Run-health verdict + one-line badge for a metrics record. Old records
  // without a signals block still get a verdict from their error count.
  // Returns null when the shared run-log-summary module is unavailable.
  getRecordHealth(record) {
    if (!record || !RunLogSummary) return null;
    try {
      const health = RunLogSummary.evaluateRunHealth(record.signals || null, {
        errorsCount: Number.isFinite(record.errors_count) ? record.errors_count : 0
      });
      return { health, badgeText: RunLogSummary.formatRunHealthBadge(health) };
    } catch (error) {
      console.log(`Metrics: Health evaluation failed: ${error.message}`);
      return null;
    }
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

  formatLastRunLabel(isoString) {
    if (!isoString) return 'Never';
    return this.formatRelativeTime(isoString);
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
        calendarActions: record?.calendar_actions ? record.calendar_actions : this.createCalendarActionCounts(),
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

  // Badge variants: the run statuses plus every source verdict (dead, stopped,
  // shrunk, empty, vanished, quiet, ok) so widget rows share the page palette.
  getWidgetBadgeColors(variant) {
    const palette = {
      success: BRAND.success,
      warning: BRAND.warning,
      danger: BRAND.danger,
      neutral: BRAND.neutral || BRAND.textMuted,
      ...SOURCE_VERDICT_COLORS
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
    const ordered = [...records].sort((a, b) => (
      this.getTimeValue(a?.finished_at || a?.finishedAt) - this.getTimeValue(b?.finished_at || b?.finishedAt)
    ));
    if (!Number.isFinite(limit) || limit <= 0) return ordered;
    return ordered.slice(-limit);
  }

  getTimeValue(isoString) {
    if (!isoString) return 0;
    const time = new Date(isoString).getTime();
    return Number.isFinite(time) ? time : 0;
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

  // Filled, smoothed area with faint gridlines and the newest point
  // emphasized (all three can be turned off per call); the extra style keys
  // baselineValue / tintFromIndex / tintColor feed the host widget. The
  // signature is shared with the page builders, so it stays put.
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
      gradient: style.gradient !== false,
      gradientSteps: style.gradientSteps,
      gridlines: style.gridlines !== false,
      gridColor: style.gridColor || null,
      emphasizeLast: style.emphasizeLast !== false,
      lastPointColor: style.lastPointColor || null,
      baselineValue: Number.isFinite(style.baselineValue) ? style.baselineValue : null,
      baselineColor: style.baselineColor || null,
      baselineLabel: style.baselineLabel,
      tintFromIndex: Number.isFinite(style.tintFromIndex) ? style.tintFromIndex : null,
      tintColor: style.tintColor || null,
      logPoints,
      logLabel: style.logLabel,
      logLimit: style.logLimit
    });
  }

  // Several series on one plot: shared scale, one set of gridlines, a faint
  // gradient under each line and the newest point of each series emphasized.
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
    const fillAlpha = Number.isFinite(style.fillOpacity) ? style.fillOpacity : 0.1;

    const ctx = new DrawContext();
    ctx.size = new Size(size.width, size.height);
    ctx.respectScreenScale = true;
    ctx.opaque = false;

    if (style.gridlines !== false) {
      const grid = new LineChart(size.width, size.height, [0], { minValue, maxValue, padding });
      grid.drawGridlines(style.gridColor || null);
      ctx.drawImageAtPoint(grid.ctx.getImage(), new Point(0, 0));
    }

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
        fillColor: style.fill === false || fillAlpha <= 0 ? null : LineChart.withAlpha(lineColor, fillAlpha),
        gradient: true,
        gradientSteps: 4,
        lineWidth,
        showDots,
        dotRadius,
        dotColor: lineColor,
        emphasizeLast: style.emphasizeLast !== false,
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

  buildScriptableUrl(scriptName, params = {}) {
    const base = `scriptable:///run?scriptName=${encodeURIComponent(scriptName)}`;
    const query = Object.keys(params)
      .filter(key => params[key] !== undefined && params[key] !== null)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    return query ? `${base}&${query}` : base;
  }

  buildSourcesUrl(sortState) {
    const defaultSort = this.getDefaultSortForView({ mode: 'sources' });
    const isDefault = !sortState
      || (sortState.key === defaultSort.key && sortState.direction === defaultSort.direction);
    return this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, {
      view: 'sources',
      sort: isDefault ? null : sortState.key,
      dir: isDefault ? null : sortState.direction
    });
  }

  buildHostUrl(host) {
    return this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, { host });
  }

  buildWidgetDashboardUrl(view, sortState, runSortState, runFilters) {
    const safeView = view?.mode ? view : { mode: 'sources' };
    if (safeView.mode === 'host' && safeView.host) {
      return this.buildHostUrl(safeView.host);
    }
    const normalizedMode = this.normalizeViewToken(safeView.mode) || safeView.mode;
    if (normalizedMode === 'runs') {
      const sort = runSortState || this.getDefaultRunSort();
      return this.buildRunListUrl(sort, runFilters || null);
    }
    return this.buildSourcesUrl(sortState || null);
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
    // Old widget parameters ("parsers", "health") land on Sources, which replaced them.
    if (['sources', 'source', 'hosts', 'host', 'sites', 'site', 'websites', 'parsers', 'parser-health', 'parserhealth', 'health', 'recent', 'latest'].includes(raw)) return 'sources';
    if (['runs', 'run-history', 'history', 'all-runs', 'allruns', 'runlist', 'run-list'].includes(raw)) return 'runs';
    return null;
  }

  parseWidgetParams(param) {
    const payload = {
      view: null,
      host: null,
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
    const valueAfter = (token, separator) => token.slice(token.indexOf(separator) + 1).trim();
    tokens.forEach(token => {
      const lower = token.toLowerCase();
      if (lower.startsWith('host:') || lower.startsWith('host=') || lower.startsWith('site:') || lower.startsWith('site=')) {
        const host = valueAfter(token, lower.charAt(4));
        payload.view = 'host';
        payload.host = host ? host.toLowerCase() : null;
        return;
      }
      if (lower.startsWith('parser:') || lower.startsWith('parser=')) {
        // Old parser deep links resolve to the host that parser feeds (resolveHostView).
        const parserName = valueAfter(token, lower.charAt(6));
        payload.view = 'host';
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
        payload.status = valueAfter(token, ':');
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
        payload.parserFilter = valueAfter(token, ':');
        return;
      }
      if (lower.startsWith('days=') || lower.startsWith('days:')) {
        const rawDays = valueAfter(token, lower.charAt(4));
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
    if (parsed.view === 'host') {
      if (parsed.host) return { mode: 'host', host: parsed.host };
      if (parsed.parserName) return { mode: 'host', parserName: parsed.parserName };
      return { mode: 'sources' };
    }
    return { mode: parsed.view };
  }

  parseViewFromQuery(query) {
    if (!query) return null;
    const host = query.host || query.site || null;
    if (host) {
      return { mode: 'host', host: String(host).trim().toLowerCase() };
    }
    const parserName = query.parser || query.parserName || null;
    if (parserName) {
      return { mode: 'host', parserName: String(parserName) };
    }
    const viewValue = query.view || query.mode || null;
    const viewToken = this.normalizeViewToken(viewValue);
    return viewToken ? { mode: viewToken } : null;
  }

  // A host view that only names a parser (old parser deep links) resolves to
  // the host that parser feeds; a host that is not in the ledger keeps its
  // name so the detail view can say so.
  resolveHostView(view, sourceHealth) {
    if (!view || view.mode !== 'host') return view;
    const rows = sourceHealth?.health?.rows || [];
    if (view.host) {
      const needle = String(view.host).toLowerCase();
      const match = rows.find(row => String(row.host).toLowerCase() === needle);
      return { mode: 'host', host: match ? match.host : view.host };
    }
    if (view.parserName) {
      const needle = String(view.parserName).toLowerCase();
      const match = rows.find(row => (row.parsers || []).some(name => String(name).toLowerCase() === needle));
      if (match) return { mode: 'host', host: match.host };
    }
    return { mode: 'sources' };
  }

  normalizeSortKey(value) {
    if (!value) return null;
    const normalized = String(value).toLowerCase().replace(/[^a-z]/g, '');
    if (['verdict', 'status', 'health', 'trouble', 'state'].includes(normalized)) return 'verdict';
    if (['host', 'site', 'name', 'website'].includes(normalized)) return 'host';
    if (['extracted', 'extr', 'rows', 'events', 'total'].includes(normalized)) return 'extracted';
    if (['bear', 'bears', 'final'].includes(normalized)) return 'bear';
    if (['upcoming', 'up', 'future'].includes(normalized)) return 'upcoming';
    if (['age', 'seen', 'lastrun', 'last', 'lastseen', 'run'].includes(normalized)) return 'age';
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
    return sortKey === 'verdict' || sortKey === 'host' ? 'asc' : 'desc';
  }

  getDefaultSortForView(view) {
    if (view?.mode === 'sources') {
      return { key: 'verdict', direction: 'asc' };
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
    if (!view || view.mode !== 'sources') return null;
    const fromQuery = this.getSortFromQuery(this.getQueryParams());
    if (fromQuery) return fromQuery;
    const fromParam = this.getSortFromParam(this.runtime.widgetParameter);
    if (fromParam) return fromParam;
    return this.getDefaultSortForView(view);
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
    // Query values win only when actually set — an empty query object returns
    // all-null fields, which must not clobber widget-parameter filters
    const merged = { ...fromParam };
    Object.entries(fromQuery).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        merged[key] = value;
      }
    });
    return merged;
  }

  async resolveView() {
    const queryView = this.parseViewFromQuery(this.getQueryParams());
    if (queryView) return queryView;
    const paramView = this.parseViewParam(this.runtime.widgetParameter);
    if (paramView) return paramView;
    return { mode: 'sources' };
  }

  getWidgetMaxRows() {
    const family = this.runtime.widgetFamily || 'medium';
    if (family === 'small') return 3;
    if (family === 'large') return 8;
    return 3;
  }

  getWidgetHeaderText(view) {
    if (view?.mode === 'runs') return 'All Runs';
    if (view?.mode === 'host') return view.host ? String(view.host) : 'Host';
    return 'Sources';
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

  // ─── Widget art (DrawContext) ─────────────────────────────────────────────
  // The home-screen widgets draw their own graphics: a verdict ring, a run
  // heat strip, gradient area charts, a bar strip and dot rows. Both palettes
  // sit on the brand purple; dark mode deepens it (Device.isUsingDarkAppearance).

  getWidgetPalette() {
    if (this._widgetPalette) return this._widgetPalette;
    let dark = false;
    try {
      dark = typeof Device !== 'undefined' && typeof Device.isUsingDarkAppearance === 'function'
        ? !!Device.isUsingDarkAppearance()
        : false;
    } catch (_) {
      dark = false;
    }
    this._widgetPalette = dark
      ? {
        dark: true,
        background: '#2a2f5e',
        backgroundDeep: '#1b1f42',
        text: BRAND.textSoft,
        textMuted: '#c7cdf0',
        card: 0.09,
        rule: 0.1,
        track: 0.12,
        ok: BRAND.success
      }
      : {
        dark: false,
        background: BRAND.primary,
        backgroundDeep: '#5260d8',
        text: BRAND.text,
        textMuted: BRAND.textMuted,
        card: WIDGET_STYLE.rowBackgroundAlpha,
        rule: 0.14,
        track: 0.18,
        ok: BRAND.success
      };
    return this._widgetPalette;
  }

  // Brand purple fading to a deeper shade corner to corner; plain colour when
  // LinearGradient is unavailable.
  applyWidgetBackground(widget) {
    const palette = this.getWidgetPalette();
    widget.backgroundColor = new Color(palette.background);
    try {
      if (typeof LinearGradient === 'function') {
        const gradient = new LinearGradient();
        gradient.colors = [new Color(palette.background), new Color(palette.backgroundDeep)];
        gradient.locations = [0, 1];
        gradient.startPoint = new Point(0, 0);
        gradient.endPoint = new Point(1, 1);
        widget.backgroundGradient = gradient;
      }
    } catch (error) {
      console.log(`Metrics: widget gradient unavailable: ${error.message}`);
    }
  }

  createWidgetContext(width, height) {
    const ctx = new DrawContext();
    ctx.size = new Size(width, height);
    ctx.respectScreenScale = true;
    ctx.opaque = false;
    return ctx;
  }

  widgetFont(size, weight = 'regular') {
    const rounded = {
      regular: 'regularRoundedSystemFont',
      medium: 'mediumRoundedSystemFont',
      bold: 'boldRoundedSystemFont',
      heavy: 'heavyRoundedSystemFont'
    }[weight] || 'regularRoundedSystemFont';
    if (typeof Font[rounded] === 'function') return Font[rounded](size);
    return weight === 'regular' ? Font.systemFont(size) : Font.boldSystemFont(size);
  }

  // Scriptable's Path has no arc primitive: the arc is appended as cubic
  // curves of at most a quarter turn each (angles in radians, screen
  // orientation, so increasing angles run clockwise).
  appendArc(path, cx, cy, radius, startAngle, endAngle, moveFirst) {
    const sweep = endAngle - startAngle;
    const segments = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const step = sweep / segments;
    const k = (4 / 3) * Math.tan(step / 4);
    const at = angle => new Point(cx + (radius * Math.cos(angle)), cy + (radius * Math.sin(angle)));
    let angle = startAngle;
    let from = at(angle);
    if (moveFirst) path.move(from);
    else path.addLine(from);
    for (let index = 0; index < segments; index += 1) {
      const next = angle + step;
      const to = at(next);
      const control1 = new Point(from.x - (k * radius * Math.sin(angle)), from.y + (k * radius * Math.cos(angle)));
      const control2 = new Point(to.x + (k * radius * Math.sin(next)), to.y - (k * radius * Math.cos(next)));
      path.addCurve(to, control1, control2);
      angle = next;
      from = to;
    }
  }

  // A gauge ring: a faint full track, one coloured arc per segment (clockwise
  // from the top, in the order given) and a big number in the middle.
  // options: { size, thickness, segments:[{ value, color }], total,
  //            centerText, centerSubText, centerColor }
  buildRingImage(options = {}) {
    const palette = this.getWidgetPalette();
    const size = Number.isFinite(options.size) ? options.size : 64;
    const thickness = Number.isFinite(options.thickness) ? options.thickness : Math.max(5, Math.round(size * 0.13));
    const ctx = this.createWidgetContext(size, size);
    const center = size / 2;
    const radius = (size / 2) - (thickness / 2) - 1;
    const total = Math.max(0, Number(options.total) || 0);
    const segments = (Array.isArray(options.segments) ? options.segments : [])
      .filter(segment => segment && Number(segment.value) > 0);

    ctx.setStrokeColor(new Color('#ffffff', palette.track));
    ctx.setLineWidth(thickness);
    ctx.strokeEllipse(new Rect(center - radius, center - radius, radius * 2, radius * 2));

    if (total > 0 && segments.length) {
      const fullTurn = Math.PI * 2;
      const gap = segments.length > 1 ? 0.035 : 0;
      let angle = -Math.PI / 2;
      ctx.setLineWidth(thickness);
      segments.forEach(segment => {
        const sweep = fullTurn * Math.min(1, Number(segment.value) / total);
        const start = angle + (gap / 2);
        const end = angle + sweep - (gap / 2);
        if (end > start) {
          const arc = new Path();
          this.appendArc(arc, center, center, radius, start, end, true);
          const color = segment.color instanceof Color ? segment.color : new Color(String(segment.color || BRAND.neutral));
          ctx.setStrokeColor(color);
          ctx.addPath(arc);
          ctx.strokePath();
        }
        angle += sweep;
      });
    }

    const centerText = options.centerText === undefined || options.centerText === null ? '' : String(options.centerText);
    const subText = options.centerSubText ? String(options.centerSubText) : '';
    if (centerText) {
      const numberSize = Number.isFinite(options.centerFontSize)
        ? options.centerFontSize
        : Math.max(12, Math.round(size * (centerText.length > 2 ? 0.26 : 0.34)));
      const subSize = Math.max(7, Math.round(size * 0.13));
      const inner = radius - (thickness / 2);
      const textColor = options.centerColor instanceof Color
        ? options.centerColor
        : new Color(String(options.centerColor || palette.text));
      ctx.setTextAlignedCenter();
      ctx.setFont(this.widgetFont(numberSize, 'heavy'));
      ctx.setTextColor(textColor);
      const numberHeight = numberSize * 1.25;
      const subHeight = subText ? subSize * 1.3 : 0;
      const blockTop = center - ((numberHeight + subHeight) / 2);
      ctx.drawTextInRect(centerText, new Rect(center - inner, blockTop, inner * 2, numberHeight));
      if (subText) {
        ctx.setFont(this.widgetFont(subSize, 'medium'));
        ctx.setTextColor(new Color(palette.textMuted));
        ctx.drawTextInRect(subText, new Rect(center - inner, blockTop + numberHeight - 1, inner * 2, subHeight + 2));
      }
    }

    return ctx.getImage();
  }

  // One column per run (oldest left, newest right) from every host's series:
  // how many hosts that run found dead / stopped / shrunk / empty. The current
  // baseline stands in for the baseline of the day, which is close enough for
  // a 14-run strip.
  buildHeatStripColumns(health, runLimit) {
    const rows = health && Array.isArray(health.rows) ? health.rows : [];
    const runs = new Map();
    rows.forEach(row => {
      const baseline = Number.isFinite(row?.baseline) ? row.baseline : null;
      (Array.isArray(row?.series) ? row.series : []).forEach(line => {
        if (!line || !line.run_id) return;
        let entry = runs.get(line.run_id);
        if (!entry) {
          entry = {
            runId: line.run_id,
            finishedAt: line.finished_at || '',
            counts: { dead: 0, stopped: 0, shrunk: 0, empty: 0, ok: 0 },
            total: 0,
            extracted: 0
          };
          runs.set(line.run_id, entry);
        }
        const extracted = Number(line.extracted) || 0;
        let verdict = 'ok';
        if (line.status === 'dead') verdict = 'dead';
        else if (extracted === 0) verdict = baseline > 0 ? 'stopped' : 'empty';
        else if (baseline > 0 && extracted < baseline / 2) verdict = 'shrunk';
        entry.counts[verdict] += 1;
        entry.total += 1;
        entry.extracted += extracted;
      });
    });
    const ordered = [...runs.values()].sort((a, b) => (
      String(a.finishedAt).localeCompare(String(b.finishedAt)) || String(a.runId).localeCompare(String(b.runId))
    ));
    const limit = Number.isFinite(runLimit) && runLimit > 0 ? runLimit : 14;
    return ordered.slice(-limit).map(entry => {
      const troubled = entry.total - entry.counts.ok;
      const worst = ['dead', 'stopped', 'shrunk', 'empty'].find(verdict => entry.counts[verdict] > 0) || null;
      return { ...entry, troubled, worst };
    });
  }

  // Heat strip: a rounded square per run; inside it the troubled hosts of
  // that run stack up from the bottom as verdict-coloured bands (worst on
  // top), the stack as tall as the run's share of the worst run on the
  // strip. The newest square is outlined; a 7pt caption sits underneath.
  buildHeatStripImage(columns, options = {}) {
    const palette = this.getWidgetPalette();
    const width = Number.isFinite(options.width) ? options.width : 200;
    const height = Number.isFinite(options.height) ? options.height : 26;
    const ctx = this.createWidgetContext(width, height);
    const list = Array.isArray(columns) ? columns : [];
    const captionHeight = options.caption === false ? 0 : 10;
    const cellHeight = Math.max(4, height - captionHeight - 1);
    const slots = Math.max(list.length, Number.isFinite(options.slots) ? options.slots : 1);
    const gap = 3;
    const cellWidth = Math.min(22, (width - (gap * (slots - 1))) / slots);
    const corner = Math.min(3, cellWidth / 3);
    const peak = list.reduce((max, column) => Math.max(max, column.troubled || 0), 0);
    const totalHosts = list.reduce((max, column) => Math.max(max, column.total || 0), 0);

    list.forEach((column, index) => {
      const x = index * (cellWidth + gap);
      const rect = new Rect(x, 0, cellWidth, cellHeight);
      const base = new Path();
      base.addRoundedRect(rect, corner, corner);
      ctx.setFillColor(new Color('#ffffff', palette.track));
      ctx.addPath(base);
      ctx.fillPath();
      if (column.troubled > 0 && column.worst) {
        const stackHeight = Math.max(3, cellHeight * (peak > 0 ? column.troubled / peak : 0));
        let y = cellHeight;
        ['empty', 'shrunk', 'stopped', 'dead'].forEach(verdict => {
          const count = column.counts[verdict] || 0;
          if (!count) return;
          const bandHeight = stackHeight * (count / column.troubled);
          y -= bandHeight;
          const band = new Path();
          const isTop = y <= cellHeight - stackHeight + 0.01;
          band.addRoundedRect(new Rect(x, y, cellWidth, bandHeight), isTop ? corner : 0, isTop ? corner : 0);
          ctx.setFillColor(new Color(SOURCE_VERDICT_COLORS[verdict] || BRAND.danger, 0.95));
          ctx.addPath(band);
          ctx.fillPath();
        });
      } else if (column.total > 0) {
        const calm = new Path();
        calm.addRoundedRect(rect, corner, corner);
        ctx.setFillColor(new Color(palette.ok, 0.28));
        ctx.addPath(calm);
        ctx.fillPath();
      }
      if (index === list.length - 1) {
        const outline = new Path();
        outline.addRoundedRect(new Rect(x + 0.5, 0.5, cellWidth - 1, cellHeight - 1), corner, corner);
        ctx.setStrokeColor(new Color('#ffffff', 0.85));
        ctx.setLineWidth(1);
        ctx.addPath(outline);
        ctx.strokePath();
      }
    });

    if (captionHeight > 0) {
      const captionY = cellHeight + 1;
      ctx.setFont(Font.systemFont(7));
      ctx.setTextColor(new Color(palette.textMuted));
      ctx.setTextAlignedLeft();
      const left = options.captionLeft || `${list.length} runs`;
      ctx.drawTextInRect(left, new Rect(0, captionY, width / 2, captionHeight));
      ctx.setTextAlignedRight();
      const right = options.captionRight || (peak > 0
        ? `peak ${peak} of ${totalHosts} troubled`
        : (list.length ? 'all clear' : ''));
      if (right) ctx.drawTextInRect(right, new Rect(width / 2, captionY, width / 2, captionHeight));
    }

    return ctx.getImage();
  }

  // Bar strip: one rounded bar per run, coloured by status, over three faint
  // rules; the newest bar is outlined and carries its value.
  // bars: [{ value, color }]
  buildBarStripImage(bars, options = {}) {
    const palette = this.getWidgetPalette();
    const width = Number.isFinite(options.width) ? options.width : 200;
    const height = Number.isFinite(options.height) ? options.height : 40;
    const ctx = this.createWidgetContext(width, height);
    const list = Array.isArray(bars) ? bars : [];
    const captionHeight = options.caption === false ? 0 : 10;
    const labelHeight = 9;
    const plotTop = labelHeight;
    const plotHeight = Math.max(4, height - captionHeight - labelHeight - 1);
    const plotBottom = plotTop + plotHeight;
    const slots = Math.max(list.length, Number.isFinite(options.slots) ? options.slots : 1);
    const gap = 3;
    const barWidth = Math.min(26, (width - (gap * (slots - 1))) / slots);
    const corner = Math.min(2.5, barWidth / 3);
    const peak = list.reduce((max, bar) => Math.max(max, Number(bar.value) || 0), 0) || 1;

    ctx.setFillColor(new Color('#ffffff', palette.rule));
    [0.25, 0.5, 0.75].forEach(fraction => {
      ctx.fillRect(new Rect(0, plotTop + (plotHeight * fraction), width, 0.5));
    });

    list.forEach((bar, index) => {
      const value = Math.max(0, Number(bar.value) || 0);
      const barHeight = Math.max(2, (value / peak) * plotHeight);
      const x = index * (barWidth + gap);
      const rect = new Rect(x, plotBottom - barHeight, barWidth, barHeight);
      const color = bar.color instanceof Color ? bar.color : new Color(String(bar.color || BRAND.neutral));
      const isLast = index === list.length - 1;
      const path = new Path();
      path.addRoundedRect(rect, corner, corner);
      ctx.setFillColor(LineChart.withAlpha(color, isLast ? 1 : 0.72));
      ctx.addPath(path);
      ctx.fillPath();
      if (isLast) {
        const outline = new Path();
        outline.addRoundedRect(new Rect(x + 0.5, rect.y + 0.5, barWidth - 1, Math.max(1, barHeight - 1)), corner, corner);
        ctx.setStrokeColor(new Color('#ffffff', 0.85));
        ctx.setLineWidth(1);
        ctx.addPath(outline);
        ctx.strokePath();
        ctx.setFont(this.widgetFont(7, 'bold'));
        ctx.setTextColor(new Color(palette.text));
        ctx.setTextAlignedRight();
        const labelWidth = 48;
        ctx.drawTextInRect(this.formatNumber(value), new Rect(Math.min(x + barWidth, width) - labelWidth, 0, labelWidth, labelHeight));
      }
    });

    if (captionHeight > 0) {
      ctx.setFont(Font.systemFont(7));
      ctx.setTextColor(new Color(palette.textMuted));
      ctx.setTextAlignedLeft();
      ctx.drawTextInRect(options.captionLeft || `${list.length} runs`, new Rect(0, plotBottom + 1, width * 0.7, captionHeight));
      if (options.captionRight) {
        ctx.setTextAlignedRight();
        ctx.drawTextInRect(options.captionRight, new Rect(width * 0.3, plotBottom + 1, width * 0.7, captionHeight));
      }
    }

    return ctx.getImage();
  }

  // A row of dots (one per item, up to `max`), for the vanished count.
  buildDotsImage(count, color, options = {}) {
    const max = Number.isFinite(options.max) ? options.max : 12;
    const dot = Number.isFinite(options.dot) ? options.dot : 6;
    const gap = Number.isFinite(options.gap) ? options.gap : 3;
    const shown = Math.max(0, Math.min(max, Math.floor(Number(count) || 0)));
    const width = Math.max(dot, (shown * (dot + gap)) - gap);
    const ctx = this.createWidgetContext(width, dot);
    const fill = color instanceof Color ? color : new Color(String(color || BRAND.secondary));
    for (let index = 0; index < shown; index += 1) {
      ctx.setFillColor(LineChart.withAlpha(fill, index === shown - 1 && count > max ? 0.45 : 1));
      ctx.fillEllipse(new Rect(index * (dot + gap), 0, dot, dot));
    }
    return { image: ctx.getImage(), width, height: dot };
  }

  getWidgetArtSizes(family) {
    if (family === 'small') {
      return { ring: 60, strip: { width: 124, height: 24 }, chart: { width: 124, height: 44 }, bars: { width: 124, height: 30 }, runs: 8, runRows: 2 };
    }
    if (family === 'large') {
      return { ring: 78, strip: { width: 196, height: 30 }, chart: { width: 280, height: 96 }, bars: { width: 280, height: 64 }, spark: { width: 280, height: 46 }, runs: 14, runRows: 4 };
    }
    return { ring: 68, strip: { width: 212, height: 26 }, chart: { width: 280, height: 40 }, bars: { width: 280, height: 40 }, runs: 12, runRows: 1 };
  }

  countSourceVerdicts(health) {
    const rows = health && Array.isArray(health.rows) ? health.rows : [];
    const counts = {};
    rows.forEach(row => {
      const verdict = String(row?.verdict || 'ok');
      counts[verdict] = (counts[verdict] || 0) + 1;
    });
    return counts;
  }

  // The sources ring: one arc per troubled verdict (worst first) over the
  // faint track, the troubled count in the middle.
  buildSourcesRingImage(health, size) {
    const palette = this.getWidgetPalette();
    const counts = this.countSourceVerdicts(health);
    const hosts = health && Array.isArray(health.rows) ? health.rows.length : 0;
    const order = MetricsSections?.SOURCE_VERDICT_ORDER || Object.keys(SOURCE_VERDICT_COLORS);
    const segments = order
      .filter(verdict => verdict !== 'ok')
      .map(verdict => ({ value: counts[verdict] || 0, color: SOURCE_VERDICT_COLORS[verdict] || BRAND.danger }));
    const troubled = segments.reduce((sum, segment) => sum + segment.value, 0);
    const worst = order.find(verdict => verdict !== 'ok' && counts[verdict] > 0) || null;
    return this.buildRingImage({
      size,
      segments,
      total: hosts,
      centerText: hosts === 0 ? '–' : String(troubled),
      centerSubText: hosts === 0 ? '' : `of ${hosts}`,
      centerColor: worst ? SOURCE_VERDICT_COLORS[worst] : palette.ok
    });
  }

  // One troubled host as a tappable row: favicon, verdict dot, host, then
  // (when asked) the since/vanished detail and the verdict badge.
  async addSourceHostRow(widget, item, family, options = {}) {
    const palette = this.getWidgetPalette();
    const row = this.addWidgetRow(widget, family);
    row.url = this.buildHostUrl(item.host);
    const iconImage = await this.getHostIconImage(item);
    if (iconImage) {
      const icon = row.addImage(iconImage);
      icon.imageSize = new Size(12, 12);
      icon.cornerRadius = 3;
    }
    const dot = row.addImage(this.buildStatusDot(new Color(SOURCE_VERDICT_COLORS[item.verdict] || BRAND.neutral), 6));
    dot.imageSize = new Size(6, 6);
    const name = row.addText(this.truncateText(item.host, options.nameLimit || 22));
    name.font = Font.boldSystemFont(FONT_SIZES.widget.small);
    name.textColor = new Color(palette.text);
    name.lineLimit = 1;
    row.addSpacer();
    if (options.detail) {
      let detailLabel = `${this.formatNumber(item.extracted)} · ${this.formatNumber(item.bear)} · ${this.formatNumber(item.upcoming)}`;
      if (item.sinceLabel) detailLabel = `since ${item.sinceLabel}`;
      else if (item.vanished > 0) detailLabel = `${item.vanished} gone`;
      const detail = row.addText(detailLabel);
      detail.font = Font.systemFont(10);
      detail.textColor = new Color(palette.textMuted);
      detail.lineLimit = 1;
    }
    if (options.badge !== false) {
      this.addWidgetBadge(row, item.label, item.verdict, { fontSize: 10 });
    }
    return row;
  }

  // Sources widget. Small: ring + headline. Medium: ring beside the headline,
  // the heat strip and two troubled hosts. Large: adds more hosts and a
  // gradient sparkline of total extracted per run.
  async renderWidgetSources(widget, context) {
    const family = this.runtime.widgetFamily || 'medium';
    const palette = this.getWidgetPalette();
    const sizes = this.getWidgetArtSizes(family);
    const sourceHealth = context.sourceHealth;
    if (!sourceHealth?.available || !MetricsSections?.buildSourceWidgetSummary) {
      const empty = widget.addStack();
      empty.layoutHorizontally();
      empty.centerAlignContent();
      empty.spacing = 10;
      const ring = empty.addImage(this.buildRingImage({ size: family === 'small' ? 48 : 56, segments: [], total: 0, centerText: '–' }));
      ring.imageSize = new Size(family === 'small' ? 48 : 56, family === 'small' ? 48 : 56);
      const column = empty.addStack();
      column.layoutVertically();
      const title = column.addText('No source ledger yet');
      title.font = Font.boldSystemFont(FONT_SIZES.widget.label);
      title.textColor = new Color(palette.text);
      title.lineLimit = 2;
      const note = column.addText(family === 'small' ? 'Every run writes it.' : 'Every run writes it; backfill history on the Mac.');
      note.font = Font.systemFont(FONT_SIZES.widget.small);
      note.textColor = new Color(palette.textMuted);
      note.lineLimit = 2;
      return;
    }

    const health = sourceHealth.health;
    const limit = family === 'small' ? 0 : (family === 'large' ? 5 : 2);
    const summary = MetricsSections.buildSourceWidgetSummary(health, { limit: Math.max(1, limit) });
    const ringImage = this.buildSourcesRingImage(health, sizes.ring);
    const columns = this.buildHeatStripColumns(health, 14);
    const headlineText = summary.troubled > 0
      ? (family === 'small' ? (summary.troubled === 1 ? 'needs a look' : 'need a look') : summary.headline)
      : (family === 'small' ? 'all ok' : summary.headline);

    if (family === 'small') {
      widget.addSpacer();
      const ringRow = widget.addStack();
      ringRow.layoutHorizontally();
      ringRow.addSpacer();
      const ring = ringRow.addImage(ringImage);
      ring.imageSize = new Size(sizes.ring, sizes.ring);
      ringRow.addSpacer();
      widget.addSpacer(4);
      const headline = widget.addText(headlineText);
      headline.font = Font.boldSystemFont(FONT_SIZES.widget.label);
      headline.textColor = new Color(summary.troubled > 0 ? palette.text : palette.ok);
      headline.centerAlignText();
      headline.lineLimit = 1;
      const strip = widget.addImage(this.buildHeatStripImage(columns, { ...sizes.strip, caption: false, slots: 14 }));
      strip.imageSize = new Size(sizes.strip.width, sizes.strip.height);
      strip.centerAlignImage();
      widget.addSpacer();
      return;
    }

    const top = widget.addStack();
    top.layoutHorizontally();
    top.centerAlignContent();
    top.spacing = 10;
    const ring = top.addImage(ringImage);
    ring.imageSize = new Size(sizes.ring, sizes.ring);
    const column = top.addStack();
    column.layoutVertically();
    column.spacing = 3;
    const headline = column.addText(headlineText);
    headline.font = Font.boldSystemFont(FONT_SIZES.widget.label);
    headline.textColor = new Color(palette.text);
    headline.lineLimit = 1;
    if (family === 'large') {
      const newestLabel = summary.newestFinishedAt
        ? `Newest run ${this.formatRelativeTime(summary.newestFinishedAt)} · ${columns.length} runs on the strip`
        : 'No runs recorded yet';
      const newest = column.addText(newestLabel);
      newest.font = Font.systemFont(10);
      newest.textColor = new Color(palette.textMuted);
      newest.lineLimit = 1;
    }
    const stripImage = this.buildHeatStripImage(columns, { ...sizes.strip, slots: 14 });
    const strip = column.addImage(stripImage);
    strip.imageSize = new Size(sizes.strip.width, sizes.strip.height);

    if (family === 'medium') {
      const items = summary.items.slice(0, 2);
      for (const item of items) {
        await this.addSourceHostRow(column, item, 'small', { nameLimit: 20, badge: true });
      }
      if (items.length === 0) {
        const newestLabel = summary.newestFinishedAt
          ? `Newest run ${this.formatRelativeTime(summary.newestFinishedAt)}`
          : 'No runs recorded yet';
        const newest = column.addText(newestLabel);
        newest.font = Font.systemFont(FONT_SIZES.widget.small);
        newest.textColor = new Color(palette.textMuted);
        newest.lineLimit = 1;
      }
      return;
    }

    widget.addSpacer(6);
    for (let index = 0; index < summary.items.length; index += 1) {
      if (index > 0) widget.addSpacer(3);
      await this.addSourceHostRow(widget, summary.items[index], 'large', { nameLimit: 28, detail: true });
    }
    if (summary.items.length === 0) {
      const calm = widget.addText(`All ${summary.hosts} sites answered — nothing to chase.`);
      calm.font = Font.systemFont(FONT_SIZES.widget.small);
      calm.textColor = new Color(palette.ok);
      calm.lineLimit = 1;
    }

    widget.addSpacer();
    const caption = widget.addStack();
    caption.layoutHorizontally();
    caption.centerAlignContent();
    const captionText = caption.addText(`Extracted per run · last ${columns.length}`);
    captionText.font = Font.systemFont(10);
    captionText.textColor = new Color(palette.textMuted);
    captionText.lineLimit = 1;
    caption.addSpacer();
    if (summary.more > 0) {
      const more = caption.addText(`+${summary.more} more hosts`);
      more.font = Font.systemFont(10);
      more.textColor = new Color(palette.textMuted);
      more.lineLimit = 1;
    }
    widget.addSpacer(2);
    const sparkValues = columns.map(column => column.extracted);
    const sparkImage = this.buildLineChartImage(sparkValues.length ? sparkValues : [0], sizes.spark, {
      lineColor: new Color(CHART_STYLE.line),
      fillColor: new Color(CHART_STYLE.line, 0.3),
      lineWidth: 1.5,
      padding: 4,
      logPoints: false
    });
    const spark = widget.addImage(sparkImage);
    spark.imageSize = new Size(sizes.spark.width, sizes.spark.height);
  }

  addWidgetMetricTile(container, label, value, options = {}) {
    const palette = this.getWidgetPalette();
    const tile = container.addStack();
    tile.layoutVertically();
    tile.spacing = 0;
    tile.backgroundColor = new Color(WIDGET_STYLE.rowBackground, palette.card);
    tile.cornerRadius = WIDGET_STYLE.rowRadius;
    tile.setPadding(4, 7, 4, 7);
    const number = tile.addText(String(value));
    number.font = this.widgetFont(options.fontSize || 15, 'heavy');
    number.textColor = options.color instanceof Color ? options.color : new Color(String(options.color || palette.text));
    number.lineLimit = 1;
    number.minimumScaleFactor = 0.6;
    const caption = tile.addText(String(label));
    caption.font = Font.systemFont(9);
    caption.textColor = new Color(palette.textMuted);
    caption.lineLimit = 1;
    return tile;
  }

  // Host widget: verdict badge and since-run, a gradient area of extracted
  // per run with the baseline dashed and the troubled stretch tinted, the
  // latest numbers as tiles, vanished events as dots.
  async renderWidgetHost(widget, context, view) {
    const family = this.runtime.widgetFamily || 'medium';
    const palette = this.getWidgetPalette();
    const sizes = this.getWidgetArtSizes(family);
    const sourceHealth = context.sourceHealth;
    const rows = sourceHealth?.available ? (sourceHealth.health?.rows || []) : [];
    const needle = String(view?.host || '').toLowerCase();
    const row = rows.find(item => String(item.host).toLowerCase() === needle) || null;
    if (!row) {
      const none = widget.addText(sourceHealth?.available ? 'No ledger lines for this host.' : 'No source ledger yet');
      none.font = Font.systemFont(FONT_SIZES.widget.small);
      none.textColor = new Color(palette.text);
      return;
    }

    const verdictColor = SOURCE_VERDICT_COLORS[row.verdict] || BRAND.neutral;
    const verdictLabel = MetricsSections?.sourceVerdictLabel
      ? MetricsSections.sourceVerdictLabel(row.verdict)
      : String(row.verdict || '');
    const statusRow = widget.addStack();
    statusRow.layoutHorizontally();
    statusRow.centerAlignContent();
    statusRow.spacing = 6;
    this.addWidgetBadge(statusRow, verdictLabel, row.verdict, { fontSize: 10 });
    const parsers = (Array.isArray(row.parsers) ? row.parsers : []).filter(Boolean);
    if (family !== 'small' && parsers.length) {
      const parserText = statusRow.addText(this.truncateText(parsers.join(', '), family === 'large' ? 40 : 24));
      parserText.font = Font.systemFont(FONT_SIZES.widget.small);
      parserText.textColor = new Color(palette.textMuted);
      parserText.lineLimit = 1;
    }
    statusRow.addSpacer();
    let whenLabel = '';
    if (row.since && MetricsSections?.formatSourceRun) {
      whenLabel = `since ${MetricsSections.formatSourceRun(row.since)}`;
    } else if (row.latest?.finished_at) {
      whenLabel = this.formatRelativeTime(row.latest.finished_at);
    }
    if (whenLabel && family !== 'small') {
      const when = statusRow.addText(whenLabel);
      when.font = Font.systemFont(FONT_SIZES.widget.small);
      when.textColor = new Color(palette.textMuted);
      when.lineLimit = 1;
    }
    widget.addSpacer(3);

    const fullSeries = Array.isArray(row.series) ? row.series : [];
    const runLimit = family === 'small' ? 8 : (family === 'large' ? 16 : 12);
    const windowed = fullSeries.slice(-runLimit);
    const values = windowed.map(line => Number(line.extracted) || 0);
    if (values.length > 1) {
      let tintFromIndex = null;
      if (row.since) {
        const index = windowed.findIndex(line => line.run_id === row.since);
        const older = fullSeries.some(line => line.run_id === row.since);
        tintFromIndex = index >= 0 ? index : (older ? 0 : null);
      }
      const chartImage = this.buildLineChartImage(values, sizes.chart, {
        lineColor: new Color(CHART_STYLE.line),
        fillColor: new Color(CHART_STYLE.line, 0.3),
        lineWidth: family === 'small' ? 1.5 : 2,
        padding: family === 'small' ? 4 : 6,
        baselineValue: Number.isFinite(row.baseline) ? row.baseline : null,
        baselineColor: new Color(palette.text, 0.7),
        baselineLabel: family === 'small' ? null : 'baseline',
        tintFromIndex,
        tintColor: new Color(verdictColor),
        lastPointColor: new Color(row.verdict === 'ok' ? CHART_STYLE.line : verdictColor),
        gridColor: new Color('#ffffff', palette.rule),
        logPoints: false
      });
      const chart = widget.addImage(chartImage);
      chart.imageSize = new Size(sizes.chart.width, sizes.chart.height);
      widget.addSpacer(3);
    }

    const latest = row.latest || {};
    const tiles = widget.addStack();
    tiles.layoutHorizontally();
    tiles.spacing = 5;
    const tileSize = family === 'small' ? 13 : 15;
    this.addWidgetMetricTile(tiles, 'extracted', this.formatNumber(latest.extracted || 0), { fontSize: tileSize });
    if (family !== 'small') {
      this.addWidgetMetricTile(tiles, 'bear', this.formatNumber(latest.bear || 0), { fontSize: tileSize });
    }
    this.addWidgetMetricTile(tiles, 'upcoming', this.formatNumber(latest.upcoming || 0), { fontSize: tileSize });
    if (family !== 'small') {
      this.addWidgetMetricTile(tiles, 'baseline', Number.isFinite(row.baseline) ? this.formatNumber(row.baseline) : '—', {
        fontSize: tileSize,
        color: palette.textMuted
      });
    }
    tiles.addSpacer();
    if (family === 'small') return;

    // Medium has no room for the meta row unless something vanished.
    const vanished = Array.isArray(row.vanished) ? row.vanished : [];
    if (family === 'medium' && !vanished.length) return;
    widget.addSpacer(4);
    const meta = widget.addStack();
    meta.layoutHorizontally();
    meta.centerAlignContent();
    meta.spacing = 6;
    if (vanished.length) {
      const dots = this.buildDotsImage(vanished.length, new Color(SOURCE_VERDICT_COLORS.vanished), { max: family === 'large' ? 16 : 10 });
      const dotsImage = meta.addImage(dots.image);
      dotsImage.imageSize = new Size(dots.width, dots.height);
      const vanishedText = meta.addText(`${vanished.length} vanished`);
      vanishedText.font = Font.boldSystemFont(10);
      vanishedText.textColor = new Color(SOURCE_VERDICT_COLORS.vanished);
      vanishedText.lineLimit = 1;
    } else {
      const calm = meta.addText('nothing vanished');
      calm.font = Font.systemFont(10);
      calm.textColor = new Color(palette.textMuted);
      calm.lineLimit = 1;
    }
    meta.addSpacer();
    const runsText = meta.addText(`${fullSeries.length} runs`);
    runsText.font = Font.systemFont(10);
    runsText.textColor = new Color(palette.textMuted);
    runsText.lineLimit = 1;

    if (family === 'large' && vanished.length) {
      widget.addSpacer(3);
      vanished.slice(0, 3).forEach(item => {
        const line = widget.addText(`• ${this.truncateText(item.title || item.key || 'untitled', 34)}${item.day ? ` · ${item.day}` : ''}`);
        line.font = Font.systemFont(10);
        line.textColor = new Color(palette.textMuted);
        line.lineLimit = 1;
      });
    }
  }

  // Runs widget: a bar strip of final events per run (status-coloured, newest
  // outlined) above the run cells the widget always had.
  renderWidgetRuns(widget, context) {
    const runItems = Array.isArray(context.runItems) ? context.runItems : [];
    const runSortState = context.runSortState || this.getDefaultRunSort();
    const runFilters = context.runFilters || null;
    const family = this.runtime.widgetFamily || 'medium';
    const palette = this.getWidgetPalette();
    const sizes = this.getWidgetArtSizes(family);

    // The header row (logo + "All Runs") is already on the widget.
    if (runSortState && family !== 'small') {
      const sortLabel = widget.addText(`Sort ${this.getRunSortLabel(runSortState)}`);
      sortLabel.font = Font.systemFont(10);
      sortLabel.textColor = new Color(palette.textMuted);
      sortLabel.lineLimit = 1;
    }

    if (runFilters && (runFilters.status || runFilters.parserFilter || runFilters.days)) {
      const filterLine = widget.addText(this.formatRunFilterLabel(runFilters));
      filterLine.font = Font.systemFont(10);
      filterLine.textColor = new Color(palette.textMuted);
      filterLine.lineLimit = 1;
    }
    widget.addSpacer(4);

    const filtered = this.applyRunFilters(runItems, runFilters);
    const chronological = [...filtered]
      .sort((a, b) => this.getTimeValue(a?.finishedAt) - this.getTimeValue(b?.finishedAt))
      .slice(-sizes.runs);
    if (chronological.length) {
      const bars = chronological.map(run => ({
        value: run.finalEvents || 0,
        color: this.getStatusMeta(run.status).color
      }));
      const newest = chronological[chronological.length - 1];
      const barsImage = this.buildBarStripImage(bars, {
        ...sizes.bars,
        slots: sizes.runs,
        caption: family !== 'small',
        captionLeft: `Final events · last ${chronological.length} runs`,
        captionRight: family === 'small' ? null : `newest ${this.formatLastRunLabel(newest.finishedAt)}`
      });
      const strip = widget.addImage(barsImage);
      strip.imageSize = new Size(sizes.bars.width, sizes.bars.height);
      widget.addSpacer(5);
    }

    const sorted = this.sortRunItems(filtered, runSortState);
    const columns = this.getWidgetColumnCount(family);
    const maxRows = sizes.runRows;
    const items = sorted.slice(0, maxRows * columns);

    if (items.length === 0) {
      const none = widget.addText('No runs match filters.');
      none.font = Font.systemFont(FONT_SIZES.widget.small);
      none.textColor = new Color(palette.text);
      return;
    }

    for (let index = 0; index < items.length; index += columns) {
      if (index > 0) widget.addSpacer(4);
      const row = widget.addStack();
      row.layoutHorizontally();
      row.spacing = WIDGET_STYLE.rowSpacing;
      const isIncompleteRow = columns > 1 && (index + columns > items.length);

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

        const statusIcon = this.buildStatusIcon(statusMeta, 10);
        if (statusIcon) {
          const statusImage = header.addImage(statusIcon);
          statusImage.imageSize = new Size(10, 10);
        }

        const titleLine = header.addText(this.formatRunId(run.runId));
        titleLine.font = Font.boldSystemFont(FONT_SIZES.widget.small);
        titleLine.textColor = new Color(palette.text);
        titleLine.lineLimit = 1;

        if (isIncompleteRow) {
          header.addSpacer(4);
        } else {
          header.addSpacer();
        }

        const finalLabel = this.formatNumber(run.finalEvents || 0);
        const finalText = header.addText(finalLabel);
        finalText.font = this.widgetFont(FONT_SIZES.widget.small, 'heavy');
        finalText.textColor = statusMeta.color;
        finalText.lineLimit = 1;

        const errors = run.errorsCount || 0;
        const warnings = run.warningsCount || 0;
        const issuesTotal = errors + warnings;
        const summaryParts = [];
        if (issuesTotal > 0) {
          summaryParts.push(`Issues ${issuesTotal}`);
        }
        if (run.finishedAt) {
          summaryParts.push(this.formatLastRunLabel(run.finishedAt));
        }
        if (family === 'large') {
          if (run.parsersCount) summaryParts.push(`${run.parsersCount} parsers`);
          if (run.durationMs) summaryParts.push(this.formatDuration(run.durationMs));
        }
        const summary = cell.addText(summaryParts.join(' • ') || 'Final events');
        summary.font = Font.systemFont(10);
        summary.textColor = new Color(palette.textMuted);
        summary.lineLimit = 1;
      }
    }

    if (filtered.length > items.length) {
      widget.addSpacer(3);
      const more = widget.addText(`+${filtered.length - items.length} more`);
      more.font = Font.systemFont(10);
      more.textColor = new Color(palette.textMuted);
    }
  }

  async renderWidget(data, view) {
    const widget = new ListWidget();
    this.applyWidgetBackground(widget);
    widget.setPadding(12, 12, 12, 12);

    const normalizedMode = view?.mode === 'host'
      ? 'host'
      : (this.normalizeViewToken(view?.mode) || 'sources');
    const normalizedView = { ...(view || {}), mode: normalizedMode };

    const logoImage = await this.loadLogoImage();

    const latest = data.latestRecord;
    const records = Array.isArray(data.records) ? data.records : [];
    const sortState = data.sortState || this.resolveSort(normalizedView);
    const runSortState = data.runSortState || this.resolveRunSort(normalizedView);
    const runFilters = data.runFilters || this.resolveRunFilters(normalizedView);
    const runItems = Array.isArray(data.runItems) ? data.runItems : this.buildRunItems(records);
    const chartSize = this.getWidgetChartSize();
    const widgetUrl = this.buildWidgetDashboardUrl(normalizedView, sortState, runSortState, runFilters);

    // Host views wear the host's favicon in the header instead of the logo.
    let headerImage = logoImage;
    if (normalizedView.mode === 'host' && normalizedView.host) {
      const rows = data.sourceHealth?.available ? (data.sourceHealth.health?.rows || []) : [];
      const needle = String(normalizedView.host).toLowerCase();
      const row = rows.find(item => String(item.host).toLowerCase() === needle) || null;
      const favicon = row ? await this.getHostIconImage(row) : null;
      if (favicon) headerImage = favicon;
    }
    this.addWidgetHeader(widget, headerImage, this.getWidgetHeaderText(normalizedView));

    if (normalizedView.mode === 'runs' && runItems.length === 0) {
      const message = widget.addText('No run metrics yet.');
      message.font = Font.systemFont(FONT_SIZES.widget.label);
      message.textColor = new Color(this.getWidgetPalette().text);
      if (widgetUrl) widget.url = widgetUrl;
      return widget;
    }

    const context = {
      latest,
      records,
      sourceHealth: data.sourceHealth || null,
      chartSize,
      runSortState,
      runFilters,
      runItems
    };

    if (normalizedView.mode === 'runs') {
      this.renderWidgetRuns(widget, context);
    } else if (normalizedView.mode === 'host') {
      await this.renderWidgetHost(widget, context, normalizedView);
    } else {
      await this.renderWidgetSources(widget, context);
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

  async renderAppHtml(data, view, sortState) {
    const html = await this.buildAppHtml(data, view, sortState);
    await WebView.loadHTML(html, null, null, true);
  }

  async buildAppHtml(data, view, sortState) {
    const latest = data.latestRecord;
    const summary = data.summary;
    const records = Array.isArray(data.records) ? data.records : [];
    const sourceHealth = data.sourceHealth || { available: false, reason: null, health: null, records: [] };
    const sourceRows = sourceHealth.available && Array.isArray(sourceHealth.health?.rows) ? sourceHealth.health.rows : [];
    const sourceRecords = Array.isArray(sourceHealth.records) ? sourceHealth.records : [];
    const sourceSort = sortState || data.sortState || this.resolveSort(view);
    const sourceSortResolved = sourceSort || this.getDefaultSortForView({ mode: 'sources' });
    const runSortState = data.runSortState || this.resolveRunSort(view);
    const runSortResolved = runSortState || this.getDefaultRunSort();
    const runFilters = data.runFilters || this.resolveRunFilters(view);
    const runItems = Array.isArray(data.runItems) ? data.runItems : this.buildRunItems(records);
    const filteredRuns = this.applyRunFilters(runItems, runFilters);
    const sortedRuns = this.sortRunItems(filteredRuns, runSortResolved);
    const recentRecords = this.getRecentRecords(records, this.getAppHistoryLimit());
    const isDarkMode = Device.isUsingDarkAppearance();
    const chartMode = isDarkMode ? 'dark' : 'light';
    const safeView = view?.mode ? view : { mode: 'sources' };
    const viewMode = safeView.mode === 'host' ? 'host' : (this.normalizeViewToken(safeView.mode) || 'sources');
    const initialViewKey = viewMode === 'host' ? String(safeView.host || '') : '';

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

    const buildNavAttributes = (viewTarget, keyTarget, isTab = false) => {
      if (!viewTarget) return '';
      const attrs = [`data-nav-view="${escapeHtml(viewTarget)}"`];
      if (keyTarget) {
        attrs.push(`data-nav-key="${escapeHtml(keyTarget)}"`);
      }
      if (isTab) {
        attrs.push('data-nav-tab="true"');
      }
      return attrs.join(' ');
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

    // One chart card: title, figures, subtitle. A figure is inline SVG with
    // its spec embedded (metrics-sections buildChartFigureHtml); the page
    // script re-renders it for the range toggle, shows a run's numbers on
    // tap, and upgrades it to a Chart.js canvas when the CDN script loads.
    // Figures in views hidden on load stay pending (spec only) and render
    // when their view opens.
    const buildChartFigureCard = (title, figures, subtitle) => {
      const body = (Array.isArray(figures) ? figures : [figures]).filter(Boolean).join('');
      if (!body) return '';
      return `
      <div class="card chart-card">
        <div class="section-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="section-subtitle">${escapeHtml(subtitle)}</div>` : ''}
        ${body}
      </div>`;
    };
    const buildFigure = (spec, options = {}) => (spec && MetricsSections && typeof MetricsSections.buildChartFigureHtml === 'function'
      ? MetricsSections.buildChartFigureHtml(spec, { mode: chartMode, ...options })
      : '');
    const chartSpec = (name, ...args) => (MetricsSections && typeof MetricsSections[name] === 'function'
      ? MetricsSections[name](...args)
      : null);

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

    // Parser filter chips come from the runs themselves (metrics.ndjson still
    // records parser names per run), most frequent first.
    const parserNameCounts = {};
    runItems.forEach(item => {
      (Array.isArray(item.parserNames) ? item.parserNames : []).forEach(name => {
        if (!name) return;
        parserNameCounts[name] = (parserNameCounts[name] || 0) + 1;
      });
    });
    const parserNames = Object.keys(parserNameCounts)
      .sort((a, b) => (parserNameCounts[b] - parserNameCounts[a]) || String(a).localeCompare(String(b)))
      .slice(0, 8);
    const activeParserFilter = runFilters?.parserFilter ? String(runFilters.parserFilter).toLowerCase() : null;
    const parserChips = ['All parsers', ...parserNames].map((name, index) => {
      if (index === 0) {
        return buildRunFilterChip(name, { parserFilter: null }, !activeParserFilter, 'parser', '');
      }
      const isActive = activeParserFilter === String(name).toLowerCase();
      return buildRunFilterChip(name, { parserFilter: name }, isActive, 'parser', name);
    }).join('');

    const emptyLedgerMessage = MetricsSections?.SOURCE_LEDGER_EMPTY_MESSAGE
      || 'No source ledger yet — every run writes it; seed history with npm run backfill-source-ledger on the Mac.';

    // Sources — one row per website host from the source ledger, trouble first.
    const buildSourcesCards = () => {
      const cards = [];
      if (!sourceHealth.available || !MetricsSections) {
        const reason = sourceHealth.reason ? ` (${sourceHealth.reason})` : '';
        cards.push(buildEmptyCard('No source ledger yet', `${emptyLedgerMessage}${reason}`));
        return cards;
      }
      const health = sourceHealth.health;
      const digest = MetricsSections.buildSourceWidgetSummary(health, { limit: 1 });
      const newestLabel = digest.newestFinishedAt
        ? `newest run ${this.formatRelativeTime(digest.newestFinishedAt)}`
        : 'no runs yet';
      const body = `
        ${MetricsSections.buildSourceCountersHtml(health)}
        ${MetricsSections.buildSourcesTableHtml(health, {
          sortState: sourceSortResolved,
          hostUrl: row => this.buildHostUrl(row.host),
          faviconUrl: row => this.getHostFaviconUrl(row)
        })}`;
      // Overview: extracted per run stacked by site (troubled sites in their
      // verdict colour), with the sites-answering strip following its range.
      const overviewSpec = chartSpec('buildSourcesOverviewChartSpec', health, { verdictColors: SOURCE_VERDICT_COLORS });
      const answeringSpec = chartSpec('buildSitesAnsweringChartSpec', health);
      const sourcesVisible = viewMode === 'sources';
      const overviewCard = buildChartFigureCard('Extracted Per Run', [
        buildFigure(overviewSpec, { render: sourcesVisible }),
        buildFigure(answeringSpec, { render: sourcesVisible, follows: overviewSpec ? overviewSpec.id : null })
      ], 'Rows each site yielded per run, troubled sites in their verdict colour; below, how many sites answered ok');
      if (overviewCard) cards.push(overviewCard);
      cards.push(buildSection('Sources', body, escapeHtml(`${digest.headline} • ${newestLabel}`)));
      return cards;
    };

    // Host detail — the series, latest errors and the vanished list for one host.
    const buildHostCards = host => {
      const cards = [];
      if (!MetricsSections) {
        cards.push(buildEmptyCard('Host detail unavailable', 'The metrics-sections module is missing on this device.'));
        return cards;
      }
      const needle = String(host || '').toLowerCase();
      const row = sourceRows.find(item => String(item.host).toLowerCase() === needle) || null;
      if (!row) {
        cards.push(buildEmptyCard(
          host ? `No ledger lines for ${host}` : 'No host selected',
          sourceHealth.available ? 'Pick a site from the Sources list.' : emptyLedgerMessage
        ));
        return cards;
      }
      cards.push(buildSection('Latest Run', MetricsSections.buildHostSummaryHtml(row, {
        faviconUrl: item => this.getHostFaviconUrl(item)
      })));

      // Charts: extracted/bear/upcoming with the baseline and the troubled
      // stretch, a pages/page-errors strip that follows its range, then
      // proposals (new up, merge down) with vanished counts as dots. Only
      // the host open on load is rendered now; the rest render when tapped.
      const series = Array.isArray(row.series) ? row.series : [];
      const hostVisible = viewMode === 'host' && String(row.host).toLowerCase() === String(initialViewKey).toLowerCase();
      const hostChartOptions = { verdictColors: SOURCE_VERDICT_COLORS, records: sourceRecords };
      const hostSeriesSpec = chartSpec('buildHostSeriesChartSpec', row, hostChartOptions);
      if (hostSeriesSpec) {
        const baselineSubtitle = row.baseline !== null && row.baseline !== undefined
          ? `Baseline ${this.formatNumber(row.baseline)} extracted (median of recent ok runs)${row.since ? ', troubled stretch shaded' : ''}`
          : 'No baseline yet';
        cards.push(buildChartFigureCard(`Per Run (${series.length} Runs)`, [
          buildFigure(hostSeriesSpec, { render: hostVisible }),
          buildFigure(chartSpec('buildHostPagesChartSpec', row, hostChartOptions), { render: hostVisible, follows: hostSeriesSpec.id })
        ], baselineSubtitle));
        cards.push(buildChartFigureCard(
          'Proposals & Vanished',
          buildFigure(chartSpec('buildHostProposalsChartSpec', row, hostChartOptions), { render: hostVisible }),
          'New proposals up, merges down; dots are upcoming events that vanished in that run'
        ));
      }

      cards.push(buildSection('Runs', MetricsSections.buildHostSeriesTableHtml(row, {
        records: sourceRecords,
        limit: HOST_SERIES_ROW_LIMIT
      })));
      cards.push(buildSection('Latest Errors', MetricsSections.buildHostErrorsHtml(row)));
      cards.push(buildSection(
        'Vanished Events',
        MetricsSections.buildVanishedListHtml(row),
        escapeHtml('Upcoming events seen in the previous run that are gone from the latest one')
      ));
      return cards;
    };

    // Runs — metrics.ndjson: Health & Guards for the latest run, the run list,
    // all-time totals and the quality trends.
    const buildRunsCards = () => {
      const cards = [];
      // Health & Guards (latest run) — guard/arbitration/AI details come from
      // record.signals; records without signals (pre-metrics-2.0) render a note.
      if (MetricsSections && RunLogSummary && latest) {
        const latestHealth = this.getRecordHealth(latest);
        const healthBody = MetricsSections.buildHealthGuardsSectionHtml(
          latest,
          latestHealth ? latestHealth.health : null,
          latestHealth ? latestHealth.badgeText : ''
        );
        const healthSubtitle = latest?.run_id
          ? escapeHtml(`Latest run ${this.formatRunId(latest.run_id)}`)
          : null;
        cards.push(buildSection('Health & Guards (Latest Run)', healthBody, healthSubtitle));
      }

      if (runItems.length === 0) {
        cards.push(buildEmptyCard('No run metrics found.', 'Run the scraper on the phone to generate metrics.'));
      } else {
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
      }

      if (summary?.totals) {
        const totals = summary.totals;
        const statusCounts = this.normalizeStatusCounts(totals.statuses);
        const actions = totals.actions || this.createActionCounts();
        const calendarActions = totals.calendar_actions || this.createCalendarActionCounts();
        const runs = totals.runs || 0;
        const actionTotal = this.sumDisplayActions(actions);
        const parserCount = Object.keys(summary.by_parser_name || {}).length;
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
            ${buildMetric('Adds', this.formatNumber(actions.new || 0), this.formatPercent(actions.new || 0, actionTotal))}
            ${buildMetric('Merges', this.formatNumber(actions.merge || 0), this.formatPercent(actions.merge || 0, actionTotal))}
            ${buildMetric('Conflicts', this.formatNumber(actions.conflict || 0), this.formatPercent(actions.conflict || 0, actionTotal))}
          </div>
          <div class="metrics-grid">
            ${buildMetric('Create writes', this.formatNumber(calendarActions.create || 0))}
            ${buildMetric('Update writes', this.formatNumber(calendarActions.update || 0))}
            ${buildMetric('Skip writes', this.formatNumber(calendarActions.skip || 0))}
          </div>`;
        cards.push(buildSection('All Time Totals', totalsGrid));
      }

      // Quality trends over the retained window — only runs that carry a
      // signals block are plotted (older records are skipped, not zeroed).
      const qualitySpec = chartSpec('buildQualityChartSpec', recentRecords);
      const aiSpec = chartSpec('buildAiTimeChartSpec', recentRecords);
      const runsVisible = viewMode === 'runs';
      if (qualitySpec) {
        cards.push(buildChartFigureCard(`Event Quality (Last ${qualitySpec.labels.length} Runs)`, buildFigure(qualitySpec, { render: runsVisible }), 'Share of events with a venue, coordinates, and a real duration'));
      }
      if (aiSpec) {
        cards.push(buildChartFigureCard(`AI Time Per Run (Last ${aiSpec.labels.length} Runs)`, buildFigure(aiSpec, { render: runsVisible }), 'Total AI request time per run, in seconds'));
      }
      return cards;
    };

    const buildCardsForView = viewState => {
      const mode = viewState?.mode === 'host'
        ? 'host'
        : (this.normalizeViewToken(viewState?.mode) || 'sources');
      if (mode === 'runs') return buildRunsCards();
      if (mode === 'host') return buildHostCards(viewState.host);
      return buildSourcesCards();
    };

    const buildViewSection = (viewState, cards) => {
      const label = this.getViewLabel(viewState);
      const mode = viewState?.mode || 'sources';
      const key = viewState?.host || '';
      const isActive = mode === viewMode && (mode !== 'host' || key === initialViewKey);
      const keyAttr = key ? ` data-key="${escapeHtml(key)}"` : '';
      return `
        <section class="view${isActive ? ' active' : ''}" data-view="${escapeHtml(mode)}"${keyAttr} data-view-label="${escapeHtml(label)}">
          ${cards.join('\n')}
        </section>`;
    };

    const viewSections = [];
    this.getViewOptions().forEach(option => {
      const viewState = { mode: option.mode };
      viewSections.push(buildViewSection(viewState, buildCardsForView(viewState)));
    });

    // Every host gets its own pre-rendered section so taps switch instantly;
    // a host missing from the ledger still gets a section that says so.
    const hostViews = sourceRows.map(row => ({ mode: 'host', host: row.host }));
    if (viewMode === 'host' && !sourceRows.some(row => row.host === initialViewKey)) {
      hostViews.push({ mode: 'host', host: initialViewKey });
    }
    hostViews.forEach(viewState => {
      viewSections.push(buildViewSection(viewState, buildCardsForView(viewState)));
    });

    const logoImage = await this.loadLogoImage();
    const logoData = this.imageToDataUri(logoImage);
    const newestSourceRun = sourceRows.reduce((newest, row) => {
      const stamp = row.latest?.finished_at ? String(row.latest.finished_at) : '';
      return stamp > newest ? stamp : newest;
    }, '');
    let headerMeta = 'No run data yet';
    if (latest?.finished_at) {
      headerMeta = `Latest run ${this.formatRelativeTime(latest.finished_at)}`;
    } else if (newestSourceRun) {
      headerMeta = `Newest source run ${this.formatRelativeTime(newestSourceRun)}`;
    }
    const lastRunUrl = latest?.run_id
      ? this.buildScriptableUrl(DISPLAY_SAVED_RUN_SCRIPT, { runId: latest.run_id, readOnly: true })
      : null;
    const lastRunButton = lastRunUrl ? buildLink('Open last run', lastRunUrl, 'button') : '';
    const navLinks = this.getViewOptions().map(option => {
      const isActive = viewMode === option.mode || (viewMode === 'host' && option.mode === 'sources');
      const url = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT, { view: option.mode });
      return buildChip(option.label, url, isActive, buildNavAttributes(option.mode, null, true));
    }).join('');
    const hostChipClass = viewMode === 'host' ? 'chip host-chip active' : 'chip host-chip hidden';
    const hostChip = `<span class="${hostChipClass}" data-host-chip>${escapeHtml(`Host: ${initialViewKey || 'detail'}`)}</span>`;
    const navHtml = `${navLinks}${hostChip}`;

    const sourceSortKey = sourceSortResolved?.key || 'verdict';
    const sourceSortDir = sourceSortResolved?.direction || this.getDefaultSortDirection(sourceSortKey);
    const runSortKey = runSortResolved?.key || 'finished';
    const runSortDir = runSortResolved?.direction || this.getDefaultRunSortDirection(runSortKey);
    const runFilterStatus = runFilters?.status ? String(runFilters.status) : '';
    const runFilterDays = Number.isFinite(runFilters?.days) ? String(runFilters.days) : '';
    const runFilterParser = runFilters?.parserFilter ? String(runFilters.parserFilter) : '';

    // One CSS rule per verdict, from the same palette the widget badges use.
    const verdictCss = Object.keys(SOURCE_VERDICT_COLORS).map(verdict => {
      const color = SOURCE_VERDICT_COLORS[verdict];
      return `    .verdict-${verdict} { color: ${color}; background: ${this.hexToRgba(color, verdict === 'ok' ? 0.16 : 0.18)}; }`;
    }).join('\n');

    // The chart renderer is pure and closes over nothing, so its source text
    // runs inside the page too: the same code that drew the SVGs here
    // re-renders them for the range toggle and the views opened later.
    const rendererSource = MetricsSections && typeof MetricsSections.createChartRenderer === 'function'
      ? MetricsSections.createChartRenderer.toString()
      : 'function () { return null; }';
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chunky Dad Metrics</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&display=swap" rel="stylesheet">
  <script async src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" onload="if (window.chunkyChartsUpgrade) window.chunkyChartsUpgrade()"></script>
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
      min-width: 0;
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
    .health-badge {
      display: inline-block;
      font-size: 13px;
      font-weight: 700;
      padding: 5px 12px;
      border-radius: 999px;
      margin-bottom: 8px;
      background: rgba(46, 213, 115, 0.14);
      border: 1px solid rgba(46, 213, 115, 0.45);
    }
    .health-badge.warn {
      background: rgba(254, 202, 87, 0.16);
      border-color: rgba(254, 202, 87, 0.55);
    }
    .signal-subtitle {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      margin: 10px 0 4px;
    }
    .signal-line {
      font-size: 13px;
      font-variant-numeric: tabular-nums;
      margin: 4px 0;
    }
    .signal-line.warn-text {
      color: #b45309;
      font-weight: 600;
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
    .chart-card {
      overflow: hidden;
    }
    .chart-figure {
      margin: 8px 0 0;
      min-width: 0;
    }
    .chart-figure + .chart-figure {
      margin-top: 4px;
    }
    .chart-range {
      display: flex;
      justify-content: flex-end;
      gap: 4px;
      margin-bottom: 6px;
    }
    .chart-range-button {
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
      padding: 5px 10px;
      border-radius: 999px;
      border: 1px solid var(--border-color);
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
    }
    .chart-range-button.active {
      background: var(--primary-color);
      border-color: var(--primary-color);
      color: #ffffff;
    }
    .chart-stage {
      position: relative;
      width: 100%;
      background: var(--background-light);
      border-radius: 12px;
      padding: 6px 4px 2px;
    }
    .chart-stage.is-canvas {
      padding: 8px 6px;
      min-height: 190px;
    }
    .chart-kind-bars .chart-stage.is-canvas {
      min-height: 110px;
    }
    .chart-stage > svg,
    .chart-stage > canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    .chart-svg text {
      font-family: inherit;
    }
    .chart-legend {
      margin-top: 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 11px;
      color: var(--text-secondary);
    }
    .chart-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border-radius: 999px;
      background: var(--background-light);
    }
    .chart-legend-value {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
    }
    .chart-swatch {
      width: 10px;
      height: 3px;
      border-radius: 999px;
      flex: none;
      background: var(--text-secondary);
    }
    .chart-swatch.square {
      width: 8px;
      height: 8px;
      border-radius: 2px;
    }
    .chart-caption {
      margin: 6px 0 0;
      font-size: 11px;
      color: var(--text-secondary);
      font-variant-numeric: tabular-nums;
      min-height: 14px;
      word-break: break-word;
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
    .source-counters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }
    .metric-chip[class*="verdict-"] .metric-chip-label {
      color: inherit;
    }
    .verdict-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .verdict-chip::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      display: inline-block;
    }
${verdictCss}
    .verdict-ok {
      color: var(--color-neutral);
    }
    .source-site {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .source-favicon {
      width: 14px;
      height: 14px;
      border-radius: 3px;
      flex: none;
      object-fit: contain;
      background: var(--background-light);
    }
    .source-favicon.placeholder {
      display: inline-block;
      border: 1px dashed var(--border-color);
      background: transparent;
    }
    .sources-table td {
      vertical-align: middle;
    }
    .verdict-cell {
      white-space: nowrap;
    }
    .trio-cell {
      white-space: nowrap;
    }
    .trend-cell {
      width: 80px;
    }
    .sparkline {
      display: block;
      color: var(--primary-color);
      overflow: visible;
    }
    tr[data-source-verdict="dead"] .sparkline,
    tr[data-source-verdict="stopped"] .sparkline {
      color: var(--color-danger);
    }
    tr[data-source-verdict="shrunk"] .sparkline {
      color: var(--color-warning);
    }
    .age-cell {
      white-space: nowrap;
    }
    .host-head {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }
    .host-head .source-favicon {
      width: 22px;
      height: 22px;
      border-radius: 6px;
    }
    .host-head-text {
      flex: 1;
      min-width: 140px;
    }
    .host-name {
      font-size: 15px;
      font-weight: 700;
      word-break: break-all;
    }
    .host-meta {
      margin-bottom: 10px;
      font-size: 12px;
    }
    .source-errors {
      margin: 0;
      padding-left: 18px;
      font-size: 12px;
      word-break: break-word;
    }
    .source-errors li {
      margin: 4px 0;
    }
    .status-text {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-secondary);
    }
    .status-text.source-status-dead {
      color: var(--color-danger);
    }
    .status-text.source-status-empty {
      color: var(--color-warning);
    }
    .status-text.source-status-ok {
      color: var(--color-success);
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
<body data-view-mode="${escapeHtml(viewMode)}" data-view-key="${escapeHtml(initialViewKey)}" data-source-sort-key="${escapeHtml(sourceSortKey)}" data-source-sort-dir="${escapeHtml(sourceSortDir)}" data-run-sort-key="${escapeHtml(runSortKey)}" data-run-sort-dir="${escapeHtml(runSortDir)}" data-run-filter-status="${escapeHtml(runFilterStatus)}" data-run-filter-days="${escapeHtml(runFilterDays)}" data-run-filter-parser="${escapeHtml(runFilterParser)}">
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
      const hostChip = document.querySelector('[data-host-chip]');
      const sourceSortButtons = Array.from(document.querySelectorAll('[data-sort-view="sources"]'));
      const runSortButtons = Array.from(document.querySelectorAll('[data-sort-view="runs"]'));
      const runFilterChips = Array.from(document.querySelectorAll('[data-filter-view="runs"]'));
      const sourceList = document.querySelector('[data-list="sources"]');
      const runList = document.querySelector('[data-list="runs"]');

      const parseNumber = value => {
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
      };
      const normalizeDirection = value => (value === 'asc' ? 'asc' : 'desc');
      const normalizeText = value => String(value || '').toLowerCase();

      // ---- Charts -------------------------------------------------------
      // Every figure carries its spec (data-chart). The SVG was drawn by the
      // same renderer that runs here; range changes and views opened later
      // re-render it, a tap shows that run's numbers, and once Chart.js has
      // loaded from the CDN the figure becomes a canvas with tooltips, legend
      // toggles and animation. No CDN, no change: the SVG stays.
      let activateCharts = () => {};
      const chartRenderer = (() => {
        try { return (${rendererSource})(); } catch (_) { return null; }
      })();
      if (chartRenderer) {
        const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        const chartFigures = Array.from(document.querySelectorAll('figure[data-chart]'));
        const chartState = new Map();
        const rangeDays = { 7: 7, 30: 30, all: null };
        const stateFor = figure => {
          if (!chartState.has(figure)) {
            let spec = null;
            try { spec = JSON.parse(figure.getAttribute('data-chart') || 'null'); } catch (_) { spec = null; }
            if (!spec) return null;
            chartState.set(figure, {
              spec,
              range: figure.getAttribute('data-chart-range') || '30',
              mode: figure.getAttribute('data-chart-mode') || 'light',
              chart: null
            });
          }
          return chartState.get(figure);
        };
        const shownSpec = state => {
          const days = rangeDays[state.range];
          return days ? chartRenderer.sliceChartSpec(state.spec, days) : state.spec;
        };
        const setCaption = (figure, text) => {
          const caption = figure.querySelector('[data-chart-caption]');
          if (caption) caption.textContent = text;
        };
        const dropChart = state => {
          if (state.chart) {
            try { state.chart.destroy(); } catch (_) { /* already gone */ }
            state.chart = null;
          }
        };
        const bindTap = (figure, stage, shown) => {
          stage.onclick = event => {
            const svg = stage.querySelector('svg');
            if (!svg) return;
            const rect = svg.getBoundingClientRect();
            if (!rect.width) return;
            const x = ((event.clientX - rect.left) / rect.width) * chartRenderer.WIDTH;
            const index = chartRenderer.indexAtX(shown, x);
            if (index < 0) return;
            const cursor = svg.querySelector('[data-chart-cursor]');
            if (cursor) {
              const cursorX = chartRenderer.xForIndex(shown, index);
              cursor.setAttribute('x1', cursorX);
              cursor.setAttribute('x2', cursorX);
              cursor.setAttribute('stroke-opacity', '0.6');
            }
            setCaption(figure, chartRenderer.describeIndex(shown, index));
          };
        };
        const renderSvg = (figure, state) => {
          const stage = figure.querySelector('[data-chart-stage]');
          if (!stage) return;
          const shown = shownSpec(state);
          dropChart(state);
          stage.classList.remove('is-canvas');
          stage.innerHTML = chartRenderer.buildChartSvg(shown, { mode: state.mode });
          const legendHtml = chartRenderer.buildLegendHtml(shown, { mode: state.mode });
          const legend = figure.querySelector('.chart-legend');
          if (legend) legend.outerHTML = legendHtml;
          else if (legendHtml) stage.insertAdjacentHTML('afterend', legendHtml);
          setCaption(figure, chartRenderer.describeIndex(shown, shown.labels.length - 1));
          figure.removeAttribute('data-chart-pending');
          bindTap(figure, stage, shown);
        };
        const shadePlugin = {
          id: 'chunkyShade',
          beforeDatasetsDraw(chart) {
            const shade = chart.options.plugins && chart.options.plugins.chunkyShade;
            const scale = chart.scales.x;
            const area = chart.chartArea;
            if (!shade || !scale || !area) return;
            const count = chart.data.labels.length;
            let from = scale.getPixelForValue(shade.fromIndex);
            if (chart.config.type === 'bar') from -= (scale.width / Math.max(1, count)) / 2;
            else if (shade.fromIndex > 0) from = (scale.getPixelForValue(shade.fromIndex - 1) + from) / 2;
            const ctx = chart.ctx;
            ctx.save();
            ctx.fillStyle = chartRenderer.withAlpha(shade.color, 0.12);
            ctx.fillRect(from, area.top, area.right - from, area.bottom - area.top);
            ctx.restore();
          }
        };
        const renderCanvas = (figure, state) => {
          const stage = figure.querySelector('[data-chart-stage]');
          if (!stage || !window.Chart) return false;
          const shown = shownSpec(state);
          const config = chartRenderer.buildChartJsConfig(shown, { mode: state.mode, reducedMotion });
          const meta = config.chunky;
          dropChart(state);
          stage.onclick = null;
          stage.innerHTML = '';
          stage.classList.add('is-canvas');
          const canvas = document.createElement('canvas');
          stage.appendChild(canvas);
          config.data.datasets.forEach(dataset => {
            if (!dataset.chunkyGradient) return;
            const color = dataset.borderColor;
            const topAlpha = meta.kind === 'stack' ? 0.55 : 0.35;
            const bottomAlpha = meta.kind === 'stack' ? 0.25 : 0.03;
            dataset.backgroundColor = context => {
              const area = context.chart.chartArea;
              if (!area) return chartRenderer.withAlpha(color, 0.2);
              const gradient = context.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
              gradient.addColorStop(0, chartRenderer.withAlpha(color, topAlpha));
              gradient.addColorStop(1, chartRenderer.withAlpha(color, bottomAlpha));
              return gradient;
            };
          });
          config.options.plugins.tooltip.callbacks = {
            title: items => (items.length ? (meta.titles[items[0].dataIndex] || '') : ''),
            label: item => {
              if (item.dataset.chunkyBaseline) return null;
              const raw = item.parsed.y;
              if (raw == null) return null;
              return ' ' + chartRenderer.formatValue(Math.abs(raw), meta.unit) + '  ' + item.dataset.label;
            }
          };
          config.options.scales.y.ticks.callback = value => chartRenderer.formatValue(Math.abs(value), meta.unit);
          config.plugins = [shadePlugin];
          try {
            state.chart = new window.Chart(canvas, config);
          } catch (_) {
            return false;
          }
          // Chart.js draws its own (toggleable) legend inside the canvas;
          // strips keep the HTML chips instead so their plot stays tall.
          const legend = figure.querySelector('.chart-legend');
          if (legend && config.options.plugins.legend.display) legend.remove();
          setCaption(figure, chartRenderer.describeIndex(shown, shown.labels.length - 1));
          figure.removeAttribute('data-chart-pending');
          return true;
        };
        const renderFigure = (figure, state) => {
          if (!(window.Chart && renderCanvas(figure, state))) renderSvg(figure, state);
        };
        activateCharts = section => {
          if (!section) return;
          Array.from(section.querySelectorAll('figure[data-chart]')).forEach(figure => {
            const state = stateFor(figure);
            if (!state) return;
            if (figure.hasAttribute('data-chart-pending') || (window.Chart && !state.chart)) {
              renderFigure(figure, state);
            } else if (!state.chart) {
              const stage = figure.querySelector('[data-chart-stage]');
              if (stage && !stage.onclick) bindTap(figure, stage, shownSpec(state));
            }
          });
        };
        window.chunkyChartsUpgrade = () => activateCharts(document.querySelector('section.view.active'));
        chartFigures.forEach(figure => {
          Array.from(figure.querySelectorAll('button[data-chart-range]')).forEach(button => {
            button.addEventListener('click', () => {
              const state = stateFor(figure);
              if (!state) return;
              state.range = button.getAttribute('data-chart-range') || 'all';
              figure.setAttribute('data-chart-range', state.range);
              Array.from(figure.querySelectorAll('button[data-chart-range]')).forEach(item => item.classList.toggle('active', item === button));
              renderFigure(figure, state);
              const id = figure.getAttribute('data-chart-id');
              if (!id) return;
              chartFigures.filter(other => other.getAttribute('data-chart-follows') === id).forEach(other => {
                const otherState = stateFor(other);
                if (!otherState) return;
                otherState.range = state.range;
                other.setAttribute('data-chart-range', state.range);
                renderFigure(other, otherState);
              });
            });
          });
        });
      }

      const sourceSortState = {
        key: body.getAttribute('data-source-sort-key') || 'verdict',
        direction: normalizeDirection(body.getAttribute('data-source-sort-dir'))
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

      const buildKey = (mode, key) => (mode === 'host' ? 'host:' + normalizeText(key) : mode);
      const viewIndex = new Map();
      viewSections.forEach(section => {
        const mode = section.getAttribute('data-view') || '';
        const key = section.getAttribute('data-key') || '';
        viewIndex.set(buildKey(mode, key), section);
      });

      const getSectionFor = (mode, key) => {
        if (!mode) return null;
        const lookup = buildKey(mode, key || '');
        if (viewIndex.has(lookup)) return viewIndex.get(lookup);
        const sourcesKey = buildKey('sources', '');
        if (viewIndex.has(sourcesKey)) return viewIndex.get(sourcesKey);
        return viewSections[0] || null;
      };

      const setActiveView = (mode, key) => {
        const section = getSectionFor(mode, key);
        if (!section) return;
        viewSections.forEach(item => item.classList.toggle('active', item === section));
        const activeMode = section.getAttribute('data-view') || mode;
        const activeKey = section.getAttribute('data-key') || '';
        const navMode = activeMode === 'host' ? 'sources' : activeMode;
        navTabs.forEach(tab => {
          const tabMode = tab.getAttribute('data-nav-view') || '';
          tab.classList.toggle('active', tabMode === navMode);
        });
        if (hostChip) {
          if (activeMode === 'host') {
            hostChip.textContent = 'Host: ' + (activeKey || 'detail');
            hostChip.classList.remove('hidden');
            hostChip.classList.add('active');
          } else {
            hostChip.classList.add('hidden');
            hostChip.classList.remove('active');
          }
        }
        body.setAttribute('data-view-mode', activeMode || '');
        body.setAttribute('data-view-key', activeKey || '');
        window.scrollTo(0, 0);
        activateCharts(section);
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

      // Sources: trouble first, then the biggest sites, then the host name —
      // the same order the assessment produces (sortSourceRows in metrics-sections).
      const sourceBaseOrder = (aData, bData) => (
        (parseNumber(aData.sourceVerdictRank) - parseNumber(bData.sourceVerdictRank))
        || (parseNumber(bData.sourceExtracted) - parseNumber(aData.sourceExtracted))
        || String(aData.sourceHost || '').localeCompare(String(bData.sourceHost || ''))
      );

      const sortSourceRows = () => {
        if (!sourceList) return;
        const rows = Array.from(sourceList.querySelectorAll('[data-row="source"]'));
        const direction = sourceSortState.direction === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
          const aData = a.dataset;
          const bData = b.dataset;
          let diff = 0;
          if (sourceSortState.key === 'host') {
            diff = String(aData.sourceHost || '').localeCompare(String(bData.sourceHost || ''));
          } else if (sourceSortState.key === 'verdict') {
            diff = parseNumber(aData.sourceVerdictRank) - parseNumber(bData.sourceVerdictRank);
          } else if (sourceSortState.key === 'extracted') {
            diff = parseNumber(aData.sourceExtracted) - parseNumber(bData.sourceExtracted);
          } else if (sourceSortState.key === 'bear') {
            diff = parseNumber(aData.sourceBear) - parseNumber(bData.sourceBear);
          } else if (sourceSortState.key === 'upcoming') {
            diff = parseNumber(aData.sourceUpcoming) - parseNumber(bData.sourceUpcoming);
          } else if (sourceSortState.key === 'age') {
            diff = parseNumber(aData.sourceAge) - parseNumber(bData.sourceAge);
          }
          if (diff === 0) return sourceBaseOrder(aData, bData);
          return diff * direction;
        });
        rows.forEach(row => sourceList.appendChild(row));
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
          const key = link.getAttribute('data-nav-key') || '';
          setActiveView(mode, key);
        });
      });

      sourceSortButtons.forEach(button => {
        button.addEventListener('click', event => {
          const key = button.getAttribute('data-sort-key');
          const dir = button.getAttribute('data-sort-dir');
          if (!key || !dir) return;
          event.preventDefault();
          sourceSortState.key = key;
          sourceSortState.direction = normalizeDirection(dir);
          updateSortButtons(sourceSortButtons, sourceSortState);
          sortSourceRows();
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

      const initialMode = body.getAttribute('data-view-mode') || 'sources';
      const initialKey = body.getAttribute('data-view-key') || '';
      setActiveView(initialMode, initialKey);
      updateSortButtons(sourceSortButtons, sourceSortState);
      updateSortButtons(runSortButtons, runSortState);
      updateFilterChips();
      sortSourceRows();
      applyRunFiltersAndSort();
    })();
  </script>
</body>
</html>`;

    return html;
  }

  getViewOptions() {
    return [
      { mode: 'sources', label: 'Sources' },
      { mode: 'runs', label: 'All Runs' }
    ];
  }

  getViewLabel(view) {
    if (!view) return 'Sources';
    if (view.mode === 'host') {
      return view.host ? `Host: ${view.host}` : 'Host Detail';
    }
    const option = this.getViewOptions().find(item => item.mode === view.mode);
    return option ? option.label : 'Sources';
  }

  // "#rrggbb" + alpha → "rgba(r, g, b, a)" for the verdict chip backgrounds.
  hexToRgba(hex, alpha) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!match) return `rgba(167, 176, 204, ${alpha})`;
    const value = parseInt(match[1], 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
}

async function runMetricsDisplay() {
  const display = new MetricsDisplay();
  await display.ensureDirs();

  const records = await display.loadMetricsRecords();
  const latestRecord = records.length ? records[records.length - 1] : null;
  const summary = await display.loadSummary();
  const sourceHealth = await display.loadSourceHealth();

  const view = display.resolveHostView(await display.resolveView(), sourceHealth);
  const sortState = display.resolveSort(view);
  const runSortState = display.resolveRunSort(view);
  const runFilters = display.resolveRunFilters(view);
  const runItems = display.buildRunItems(records);
  const data = { latestRecord, summary, records, sourceHealth, sortState, runSortState, runFilters, runItems };

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

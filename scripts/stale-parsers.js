// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: clock;

// Stale Sources Widget
// Shows how many scraped websites need a look, read from the source ledger
// (metrics/sources.ndjson) that every scrape — Mac or phone — appends to.
// One line per run per website host; metrics-sections.js turns the lines into
// a verdict per host (dead / stopped / shrunk / empty / vanished / quiet / ok).
//
// "Needs a look" = dead, stopped, shrunk, empty or quiet. "vanished" is
// informational (the dashboard shows it) and never enters the queue.
//
// Widget parameter: "days=N" sets staleAfterDays — a host with no ledger line
// within N days is "quiet". Example: "days=5".
//
// Tapping the widget runs the current troubled host in a rolling queue: one tap
// runs one of its parsers (hosts with several parsers take several taps, the
// cursor advances each time). In app mode you can skip the current host (24h).

// ─── Brand & style constants (mirrored from display-run-metrics.js) ───────────

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
  }
};

// ─── Widget-specific constants ────────────────────────────────────────────────

const LOGO_URL = 'https://chunky.dad/favicons/logo-hero.png';
const FAVICON_BASE_URL = 'https://chunky.dad/img/favicons';
const SCRAPER_SCRIPT = 'bear-event-scraper-unified';
const DISPLAY_METRICS_SCRIPT = 'display-run-metrics';
const SOURCE_LEDGER_FILE = 'sources.ndjson';
// Matches assessSourceHealth's own default: the Mac scrapes daily, so three
// silent days means the host has missed scrapes, not just a weekend.
const DEFAULT_STALE_DAYS = 3;
const DEFAULT_SKIP_HOURS = 24;
const QUEUE_IDLE_RESET_HOURS = 12;
const QUEUE_STATE_FILE = 'stale-parser-queue.json';
const QUEUE_STATE_VERSION = 2;
const HOURS_SUFFIX = 'h';
const SHORT_DATE_FORMAT_OPTIONS = { month: 'short', day: 'numeric', year: 'numeric' };
const FAVICON_CACHE_TTL_DAYS = 14;
const LOGO_CACHE_TTL_DAYS = 7;
const WIDGET_TITLE = 'Stale Sources';
const NO_LEDGER_TEXT = 'No source ledger yet';

// Verdicts that put a host in the queue. "vanished" is deliberately absent.
const TROUBLED_VERDICTS = ['dead', 'stopped', 'shrunk', 'empty', 'quiet'];
const VERDICT_COLORS = {
  dead: BRAND.danger,
  stopped: BRAND.danger,
  shrunk: BRAND.warning,
  empty: BRAND.warning,
  quiet: BRAND.neutral,
  vanished: BRAND.neutral,
  ok: BRAND.success
};

// ─── Shared health helpers (pure, from metrics-sections.js) ───────────────────
// Loaded defensively, the way display-run-metrics.js does: under Scriptable
// importModule resolves the sibling script; under Node the smoke test stubs
// importModule before requiring this file.

let MetricsSections = null;
try {
  if (typeof importModule === 'function') {
    MetricsSections = importModule('metrics-sections').MetricsSections;
  }
} catch (error) {
  console.log(`StaleParsers: metrics-sections unavailable: ${error.message}`);
}

// ─── Pure selection logic (no Scriptable APIs; exported for the smoke test) ──

function faviconUrlForHost(host) {
  const raw = String(host || '').trim().toLowerCase();
  if (!raw) return null;
  const cleanDomain = raw
    .replace(/^www\./, '')
    .replace(/[^a-zA-Z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!cleanDomain) return null;
  return `${FAVICON_BASE_URL}/favicon-${cleanDomain}-64px.ico`;
}

function isTroubledVerdict(verdict) {
  return TROUBLED_VERDICTS.includes(String(verdict || ''));
}

function describeHostRow(row) {
  const parsers = Array.isArray(row.parsers) ? row.parsers.filter(Boolean).map(String) : [];
  const latest = row.latest || {};
  return {
    host: row.host,
    parsers,
    verdict: row.verdict,
    since: row.since || null,
    ageDays: Number.isFinite(row.ageDays) ? row.ageDays : null,
    latestRunId: latest.run_id || null,
    latestFinishedAt: latest.finished_at || null,
    vanishedCount: Array.isArray(row.vanished) ? row.vanished.length : 0,
    iconUrl: faviconUrlForHost(row.host)
  };
}

// health = assessSourceHealth(...) output. Rows arrive trouble-first already
// (SOURCE_VERDICT_ORDER), so the queue order is the ledger's own severity order.
function buildSourceStatus(health, options = {}) {
  if (options.ledgerMissing || !health) {
    return {
      ledgerMissing: true,
      total: 0,
      troubled: [],
      vanished: [],
      ok: 0,
      newestRunId: null,
      newestFinishedAt: null
    };
  }
  const rows = Array.isArray(health.rows) ? health.rows : [];
  const troubled = rows.filter(row => isTroubledVerdict(row.verdict)).map(describeHostRow);
  const vanished = rows.filter(row => row.verdict === 'vanished').map(describeHostRow);
  let newestRunId = null;
  let newestFinishedAt = null;
  rows.forEach(row => {
    const finishedAt = row.latest?.finished_at || null;
    if (finishedAt && (!newestFinishedAt || String(finishedAt) > String(newestFinishedAt))) {
      newestFinishedAt = finishedAt;
      newestRunId = row.latest?.run_id || null;
    }
  });
  return {
    ledgerMissing: false,
    total: rows.length,
    troubled,
    vanished,
    ok: rows.filter(row => row.verdict === 'ok').length,
    newestRunId,
    newestFinishedAt
  };
}

function buildTroubledSignature(troubledHosts) {
  return troubledHosts.map(entry => `${entry.host}:${entry.verdict}`).join('|');
}

function emptyQueueState(signature) {
  return {
    version: QUEUE_STATE_VERSION,
    staleSignature: signature,
    lastTapAt: 0,
    processed: {},
    skippedUntil: {},
    parserCursor: {}
  };
}

// Keeps only entries for hosts that are troubled right now. A version-1 file
// (keyed by parser name) sanitizes down to nothing and starts fresh.
function sanitizeQueueState(state, troubledHostNames, nowMs) {
  const out = emptyQueueState(state.staleSignature || '');
  const validHosts = new Set(troubledHostNames);
  out.lastTapAt = Number.isFinite(state.lastTapAt) ? state.lastTapAt : 0;
  if (state.processed && typeof state.processed === 'object') {
    Object.keys(state.processed).forEach(host => {
      if (validHosts.has(host) && state.processed[host]) out.processed[host] = true;
    });
  }
  if (state.skippedUntil && typeof state.skippedUntil === 'object') {
    Object.keys(state.skippedUntil).forEach(host => {
      const value = Number(state.skippedUntil[host]);
      if (validHosts.has(host) && Number.isFinite(value) && value > nowMs) {
        out.skippedUntil[host] = value;
      }
    });
  }
  if (state.parserCursor && typeof state.parserCursor === 'object') {
    Object.keys(state.parserCursor).forEach(host => {
      const value = Number(state.parserCursor[host]);
      if (validHosts.has(host) && Number.isFinite(value) && value > 0) {
        out.parserCursor[host] = Math.floor(value);
      }
    });
  }
  return out;
}

function isQueueIdle(state, nowMs) {
  if (!state.lastTapAt || state.lastTapAt <= 0) return false;
  const idleMs = QUEUE_IDLE_RESET_HOURS * 60 * 60 * 1000;
  return (nowMs - state.lastTapAt) > idleMs;
}

function isHostSkipped(state, host, nowMs) {
  const skipUntil = Number(state.skippedUntil[host] || 0);
  return Number.isFinite(skipUntil) && skipUntil > nowMs;
}

// The current pick is a host plus the parser its cursor points at. Hosts whose
// parsers[] is empty cannot be run and are treated as processed.
function describeCurrentPick(state, entry) {
  if (!entry) return null;
  const parsers = Array.isArray(entry.parsers) ? entry.parsers : [];
  if (!parsers.length) return null;
  const rawCursor = Number(state.parserCursor[entry.host] || 0);
  const cursor = Number.isFinite(rawCursor) && rawCursor > 0 ? Math.min(Math.floor(rawCursor), parsers.length - 1) : 0;
  return {
    host: entry.host,
    verdict: entry.verdict,
    since: entry.since,
    parsers,
    parserName: parsers[cursor],
    parserIndex: cursor,
    iconUrl: entry.iconUrl
  };
}

// Pure queue resolution. `loaded` is the previously saved state (or null).
// Returns the state to persist and the current pick (or null when every
// troubled host is processed-or-skipped, or when there is nothing troubled).
function resolveQueue(loaded, troubledHosts, nowMs) {
  const hostNames = troubledHosts.map(entry => entry.host);
  const signature = buildTroubledSignature(troubledHosts);
  const baseState = loaded && typeof loaded === 'object'
    ? sanitizeQueueState(loaded, hostNames, nowMs)
    : emptyQueueState(signature);
  const state = {
    ...baseState,
    staleSignature: baseState.staleSignature || signature
  };

  if (state.staleSignature !== signature || isQueueIdle(state, nowMs)) {
    state.processed = {};
    state.skippedUntil = {};
    state.parserCursor = {};
    state.staleSignature = signature;
  }

  const runnable = troubledHosts.filter(entry => Array.isArray(entry.parsers) && entry.parsers.length > 0);
  const cycleDone = runnable.length > 0 && runnable.every(entry => (
    !!state.processed[entry.host] || isHostSkipped(state, entry.host, nowMs)
  ));
  if (cycleDone) {
    state.processed = {};
    state.parserCursor = {};
  }

  const currentEntry = runnable.find(entry => (
    !state.processed[entry.host] && !isHostSkipped(state, entry.host, nowMs)
  )) || null;

  return { state, current: describeCurrentPick(state, currentEntry) };
}

// One tap ran `current.parserName`. Advance the host's cursor; when its last
// parser has run the host is processed and the cursor resets.
function markCurrentRun(state, current, nowMs) {
  if (!current || !current.host) return false;
  const next = current.parserIndex + 1;
  if (next >= current.parsers.length) {
    state.processed[current.host] = true;
    delete state.parserCursor[current.host];
  } else {
    state.parserCursor[current.host] = next;
  }
  delete state.skippedUntil[current.host];
  state.lastTapAt = nowMs;
  return true;
}

function skipHost(state, current, hours, nowMs) {
  if (!current || !current.host) return false;
  const skipHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SKIP_HOURS;
  state.skippedUntil[current.host] = nowMs + (skipHours * 60 * 60 * 1000);
  delete state.processed[current.host];
  delete state.parserCursor[current.host];
  state.lastTapAt = nowMs;
  return true;
}

function parseStaleDays(widgetParam) {
  if (!widgetParam) return DEFAULT_STALE_DAYS;
  const raw = String(widgetParam).trim();
  if (!raw) return DEFAULT_STALE_DAYS;
  const tokens = raw.split(/[|;,&?]+/).map(t => t.trim()).filter(Boolean);
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith('days=') || lower.startsWith('days:')) {
      const val = token.slice(5).trim();
      const parsed = Number.parseInt(val, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return DEFAULT_STALE_DAYS;
}

// run_id "20261005-232729" → "Oct 5 23:27"; anything else is shown as-is.
function formatRunId(runId) {
  const raw = String(runId || '').trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!match) return raw;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  if (!Number.isFinite(date.getTime())) return raw;
  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${day} ${match[4]}:${match[5]}`;
}

function formatSummaryLine(status) {
  if (status.ledgerMissing) return NO_LEDGER_TEXT;
  const count = status.troubled.length;
  const total = status.total;
  if (count === 0) return `All ${total} ${total === 1 ? 'site' : 'sites'} answered`;
  return `${count} of ${total} ${total === 1 ? 'site needs' : 'sites need'} a look`;
}

function formatHostDetail(entry) {
  if (!entry) return '';
  return entry.since ? `${entry.verdict} since ${formatRunId(entry.since)}` : entry.verdict;
}

// ─── StaleParsersChecker ──────────────────────────────────────────────────────

class StaleParsersChecker {
  constructor() {
    this.fm = FileManager.iCloud();
    const documentsDir = this.fm.documentsDirectory();
    this.baseDir = this.fm.joinPath(documentsDir, 'chunky-dad-scraper');
    this.metricsDir = this.fm.joinPath(this.baseDir, 'metrics');
    this.cacheDir = this.fm.joinPath(this.baseDir, 'cache');
    this.runtime = this.getRuntimeContext();
    this.iconCache = new Map();
  }

  // ── Runtime detection ───────────────────────────────────────────────────────

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
      console.log(`StaleParsers: Runtime detection failed: ${error.message}`);
    }
    return runtime;
  }

  parseStaleDays(widgetParam) {
    return parseStaleDays(widgetParam);
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  getSourceLedgerPath() {
    return this.fm.joinPath(this.metricsDir, SOURCE_LEDGER_FILE);
  }

  // Returns null when the ledger file does not exist, else the ledger text.
  async loadSourceLedgerText() {
    const path = this.getSourceLedgerPath();
    if (!this.fm.fileExists(path)) return null;
    try {
      await this.fm.downloadFileFromiCloud(path);
    } catch (error) {
      console.log(`StaleParsers: iCloud download failed: ${error.message}`);
    }
    return this.fm.readString(path) || '';
  }

  async loadSourceStatus(staleDays) {
    if (!MetricsSections || typeof MetricsSections.assessSourceHealth !== 'function') {
      throw new Error('metrics-sections.js is missing on this device');
    }
    const text = await this.loadSourceLedgerText();
    if (text === null) {
      console.log('StaleParsers: No source ledger yet');
      return buildSourceStatus(null, { ledgerMissing: true });
    }
    const records = MetricsSections.parseSourceLedger(text);
    const health = MetricsSections.assessSourceHealth(records, { now: new Date(), staleAfterDays: staleDays });
    console.log(`StaleParsers: ${records.length} ledger lines, ${health.hosts} hosts, ${health.troubled} not ok`);
    return buildSourceStatus(health);
  }

  // ── Rolling queue state ──────────────────────────────────────────────────────

  ensureBaseDir() {
    if (!this.fm.fileExists(this.baseDir)) {
      this.fm.createDirectory(this.baseDir, true);
    }
  }

  getQueueStatePath() {
    return this.fm.joinPath(this.baseDir, QUEUE_STATE_FILE);
  }

  loadQueueState() {
    const path = this.getQueueStatePath();
    if (!this.fm.fileExists(path)) return null;
    try {
      const raw = this.fm.readString(path) || '';
      if (!raw.trim()) return null;
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch (error) {
      console.log(`StaleParsers: Could not read queue state: ${error.message}`);
      return null;
    }
  }

  saveQueueState(state) {
    try {
      this.ensureBaseDir();
      const path = this.getQueueStatePath();
      this.fm.writeString(path, JSON.stringify(state, null, 2));
    } catch (error) {
      console.log(`StaleParsers: Could not write queue state: ${error.message}`);
    }
  }

  // No ledger → no queue (nothing is saved either).
  resolveQueueState(status) {
    if (status.ledgerMissing) return { state: null, current: null };
    const nowMs = Date.now();
    const resolved = resolveQueue(this.loadQueueState(), status.troubled, nowMs);
    this.saveQueueState(resolved.state);
    return resolved;
  }

  markCurrentRun(queueStateInfo) {
    if (!queueStateInfo?.state) return false;
    const marked = markCurrentRun(queueStateInfo.state, queueStateInfo.current, Date.now());
    if (marked) this.saveQueueState(queueStateInfo.state);
    return marked;
  }

  skipCurrentHost(queueStateInfo, hours) {
    if (!queueStateInfo?.state) return false;
    const skipped = skipHost(queueStateInfo.state, queueStateInfo.current, hours, Date.now());
    if (skipped) this.saveQueueState(queueStateInfo.state);
    return skipped;
  }

  // ── Image helpers ───────────────────────────────────────────────────────────

  hashString(value) {
    const input = String(value || '');
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  async loadLogoImage() {
    const cachePath = this.fm.joinPath(this.cacheDir, 'logo-hero.png');
    try {
      if (this.fm.fileExists(cachePath)) {
        const mtime = this.fm.modificationDate(cachePath);
        if (mtime && (Date.now() - mtime.getTime()) < (LOGO_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)) {
          return Image.fromFile(cachePath);
        }
      }
    } catch (error) {
      console.log(`StaleParsers: Logo cache read failed: ${error.message}`);
    }
    try {
      this.ensureCacheDir();
      const request = new Request(LOGO_URL);
      const image = await request.loadImage();
      this.fm.writeImage(cachePath, image);
      return image;
    } catch (error) {
      console.log(`StaleParsers: Logo download failed: ${error.message}`);
      return null;
    }
  }

  async loadFaviconImage(url) {
    if (!url) return null;
    const hash = this.hashString(url);
    const cachePath = this.fm.joinPath(this.cacheDir, `favicon-${hash}.png`);
    try {
      if (this.fm.fileExists(cachePath)) {
        const mtime = this.fm.modificationDate(cachePath);
        if (mtime && (Date.now() - mtime.getTime()) < (FAVICON_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)) {
          return Image.fromFile(cachePath);
        }
      }
    } catch (error) {
      console.log(`StaleParsers: Favicon cache read failed: ${error.message}`);
    }
    try {
      this.ensureCacheDir();
      const request = new Request(url);
      const image = await request.loadImage();
      this.fm.writeImage(cachePath, image);
      return image;
    } catch (error) {
      console.log(`StaleParsers: Favicon download failed: ${error.message}`);
      return null;
    }
  }

  async getHostIcon(iconUrl) {
    if (!iconUrl) return null;
    const cacheKey = `favicon:${iconUrl}`;
    if (this.iconCache.has(cacheKey)) return this.iconCache.get(cacheKey);
    const image = await this.loadFaviconImage(iconUrl);
    this.iconCache.set(cacheKey, image);
    return image;
  }

  ensureCacheDir() {
    if (!this.fm.fileExists(this.cacheDir)) {
      this.fm.createDirectory(this.cacheDir, true);
    }
  }

  // ── URL builder ─────────────────────────────────────────────────────────────

  buildScriptableUrl(scriptName, params) {
    const base = `scriptable:///run?scriptName=${encodeURIComponent(scriptName)}`;
    if (!params || Object.keys(params).length === 0) return base;
    const query = Object.keys(params)
      .filter(key => params[key] !== undefined && params[key] !== null)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    return query ? `${base}&${query}` : base;
  }

  getSelfScriptName() {
    try {
      if (typeof Script !== 'undefined' && typeof Script.name === 'function') {
        return Script.name();
      }
    } catch (_) {
      // ignore
    }
    return 'stale-parsers';
  }

  buildSelfUrl(params) {
    return this.buildScriptableUrl(this.getSelfScriptName(), params);
  }

  getActionFromQuery() {
    const query = this.runtime.queryParameters || {};
    const action = query.action || query.cmd || null;
    return action ? String(action).trim().toLowerCase() : null;
  }

  // ── Formatting helpers ──────────────────────────────────────────────────────

  formatNewestRun(status) {
    if (!status.newestFinishedAt) return '';
    const time = new Date(status.newestFinishedAt);
    if (!Number.isFinite(time.getTime())) return '';
    const day = time.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const clock = time.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `Newest run ${day} ${clock}`;
  }

  truncateText(value, maxLength) {
    const raw = String(value || '');
    if (!Number.isFinite(maxLength) || maxLength <= 0) return raw;
    if (maxLength === 1) return raw.length > 1 ? '…' : raw;
    if (raw.length <= maxLength) return raw;
    return `${raw.slice(0, maxLength - 1)}…`;
  }

  verdictColor(verdict) {
    return VERDICT_COLORS[verdict] || BRAND.neutral;
  }

  // ── Widget cell helpers ─────────────────────────────────────────────────────

  addWidgetCell(container, family) {
    const cell = container.addStack();
    cell.layoutVertically();
    cell.spacing = 2;
    const alpha = family === 'small' ? WIDGET_STYLE.rowBackgroundAlphaCompact : WIDGET_STYLE.rowBackgroundAlpha;
    cell.backgroundColor = new Color(WIDGET_STYLE.rowBackground, alpha);
    cell.cornerRadius = WIDGET_STYLE.rowRadius;
    const padding = family === 'small' ? WIDGET_STYLE.rowPaddingCompact : WIDGET_STYLE.rowPadding;
    cell.setPadding(padding.top, padding.left, padding.bottom, padding.right);
    return cell;
  }

  addWidgetBadge(container, label, colorHex) {
    const badge = container.addStack();
    badge.backgroundColor = new Color(colorHex, WIDGET_STYLE.badgeAlpha);
    badge.cornerRadius = WIDGET_STYLE.badgeRadius;
    const p = WIDGET_STYLE.badgePadding;
    badge.setPadding(p.top, p.left, p.bottom, p.right);
    const text = badge.addText(String(label));
    text.font = Font.boldSystemFont(FONT_SIZES.widget.small);
    text.textColor = new Color(colorHex);
    text.lineLimit = 1;
    return badge;
  }

  addWidgetHeader(widget, logoImage, headerText) {
    const family = this.runtime.widgetFamily || 'medium';
    const header = widget.addStack();
    header.centerAlignContent();
    header.spacing = family === 'small' ? 4 : 6;
    if (logoImage) {
      const img = header.addImage(logoImage);
      const size = family === 'small' ? 20 : 24;
      img.imageSize = new Size(size, size);
    }
    const title = header.addText(headerText || WIDGET_TITLE);
    title.font = Font.boldSystemFont(family === 'small' ? FONT_SIZES.widget.small : FONT_SIZES.widget.label);
    title.textColor = new Color(BRAND.text);
    title.lineLimit = 1;
    widget.addSpacer(family === 'small' ? 4 : 6);
  }

  // One troubled host row: favicon, host, verdict badge, "since <run>" line.
  async addHostRow(widget, entry, family, hostMaxLength) {
    const cell = this.addWidgetCell(widget, family);
    cell.url = this.buildSelfUrl({ action: 'runCurrent' });

    const headerRow = cell.addStack();
    headerRow.layoutHorizontally();
    headerRow.centerAlignContent();
    headerRow.spacing = 4;

    const iconImage = await this.getHostIcon(entry.iconUrl);
    if (iconImage) {
      const icon = headerRow.addImage(iconImage);
      icon.imageSize = new Size(11, 11);
    }

    const nameText = headerRow.addText(this.truncateText(entry.host, hostMaxLength));
    nameText.font = Font.boldSystemFont(FONT_SIZES.widget.small);
    nameText.textColor = new Color(BRAND.text);
    nameText.lineLimit = 1;

    headerRow.addSpacer();
    this.addWidgetBadge(headerRow, entry.verdict, this.verdictColor(entry.verdict));

    if (entry.since) {
      const sinceText = cell.addText(`since ${formatRunId(entry.since)}`);
      sinceText.font = Font.systemFont(FONT_SIZES.widget.small);
      sinceText.textColor = new Color(BRAND.textMuted);
      sinceText.lineLimit = 1;
    }
    return cell;
  }

  // Centered "all answered" / "no ledger" body shared by medium and large.
  addQuietBody(widget, logoImage, status, family) {
    widget.addSpacer();
    const row = widget.addStack();
    row.centerAlignContent();
    if (logoImage) {
      const size = family === 'large' ? 36 : 28;
      const img = row.addImage(logoImage);
      img.imageSize = new Size(size, size);
      row.addSpacer(family === 'large' ? 10 : 8);
    }
    const column = row.addStack();
    column.layoutVertically();
    const label = column.addText(status.ledgerMissing ? NO_LEDGER_TEXT : `${formatSummaryLine(status)} 🐻`);
    label.font = Font.boldSystemFont(family === 'large' ? FONT_SIZES.widget.title : FONT_SIZES.widget.label);
    label.textColor = new Color(status.ledgerMissing ? BRAND.textMuted : BRAND.success);
    label.lineLimit = 1;
    const newest = this.formatNewestRun(status);
    if (newest) {
      const newestText = column.addText(newest);
      newestText.font = Font.systemFont(FONT_SIZES.widget.small);
      newestText.textColor = new Color(BRAND.textMuted);
      newestText.lineLimit = 1;
    }
    widget.addSpacer();
  }

  // ── Widget renderers ────────────────────────────────────────────────────────

  async renderSmallWidget(status) {
    const widget = new ListWidget();
    widget.backgroundColor = new Color(BRAND.primary);
    widget.setPadding(12, 12, 12, 12);
    widget.url = this.buildSelfUrl({ action: 'runCurrent' });

    const logoImage = await this.loadLogoImage();

    if (logoImage) {
      const logo = widget.addImage(logoImage);
      logo.imageSize = new Size(24, 24);
      widget.addSpacer(6);
    }

    if (status.ledgerMissing) {
      const label = widget.addText(NO_LEDGER_TEXT);
      label.font = Font.systemFont(FONT_SIZES.widget.small);
      label.textColor = new Color(BRAND.textMuted);
      label.centerAlignText();
    } else if (status.troubled.length === 0) {
      const check = widget.addText('✓');
      check.font = Font.boldSystemFont(28);
      check.textColor = new Color(BRAND.success);
      check.centerAlignText();
      widget.addSpacer(2);
      const label = widget.addText(formatSummaryLine(status));
      label.font = Font.systemFont(FONT_SIZES.widget.small);
      label.textColor = new Color(BRAND.textMuted);
      label.centerAlignText();
    } else {
      const count = widget.addText(String(status.troubled.length));
      count.font = Font.boldSystemFont(32);
      count.textColor = new Color(BRAND.danger);
      count.centerAlignText();
      widget.addSpacer(2);
      const label = widget.addText(`of ${status.total} sites need a look`);
      label.font = Font.systemFont(FONT_SIZES.widget.small);
      label.textColor = new Color(BRAND.textMuted);
      label.centerAlignText();
    }

    return widget;
  }

  async renderMediumWidget(status) {
    const widget = new ListWidget();
    widget.backgroundColor = new Color(BRAND.primary);
    widget.setPadding(12, 12, 12, 12);
    widget.url = this.buildSelfUrl({ action: 'runCurrent' });

    const logoImage = await this.loadLogoImage();
    this.addWidgetHeader(widget, logoImage, WIDGET_TITLE);

    if (status.ledgerMissing || status.troubled.length === 0) {
      this.addQuietBody(widget, logoImage, status, 'medium');
      return widget;
    }

    const summary = widget.addText(formatSummaryLine(status));
    summary.font = Font.systemFont(FONT_SIZES.widget.small);
    summary.textColor = new Color(BRAND.textMuted);
    summary.lineLimit = 1;
    widget.addSpacer(4);

    const maxRows = 2;
    const items = status.troubled.slice(0, maxRows);
    for (let i = 0; i < items.length; i += 1) {
      if (i > 0) widget.addSpacer(4);
      await this.addHostRow(widget, items[i], 'medium', 22);
    }

    if (status.troubled.length > maxRows) {
      widget.addSpacer(4);
      const more = widget.addText(`+${status.troubled.length - maxRows} more`);
      more.font = Font.systemFont(FONT_SIZES.widget.small);
      more.textColor = new Color(BRAND.textMuted);
    }

    return widget;
  }

  async renderLargeWidget(status) {
    const widget = new ListWidget();
    widget.backgroundColor = new Color(BRAND.primary);
    widget.setPadding(12, 12, 12, 12);
    widget.url = this.buildSelfUrl({ action: 'runCurrent' });

    const logoImage = await this.loadLogoImage();
    this.addWidgetHeader(widget, logoImage, WIDGET_TITLE);

    if (status.ledgerMissing || status.troubled.length === 0) {
      this.addQuietBody(widget, logoImage, status, 'large');
      return widget;
    }

    const summary = widget.addText(formatSummaryLine(status));
    summary.font = Font.systemFont(FONT_SIZES.widget.small);
    summary.textColor = new Color(BRAND.textMuted);
    summary.lineLimit = 1;
    widget.addSpacer(4);

    const maxRows = 5;
    const items = status.troubled.slice(0, maxRows);
    for (let i = 0; i < items.length; i += 1) {
      if (i > 0) widget.addSpacer(4);
      await this.addHostRow(widget, items[i], 'large', 28);
    }

    if (status.troubled.length > maxRows) {
      widget.addSpacer(4);
      const more = widget.addText(`+${status.troubled.length - maxRows} more`);
      more.font = Font.systemFont(FONT_SIZES.widget.small);
      more.textColor = new Color(BRAND.textMuted);
    }

    widget.addSpacer(6);
    const summaryCell = this.addWidgetCell(widget, 'large');
    const okText = summaryCell.addText(`✅ ${status.ok} ok`);
    okText.font = Font.systemFont(FONT_SIZES.widget.small);
    okText.textColor = new Color(BRAND.success);
    okText.lineLimit = 1;
    if (status.vanished.length > 0) {
      const vanishedText = summaryCell.addText(`${status.vanished.length} vanished — see the dashboard`);
      vanishedText.font = Font.systemFont(FONT_SIZES.widget.small);
      vanishedText.textColor = new Color(BRAND.textMuted);
      vanishedText.lineLimit = 1;
    }
    const newest = this.formatNewestRun(status);
    if (newest) {
      const newestText = summaryCell.addText(newest);
      newestText.font = Font.systemFont(FONT_SIZES.widget.small);
      newestText.textColor = new Color(BRAND.textMuted);
      newestText.lineLimit = 1;
    }

    return widget;
  }

  renderAccessoryCircularWidget(status) {
    const widget = new ListWidget();
    widget.url = this.buildSelfUrl({ action: 'runCurrent' });

    if (status.ledgerMissing) {
      const dash = widget.addText('–');
      dash.font = Font.boldSystemFont(20);
      dash.textColor = new Color(BRAND.neutral);
      dash.centerAlignText();
    } else if (status.troubled.length === 0) {
      const check = widget.addText('✓');
      check.font = Font.boldSystemFont(20);
      check.textColor = new Color(BRAND.success);
      check.centerAlignText();
    } else {
      const count = widget.addText(String(status.troubled.length));
      count.font = Font.boldSystemFont(24);
      count.textColor = new Color(BRAND.danger);
      count.centerAlignText();
      widget.addSpacer(2);
      const label = widget.addText('sites');
      label.font = Font.systemFont(10);
      label.textColor = new Color(BRAND.textMuted);
      label.centerAlignText();
    }

    return widget;
  }

  renderAccessoryRectangularWidget(status, queueStateInfo) {
    const widget = new ListWidget();
    widget.url = this.buildSelfUrl({ action: 'runCurrent' });

    const title = widget.addText(WIDGET_TITLE);
    title.font = Font.boldSystemFont(FONT_SIZES.widget.small);
    title.lineLimit = 1;

    widget.addSpacer(2);

    const label = widget.addText(status.ledgerMissing ? NO_LEDGER_TEXT : formatSummaryLine(status));
    label.font = Font.systemFont(FONT_SIZES.widget.small);
    label.lineLimit = 1;

    if (!status.ledgerMissing && status.troubled.length > 0) {
      const current = queueStateInfo?.current || null;
      const firstEntry = current
        ? status.troubled.find(entry => entry.host === current.host) || status.troubled[0]
        : status.troubled[0];
      const firstLabel = widget.addText(`${this.truncateText(firstEntry.host, 18)} · ${firstEntry.verdict}`);
      firstLabel.font = Font.systemFont(10);
      firstLabel.lineLimit = 1;
    }

    return widget;
  }

  renderAccessoryInlineWidget(status) {
    const widget = new ListWidget();
    widget.url = this.buildSelfUrl({ action: 'runCurrent' });

    const label = widget.addText(`Sources: ${status.ledgerMissing ? 'no ledger yet' : formatSummaryLine(status)}`);
    label.font = Font.systemFont(FONT_SIZES.widget.small);
    label.lineLimit = 1;

    return widget;
  }

  // ── App-mode (non-widget) display ───────────────────────────────────────────

  // Runs the current host's current parser through the scraper's url scheme
  // (one parser per launch — the scraper takes a single parserName). The queue
  // cursor advances so the next tap runs the host's next parser, if any.
  runCurrentHost(queueStateInfo) {
    const current = queueStateInfo?.current || null;
    if (!current || !current.parserName) return false;
    const marked = this.markCurrentRun(queueStateInfo);
    if (!marked) return false;
    const url = this.buildScriptableUrl(SCRAPER_SCRIPT, { parserName: current.parserName });
    Safari.open(url);
    return true;
  }

  async handleQueryAction(status, queueStateInfo) {
    const action = this.getActionFromQuery();
    if (!action) return null;
    if (status.ledgerMissing) return false;
    if (action === 'runcurrent') {
      return this.runCurrentHost(queueStateInfo);
    }
    if (action === 'skipcurrent') {
      const skipped = this.skipCurrentHost(queueStateInfo, DEFAULT_SKIP_HOURS);
      if (!skipped) return false;
      return this.runCurrentHost(this.resolveQueueState(status));
    }
    return null;
  }

  describeCurrentForAlert(current) {
    if (!current) return 'Current: none available (every troubled site is skipped for now)';
    const step = current.parsers.length > 1
      ? ` — ${current.parserName} (${current.parserIndex + 1}/${current.parsers.length})`
      : '';
    return `Current: ${current.host}${step}`;
  }

  async showAppAlert(status, staleDays, queueStateInfo) {
    const alert = new Alert();
    alert.title = WIDGET_TITLE;

    if (status.ledgerMissing) {
      alert.message = `${NO_LEDGER_TEXT}.\n\nThe ledger (metrics/${SOURCE_LEDGER_FILE}) appears after the first scrape that writes it.`;
      alert.addAction('Open Metrics');
      alert.addCancelAction('Dismiss');
      const idx = await alert.present();
      if (idx === 0) Safari.open(this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT));
      return;
    }

    const newest = this.formatNewestRun(status);
    if (status.troubled.length === 0) {
      alert.message = [
        `${formatSummaryLine(status)} (quiet after ${staleDays} days).`,
        newest,
        status.vanished.length > 0 ? `${status.vanished.length} vanished — see the dashboard.` : ''
      ].filter(Boolean).join('\n');
      alert.addAction('Open Metrics');
      alert.addCancelAction('Dismiss');
      const idx = await alert.present();
      if (idx === 0) Safari.open(this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT));
      return;
    }

    const hostLines = status.troubled.map(entry => `• ${entry.host} — ${formatHostDetail(entry)}`);
    const current = queueStateInfo?.current || null;
    const footer = [
      status.vanished.length > 0 ? `${status.vanished.length} vanished — see the dashboard.` : null,
      newest || null
    ].filter(Boolean);
    alert.message = [
      `${formatSummaryLine(status)} (quiet after ${staleDays} days):`,
      '',
      this.describeCurrentForAlert(current),
      '',
      ...hostLines,
      ...(footer.length ? ['', ...footer] : [])
    ].join('\n');

    alert.addAction('Open Metrics');
    if (current) {
      alert.addAction(`Run ${current.parserName}`);
      alert.addAction(`Skip ${current.host} (${DEFAULT_SKIP_HOURS}${HOURS_SUFFIX})`);
    } else {
      alert.addAction('No site available');
    }
    alert.addCancelAction('Dismiss');

    const idx = await alert.present();
    if (idx === 0) {
      Safari.open(this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT));
    } else if (idx === 1) {
      if (current) this.runCurrentHost(queueStateInfo);
    } else if (idx === 2 && current) {
      const skipped = this.skipCurrentHost(queueStateInfo, DEFAULT_SKIP_HOURS);
      if (skipped) {
        const updatedQueueState = this.resolveQueueState(status);
        this.runCurrentHost(updatedQueueState);
      }
    }
  }

  // ── Main render dispatcher ──────────────────────────────────────────────────

  async render(status, staleDays, queueStateInfo) {
    const family = this.runtime.widgetFamily;

    if (family === 'accessoryCircular') {
      return this.renderAccessoryCircularWidget(status);
    }
    if (family === 'accessoryRectangular') {
      return this.renderAccessoryRectangularWidget(status, queueStateInfo);
    }
    if (family === 'accessoryInline') {
      return this.renderAccessoryInlineWidget(status);
    }
    if (family === 'small') {
      return this.renderSmallWidget(status);
    }
    if (family === 'large') {
      return this.renderLargeWidget(status);
    }
    // Default: medium (also covers null/undefined family when adding widget)
    return this.renderMediumWidget(status);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function runStaleSourcesWidget() {
  try {
    const checker = new StaleParsersChecker();
    const staleDays = checker.parseStaleDays(checker.runtime.widgetParameter);

    console.log(`StaleParsers: Starting (quiet after ${staleDays} days)`);

    const status = await checker.loadSourceStatus(staleDays);
    const queueStateInfo = checker.resolveQueueState(status);

    console.log(`StaleParsers: ${status.troubled.length} of ${status.total} hosts need a look, ${status.vanished.length} vanished`);

    if (checker.runtime.runsInWidget) {
      const widget = await checker.render(status, staleDays, queueStateInfo);
      Script.setWidget(widget);
    } else {
      const actionHandled = await checker.handleQueryAction(status, queueStateInfo);
      if (!actionHandled) {
        await checker.showAppAlert(status, staleDays, queueStateInfo);
      }
    }
  } catch (error) {
    console.log(`StaleParsers: Fatal error: ${error.message}`);

    // Show a minimal error widget so the widget slot doesn't go blank
    if (typeof config !== 'undefined' && config.runsInWidget) {
      try {
        const errWidget = new ListWidget();
        errWidget.backgroundColor = new Color(BRAND.primary);
        errWidget.setPadding(12, 12, 12, 12);
        const errText = errWidget.addText(`${WIDGET_TITLE}\nError loading data`);
        errText.font = Font.systemFont(FONT_SIZES.widget.small);
        errText.textColor = new Color(BRAND.danger);
        Script.setWidget(errWidget);
      } catch (_) {
        // nothing more we can do
      }
    }
  } finally {
    if (typeof Script !== 'undefined' && typeof Script.complete === 'function') {
      Script.complete();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  // Node (smoke tests): expose the pure selection logic, never run the widget.
  module.exports = {
    TROUBLED_VERDICTS,
    DEFAULT_STALE_DAYS,
    DEFAULT_SKIP_HOURS,
    QUEUE_IDLE_RESET_HOURS,
    QUEUE_STATE_FILE,
    faviconUrlForHost,
    isTroubledVerdict,
    buildSourceStatus,
    buildTroubledSignature,
    resolveQueue,
    markCurrentRun,
    skipHost,
    parseStaleDays,
    formatRunId,
    formatSummaryLine,
    formatHostDetail
  };
}

if (typeof FileManager !== 'undefined') {
  // Scriptable: run the widget / app.
  runStaleSourcesWidget();
}

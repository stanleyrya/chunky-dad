// ============================================================================
// SCRIPTABLE ADAPTER - iOS ENVIRONMENT SPECIFIC CODE
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains iOS/Scriptable ONLY code
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Scriptable APIs (Request, Calendar, FileManager, Alert, Notification)
// ✅ iOS-specific HTTP requests and calendar operations
// ✅ Scriptable-specific file operations and UI
//
// ❌ NEVER ADD THESE TO THIS FILE:
// ❌ Web APIs (fetch, DOMParser, localStorage, document, window)
// ❌ Business logic (that belongs in shared-core.js)
// ❌ Parsing logic (that belongs in parsers/)
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

/**
 * Author: Ryan Stanley (stanleyrya@gmail.com)
 * Tips: https://www.paypal.me/stanleyrya
 *
 * Class that can capture the time functions take in milliseconds then export them to a CSV.
 *
 * This is a minified version but it can be replaced with the full version here!
 * https://github.com/stanleyrya/scriptable-playground/tree/main/json-file-manager
 *
 * Usage:
 *  * wrap(fn, args): Wrap the function calls you want to monitor with this wrapper.
 *  * appendPerformanceDataToFile(relativePath): Use at the end of your script to write the metrics to the CSV file at the relative file path.
 */
class PerformanceDebugger {
  constructor() {
    this.performanceResultsInMillis = {};
  }
  async wrap(e, t, i) {
    const r = Date.now(),
      s = await e.apply(null, t),
      n = Date.now(),
      a = i || e.name;
    return ((this.performanceResultsInMillis[a] = n - r), s);
  }
  async appendPerformanceDataToFile(e) {
    const t = this.getFileManager(),
      i = this.getCurrentDir() + e,
      r = e.split("/");
    if (r > 1) {
      const e = r[r.length - 1],
        s = i.replace("/" + e, "");
      t.createDirectory(s, !0);
    }
    if (t.fileExists(i) && t.isDirectory(i))
      throw "Performance file is a directory, please delete!";
    let s,
      n,
      a = Object.getOwnPropertyNames(this.performanceResultsInMillis);
    if (t.fileExists(i)) {
      (console.log(
        "File exists, reading headers. To keep things easy we're only going to write to these headers.",
      ),
        await t.downloadFileFromiCloud(i),
        (n = t.readString(i)),
        (s = this.getFirstLine(n).split(",")));
    } else
      (console.log("File doesn't exist, using available headers."),
        (n = (s = a).toString()));
    n = n.concat("\n");
    for (const e of s)
      (this.performanceResultsInMillis[e] &&
        (n = n.concat(this.performanceResultsInMillis[e])),
        (n = n.concat(",")));
    ((n = n.slice(0, -1)), t.writeString(i, n));
  }
  getFirstLine(e) {
    var t = e.indexOf("\n");
    return (-1 === t && (t = void 0), e.substring(0, t));
  }
  getFileManager() {
    try {
      return FileManager.iCloud();
    } catch (e) {
      return FileManager.local();
    }
  }
  getCurrentDir() {
    const e = this.getFileManager(),
      t = module.filename;
    return t.replace(e.fileName(t, !0), "");
  }
}
const performanceDebugger = new PerformanceDebugger();

/**
 * Author: Ryan Stanley (stanleyrya@gmail.com)
 * Tips: https://www.paypal.me/stanleyrya
 *
 * Class that can write logs to the file system.
 *
 * This is a minified version but it can be replaced with the full version here!
 * https://github.com/stanleyrya/scriptable-playground/tree/main/file-logger
 *
 * Usage:
 *  * log(line): Adds the log line to the class' internal log buffer.
 *  * writeLogs(relativePath): Writes the stored logs to the relative file path.
 */
class FileLogger {
  constructor(options = {}) {
    this.entries = [];
    this.totalBytes = 0;
    this.maxLines = Number.isFinite(options.maxLines) ? options.maxLines : 8000;
    this.maxBytes = Number.isFinite(options.maxBytes)
      ? options.maxBytes
      : 1000000;
    this.captureMode = options.captureMode || "all";
    this.consoleWrapped = false;
    this.originalConsole = null;
  }

  configure(options = {}) {
    if (Number.isFinite(options.maxLines)) {
      this.maxLines = options.maxLines;
    }
    if (Number.isFinite(options.maxBytes)) {
      this.maxBytes = options.maxBytes;
    }
    if (typeof options.captureMode === "string") {
      this.captureMode = options.captureMode;
    }
  }

  get logs() {
    return this.getLogText({ mode: "full" });
  }

  log(line) {
    this.append("info", line);
  }

  warn(line) {
    this.append("warn", line);
  }

  error(line) {
    this.append("error", line);
  }

  captureConsole() {
    if (this.consoleWrapped) {
      return;
    }
    this.consoleWrapped = true;
    this.originalConsole = {
      log: typeof console.log === "function" ? console.log : null,
      warn: typeof console.warn === "function" ? console.warn : null,
      error: typeof console.error === "function" ? console.error : null,
    };

    // Debug channel: captured into the log file but NEVER echoed to the visible
    // console. shared-core routes full AI payload dumps here (SharedCore.logDebug)
    // so runs stay readable while the file log retains full detail.
    console.debug = (...args) => {
      const message = this.formatArgs(args);
      this.append("debug", message);
    };

    const callOriginal = (method, message) => {
      const original =
        this.originalConsole?.[method] || this.originalConsole?.log;
      if (typeof original === "function") {
        original.call(console, message);
      }
    };

    console.log = (...args) => {
      const message = this.formatArgs(args);
      this.append("info", message);
      callOriginal("log", message);
    };

    if (typeof console.warn === "function") {
      console.warn = (...args) => {
        const message = this.formatArgs(args);
        this.append("warn", message);
        callOriginal("warn", message);
      };
    }

    if (typeof console.error === "function") {
      console.error = (...args) => {
        const message = this.formatArgs(args);
        this.append("error", message);
        callOriginal("error", message);
      };
    }
  }

  // Scriptable gives every imported module its own console binding, so
  // captureConsole() above only sees THIS module's output. getConsoleTee()
  // hands out a sink the orchestrator can wire into the other modules'
  // consoles (via their __wireConsoleTee helpers) so their lines land in the
  // same run-log file with identical formatting and captureMode gating.
  getConsoleTee() {
    return (level, args) => this.append(level, this.formatArgs(args));
  }

  append(level, message) {
    const normalized = this.normalizeLevel(level);
    if (this.captureMode === "none") {
      return;
    }
    if (
      this.captureMode === "errors" &&
      (normalized === "info" || normalized === "debug")
    ) {
      return;
    }
    const line = this.formatEntry(normalized, message);
    const byteSize = line.length + 1;
    this.entries.push({ level: normalized, line, byteSize });
    this.totalBytes += byteSize;
    this.trimEntries();
  }

  formatEntry(level, message) {
    const safeMessage =
      typeof message === "string" ? message : this.formatArgs([message]);
    return `${new Date().toISOString()} [${level.toUpperCase()}] ${safeMessage}`;
  }

  formatArgs(args) {
    if (!Array.isArray(args) || args.length === 0) {
      return "";
    }
    return args.map((arg) => this.formatArg(arg)).join(" ");
  }

  formatArg(arg) {
    if (arg instanceof Error) {
      return arg.stack || arg.message || String(arg);
    }
    if (arg === null) return "null";
    if (arg === undefined) return "undefined";
    const argType = typeof arg;
    if (argType === "string") return arg;
    if (argType === "number" || argType === "boolean" || argType === "bigint") {
      return String(arg);
    }
    if (argType === "function") {
      return `[Function ${arg.name || "anonymous"}]`;
    }
    if (argType === "object") {
      try {
        return JSON.stringify(arg);
      } catch (e) {
        return String(arg);
      }
    }
    return String(arg);
  }

  normalizeLevel(level) {
    const normalized = String(level || "info").toLowerCase();
    if (normalized === "warn" || normalized === "warning") return "warn";
    if (normalized === "error") return "error";
    if (normalized === "debug") return "debug";
    return "info";
  }

  trimEntries() {
    const hasMaxLines = Number.isFinite(this.maxLines) && this.maxLines > 0;
    const hasMaxBytes = Number.isFinite(this.maxBytes) && this.maxBytes > 0;

    while (hasMaxLines && this.entries.length > this.maxLines) {
      const removed = this.entries.shift();
      this.totalBytes -= removed ? removed.byteSize : 0;
    }

    while (
      hasMaxBytes &&
      this.totalBytes > this.maxBytes &&
      this.entries.length > 0
    ) {
      const removed = this.entries.shift();
      this.totalBytes -= removed ? removed.byteSize : 0;
    }
  }

  getLogText(options = {}) {
    const mode = String(options.mode || "full").toLowerCase();
    if (mode === "summary" || mode === "none" || mode === "off") {
      return "";
    }

    let entries = this.entries;
    if (mode === "errors" || mode === "error") {
      entries = entries.filter(
        (entry) => entry.level === "error" || entry.level === "warn",
      );
    }

    if (
      Number.isFinite(options.maxLines) &&
      options.maxLines > 0 &&
      entries.length > options.maxLines
    ) {
      entries = entries.slice(-options.maxLines);
    }

    if (Number.isFinite(options.maxBytes) && options.maxBytes > 0) {
      let totalBytes = 0;
      const trimmed = [];
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i];
        totalBytes += entry.byteSize;
        if (totalBytes > options.maxBytes) {
          break;
        }
        trimmed.push(entry);
      }
      entries = trimmed.reverse();
    }

    if (!entries.length) {
      return "";
    }

    return `${entries.map((entry) => entry.line).join("\n")}\n`;
  }

  writeLogs(relativePath, options = {}) {
    const fm = this.getFileManager();
    const fullPath = this.getCurrentDir() + relativePath;
    const pathParts = relativePath.split("/");

    if (pathParts.length > 1) {
      const fileName = pathParts[pathParts.length - 1];
      const dirPath = fullPath.replace("/" + fileName, "");
      try {
        fm.createDirectory(dirPath, true);
      } catch (dirErr) {
        console.log(
          `📱 FileLogger: Directory creation failed: ${dirErr.message}`,
        );
      }
    }

    if (fm.fileExists(fullPath) && fm.isDirectory(fullPath)) {
      throw new Error("Log file is a directory, please delete!");
    }

    const content = this.getLogText(options);
    try {
      fm.writeString(fullPath, content);
      console.log(`📱 Scriptable: Successfully wrote logs to ${fullPath}`);
    } catch (writeErr) {
      console.log(`📱 Scriptable: Failed to write logs: ${writeErr.message}`);
      throw writeErr;
    }
  }

  getFileManager() {
    try {
      return FileManager.iCloud();
    } catch (e) {
      return FileManager.local();
    }
  }

  getCurrentDir() {
    const fm = this.getFileManager();
    const filename = module.filename;
    return filename.replace(fm.fileName(filename, true), "");
  }
}
const logger = new FileLogger();
logger.captureConsole();

const DEFAULT_CAPTURE_LOG_MAX_LINES = 30000;
const DEFAULT_CAPTURE_LOG_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_DISPLAY_LOG_MAX_LINES = 12000;
// Captures: 1=scheme, 2=authority, 3=path, 4=query (without fragment).
const SIMPLE_URL_PARSE_REGEX =
  /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i;

const HEADER_LOGO_URL = "https://chunky.dad/favicons/logo-hero.png";
const HEADER_LOGO_CACHE_FILE = "logo-hero.png";
const HEADER_LOGO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const { EventSchema: SharedEventSchema } = importModule("event-schema");
const { SharedCore } = importModule("shared-core");
const { RunLogSummary } = importModule("run-log-summary");
const { EventProvenance } = importModule("event-provenance");

if (
  !SharedEventSchema ||
  typeof SharedEventSchema.parseNotesIntoFields !== "function"
) {
  throw new Error(
    "ScriptableAdapter requires EventSchema to be loaded before adapter initialization",
  );
}

class ScriptableAdapter {
  constructor(config = {}) {
    this.config = {
      timeout: config.timeout || 30000,
      userAgent: config.userAgent || "chunky-dad-scraper/1.0",
      ...config,
    };

    // Store cities configuration for calendar mapping
    this.cities = config.cities || {};
    this.lastResults = null; // Store last results for calendar display

    // FileManager available for fallbacks
    this.fm = FileManager.iCloud();

    // Initialize directory paths
    const documentsDir = this.fm.documentsDirectory();
    this.baseDir = this.fm.joinPath(documentsDir, "chunky-dad-scraper");
    this.runsDir = this.fm.joinPath(this.baseDir, "runs");
    this.logsDir = this.fm.joinPath(this.baseDir, "logs");
    this.metricsDir = this.fm.joinPath(this.baseDir, "metrics");
    this.storageDir = this.fm.joinPath(this.baseDir, "storage");
    this.pageStorageDir = this.fm.joinPath(this.storageDir, "pages");
    this.cacheDir = this.fm.joinPath(this.baseDir, "cache");

    // Reuse a resolved run context (with automation overrides applied) when the
    // orchestrator hands one over; otherwise detect it fresh
    this.runtimeContext =
      config.runtime && typeof config.runtime === "object"
        ? { ...config.runtime }
        : this.getScriptableRuntimeContext();
    this.runStartedAt = new Date();
    this.warnCount = 0;
    this.lastExecutionActionCounts = null;
  }

  getScriptableRuntimeContext() {
    const runtime = {
      environment: "scriptable",
      type: "manual",
      trigger: "app",
      runsInWidget: false,
      runsInApp: false,
      runsInActionExtension: false,
      runsWithSiri: false,
      widgetFamily: null,
      widgetParameter: null,
      queryParameters: {},
      shortcutParameter: null,
      plainTexts: [],
    };

    try {
      if (typeof config !== "undefined") {
        runtime.runsInWidget = !!config.runsInWidget;
        runtime.runsInApp = !!config.runsInApp;
        runtime.runsInActionExtension = !!config.runsInActionExtension;
        runtime.runsWithSiri = !!config.runsWithSiri;
        runtime.widgetFamily = config.widgetFamily || null;
      }
      if (typeof args !== "undefined") {
        runtime.widgetParameter = args.widgetParameter || null;
        runtime.queryParameters = args.queryParameters || {};
        runtime.shortcutParameter = args.shortcutParameter || null;
        runtime.plainTexts = Array.isArray(args.plainTexts)
          ? args.plainTexts
          : [];
      }
    } catch (error) {
      console.log(
        `📱 Scriptable: Run context detection failed: ${error.message}`,
      );
    }

    if (runtime.runsInWidget) {
      runtime.trigger = "widget";
    } else if (runtime.runsInActionExtension) {
      runtime.trigger = "action-extension";
    } else if (runtime.runsWithSiri) {
      runtime.trigger = "siri";
    } else {
      runtime.trigger = runtime.runsInApp ? "app" : "unknown";
    }

    runtime.type =
      runtime.runsInWidget ||
      runtime.runsInActionExtension ||
      runtime.runsWithSiri
        ? "automated"
        : "manual";

    return runtime;
  }

  applyAutomationRunContext(runtimeContext, automationRun, automationOverride) {
    const updated = { ...(runtimeContext || {}) };
    const hasOverride =
      automationOverride !== null && automationOverride !== undefined;
    if (automationRun) {
      updated.type = "automated";
      if (
        !updated.trigger ||
        updated.trigger === "app" ||
        updated.trigger === "unknown"
      ) {
        updated.trigger = hasOverride ? "shortcut" : updated.trigger;
      }
    } else if (automationOverride === false) {
      updated.type = "manual";
    }
    updated.automationRun = automationRun === true;
    if (hasOverride) {
      updated.automationOverride = automationOverride;
    }
    return updated;
  }

  resolveRunContext(results) {
    const runtimeContext =
      this.runtimeContext || this.getScriptableRuntimeContext();
    const providedContext = results?.runContext || null;

    if (results?._isDisplayingSavedRun) {
      if (providedContext && providedContext.type === "display") {
        return providedContext;
      }
      return {
        type: "display",
        environment: runtimeContext.environment,
        trigger: "saved-run",
        original: results?._savedRunContext || providedContext || null,
      };
    }

    return providedContext || runtimeContext;
  }

  formatRunContext(runContext) {
    if (!runContext) return "Unknown";

    const typeValue = String(runContext.type || "manual");
    const label = typeValue.charAt(0).toUpperCase() + typeValue.slice(1);

    if (typeValue === "display") {
      if (runContext.original && runContext.original.type) {
        const originalType = runContext.original.type;
        const originalTrigger = runContext.original.trigger
          ? `/${runContext.original.trigger}`
          : "";
        return `${label} (original: ${originalType}${originalTrigger})`;
      }
      if (runContext.trigger) {
        return `${label} (${runContext.trigger})`;
      }
      return label;
    }

    if (runContext.trigger) {
      return `${label} (${runContext.trigger})`;
    }

    return label;
  }

  async loadHeaderLogoData() {
    const logoImage = await this.loadHeaderLogoImage();
    return logoImage ? this.imageToDataUri(logoImage) : null;
  }

  async loadHeaderLogoImage() {
    try {
      if (!this.fm.fileExists(this.cacheDir)) {
        this.fm.createDirectory(this.cacheDir, true);
      }
    } catch (error) {
      console.log(
        `📱 Scriptable: Logo cache dir setup failed: ${error.message}`,
      );
    }

    const cachePath = this.fm.joinPath(this.cacheDir, HEADER_LOGO_CACHE_FILE);
    try {
      if (this.fm.fileExists(cachePath)) {
        const mtime = this.fm.modificationDate(cachePath);
        if (mtime && Date.now() - mtime.getTime() < HEADER_LOGO_CACHE_TTL_MS) {
          return Image.fromFile(cachePath);
        }
      }
    } catch (error) {
      console.log(`📱 Scriptable: Logo cache read failed: ${error.message}`);
    }

    try {
      const request = new Request(HEADER_LOGO_URL);
      const image = await request.loadImage();
      this.fm.writeImage(cachePath, image);
      return image;
    } catch (error) {
      console.log(`📱 Scriptable: Logo download failed: ${error.message}`);
      return null;
    }
  }

  imageToDataUri(image) {
    if (!image) return null;
    try {
      const data = Data.fromPNG(image);
      return `data:image/png;base64,${data.toBase64String()}`;
    } catch (error) {
      console.log(
        `📱 Scriptable: Logo data conversion failed: ${error.message}`,
      );
      return null;
    }
  }

  sanitizeEventForRunSave(event) {
    if (!event || typeof event !== "object") return event;
    const seen = new WeakSet();

    try {
      return JSON.parse(
        JSON.stringify(event, (key, value) => {
          if (key === "_parserConfig" && value) {
            return {
              name: value.name,
              parser: value.parser,
              dryRun: value.dryRun,
              city: value.city,
              calendarSearchRangeDays: value.calendarSearchRangeDays,
            };
          }
          if (key === "_existingEvent" && value) {
            return {
              title: value.title,
              identifier: value.identifier,
              startDate: value.startDate,
              endDate: value.endDate,
              location: value.location,
              url: value.url,
            };
          }
          if (key === "_conflicts" && value && Array.isArray(value)) {
            return value.map((conflict) => ({
              title: conflict.title,
              startDate: conflict.startDate,
              endDate: conflict.endDate,
              identifier: conflict.identifier,
            }));
          }
          if (key === "calendar" && value && value.title && value.identifier) {
            return {
              title: value.title,
              identifier: value.identifier,
            };
          }
          if (typeof value === "function") {
            return undefined;
          }
          if (value && typeof value === "object") {
            if (seen.has(value)) {
              return undefined;
            }
            seen.add(value);
          }
          return value;
        }),
      );
    } catch (error) {
      console.log(
        `📱 Scriptable: Failed to serialize event "${event.title || event.name || "unknown"}": ${error.message}`,
      );
      return {
        title: event.title || event.name || "",
        startDate: event.startDate || null,
        endDate: event.endDate || null,
        location: event.location || event.venue || "",
        url: event.url || "",
        city: event.city || "",
        _action: event._action || null,
        _analysis: event._analysis || null,
        _mergeDiff: event._mergeDiff || null,
        _original: event._original || null,
      };
    }
  }

  sanitizeEventsForRunSave(events) {
    if (!Array.isArray(events)) return [];
    return events
      .map((event) => this.sanitizeEventForRunSave(event))
      .filter(Boolean);
  }

  // The top-level bearDroppedEvents list in a saved run exists only for the
  // saved-run audit display; the same entries are already persisted verbatim
  // under parserResults[].bearDroppedEvents for any other consumer. So this
  // copy is slimmed: `_`-prefixed working keys on the embedded event (notably
  // the ~1-2KB `_parserConfig` every drop carries) are dropped. Shallow
  // clones only — the live entries are still on screen and must not change.
  sanitizeDroppedEntriesForRunSave(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const copy = { ...entry };
      delete copy._parserConfig;
      if (copy.event && typeof copy.event === "object") {
        const event = {};
        for (const key of Object.keys(copy.event)) {
          if (key.startsWith("_")) continue;
          event[key] = copy.event[key];
        }
        copy.event = event;
      }
      return copy;
    });
  }

  // Detect all-day events at save-time based on DateTime patterns
  isAllDayEvent(event) {
    if (!event || !event.startDate || !event.endDate) return false;

    const startDate = new Date(event.startDate);
    const endDate = new Date(event.endDate);

    // Check if start time is 00:00:00
    const isStartMidnight =
      startDate.getHours() === 0 &&
      startDate.getMinutes() === 0 &&
      startDate.getSeconds() === 0;

    // Check if end time is 23:59:59 (or 23:59:00)
    const isEndLateNight =
      endDate.getHours() === 23 &&
      (endDate.getMinutes() === 59 || endDate.getMinutes() === 0);

    // Check if it's the same day
    const isSameDay = startDate.toDateString() === endDate.toDateString();

    return isStartMidnight && isEndLateNight && isSameDay;
  }

  // Get calendar name for a city
  getCalendarName(city) {
    if (city && this.cities[city] && this.cities[city].calendar) {
      return this.cities[city].calendar;
    }
    // Fail closed (run 2026-07-31, Club Chub): the old fallback interpolated
    // the raw city string and produced "chunky-dad-wilton manors" — a target
    // with a space in it, naming a calendar that cannot exist. Every
    // unrecognized city now routes to the single unknown target instead, and
    // says so once per distinct city so the run shows the drop.
    const target = SharedCore.resolveCalendarTarget(this.cities, city);
    this.logUnrecognizedCalendarCity(target);
    return target.name;
  }

  // Additive, once per distinct unrecognized city (getCalendarName runs per
  // event; the same city must not spam the log).
  logUnrecognizedCalendarCity(target) {
    if (!target || target.recognized) return;
    if (!this._unrecognizedCalendarCities) {
      this._unrecognizedCalendarCities = new Set();
    }
    const key = target.requested || "(empty)";
    if (this._unrecognizedCalendarCities.has(key)) return;
    this._unrecognizedCalendarCities.add(key);
    console.log(
      `📱 Scriptable: ⚠️ Unrecognized city "${key}" has no configured calendar — routed to "${target.name}" (no calendar name is ever invented from a city string)`,
    );
  }

  // Get timezone for a city
  getTimezoneForCity(city) {
    if (city && this.cities[city] && this.cities[city].timezone) {
      return this.cities[city].timezone;
    }
    // NO FALLBACKS - throw error if timezone not found
    throw new Error(`No timezone configuration found for city: ${city}`);
  }

  // Get timezone for display purposes - falls back to UTC for unknown cities.
  // Use this instead of getTimezoneForCity in all display/rendering contexts so that
  // events with unresolved cities (e.g. city="unknown") still render rather than crashing.
  getTimezoneForCityOrUtc(city) {
    try {
      return this.getTimezoneForCity(city);
    } catch (e) {
      return "UTC";
    }
  }

  // HTTP Adapter Implementation
  getPageCacheConfig() {
    const pageCache = this.config.pageCache || {};
    const ttlDays = Number(pageCache.ttlDays);
    return {
      enabled: pageCache.enabled === true,
      ttlDays: Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 3,
    };
  }

  // How long unused OCR/classification cache entries survive the end-of-run
  // prune. Reads the global `ocr` block threaded in by the orchestrator (the
  // same way pageCache is) — the single retention knob, everything else about
  // cache retention is fixed policy.
  getOcrCacheRetentionDays() {
    const raw = Number(this.config.ocr?.cacheRetentionDays);
    return Number.isFinite(raw) && raw > 0 ? raw : 90;
  }

  normalizePageCacheUrl(url) {
    try {
      const normalized = new URL(String(url));
      normalized.hash = "";
      normalized.protocol = normalized.protocol.toLowerCase();
      normalized.hostname = normalized.hostname.toLowerCase();

      const searchEntries = Array.from(normalized.searchParams.entries()).sort(
        ([leftKey, leftValue], [rightKey, rightValue]) => {
          if (leftKey === rightKey) {
            return leftValue.localeCompare(rightValue);
          }
          return leftKey.localeCompare(rightKey);
        },
      );

      normalized.search = "";
      searchEntries.forEach(([key, value]) =>
        normalized.searchParams.append(key, value),
      );

      return normalized.toString();
    } catch (_) {
      return String(url || "").trim();
    }
  }

  parsePageCacheUrl(url) {
    const input = String(url || "").trim();
    if (!input) {
      return null;
    }

    try {
      return new URL(input);
    } catch (_) {}

    const match = input.match(SIMPLE_URL_PARSE_REGEX);
    if (!match) {
      return null;
    }

    const authority = String(match[2] || "").toLowerCase();
    let host = authority;
    const authSeparatorIndex = host.lastIndexOf("@");
    if (authSeparatorIndex >= 0) {
      host = host.slice(authSeparatorIndex + 1);
    }

    let hostname = host;
    if (host.startsWith("[")) {
      const ipv6EndIndex = host.indexOf("]");
      hostname = ipv6EndIndex > 0 ? host.slice(0, ipv6EndIndex + 1) : host;
    } else {
      hostname = host.split(":")[0] || "";
    }

    return {
      host,
      hostname,
      pathname: match[3] || "/",
      search: match[4] || "",
    };
  }

  sanitizePageCacheSegment(segment) {
    return (
      String(segment || "index")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "index"
    );
  }

  hashPageCacheValue(value) {
    // FNV-1a 32-bit hash for compact deterministic cache keys.
    let hash = 2166136261;
    const input = String(value || "");
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  getPageCachePathParts(url) {
    const normalizedUrl = this.normalizePageCacheUrl(url);
    const parsed = this.parsePageCacheUrl(normalizedUrl);

    if (parsed) {
      const hostDir = this.sanitizePageCacheSegment(
        parsed.host || parsed.hostname || "unknown-host",
      );
      const pathSegments = (parsed.pathname || "/")
        .split("/")
        .filter(Boolean)
        .map((segment) => this.sanitizePageCacheSegment(segment));

      let fileBase =
        pathSegments.length > 0 ? pathSegments.join("__") : "index";
      if (parsed.search) {
        fileBase += `--q-${this.hashPageCacheValue(parsed.search)}`;
      }
      if (fileBase.length > 120) {
        fileBase = `${fileBase.slice(0, 80)}--${this.hashPageCacheValue(fileBase)}`;
      }

      return {
        normalizedUrl,
        hostDir,
        fileName: `${fileBase}.json`,
      };
    }

    const fallbackName = `${this.hashPageCacheValue(normalizedUrl || url)}.json`;
    return {
      normalizedUrl,
      hostDir: "unknown-host",
      fileName: fallbackName,
    };
  }

  ensureDirectoryExists(path) {
    if (!this.fm.fileExists(path)) {
      this.fm.createDirectory(path, true);
    }
  }

  ensurePageCacheDir(hostDir) {
    this.ensureDirectoryExists(this.baseDir);
    this.ensureDirectoryExists(this.storageDir);
    this.ensureDirectoryExists(this.pageStorageDir);
    const hostDirPath = this.fm.joinPath(this.pageStorageDir, hostDir);
    this.ensureDirectoryExists(hostDirPath);
    return hostDirPath;
  }

  async readCachedPage(url, pageCacheConfig) {
    if (!pageCacheConfig.enabled) {
      return null;
    }

    const { hostDir, fileName, normalizedUrl } =
      this.getPageCachePathParts(url);
    const hostDirPath = this.fm.joinPath(this.pageStorageDir, hostDir);
    const cachePath = this.fm.joinPath(hostDirPath, fileName);

    try {
      if (!this.fm.fileExists(cachePath)) {
        return null;
      }

      const modifiedAt = this.fm.modificationDate(cachePath);
      const maxAgeMs = pageCacheConfig.ttlDays * 24 * 60 * 60 * 1000;
      if (modifiedAt && Date.now() - modifiedAt.getTime() > maxAgeMs) {
        return null;
      }

      try {
        await this.fm.downloadFileFromiCloud(cachePath);
      } catch (_) {}

      const cached = JSON.parse(this.fm.readString(cachePath));
      const fetchState =
        typeof cached.fetchState === "string"
          ? cached.fetchState.toLowerCase()
          : "";
      if (
        fetchState === "failed" &&
        cached.failure &&
        cached.failure.nonRetryable === true
      ) {
        const failureMessage =
          typeof cached.failure.error === "string"
            ? cached.failure.error
            : cached.failure.error &&
                typeof cached.failure.error.message === "string"
              ? cached.failure.error.message
              : `Cached non-retryable failure for ${normalizedUrl}`;
        const failureError = new Error(failureMessage);
        failureError.retryable = false;
        failureError.cachedFailure = true;
        if (Number.isFinite(cached.statusCode)) {
          failureError.statusCode = cached.statusCode;
        }
        throw failureError;
      }
      if (fetchState !== "downloaded") {
        return null;
      }
      if (
        !cached ||
        typeof cached.html !== "string" ||
        cached.html.length === 0
      ) {
        return null;
      }

      return {
        html: cached.html,
        url: cached.url || normalizedUrl,
        statusCode: cached.statusCode || 200,
        headers: cached.headers || {},
        fetchedAt: cached.fetchedAt || null,
        modifiedAtMs: modifiedAt ? modifiedAt.getTime() : null,
        cachePath,
      };
    } catch (error) {
      if (error?.cachedFailure) {
        throw error;
      }
      console.log(
        `📱 Scriptable: Page cache read failed for ${url}: ${error.message}`,
      );
      return null;
    }
  }

  // Hours below 24h ("5.3h"), days otherwise ("2.1d"); null when unknown.
  formatPageCacheAge(ageMs) {
    if (!Number.isFinite(ageMs) || ageMs < 0) {
      return null;
    }
    const hours = ageMs / (60 * 60 * 1000);
    return hours < 24 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;
  }

  // Cache hits were previously silent, hiding why a page showed stale content.
  logPageCacheHit(url, cachedPage, pageCacheConfig) {
    const fetchedAtMs = cachedPage.fetchedAt
      ? Date.parse(cachedPage.fetchedAt)
      : NaN;
    const baseMs = Number.isFinite(fetchedAtMs)
      ? fetchedAtMs
      : Number(cachedPage.modifiedAtMs);
    const age =
      Number.isFinite(baseMs) && baseMs > 0
        ? this.formatPageCacheAge(Date.now() - baseMs)
        : null;
    const agePart = age ? `age ${age}, ` : "";
    console.log(
      `📱 Scriptable: Page cache hit (${agePart}ttl ${pageCacheConfig.ttlDays}d) for ${url}`,
    );
  }

  async writeCachedPage(url, responseData, pageCacheConfig) {
    if (
      !pageCacheConfig.enabled ||
      !responseData ||
      typeof responseData.html !== "string" ||
      responseData.html.length === 0
    ) {
      return;
    }

    const { hostDir, fileName, normalizedUrl } =
      this.getPageCachePathParts(url);
    const hostDirPath = this.ensurePageCacheDir(hostDir);
    const cachePath = this.fm.joinPath(hostDirPath, fileName);
    const payload = {
      url: normalizedUrl,
      fetchedAt: new Date().toISOString(),
      statusCode: responseData.statusCode || 200,
      headers: responseData.headers || {},
      fetchState: "downloaded",
      html: responseData.html,
    };

    try {
      this.fm.writeString(cachePath, JSON.stringify(payload, null, 2));
    } catch (error) {
      console.log(
        `📱 Scriptable: Page cache write failed for ${url}: ${error.message}`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Learned dead-end store persistence: dead-ends.json alongside the other
  // scraper storage. Shape: { "<url>": { firstSeen, lastSeen, misses } }.
  // The semantics (skip/retry/prune) live in shared-core; the orchestrator
  // loads the store before the run and saves the updated store after it.
  // ---------------------------------------------------------------------
  getDeadEndsFilePath() {
    return this.fm.joinPath(this.baseDir, "dead-ends.json");
  }

  async loadDeadEnds() {
    const path = this.getDeadEndsFilePath();
    try {
      if (!this.fm.fileExists(path)) {
        return {};
      }
      try {
        await this.fm.downloadFileFromiCloud(path);
      } catch (_) {}
      const parsed = JSON.parse(this.fm.readString(path));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        console.log(
          "📱 Scriptable: Dead-end store has unexpected shape — starting with empty store",
        );
        return {};
      }
      return parsed;
    } catch (error) {
      // Corrupt or unreadable file must never break a run — the store is a
      // pure optimization and rebuilds itself over subsequent runs.
      console.log(
        `📱 Scriptable: Dead-end store read failed (${error.message}) — starting with empty store`,
      );
      return {};
    }
  }

  async saveDeadEnds(store) {
    if (!store || typeof store !== "object" || Array.isArray(store)) {
      return;
    }
    const path = this.getDeadEndsFilePath();
    try {
      this.ensureDirectoryExists(this.baseDir);
      this.fm.writeString(path, JSON.stringify(store, null, 2));
      console.log(
        `📱 Scriptable: ✓ Saved dead-end store (${Object.keys(store).length} entries) to ${path}`,
      );
    } catch (error) {
      console.log(
        `📱 Scriptable: Dead-end store write failed: ${error.message}`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Venue discovery queue persistence: bar-additions.json alongside the
  // other scraper storage, mirroring the dead-end store I/O (adapter owns
  // the file; corrupt/missing file → start fresh, never throw).
  //
  // GATHERING-ONLY BY DESIGN: this queue is written by results-UI taps and
  // read back ONLY to render the "Queued ✓" badge in the results UI.
  // NOTHING in the scraping pipeline reads it — no bars-data merging, no
  // provisional-curated entries, zero effect on any run behavior.
  // Promotion to data/bars/<city>.json happens out-of-band after
  // verification against independent references; this queue is
  // evidence-gathering only.
  //
  // Shape: { "<cityKey>|<normalized name>": { name, city, address,
  //   coordinates, signals: [...], website?, instagram?, sourceEvents: [...],
  //   firstSeen, lastSeen, timesSeen, runIds: [...] } }
  // ---------------------------------------------------------------------
  getBarAdditionsFilePath() {
    return this.fm.joinPath(this.baseDir, "bar-additions.json");
  }

  async loadBarAdditions() {
    const path = this.getBarAdditionsFilePath();
    try {
      if (!this.fm.fileExists(path)) {
        return {};
      }
      try {
        await this.fm.downloadFileFromiCloud(path);
      } catch (_) {}
      const parsed = JSON.parse(this.fm.readString(path));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        console.log(
          "📱 Scriptable: Venue queue has unexpected shape — starting with empty queue",
        );
        return {};
      }
      return parsed;
    } catch (error) {
      // Corrupt or unreadable file must never break the UI — the queue is
      // pure evidence and rebuilds itself over subsequent runs/taps.
      console.log(
        `📱 Scriptable: Venue queue read failed (${error.message}) — starting with empty queue`,
      );
      return {};
    }
  }

  async saveBarAdditions(queue) {
    if (!queue || typeof queue !== "object" || Array.isArray(queue)) {
      return;
    }
    const path = this.getBarAdditionsFilePath();
    try {
      this.ensureDirectoryExists(this.baseDir);
      this.fm.writeString(path, JSON.stringify(queue, null, 2));
      console.log(
        `📱 Scriptable: ✓ Saved venue queue (${Object.keys(queue).length} entries) to ${path}`,
      );
    } catch (error) {
      console.log(`📱 Scriptable: Venue queue write failed: ${error.message}`);
    }
  }

  // Fold one tapped candidate into the queue object (caller persists).
  // Existing key → merge: bump lastSeen/timesSeen, union signals/runIds/
  // sourceEvents (runIds keep the 10 most recent, sourceEvents cap at 5),
  // keep the most complete address, fill website/instagram blanks only.
  // Returns the entry, or null when the candidate has no key.
  mergeBarAdditionEntry(queue, candidate, runId, nowIso) {
    const key =
      candidate && typeof candidate.key === "string" ? candidate.key : "";
    if (!key || !queue || typeof queue !== "object") return null;
    const signals = Array.isArray(candidate.signals) ? candidate.signals : [];
    const sourceEvents = Array.isArray(candidate.sourceEvents)
      ? candidate.sourceEvents
      : [];
    const runIdText = runId ? String(runId) : "";

    const existing = queue[key];
    if (!existing || typeof existing !== "object") {
      const entry = {
        name: candidate.name || "",
        city: candidate.city || "",
        address: candidate.address || "",
        coordinates: candidate.coordinates || "",
        signals: [...signals],
        sourceEvents: sourceEvents.slice(0, 5),
        firstSeen: nowIso,
        lastSeen: nowIso,
        timesSeen: 1,
        runIds: runIdText ? [runIdText] : [],
      };
      if (candidate.website) entry.website = candidate.website;
      if (candidate.instagram) entry.instagram = candidate.instagram;
      queue[key] = entry;
      return entry;
    }

    existing.lastSeen = nowIso;
    existing.timesSeen = (Number(existing.timesSeen) || 0) + 1;
    if (!Array.isArray(existing.signals)) existing.signals = [];
    for (const signal of signals) {
      if (!existing.signals.includes(signal)) existing.signals.push(signal);
    }
    if (!Array.isArray(existing.runIds)) existing.runIds = [];
    if (runIdText && !existing.runIds.includes(runIdText)) {
      existing.runIds.push(runIdText);
    }
    existing.runIds = existing.runIds.slice(-10);
    if (!Array.isArray(existing.sourceEvents)) existing.sourceEvents = [];
    const seenEventKeys = new Set(
      existing.sourceEvents.map(
        (event) => `${event && event.title}|${event && event.date}|${event && event.sourcePageUrl}`,
      ),
    );
    for (const event of sourceEvents) {
      if (existing.sourceEvents.length >= 5) break;
      const eventKey = `${event && event.title}|${event && event.date}|${event && event.sourcePageUrl}`;
      if (seenEventKeys.has(eventKey)) continue;
      seenEventKeys.add(eventKey);
      existing.sourceEvents.push(event);
    }
    if (
      SharedCore.isMoreCompleteVenueAddressStatic(
        candidate.address,
        existing.address,
      )
    ) {
      existing.address = candidate.address;
    }
    if (!existing.website && candidate.website) {
      existing.website = candidate.website;
    }
    if (!existing.instagram && candidate.instagram) {
      existing.instagram = candidate.instagram;
    }
    return existing;
  }

  // Stamp the just-saved run id into venue-queue entries tapped this session.
  // Queue taps happen while the results sheet is up, BEFORE the run is saved,
  // so results.savedRunId is null at queue-write time and entries were landing
  // with runIds: []. The run id is generated from the save timestamp
  // (saveRun → getRunId), so assigning it earlier would change what a run id
  // means; instead queueVenueCandidateAndReport records which candidate keys
  // it wrote and this backfill — called right after saveRun assigns
  // results.savedRunId — stamps the now-known id into exactly those entries.
  // Fail open: any failure leaves entries as the tap wrote them.
  async backfillQueuedVenueRunIds(results) {
    try {
      const runId =
        results && results.savedRunId ? String(results.savedRunId) : "";
      const keys = Array.isArray(results && results._queuedVenueCandidateKeys)
        ? results._queuedVenueCandidateKeys
        : [];
      if (!runId || keys.length === 0) return;
      const queue = await this.loadBarAdditions();
      let stamped = 0;
      for (const key of keys) {
        const entry = queue[key];
        if (!entry || typeof entry !== "object") continue;
        if (!Array.isArray(entry.runIds)) entry.runIds = [];
        if (entry.runIds.includes(runId)) continue;
        entry.runIds.push(runId);
        entry.runIds = entry.runIds.slice(-10); // same cap as the tap merge
        stamped += 1;
      }
      if (stamped === 0) return;
      await this.saveBarAdditions(queue);
      console.log(
        `📱 Scriptable: Backfilled run id ${runId} into ${stamped} queued venue entr${stamped === 1 ? "y" : "ies"}`,
      );
    } catch (error) {
      console.warn(
        `📱 Scriptable: Venue-queue run id backfill failed: ${error.message}`,
      );
    }
  }

  extractHttpStatusCodeFromError(error) {
    const message =
      error && typeof error.message === "string" ? error.message : "";
    const match = message.match(/HTTP\s+(\d{3})/i);
    if (!match) {
      return null;
    }
    const statusCode = Number(match[1]);
    return Number.isFinite(statusCode) ? statusCode : null;
  }

  // Default maxDimension of 1024 matches what the OCR overflow-retry path uses:
  // first attempts at ~1568px reliably overflowed the vision model's context
  // (0 tokens, finish_reason "length") and only succeeded after retrying ≤1024,
  // so every large image paid a wasted round trip.
  async fetchImageAsBase64(url, timeoutSeconds = 30, maxDimension = 1024) {
    try {
      const request = new Request(url);
      request.timeoutInterval = timeoutSeconds;
      let image = await request.loadImage();
      // Vision-model image tokens scale with pixel count, not file size. Oversized
      // images overflow the model context and come back as empty responses with
      // finish_reason "length", so cap the longest side before encoding.
      const width = image.size ? image.size.width : 0;
      const height = image.size ? image.size.height : 0;
      const longestSide = Math.max(width, height);
      if (maxDimension > 0 && longestSide > maxDimension) {
        const scale = maxDimension / longestSide;
        const newWidth = Math.max(1, Math.round(width * scale));
        const newHeight = Math.max(1, Math.round(height * scale));
        const context = new DrawContext();
        context.size = new Size(newWidth, newHeight);
        context.opaque = true;
        context.respectScreenScale = false;
        context.drawImageInRect(image, new Rect(0, 0, newWidth, newHeight));
        image = context.getImage();
        console.log(
          `📱 Scriptable: Downscaled image ${Math.round(width)}x${Math.round(height)} → ${newWidth}x${newHeight} for OCR: ${url}`,
        );
      }
      const jpegData = Data.fromJPEG(image);
      return jpegData.toBase64String();
    } catch (error) {
      throw new Error(`Failed to fetch image as base64: ${error.message}`);
    }
  }

  async postJson(url, payload, options = {}) {
    try {
      const request = new Request(url);
      request.method = "POST";
      request.headers = {
        "Content-Type": "application/json",
        ...options.headers,
      };
      request.body = JSON.stringify(payload);
      if (options.timeoutSeconds) {
        request.timeoutInterval = options.timeoutSeconds;
      }
      const responseText = await request.loadString();
      const statusCode = request.response ? request.response.statusCode : 200;
      return {
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        text: responseText,
      };
    } catch (error) {
      throw new Error(`POST request failed: ${error.message}`);
    }
  }

  async saveFailureNote(url, error, metadata = {}) {
    if (metadata && metadata.retryable === true) {
      return false;
    }

    const { hostDir, fileName, normalizedUrl } =
      this.getPageCachePathParts(url);
    const hostDirPath = this.ensurePageCacheDir(hostDir);
    const cachePath = this.fm.joinPath(hostDirPath, fileName);
    const statusCode = Number.isFinite(metadata.statusCode)
      ? metadata.statusCode
      : this.extractHttpStatusCodeFromError(error);
    const payload = {
      url: normalizedUrl,
      fetchedAt: new Date().toISOString(),
      statusCode: Number.isFinite(statusCode) ? statusCode : null,
      headers: {},
      fetchState: "failed",
      failure: {
        nonRetryable: true,
        context: metadata.context || "crawl",
        error: error && error.message ? error.message : "Unknown error",
      },
    };

    this.fm.writeString(cachePath, JSON.stringify(payload, null, 2));
    console.log(
      `📱 Scriptable: 📝 Saved non-retryable failure cache entry to ${cachePath}`,
    );
    return true;
  }

  async fetchData(url, options = {}) {
    try {
      const pageCacheConfig = this.getPageCacheConfig();
      const canUseCache =
        pageCacheConfig.enabled &&
        (options.method || "GET").toUpperCase() === "GET" &&
        !options.body;
      // Optional caller hook (options.isCacheableResponse): a response it
      // rejects is neither served from the disk cache nor written to it —
      // used by the geocode path so an empty Nominatim body can't poison a
      // venue for the whole TTL. Callers that don't pass it are unaffected.
      const isCacheableResponse = (responseData) =>
        typeof options.isCacheableResponse !== "function" ||
        options.isCacheableResponse(responseData) !== false;
      if (canUseCache) {
        const cachedPage = await this.readCachedPage(url, pageCacheConfig);
        if (cachedPage && isCacheableResponse(cachedPage)) {
          this.logPageCacheHit(url, cachedPage, pageCacheConfig);
          return cachedPage;
        }
      }

      const request = new Request(url);
      request.method = options.method || "GET";
      request.headers = {
        "User-Agent": this.config.userAgent,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...options.headers,
      };

      if (options.body) {
        request.body = options.body;
      }

      const response = await request.loadString();

      // Check response status
      const statusCode = request.response ? request.response.statusCode : 200;

      if (statusCode >= 400) {
        throw new Error(`HTTP ${statusCode} error from ${url}`);
      }

      if (response && response.length > 0) {
        const responseData = {
          html: response,
          url: url,
          statusCode: statusCode,
          headers: request.response ? request.response.headers : {},
        };

        if (canUseCache && isCacheableResponse(responseData)) {
          await this.writeCachedPage(url, responseData, pageCacheConfig);
        }

        return responseData;
      } else {
        console.error(`📱 Scriptable: ✗ Empty response from ${url}`);
        throw new Error(`Empty response from ${url}`);
      }
    } catch (error) {
      if (error?.cachedFailure) {
        throw error;
      }
      const errorMessage = `📱 Scriptable: ✗ HTTP request failed for ${url}: ${error.message}`;
      console.log(errorMessage);
      throw new Error(`HTTP request failed for ${url}: ${error.message}`);
    }
  }

  // ---------------------------------------------------------------------
  // Native reverse geocode via Scriptable's Location API (Apple's geocoding
  // service). Apple rate-limits reverse geocoding GLOBALLY across all
  // Scriptable users, so this path practices strict quota hygiene
  // (2026-07-16 run: ~50 calls in 6 seconds tripped the global limit and
  // every cross-check for the rest of the run silently degraded to
  // 'skipped'):
  //   1. In-memory memoization per run (successes AND failures), keyed by
  //      the coordinates rounded to 5 decimals (~1 m).
  //   2. Persistent placemark cache (reverse-geocode-cache.json alongside
  //      dead-ends.json), successes only, ~30-day TTL, pruned on save;
  //      corrupt file → empty cache, never throws.
  //   3. ≥500 ms pacing between actual Location.reverseGeocode calls
  //      (cache hits never wait).
  //   4. Circuit breaker: 3 consecutive failures stop native attempts for
  //      the rest of the run.
  // Returns the raw first placemark object (subThoroughfare/thoroughfare/
  // locality/postalCode/postalAddress keys — plus name/areasOfInterest when
  // Apple knows a POI at the point, which the geo-POI bar corroboration in
  // normalizers.js harvests; the raw object is persisted verbatim, so cached
  // entries carry those fields forward and pre-harvest entries without them
  // simply yield no POI names — fail open) or null. normalizers.js uses
  // this for the geocode-verification cross-check; all Scriptable API usage
  // stays in this adapter (pure-module rule).
  // ---------------------------------------------------------------------

  getReverseGeocodeCacheFilePath() {
    return this.fm.joinPath(this.baseDir, "reverse-geocode-cache.json");
  }

  // Lazy load-on-first-use; shape { "<lat5>,<lon5>": { placemark, ts } }.
  loadReverseGeocodeDiskCache() {
    if (this.reverseGeocodeDiskCache) {
      return this.reverseGeocodeDiskCache;
    }
    let cache = {};
    const path = this.getReverseGeocodeCacheFilePath();
    try {
      if (this.fm.fileExists(path)) {
        const parsed = JSON.parse(this.fm.readString(path));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          cache = parsed;
        }
      }
    } catch (error) {
      // Corrupt/unreadable cache must never break a run — it is a pure
      // optimization and rebuilds itself over subsequent runs.
      console.log(
        `📱 Scriptable: Reverse geocode cache read failed (${error.message}) — starting with empty cache`,
      );
      cache = {};
    }
    this.reverseGeocodeDiskCache = cache;
    return cache;
  }

  // Save after every write (paced native calls make this cheap) so a crash
  // never loses earned placemarks; stale entries are pruned on the way out.
  saveReverseGeocodeDiskCache() {
    const cache = this.reverseGeocodeDiskCache;
    if (!cache || typeof cache !== "object") {
      return;
    }
    const ttlMs = 30 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - ttlMs;
    for (const key of Object.keys(cache)) {
      const entry = cache[key];
      const ts = entry && Number(entry.ts);
      if (!Number.isFinite(ts) || ts < cutoff) {
        delete cache[key];
      }
    }
    try {
      this.ensureDirectoryExists(this.baseDir);
      this.fm.writeString(
        this.getReverseGeocodeCacheFilePath(),
        JSON.stringify(cache),
      );
    } catch (error) {
      console.log(
        `📱 Scriptable: Reverse geocode cache write failed: ${error.message}`,
      );
    }
  }

  // Minimum spacing between actual Location.reverseGeocode calls — same
  // pattern as normalizers.js delayForRateLimit, kept inside the adapter
  // because the quota being protected is Apple's, not Nominatim's.
  async delayForReverseGeocodeRateLimit() {
    const minimumDelay = 500;
    const now = Date.now();
    const elapsed = now - (this.lastReverseGeocodeTime || 0);
    if (this.lastReverseGeocodeTime && elapsed < minimumDelay) {
      await this.sleepForReverseGeocode(minimumDelay - elapsed);
    }
    this.lastReverseGeocodeTime = Date.now();
  }

  sleepForReverseGeocode(delayMs) {
    return new Promise((resolve) => {
      if (typeof setTimeout !== "undefined") {
        setTimeout(resolve, delayMs);
      } else if (typeof Timer !== "undefined") {
        const timer = new Timer();
        timer.timeInterval = delayMs;
        timer.schedule(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // Adapter self-description for normalizers' enforce mode: does this
  // platform structurally have Apple's reverse geocoding? True whenever the
  // Location API is present (the same typeof checks reverseGeocodePlacemark
  // gates on) — a rate-limited/down service still "supports" the capability,
  // which is exactly the case enforce mode must fail closed on.
  supportsReverseGeocode() {
    return (
      typeof Location !== "undefined" &&
      typeof Location.reverseGeocode === "function"
    );
  }

  async reverseGeocodePlacemark(lat, lon) {
    if (
      typeof Location === "undefined" ||
      typeof Location.reverseGeocode !== "function"
    ) {
      return null;
    }
    if (!this.reverseGeocodeCache) {
      this.reverseGeocodeCache = {};
    }
    const cacheKey = `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
    if (
      Object.prototype.hasOwnProperty.call(this.reverseGeocodeCache, cacheKey)
    ) {
      return this.reverseGeocodeCache[cacheKey];
    }
    // Durable second layer: placemarks earned on earlier runs never spend
    // Apple quota again.
    const diskCache = this.loadReverseGeocodeDiskCache();
    const diskEntry = diskCache[cacheKey];
    if (
      diskEntry &&
      typeof diskEntry === "object" &&
      diskEntry.placemark &&
      typeof diskEntry.placemark === "object"
    ) {
      this.reverseGeocodeCache[cacheKey] = diskEntry.placemark;
      return diskEntry.placemark;
    }
    // Circuit breaker: once Apple's service proves unavailable this run,
    // stop burning the global quota on attempts that cannot succeed.
    if (this.reverseGeocodeCircuitOpen) {
      return null;
    }
    await this.delayForReverseGeocodeRateLimit();
    let mark = null;
    try {
      const placemarks = await Location.reverseGeocode(lat, lon);
      const first =
        Array.isArray(placemarks) && placemarks.length > 0
          ? placemarks[0]
          : null;
      mark = first && typeof first === "object" ? first : null;
      // The service answered (even with no placemark) — failures are only
      // consecutive when nothing succeeds in between.
      this.reverseGeocodeConsecutiveFailures = 0;
    } catch (error) {
      console.log(
        `📱 Scriptable: Native reverse geocode failed for ${lat},${lon}: ${error.message}`,
      );
      mark = null;
      this.reverseGeocodeConsecutiveFailures =
        (this.reverseGeocodeConsecutiveFailures || 0) + 1;
      if (this.reverseGeocodeConsecutiveFailures >= 3) {
        this.reverseGeocodeCircuitOpen = true;
        console.log(
          "📱 Scriptable: Apple reverse geocoding unavailable after 3 consecutive failures — skipping remaining lookups this run",
        );
      }
    }
    this.reverseGeocodeCache[cacheKey] = mark;
    if (mark) {
      // Failures/nulls are NEVER persisted — only real placemarks earn a
      // durable entry.
      diskCache[cacheKey] = { placemark: mark, ts: Date.now() };
      this.saveReverseGeocodeDiskCache();
    }
    return mark;
  }

  // Formatted "street, city, state zip" string built from the placemark hook
  // above, or null when nothing usable comes back. normalizers.js calls this
  // hook only when it exists (coords→address enrichment).
  async reverseGeocode(lat, lon) {
    const mark = await this.reverseGeocodePlacemark(lat, lon);
    if (!mark) {
      return null;
    }
    const postal =
      mark.postalAddress && typeof mark.postalAddress === "object"
        ? mark.postalAddress
        : {};
    const clean = (value) =>
      typeof value === "string" || typeof value === "number"
        ? String(value).trim()
        : "";
    let street = clean(postal.street);
    if (!street) {
      street = [clean(mark.subThoroughfare), clean(mark.thoroughfare)]
        .filter((part) => part.length > 0)
        .join(" ");
    }
    const city = clean(postal.city) || clean(mark.locality);
    const state = clean(postal.state) || clean(mark.administrativeArea);
    const zip = clean(postal.postalCode) || clean(mark.postalCode);
    const stateZip = [state, zip].filter((part) => part.length > 0).join(" ");
    const parts = [street, city, stateZip].filter(
      (part) => part.length > 0,
    );
    return parts.length > 0 ? parts.join(", ") : null;
  }

  hasNonEmptyValue(value) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) {
      return value.some((item) => this.hasNonEmptyValue(item));
    }
    return String(value).trim().length > 0;
  }

  parseBoolean(value) {
    if (value === null || value === undefined || value === "") return null;
    const normalized = String(value).toLowerCase().trim();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
    return null;
  }

  getQueryValue(queryParameters, keys) {
    if (!queryParameters || typeof queryParameters !== "object") {
      return null;
    }
    for (const key of keys) {
      if (queryParameters[key] !== undefined && queryParameters[key] !== null) {
        const value = queryParameters[key];
        if (this.hasNonEmptyValue(value)) {
          return Array.isArray(value) ? value[0] : value;
        }
      }
    }
    return null;
  }

  getUrlInputPayload() {
    const queryParameters = this.runtimeContext?.queryParameters || {};
    if (!queryParameters || Object.keys(queryParameters).length === 0) {
      return null;
    }
    return this.buildInputPayloadFromQuery(queryParameters, "url-scheme");
  }

  buildInputPayloadFromQuery(queryParameters, source) {
    if (!queryParameters || typeof queryParameters !== "object") {
      return null;
    }

    const reservedKeys = new Set([
      "scriptname",
      "script",
      "action",
      "callback",
      "callbackurl",
      "xsuccess",
      "xerror",
      "xcancel",
      "xsource",
      "openeditor",
      "event",
      "eventjson",
      "payload",
      "data",
    ]);
    const hasEventFields = Object.entries(queryParameters).some(
      ([key, value]) => {
        const normalizedKey = String(key)
          .toLowerCase()
          .replace(/[\s\-_]/g, "");
        if (reservedKeys.has(normalizedKey)) {
          return false;
        }
        return this.hasNonEmptyValue(value);
      },
    );

    if (!hasEventFields) {
      return null;
    }

    return {
      queryParameters,
      receivedAt: new Date().toISOString(),
      source: source || "input",
    };
  }

  parseJsonValue(rawValue) {
    if (rawValue === null || rawValue === undefined) {
      return null;
    }
    if (typeof rawValue === "object") {
      return rawValue;
    }
    if (typeof rawValue !== "string") {
      return null;
    }
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return null;
    }
  }

  extractQueryParametersFromJson(jsonValue) {
    if (
      !jsonValue ||
      typeof jsonValue !== "object" ||
      Array.isArray(jsonValue)
    ) {
      return null;
    }

    if (
      jsonValue.queryParameters &&
      typeof jsonValue.queryParameters === "object"
    ) {
      return jsonValue.queryParameters;
    }
    if (jsonValue.query && typeof jsonValue.query === "object") {
      return jsonValue.query;
    }
    if (jsonValue.params && typeof jsonValue.params === "object") {
      return jsonValue.params;
    }
    if (jsonValue.event && typeof jsonValue.event === "object") {
      return jsonValue.event;
    }

    return jsonValue;
  }

  getJsonInputPayloadCandidates() {
    const candidates = [];
    const shortcutValue = this.runtimeContext?.shortcutParameter;
    const shortcutParsed = this.parseJsonValue(shortcutValue);
    const shortcutParameters =
      this.extractQueryParametersFromJson(shortcutParsed);
    if (shortcutParameters) {
      candidates.push({
        queryParameters: shortcutParameters,
        source: "shortcutParameter",
      });
    }

    const plainTexts = this.runtimeContext?.plainTexts;
    if (Array.isArray(plainTexts)) {
      for (const plainText of plainTexts) {
        const parsed = this.parseJsonValue(plainText);
        const queryParameters = this.extractQueryParametersFromJson(parsed);
        if (queryParameters) {
          candidates.push({
            queryParameters,
            source: "plainTexts",
          });
          break;
        }
      }
    }

    return candidates;
  }

  getJsonInputPayload() {
    const candidates = this.getJsonInputPayloadCandidates();
    for (const candidate of candidates) {
      const payload = this.buildInputPayloadFromQuery(
        candidate.queryParameters,
        candidate.source,
      );
      if (payload) {
        return payload;
      }
    }
    return null;
  }

  getParserNameFromParams(queryParameters) {
    if (!queryParameters || typeof queryParameters !== "object") {
      return null;
    }

    const parserName = this.getQueryValue(queryParameters, [
      "parserName",
      "parser",
      "parser_name",
    ]);

    if (!this.hasNonEmptyValue(parserName)) {
      return null;
    }

    return String(parserName).trim();
  }

  getParserNameOverrideFromQuery() {
    const queryParameters = this.runtimeContext?.queryParameters || {};
    return this.getParserNameFromParams(queryParameters);
  }

  getParserNameOverrideFromJson() {
    const candidates = this.getJsonInputPayloadCandidates();
    for (const candidate of candidates) {
      const parserName = this.getParserNameFromParams(
        candidate.queryParameters,
      );
      if (parserName) {
        return parserName;
      }
    }
    return null;
  }

  parseAutomationMode(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const parsedBoolean = this.parseBoolean(value);
    if (parsedBoolean !== null) {
      return parsedBoolean;
    }
    const normalized = String(value).toLowerCase().trim();
    if (
      [
        "auto",
        "automated",
        "automation",
        "schedule",
        "scheduled",
        "cron",
      ].includes(normalized)
    ) {
      return true;
    }
    if (["manual", "interactive"].includes(normalized)) {
      return false;
    }
    return null;
  }

  getAutomationFlagFromParams(queryParameters) {
    if (!queryParameters || typeof queryParameters !== "object") {
      return null;
    }
    const automationValue = this.getQueryValue(queryParameters, [
      "automation",
      "automated",
      "auto",
      "runMode",
      "run_mode",
      "mode",
      "schedule",
      "scheduled",
    ]);
    return this.parseAutomationMode(automationValue);
  }

  getAutomationOverrideFromQuery() {
    const queryParameters = this.runtimeContext?.queryParameters || {};
    return this.getAutomationFlagFromParams(queryParameters);
  }

  getAutomationOverrideFromJson() {
    const candidates = this.getJsonInputPayloadCandidates();
    for (const candidate of candidates) {
      const automationOverride = this.getAutomationFlagFromParams(
        candidate.queryParameters,
      );
      if (automationOverride !== null) {
        return automationOverride;
      }
    }
    return null;
  }

  normalizeParserName(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  buildParserNameOverrideConfig(parserName, config) {
    if (!config || !Array.isArray(config.parsers)) {
      throw new Error("Configuration missing parsers array");
    }

    const normalizedTarget = this.normalizeParserName(parserName);
    const matchingParser = config.parsers.find((parser) => {
      const name = parser && parser.name ? parser.name : "";
      return this.normalizeParserName(name) === normalizedTarget;
    });

    if (!matchingParser) {
      const availableParsers = config.parsers
        .map((parser) => (parser && parser.name ? parser.name : ""))
        .filter((name) => this.hasNonEmptyValue(name));
      const availableLabel =
        availableParsers.length > 0 ? availableParsers.join(", ") : "(none)";
      throw new Error(
        `Parser "${parserName}" not found in scraper-input.js. Available parsers: ${availableLabel}`,
      );
    }

    return {
      parserConfig: {
        ...matchingParser,
        enabled: true,
      },
    };
  }

  parseUrlInputOptions(queryParameters) {
    const options = {};

    const allowPastEventsValue = this.getQueryValue(queryParameters, [
      "allowPastEvents",
      "allow_past_events",
      "allowPast",
    ]);
    const allowPastEvents = this.parseBoolean(allowPastEventsValue);
    if (allowPastEvents !== null) {
      options.allowPastEvents = allowPastEvents;
    }

    const alwaysBearValue = this.getQueryValue(queryParameters, [
      "alwaysBear",
      "always_bear",
    ]);
    const alwaysBear = this.parseBoolean(alwaysBearValue);
    if (alwaysBear !== null) {
      options.alwaysBear = alwaysBear;
    }

    const dryRunValue = this.getQueryValue(queryParameters, [
      "dryRun",
      "dry_run",
    ]);
    const dryRun = this.parseBoolean(dryRunValue);
    if (dryRun !== null) {
      options.dryRun = dryRun;
    }

    const daysToLookAheadValue = this.getQueryValue(queryParameters, [
      "daysToLookAhead",
      "days_to_look_ahead",
      "days",
    ]);
    if (daysToLookAheadValue !== null && daysToLookAheadValue !== undefined) {
      const parsedDays = Number(daysToLookAheadValue);
      if (Number.isFinite(parsedDays)) {
        options.daysToLookAhead = parsedDays;
      }
    }

    const keyTemplate = this.getQueryValue(queryParameters, [
      "keyTemplate",
      "key_template",
      "keyFormat",
      "key_format",
    ]);
    if (this.hasNonEmptyValue(keyTemplate)) {
      options.keyTemplate = String(keyTemplate).trim();
    }

    return options;
  }

  buildUrlInputParserConfig(urlInput) {
    const queryParameters = urlInput?.queryParameters || {};
    const options = this.parseUrlInputOptions(queryParameters);
    const alwaysBear =
      typeof options.alwaysBear === "boolean" ? options.alwaysBear : true;

    const parserConfig = {
      name: "Scriptable URL Input",
      enabled: true,
      // "auto" resolves scriptable-input:// to the scriptable-input parser via URL
      // detection (an absent parser key would pin the default ai-web parser instead)
      parser: "auto",
      urls: ["scriptable-input://event"],
      alwaysBear: alwaysBear,
      allowPastEvents: options.allowPastEvents === true,
      urlDiscoveryDepth: 0,
      maxAdditionalUrls: 0,
      input: urlInput,
    };

    if (options.keyTemplate) {
      parserConfig.keyTemplate = options.keyTemplate;
    }

    return {
      parserConfig,
      configOverrides: options,
    };
  }

  // Configuration Loading
  async loadConfiguration() {
    try {
      const fm = FileManager.iCloud();
      const scriptableDir = fm.documentsDirectory();
      const parserNameFromQuery = this.getParserNameOverrideFromQuery();
      let parserNameOverride = parserNameFromQuery;
      let urlInput = null;
      const automationOverrideFromQuery = this.getAutomationOverrideFromQuery();
      const automationOverrideFromJson =
        automationOverrideFromQuery === null
          ? this.getAutomationOverrideFromJson()
          : null;
      const automationOverride =
        automationOverrideFromQuery !== null
          ? automationOverrideFromQuery
          : automationOverrideFromJson;
      const baseRuntimeContext =
        this.runtimeContext || this.getScriptableRuntimeContext();
      const automationRun =
        typeof automationOverride === "boolean"
          ? automationOverride
          : baseRuntimeContext.type === "automated";
      this.runtimeContext = this.applyAutomationRunContext(
        baseRuntimeContext,
        automationRun,
        automationOverride,
      );

      if (!parserNameOverride) {
        urlInput = this.getUrlInputPayload();
      }

      if (!parserNameOverride && !urlInput) {
        parserNameOverride = this.getParserNameOverrideFromJson();
      }

      if (!parserNameOverride && !urlInput) {
        urlInput = this.getJsonInputPayload();
      }

      const loadConfigFile = (
        fileName,
        moduleName,
        missingMessage,
        emptyMessage,
        options = {},
      ) => {
        const configPath = fm.joinPath(scriptableDir, fileName);

        if (!fm.fileExists(configPath)) {
          if (options.optional) {
            return null;
          }
          console.error(
            `📱 Scriptable: ✗ Configuration file not found at: ${configPath}`,
          );
          // List files in directory for debugging
          try {
            const files = fm.listContents(scriptableDir);
            console.log(
              `📱 Scriptable: Files in ${scriptableDir}: ${JSON.stringify(files)}`,
            );
          } catch (listError) {
            console.log(
              `📱 Scriptable: ✗ Failed to list directory contents: ${listError.message}`,
            );
          }
          throw new Error(missingMessage);
        }

        const configText = fm.readString(configPath);

        if (!configText || configText.trim().length === 0) {
          throw new Error(emptyMessage);
        }

        // Use importModule to load the JS configuration file
        const configModule = importModule(moduleName);
        return configModule || eval(configText);
      };

      let config = loadConfigFile(
        "scraper-input.js",
        "scraper-input",
        "Configuration file not found at iCloud Drive/Scriptable/scraper-input.js",
        "Configuration file is empty",
        { optional: Boolean(urlInput) && !parserNameOverride },
      );

      if (!config && urlInput) {
        const inputSource = urlInput.source || "input";
        const label = inputSource === "url-scheme" ? "URL" : inputSource;
        console.log(
          `📱 Scriptable: Using ${label} input without scraper-input.js`,
        );
        config = {
          config: {
            dryRun: true,
            daysToLookAhead: null,
          },
          parsers: [],
        };
      }

      const cities = loadConfigFile(
        "scraper-cities.js",
        "scraper-cities",
        "City configuration file not found at iCloud Drive/Scriptable/scraper-cities.js",
        "City configuration file is empty",
      );

      config.cities = cities;

      const bars = loadConfigFile(
        "scraper-bars.js",
        "scraper-bars",
        "Bars configuration file not found at iCloud Drive/Scriptable/scraper-bars.js",
        "Bars configuration file is empty",
        { optional: true },
      );

      config.bars = bars || {};

      const promoters = loadConfigFile(
        "scraper-promoters.js",
        "scraper-promoters",
        "Promoters configuration file not found at iCloud Drive/Scriptable/scraper-promoters.js",
        "Promoters configuration file is empty",
        { optional: true },
      );

      config.promoters = promoters || [];

      if (parserNameOverride) {
        const { parserConfig } = this.buildParserNameOverrideConfig(
          parserNameOverride,
          config,
        );
        config.parsers = [parserConfig];
        console.log(
          `📱 Scriptable: Parser override detected - running "${parserConfig.name}"`,
        );
      } else if (urlInput) {
        const { parserConfig, configOverrides } =
          this.buildUrlInputParserConfig(urlInput);
        config.parsers = [parserConfig];

        if (!config.config || typeof config.config !== "object") {
          config.config = { dryRun: true, daysToLookAhead: null };
        }
        if (typeof configOverrides.dryRun === "boolean") {
          config.config.dryRun = configOverrides.dryRun;
        }
        if (Number.isFinite(configOverrides.daysToLookAhead)) {
          config.config.daysToLookAhead = configOverrides.daysToLookAhead;
        }

        const inputSource = urlInput.source || "input";
        const label = inputSource === "url-scheme" ? "URL" : inputSource;
        console.log(
          `📱 Scriptable: ${label} input detected - using scriptable input parser`,
        );
      }

      // Validate configuration structure
      if (!config.parsers || !Array.isArray(config.parsers)) {
        throw new Error("Configuration missing parsers array");
      }

      if (!config.cities || typeof config.cities !== "object") {
        throw new Error("Configuration missing cities data");
      }

      const automationFilter =
        automationRun && !parserNameOverride && !urlInput;
      config.runtime = {
        ...this.runtimeContext,
        automationRun: automationRun === true,
        automationOverride,
        automationFilter,
      };
      if (automationRun) {
        const filterLabel = automationFilter ? "enabled" : "disabled";
        console.log(
          `📱 Scriptable: Automation run detected (schedule ${filterLabel})`,
        );
      }

      if (
        !parserNameOverride &&
        !urlInput &&
        this.shouldPresentParserPicker(config)
      ) {
        // Total captured before the selection replaces the array
        const parserPickerTotal = config.parsers.length;
        const picked = await this.presentParserPicker(config);
        config.parsers = this.applyParserPickerOutcome(
          config.parsers,
          picked,
          parserPickerTotal,
        );
      }

      this.applyLogConfig(config);

      return config;
    } catch (error) {
      console.log(
        `📱 Scriptable: ✗ Failed to load configuration: ${error.message}`,
      );
      throw new Error(`Configuration loading failed: ${error.message}`);
    }
  }

  // Standalone bars-config loader for the calendar reviewer: same file, same
  // module name, and the same optional semantics as loadConfiguration's
  // scraper-bars.js load above (the scraper reads it into config.bars). The
  // reviewer has no scraper-input.js run, so it loads bars directly; a
  // missing/empty/broken file degrades to {} — bar matching simply finds
  // nothing.
  async loadBarsConfiguration() {
    try {
      const fm = FileManager.iCloud();
      const scriptableDir = fm.documentsDirectory();
      const configPath = fm.joinPath(scriptableDir, "scraper-bars.js");
      if (!fm.fileExists(configPath)) {
        return {};
      }
      const configText = fm.readString(configPath);
      if (!configText || configText.trim().length === 0) {
        return {};
      }
      const configModule = importModule("scraper-bars");
      return configModule || eval(configText) || {};
    } catch (error) {
      console.log(
        `📱 Scriptable: Bars configuration load failed (${error.message}) — continuing without curated bar data`,
      );
      return {};
    }
  }

  // One bars URL → parsed JSON, or null on any failure (404, offline,
  // unparseable body). Bars URLs carry their own 1-day cache TTL — read that
  // cache first, keep fetchData's global-TTL cache out of the way, and write
  // back explicitly.
  async fetchRemoteBarsJson(url, barsCacheConfig) {
    try {
      let body = null;
      const cached = await this.readCachedPage(url, barsCacheConfig);
      if (cached && typeof cached.html === "string") {
        body = cached.html;
      } else {
        const responseData = await this.fetchData(url, {
          headers: { Accept: "application/json" },
          isCacheableResponse: () => false,
        });
        if (responseData && typeof responseData.html === "string") {
          body = responseData.html;
          await this.writeCachedPage(url, responseData, barsCacheConfig);
        }
      }
      return body ? JSON.parse(body) : null;
    } catch (error) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Recurring-series detection (merge safety). Scriptable exposes NO
  // recurrence reads on CalendarEvent, so occurrences of a series are
  // individually indistinguishable from normal events — a narrow search
  // window can see exactly ONE instance of a MONTHLY series and let it
  // masquerade as a normal event. Two adapter-side layers close the hole
  // when SharedCore's own signals (notes `recurrence:` key, identifier RID
  // patterns, multi-instance UID in the candidate set) have not fired:
  //   1. Published calendar ICS: CI publishes each calendar to
  //      https://chunky.dad/data/calendars/<cityKey>.ics with RRULEs intact,
  //      and the identifier suffix after the first colon IS the ICS UID
  //      verbatim — an authoritative series lookup.
  //   2. Fallback: ONE targeted wide-window identifier probe
  //      (CalendarEvent.between over now-35d..now+70d) — ≥2 instances
  //      sharing the matched identifier means a series.
  // Both layers fail open (any error → today's behavior) and cache per run.
  // ---------------------------------------------------------------------------

  // Fetch + light-scan the published calendar ICS for one city: Map of ICS
  // UID → has-RRULE, or null on any failure (callers fall back to the
  // wide-window probe). Uses the same page-cache machinery as the remote
  // bars fetch; the published file refreshes ~2-hourly, so a ~6h TTL
  // (0.25 days) keeps repeat runs cheap. Cached per run per city.
  async getPublishedRecurringUids(cityKey) {
    try {
      const key = String(cityKey || "").trim();
      if (!key) return null;
      if (!this._publishedRecurringUidsByCity) {
        this._publishedRecurringUidsByCity = {};
      }
      if (
        Object.prototype.hasOwnProperty.call(
          this._publishedRecurringUidsByCity,
          key,
        )
      ) {
        return this._publishedRecurringUidsByCity[key];
      }
      const url = `https://chunky.dad/data/calendars/${encodeURIComponent(key)}.ics`;
      const icsCacheConfig = {
        enabled: this.getPageCacheConfig().enabled,
        ttlDays: 0.25,
      };
      let body = null;
      const cached = await this.readCachedPage(url, icsCacheConfig);
      if (cached && typeof cached.html === "string") {
        body = cached.html;
      } else {
        const responseData = await this.fetchData(url, {
          headers: { Accept: "text/calendar" },
          isCacheableResponse: () => false,
        });
        if (responseData && typeof responseData.html === "string") {
          body = responseData.html;
          await this.writeCachedPage(url, responseData, icsCacheConfig);
        }
      }
      const uids = body ? SharedCore.extractRecurringUidsFromIcs(body) : null;
      this._publishedRecurringUidsByCity[key] = uids;
      return uids;
    } catch (error) {
      return null;
    }
  }

  // Targeted wide-window identifier probe (fallback layer): count calendar
  // instances sharing the matched identifier across now-35d..now+70d.
  // Decision logic is pure (SharedCore.resolveSeriesProbeDecision).
  async probeSeriesByWideWindow(identifier, cityKey, title) {
    try {
      const calendarName = this.getCalendarName(cityKey || "default");
      const calendar = await this.getOrCreateCalendar(calendarName);
      const now = new Date();
      const windowStart = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + 70 * 24 * 60 * 60 * 1000);
      const instances = await CalendarEvent.between(windowStart, windowEnd, [
        calendar,
      ]);
      const decision = SharedCore.resolveSeriesProbeDecision(
        instances,
        identifier,
      );
      if (decision.isSeries) {
        console.log(
          `🔁 RECURRING: series detected via wide-window identifier probe for "${title}" (${decision.instanceCount} instances)`,
        );
      }
      return decision.isSeries;
    } catch (error) {
      // Fail open — probe errors never change merge behavior.
      return false;
    }
  }

  // SharedCore calls this (when defined) after a scraped event merge-matched
  // an existing calendar event WITHOUT any series signal firing. Decision
  // ordering: published calendar ICS first (authoritative both ways — a UID
  // present WITHOUT an RRULE is confirmed NOT a series and skips the probe),
  // then the wide-window identifier probe. Cached per identifier per run;
  // fails open.
  async probeRecurringSeries(existingEvent, scrapedEvent = null) {
    try {
      const identifier =
        existingEvent && existingEvent.identifier
          ? String(existingEvent.identifier).trim()
          : "";
      if (!identifier) return false;
      if (!this._seriesProbeCache) this._seriesProbeCache = {};
      if (
        Object.prototype.hasOwnProperty.call(this._seriesProbeCache, identifier)
      ) {
        return this._seriesProbeCache[identifier];
      }
      const title =
        (existingEvent && existingEvent.title) ||
        (scrapedEvent && scrapedEvent.title) ||
        "Unknown";
      const cityKey =
        (scrapedEvent && scrapedEvent.city) ||
        (existingEvent && existingEvent.city) ||
        "";
      let decision = null;

      // Layer 1: published calendar ICS lookup.
      const uid = SharedCore.extractIcsUidFromIdentifier(identifier);
      if (uid) {
        const publishedUids = await this.getPublishedRecurringUids(cityKey);
        if (publishedUids instanceof Map && publishedUids.has(uid)) {
          if (publishedUids.get(uid) === true) {
            console.log(
              `🔁 RECURRING: series confirmed via published calendar ICS for "${title}"`,
            );
            decision = true;
          } else {
            decision = false;
          }
        }
      }

      // Layer 2 (fallback): wide-window identifier probe.
      if (decision === null) {
        decision = await this.probeSeriesByWideWindow(
          identifier,
          cityKey,
          title,
        );
      }
      this._seriesProbeCache[identifier] = decision === true;
      return this._seriesProbeCache[identifier];
    } catch (error) {
      console.warn(
        `📱 Scriptable: Recurring series probe failed (fail open): ${error.message}`,
      );
      return false;
    }
  }

  // Bar data merged on the website is the source of truth; the phone's local
  // scraper-bars.js copy goes stale the moment a bar edit lands. Try the
  // combined file FIRST — one fetch of data/scraper-bars.json covers every
  // city (the scraper can't know its cities before parsing assigns them, and
  // per-city fetching would mean ~45 requests with many 404s on a fresh
  // day) — and fall back to the per-city files (data/bars/<city>.json) when
  // the combined fetch fails. cityKeys is the array of cities to refresh, or
  // null for "all cities". Each remote-served city is a per-city UNION with
  // the local list (mergeRemoteAndLocalCityBars: remote wins for a shared
  // bar-name key, local-only bars are appended), local-only cities are kept
  // as fallback entries (per-city fetching is impossible without a city
  // list, so a combined failure returns the local bars unchanged). Any
  // per-city failure quietly keeps the local entry. Returns
  // { bars, counts } — counts feed the review UI's
  // freshness line (remote = cities served from website data, combined or
  // per-city; local = kept from the local file; unavailable = neither).
  // The bar-name identity key — mirrors SharedCore.normalizeBarNameKey
  // (shared-core is not importable from the adapter layer): lowercase, drop
  // a leading "the ", strip non-alphanumerics.
  normalizeRemoteBarNameKey(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/^\s*the\s+/, "")
      .replace(/[^a-z0-9]/g, "");
  }

  // Per-city UNION of remote and local bar lists (mirrors tools/sync-bars.js
  // mergeBars semantics; curated-data-beats-derived, fail closed): remote
  // entries win for a shared bar-name key (freshest enrichment), local-only
  // entries are appended — a bar curated in the local scraper-bars.js must
  // survive until the site deploys it (run 20260724-122902: the wholesale
  // replace discarded the locally curated "Legacy" through a 1-day cache).
  // Nameless local entries have no identity key and are skipped.
  mergeRemoteAndLocalCityBars(remoteList, localList) {
    const merged = Array.isArray(remoteList) ? remoteList.slice() : [];
    const seenKeys = new Set(
      merged
        .map((bar) => this.normalizeRemoteBarNameKey(bar && bar.name))
        .filter(Boolean),
    );
    let appended = 0;
    for (const bar of Array.isArray(localList) ? localList : []) {
      const key = this.normalizeRemoteBarNameKey(bar && bar.name);
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);
      merged.push(bar);
      appended += 1;
    }
    return { merged, appended };
  }

  async refreshRemoteBars(cityKeys, localBars) {
    const merged = {
      ...(localBars && typeof localBars === "object" ? localBars : {}),
    };
    const counts = { remote: 0, local: 0, unavailable: 0 };
    let localOnlyMerged = 0;
    const barsCacheConfig = {
      enabled: this.getPageCacheConfig().enabled,
      ttlDays: 1,
    };
    const combinedRaw = await this.fetchRemoteBarsJson(
      "https://chunky.dad/data/scraper-bars.json",
      barsCacheConfig,
    );
    // Same staleness rule as the promoter registry: a scraper-bars.js pulled
    // to the phone AFTER the cached site copy was fetched is the fresher
    // curation for shared bar names, until the cache expires.
    const barsCachedAt = this.getCachedPageFetchedAt(
      "https://chunky.dad/data/scraper-bars.json",
      barsCacheConfig,
    );
    const localBarsModifiedAt = this.getLocalModuleModifiedAt("scraper-bars.js");
    const localBarsAreNewer = Boolean(
      barsCachedAt && localBarsModifiedAt
        && localBarsModifiedAt.getTime() > barsCachedAt.getTime(),
    );
    if (localBarsAreNewer) {
      console.log(
        `📱 Scriptable: Bars data — local scraper-bars.js is newer than the cached site copy; local entries win`,
      );
    }
    // The combined file is an object keyed by city — an array (or any other
    // shape) is not usable and falls back to the per-city path.
    const combinedBars =
      combinedRaw &&
      typeof combinedRaw === "object" &&
      !Array.isArray(combinedRaw)
        ? combinedRaw
        : null;
    if (combinedBars) {
      const keys =
        cityKeys === null
          ? Object.keys({ ...merged, ...combinedBars })
          : Array.isArray(cityKeys)
            ? cityKeys.filter(Boolean)
            : [];
      for (const cityKey of keys) {
        if (Array.isArray(combinedBars[cityKey])) {
          const union = localBarsAreNewer
            ? this.mergeRemoteAndLocalCityBars(
                merged[cityKey],
                combinedBars[cityKey],
              )
            : this.mergeRemoteAndLocalCityBars(
                combinedBars[cityKey],
                merged[cityKey],
              );
          merged[cityKey] = union.merged;
          localOnlyMerged += union.appended;
          counts.remote += 1;
        } else if (merged[cityKey]) {
          counts.local += 1;
        } else {
          counts.unavailable += 1;
        }
      }
    } else if (cityKeys === null) {
      // No combined file and no city list to fetch per city — keep the local
      // bars and let the counts say so.
      counts.local = Object.keys(merged).length;
    } else {
      const keys = Array.isArray(cityKeys) ? cityKeys.filter(Boolean) : [];
      for (const cityKey of keys) {
        const url = `https://chunky.dad/data/bars/${encodeURIComponent(cityKey)}.json`;
        const parsed = await this.fetchRemoteBarsJson(url, barsCacheConfig);
        if (Array.isArray(parsed)) {
          const union = localBarsAreNewer
            ? this.mergeRemoteAndLocalCityBars(merged[cityKey], parsed)
            : this.mergeRemoteAndLocalCityBars(parsed, merged[cityKey]);
          merged[cityKey] = union.merged;
          localOnlyMerged += union.appended;
          counts.remote += 1;
        } else if (merged[cityKey]) {
          counts.local += 1;
        } else {
          counts.unavailable += 1;
        }
      }
    }
    console.log(
      `📱 Scriptable: Bars data — ${counts.remote} cities from chunky.dad, ${counts.local} from local file, ${counts.unavailable} unavailable`,
    );
    // Additive line (the freshness line above keeps its exact shape): how
    // many locally curated bars were appended to remote-served cities.
    if (localOnlyMerged > 0) {
      console.log(
        `📱 Scriptable: Bars data — merged ${localOnlyMerged} local-only bar(s)`,
      );
    }
    return { bars: merged, counts };
  }

  // Union of the remote and local promoter registries (mirrors
  // mergeRemoteAndLocalCityBars; curated-data-beats-derived, fail closed):
  // remote entries win for a shared promoter-name key (freshest curation),
  // local-only entries are appended so a locally curated promoter survives
  // until the site deploys it. Nameless entries have no identity key and are
  // skipped.
  mergeRemoteAndLocalPromoters(remoteList, localList) {
    const merged = Array.isArray(remoteList) ? remoteList.slice() : [];
    const seenKeys = new Set(
      merged
        .map((promoter) => this.normalizeRemoteBarNameKey(promoter && promoter.name))
        .filter(Boolean),
    );
    let appended = 0;
    for (const promoter of Array.isArray(localList) ? localList : []) {
      const key = this.normalizeRemoteBarNameKey(promoter && promoter.name);
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);
      merged.push(promoter);
      appended += 1;
    }
    return { merged, appended };
  }


  // Modification time of a file in the Scriptable Documents directory, or null.
  // Used to decide whether a freshly PULLED local registry should outrank a
  // remote copy that is being served from cache.
  getLocalModuleModifiedAt(fileName) {
    try {
      const fm = FileManager.iCloud();
      const filePath = fm.joinPath(fm.documentsDirectory(), fileName);
      if (!fm.fileExists(filePath)) return null;
      const modifiedAt = fm.modificationDate(filePath);
      return modifiedAt instanceof Date && !Number.isNaN(modifiedAt.getTime())
        ? modifiedAt
        : null;
    } catch (_) {
      return null;
    }
  }

  // When was the cached copy of `url` fetched? Null when there is no cache
  // entry (i.e. the next read will hit the network and is authoritative).
  getCachedPageFetchedAt(url, pageCacheConfig) {
    try {
      if (!pageCacheConfig || !pageCacheConfig.enabled) return null;
      const { hostDir, fileName } = this.getPageCachePathParts(url);
      const cachePath = this.fm.joinPath(
        this.fm.joinPath(this.pageStorageDir, hostDir),
        fileName,
      );
      if (!this.fm.fileExists(cachePath)) return null;
      const modifiedAt = this.fm.modificationDate(cachePath);
      return modifiedAt instanceof Date && !Number.isNaN(modifiedAt.getTime())
        ? modifiedAt
        : null;
    } catch (_) {
      return null;
    }
  }

  // Curated promoter registry merged on the website is the source of truth;
  // the phone's local scraper-promoters.js copy goes stale the moment a
  // registry edit lands. One fetch of data/promoters.json (same fetch helper
  // and 1-day TTL cache as the bars refresh); any failure — offline, 404,
  // unparseable, non-array — quietly keeps the local registry. Returns
  // { promoters, counts } for the freshness log line.
  async refreshRemotePromoters(localPromoters) {
    const local = Array.isArray(localPromoters) ? localPromoters : [];
    const promotersCacheConfig = {
      enabled: this.getPageCacheConfig().enabled,
      ttlDays: 1,
    };
    const remoteRaw = await this.fetchRemoteBarsJson(
      "https://chunky.dad/data/promoters.json",
      promotersCacheConfig,
    );
    const remote = Array.isArray(remoteRaw) ? remoteRaw : null;
    if (!remote) {
      console.log(
        `📱 Scriptable: Promoters data — 0 from chunky.dad, ${local.length} local-only`,
      );
      return { promoters: local, counts: { remote: 0, localOnly: local.length } };
    }
    // A PULLED local registry outranks a remote copy served from a stale
    // cache. The remote list is normally the freshest curation, but it is
    // cached for a day — so after pulling a registry edit to the phone, the
    // older website copy kept winning for up to 24h (Goldiloxx favicon,
    // 2026-07-30: correct in the repo, live on the site, invisible on the
    // phone). A fresh network fetch has no cache entry, so it still wins.
    const cachedAt = this.getCachedPageFetchedAt(
      "https://chunky.dad/data/promoters.json",
      promotersCacheConfig,
    );
    const localModifiedAt = this.getLocalModuleModifiedAt("scraper-promoters.js");
    const localIsNewer = Boolean(
      cachedAt && localModifiedAt && localModifiedAt.getTime() > cachedAt.getTime(),
    );
    if (localIsNewer) {
      console.log(
        `📱 Scriptable: Promoters data — local scraper-promoters.js is newer than the cached site copy; local entries win`,
      );
    }
    const union = localIsNewer
      ? this.mergeRemoteAndLocalPromoters(local, remote)
      : this.mergeRemoteAndLocalPromoters(remote, local);
    // `appended` counts whichever list lost precedence, so report it as what
    // it actually is rather than always calling it "local-only".
    const localOnly = localIsNewer
      ? Math.max(0, union.merged.length - remote.length)
      : union.appended;
    console.log(
      `📱 Scriptable: Promoters data — ${remote.length} from chunky.dad, ${localOnly} local-only`,
    );
    return {
      promoters: union.merged,
      counts: { remote: remote.length, localOnly },
    };
  }

  // Get existing events for a specific event (called by shared-core)
  async getExistingEvents(event) {
    try {
      // Determine calendar name from city
      const city = event.city || "default";
      const calendarName = this.getCalendarName(city);
      const calendar = await this.getOrCreateCalendar(calendarName);

      const coerceDate = (value) => {
        if (!value) return null;
        if (value instanceof Date) {
          return isNaN(value.getTime()) ? null : value;
        }
        const parsed = new Date(value);
        return isNaN(parsed.getTime()) ? null : parsed;
      };

      const identifierRaw =
        event && (event.identifier || event.id)
          ? String(event.identifier || event.id).trim()
          : "";
      const hasIdentifier = Boolean(identifierRaw);

      // Parse dates from formatted event
      const startDate = coerceDate(event.startDate);
      const endDate = coerceDate(event.endDate || event.startDate);
      const searchStartDate = coerceDate(event.searchStartDate);
      const searchEndDate = coerceDate(event.searchEndDate);
      const dateCandidates = hasIdentifier
        ? [searchStartDate, searchEndDate].filter(Boolean)
        : [startDate, endDate].filter(Boolean);

      if (hasIdentifier && dateCandidates.length === 0) {
        console.log(
          "📱 Scriptable: Identifier search requires searchStartDate/searchEndDate",
        );
        return [];
      }

      if (dateCandidates.length === 0) {
        return [];
      }

      const identifierLabel = identifierRaw || "(none)";
      console.log(
        `📱 Scriptable: Existing event search (hasIdentifier=${hasIdentifier}) identifier="${identifierLabel}"`,
      );
      const wildcardMatchKey =
        typeof event.matchKey === "string" ? event.matchKey : "";
      const hasWildcardMatchKey = wildcardMatchKey.includes("*");
      const relatedHint = (() => {
        if (!hasWildcardMatchKey) return "";
        const fromMatchKey = wildcardMatchKey
          .split("|")[0]
          .replace(/\*/g, "")
          .trim()
          .toLowerCase();
        if (fromMatchKey) return fromMatchKey;
        const fromTitle = String(event.title || event.name || "")
          .toLowerCase()
          .trim();
        const firstWord = fromTitle.split(/\s+/).find(Boolean) || "";
        return firstWord;
      })();

      const configuredRangeDays = Number(
        event._parserConfig?.calendarSearchRangeDays || 0,
      );
      const rangeDays =
        Number.isFinite(configuredRangeDays) && configuredRangeDays > 0
          ? configuredRangeDays
          : 2;

      const buildWindow = (date, days) => {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - days);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);
        end.setDate(end.getDate() + days);
        return { start, end };
      };

      const dedupeEventsByIdentifier = (events) => {
        const list = Array.isArray(events) ? events : [];
        if (list.length === 0) return [];
        const seen = new Set();
        const deduped = [];
        list.forEach((existingEvent) => {
          if (!existingEvent) return;
          const identifier = this.getEventIdentifier(existingEvent);
          if (identifier && seen.has(identifier)) {
            return;
          }
          if (identifier) {
            seen.add(identifier);
          }
          deduped.push(existingEvent);
        });
        return deduped;
      };

      const classifyEventsForMatching = (events) => {
        const list = Array.isArray(events) ? events : [];
        const eventMetadata = list
          .map((existingEvent) => {
            if (!existingEvent) return null;
            const identity = this.getEventOverrideIdentity(existingEvent);
            const sourceUid = this.normalizeOverrideUid(
              identity.sourceUid || this.getEventUid(existingEvent),
            );
            const startDate =
              existingEvent.startDate instanceof Date
                ? existingEvent.startDate
                : new Date(existingEvent.startDate || 0);
            const eventDateKey = this.normalizeEventDate(startDate);
            const overrideDateKey = identity.recurrenceDateKey || eventDateKey;
            return {
              event: existingEvent,
              sourceUid,
              eventDateKey,
              isOverride: Boolean(identity.overrideKey),
              overrideDateKey,
            };
          })
          .filter(Boolean);

        const overridesByUidDate = new Set();
        eventMetadata.forEach((item) => {
          if (!item.isOverride || !item.sourceUid || !item.overrideDateKey) {
            return;
          }
          overridesByUidDate.add(
            `${item.sourceUid.toLowerCase()}::${item.overrideDateKey}`,
          );
        });

        // Flatten by shadowing source events when an override exists for same uid+date.
        // Keep all unrelated occurrences so recurring series can still match non-overridden dates.
        const flattened = eventMetadata
          .filter((item) => {
            if (item.isOverride) return true;
            if (!item.sourceUid || !item.eventDateKey) return true;
            const shadowKey = `${item.sourceUid.toLowerCase()}::${item.eventDateKey}`;
            return !overridesByUidDate.has(shadowKey);
          })
          .map((item) => item.event);

        return dedupeEventsByIdentifier(flattened);
      };

      // Keep the tighter, multi-window logic scoped to identifier-based edits only.
      // For normal scraper runs, use the original single-window approach.
      if (!hasIdentifier) {
        const earliestTime = Math.min(
          ...dateCandidates.map((date) => date.getTime()),
        );
        const latestTime = Math.max(
          ...dateCandidates.map((date) => date.getTime()),
        );
        const searchStart = new Date(earliestTime);
        searchStart.setHours(0, 0, 0, 0);
        const searchEnd = new Date(latestTime);
        searchEnd.setHours(23, 59, 59, 999);
        if (Number.isFinite(configuredRangeDays) && configuredRangeDays > 0) {
          searchStart.setDate(searchStart.getDate() - configuredRangeDays);
          searchEnd.setDate(searchEnd.getDate() + configuredRangeDays);
        }
        console.log(
          `📱 Scriptable: Existing event search window: ${searchStart.toISOString()} → ${searchEnd.toISOString()}`,
        );
        const existingEvents = await CalendarEvent.between(
          searchStart,
          searchEnd,
          [calendar],
        );
        console.log(
          `📱 Scriptable: Existing events found=${existingEvents.length}`,
        );
        if (relatedHint) {
          const relatedEvents = existingEvents.filter((existing) =>
            String(existing.title || "")
              .toLowerCase()
              .includes(relatedHint),
          );
          console.log(
            `📱 Scriptable: Related existing titles for "${relatedHint}"=${relatedEvents.length}`,
          );
          relatedEvents.slice(0, 3).forEach((existing, index) => {
            const startIso =
              existing.startDate instanceof Date &&
              !isNaN(existing.startDate.getTime())
                ? existing.startDate.toISOString()
                : String(existing.startDate || "(no date)");
            console.log(
              `📱 Scriptable: Related[${index + 1}] "${existing.title || "(no title)"}" @ ${startIso}`,
            );
          });
        }
        const flattenedEvents = classifyEventsForMatching(existingEvents);
        console.log(
          `📱 Scriptable: Existing events flattened=${flattenedEvents.length} (raw=${existingEvents.length})`,
        );
        return flattenedEvents;
      }

      // Identifier edit: only use the old visible date (pre-edit).
      const primaryDates = [searchStartDate, searchEndDate].filter(Boolean);

      const windowKeys = new Set();
      const windows = [];
      primaryDates.forEach((date) => {
        const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        if (windowKeys.has(key)) return;
        windowKeys.add(key);
        windows.push(buildWindow(date, rangeDays));
      });

      console.log(
        `📱 Scriptable: Existing event search windows=${windows.length} rangeDays=${rangeDays}`,
      );

      const allEvents = [];
      for (const w of windows) {
        console.log(
          `📱 Scriptable: Window ${w.start.toISOString()} → ${w.end.toISOString()}`,
        );
        const slice = await CalendarEvent.between(w.start, w.end, [calendar]);
        if (Array.isArray(slice) && slice.length > 0) {
          allEvents.push(...slice);
        }
      }
      console.log(`📱 Scriptable: Existing events found=${allEvents.length}`);
      if (relatedHint) {
        const relatedEvents = allEvents.filter((existing) =>
          String(existing.title || "")
            .toLowerCase()
            .includes(relatedHint),
        );
        console.log(
          `📱 Scriptable: Related existing titles for "${relatedHint}"=${relatedEvents.length}`,
        );
        relatedEvents.slice(0, 3).forEach((existing, index) => {
          const startIso =
            existing.startDate instanceof Date &&
            !isNaN(existing.startDate.getTime())
              ? existing.startDate.toISOString()
              : String(existing.startDate || "(no date)");
          console.log(
            `📱 Scriptable: Related[${index + 1}] "${existing.title || "(no title)"}" @ ${startIso}`,
          );
        });
      }
      const flattenedEvents = classifyEventsForMatching(allEvents);
      console.log(
        `📱 Scriptable: Existing events flattened=${flattenedEvents.length} (raw=${allEvents.length})`,
      );
      return flattenedEvents;
    } catch (error) {
      console.log(
        `📱 Scriptable: ✗ Failed to get existing events: ${error.message}`,
      );
      return [];
    }
  }

  isEventRecurring(event) {
    if (!event || typeof event !== "object") return false;
    if (typeof event.isRecurring === "boolean") {
      return event.isRecurring;
    }
    if (
      typeof event.recurrenceRule === "string" &&
      event.recurrenceRule.trim().length > 0
    ) {
      return true;
    }
    if (
      Array.isArray(event.recurrenceRules) &&
      event.recurrenceRules.length > 0
    ) {
      return true;
    }
    const notes = String(event.notes || "").toLowerCase();
    if (notes.includes("recurrence:") || notes.includes("rrule")) {
      return true;
    }
    return false;
  }

  getEventIdentifier(event) {
    if (!event || typeof event !== "object") return "";
    const uid = this.getEventUid(event);
    const startDate =
      event.startDate instanceof Date
        ? event.startDate
        : new Date(event.startDate || 0);
    const startIso =
      startDate instanceof Date && !isNaN(startDate.getTime())
        ? startDate.toISOString()
        : "";
    const title = String(event.title || "")
      .trim()
      .toLowerCase();
    return [uid, startIso, title].join("|");
  }

  normalizeOverrideUid(value) {
    return SharedCore.normalizeOverrideUid(value);
  }

  normalizeOverrideRecurrenceId(value) {
    return SharedCore.normalizeOverrideRecurrenceId(value);
  }

  normalizeEventDate(dateInput) {
    return SharedCore.normalizeEventDate(dateInput);
  }

  buildOverrideKey(overrideUid, overrideRecurrenceId) {
    return SharedCore.buildOverrideKey(overrideUid, overrideRecurrenceId);
  }

  parseScriptableIdentifier(value) {
    if (!value) return { uid: null, recurrenceDate: null };
    const raw = String(value).trim();
    if (!raw) return { uid: null, recurrenceDate: null };
    const colonIndex = raw.indexOf(":");
    const afterColon = colonIndex >= 0 ? raw.slice(colonIndex + 1) : raw;
    const ridMatch = afterColon.match(/\/RID=(\d+)/i);
    const uid = ridMatch ? afterColon.slice(0, ridMatch.index) : afterColon;
    return {
      uid: uid && uid.length > 0 ? uid : null,
      recurrenceDate: null,
    };
  }

  parseNotesIntoFields(notes) {
    return SharedEventSchema.parseNotesIntoFields(notes);
  }

  getEventUid(event) {
    if (!event || typeof event !== "object") return "";
    const fields = this.parseNotesIntoFields(event.notes || "");
    const identifierInfo = this.parseScriptableIdentifier(
      event.identifier || "",
    );
    const uid =
      identifierInfo.uid ||
      this.normalizeOverrideUid(
        fields.uid || fields.identifier || fields.id || "",
      );
    return uid || "";
  }

  getEventOverrideIdentity(event) {
    if (!event || typeof event !== "object") {
      return {
        overrideUid: "",
        overrideRecurrenceId: "",
        overrideKey: "",
        sourceUid: "",
        recurrenceDateKey: "",
      };
    }
    const fields = this.parseNotesIntoFields(event.notes || "");
    const parsedIdentifier = this.parseScriptableIdentifier(
      event.identifier || "",
    );
    const sourceUid = this.normalizeOverrideUid(
      fields.uid ||
        fields.identifier ||
        fields.id ||
        parsedIdentifier.uid ||
        "",
    );
    const overrideUid = this.normalizeOverrideUid(
      fields.overrideUid || event.overrideUid || "",
    );
    const overrideRecurrenceId = this.normalizeOverrideRecurrenceId(
      fields.overrideRecurrenceId || event.overrideRecurrenceId || "",
    );
    const recurrenceDate =
      event.startDate instanceof Date
        ? event.startDate
        : new Date(event.startDate || 0);
    const recurrenceDateKey =
      recurrenceDate instanceof Date && !isNaN(recurrenceDate.getTime())
        ? this.normalizeEventDate(recurrenceDate)
        : "";
    return {
      overrideUid,
      overrideRecurrenceId,
      overrideKey: this.buildOverrideKey(overrideUid, overrideRecurrenceId),
      sourceUid,
      recurrenceDateKey,
    };
  }

  // Execute calendar actions determined by shared-core
  async executeCalendarActions(analyzedEvents, config) {
    if (!analyzedEvents || analyzedEvents.length === 0) {
      console.log("📱 Scriptable: No events to process");
      this.lastExecutionActionCounts = {
        create: 0,
        update: 0,
        skip: 0,
        failed: 0,
        processed: 0,
        analyzed: 0,
      };
      return 0;
    }

    try {
      console.log(
        `📱 Scriptable: Executing actions for ${analyzedEvents.length} events`,
      );

      const failedEvents = [];
      const actionCounts = { merge: [], skip: [], create: [] };
      let processedCount = 0;

      for (const event of analyzedEvents) {
        try {
          const city = event.city || "default";
          const calendarName = this.getCalendarName(city);
          const calendar = await this.getOrCreateCalendar(calendarName);

          switch (event._action) {
            case "merge": {
              const overrideUid =
                typeof event.overrideUid === "string"
                  ? event.overrideUid.trim()
                  : "";
              const overrideRecurrenceId =
                typeof event.overrideRecurrenceId === "string"
                  ? event.overrideRecurrenceId.trim()
                  : "";
              const hasOverrideUid = overrideUid.length > 0;
              const hasOverrideRecurrenceId = overrideRecurrenceId.length > 0;

              if (hasOverrideUid !== hasOverrideRecurrenceId) {
                throw new Error(
                  "Override identity requires both overrideUid and overrideRecurrenceId",
                );
              }

              if (hasOverrideUid && hasOverrideRecurrenceId) {
                const targetOverrideKey = this.buildOverrideKey(
                  overrideUid,
                  overrideRecurrenceId,
                );
                const existingKey = this.normalizeOverrideUid(
                  event._existingKey || "",
                );
                if (existingKey && existingKey !== targetOverrideKey) {
                  console.log(
                    `📱 Scriptable: Override key mismatch "${event.title}" existing=${existingKey} target=${targetOverrideKey}`,
                  );
                }
              }

              actionCounts.merge.push(event.title);
              const targetEvent = event._existingEvent;

              // Apply the final merged values (event object already contains final values)
              // Note: Scriptable cannot read or write the native CalendarEvent.url field,
              // so URL data is stored exclusively as "website:" in notes.
              targetEvent.title = event.title;
              targetEvent.startDate = event.startDate;
              targetEvent.endDate = this.resolveCalendarWriteEndDate(event);
              targetEvent.location = event.location;
              targetEvent.notes = event.notes;

              await targetEvent.save();
              processedCount++;
              break;
            }

            case "conflict":
              actionCounts.skip.push(event.title);
              break;

            case "new":
              actionCounts.create.push(event.title);

              await this.createCalendarEvent(event, calendar);
              processedCount++;
              break;
          }
        } catch (error) {
          failedEvents.push({ title: event.title, error: error.message });
        }
      }

      // Log smart summary of actions and results
      const totalActions = Object.values(actionCounts).reduce(
        (sum, arr) => sum + arr.length,
        0,
      );
      if (totalActions > 0) {
        const actionSummary = [];
        if (actionCounts.create.length > 0)
          actionSummary.push(`${actionCounts.create.length} created`);
        if (actionCounts.merge.length > 0)
          actionSummary.push(`${actionCounts.merge.length} merged`);
        if (actionCounts.skip.length > 0)
          actionSummary.push(`${actionCounts.skip.length} skipped`);

        console.log(
          `📱 Scriptable: ✓ Processed ${processedCount} events: ${actionSummary.join(", ")}`,
        );
      }

      if (failedEvents.length > 0) {
        console.log(
          `📱 Scriptable: ✗ Failed to process ${failedEvents.length} events: ${failedEvents.map((f) => f.title).join(", ")}`,
        );
        // Log first error for debugging
        console.log(`📱 Scriptable: First error: ${failedEvents[0].error}`);
      }

      this.lastExecutionActionCounts = {
        create: actionCounts.create.length,
        update: actionCounts.merge.length,
        skip: actionCounts.skip.length,
        failed: failedEvents.length,
        processed: processedCount,
        analyzed: analyzedEvents.length,
      };

      return processedCount;
    } catch (error) {
      this.lastExecutionActionCounts = null;
      console.log(
        `📱 Scriptable: ✗ Calendar execution error: ${error.message}`,
      );
      throw new Error(`Calendar execution failed: ${error.message}`);
    }
  }

  // The endDate this adapter is willing to WRITE for an event.
  //
  // An INVERTED span (endDate strictly before startDate) is never written:
  // EventKit refuses to save it, the rejection lands in the caller's catch as
  // a "failed" event, and a real night is silently lost. Such an end is a
  // normalization artifact, not data (SharedCore.hasDegenerateEnd has said so
  // on the merge paths since those rules were written — the create path just
  // never consulted it), so it is discarded and the start is written instead.
  //
  // A ZERO-LENGTH span (endDate === startDate) is written through UNCHANGED,
  // deliberately. EKEvent has no way to represent "no end stated" — an end
  // date is mandatory — so `end === start` IS that statement on this platform,
  // and 48 of the 134 events analyzed on 2026-08-02 are exactly that case
  // (Eagle LA flyers reading "BAR OPENS 2PM" / "9PM EVERY SUNDAY" with no
  // closing time anywhere on the page). Inventing a duration would fabricate
  // data and dropping the event would lose a real night; both shapes are
  // instead surfaced report-only by SharedCore.getEventSanityFlags as
  // `end-not-after-start`.
  resolveCalendarWriteEndDate(event) {
    // Coerced, never `instanceof` — Scriptable hands every module its own Date
    // constructor, so a Date built in shared-core fails `instanceof Date` here.
    const toMs = (value) => {
      if (value === null || value === undefined || value === "") return null;
      const ms = new Date(value).getTime();
      return Number.isNaN(ms) ? null : ms;
    };
    const startMs = toMs(event && event.startDate);
    const endMs = toMs(event && event.endDate);
    if (startMs !== null && endMs !== null && endMs < startMs) {
      console.log(
        `📱 Scriptable: ⚠️ "${event?.title || "event"}" endDate is before startDate — refusing to write an inverted span, writing the start instead`,
      );
      return event.startDate;
    }
    return event.endDate;
  }

  // Helper method to create and save a calendar event
  async createCalendarEvent(event, calendar) {
    const calendarEvent = new CalendarEvent();
    calendarEvent.title = event.title;
    calendarEvent.startDate = event.startDate;
    calendarEvent.endDate = this.resolveCalendarWriteEndDate(event);
    calendarEvent.location = event.location;
    calendarEvent.notes = event.notes;
    // Note: Scriptable cannot read or write CalendarEvent.url — URL is stored as "website:" in notes.
    calendarEvent.calendar = calendar;

    const isAllDay = this.isAllDayEvent(event);
    if (isAllDay) {
      calendarEvent.isAllDay = true;
    }

    await calendarEvent.save();
    const allDayNote = isAllDay ? " (all-day)" : "";
    console.log(
      `📱 Scriptable: Created event "${event.title}" in ${calendar.title}${allDayNote}`,
    );
    return calendarEvent;
  }

  async getOrCreateCalendar(calendarName) {
    try {
      // Try to find existing calendar
      const calendars = await Calendar.forEvents();
      let calendar = calendars.find((cal) => cal.title === calendarName);

      if (!calendar) {
        // NEVER create new calendars - throw error instead
        const errorMsg = `Calendar "${calendarName}" does not exist. Please create it manually first.`;
        console.log(`📱 Scriptable: ✗ ${errorMsg}`);
        throw new Error(errorMsg);
      }

      return calendar;
    } catch (error) {
      console.log(
        `📱 Scriptable: ✗ Failed to get calendar "${calendarName}": ${error.message}`,
      );
      throw error;
    }
  }

  // ==========================================================================
  // CALENDAR REVIEWER - calendar enumeration, plain-event mapping, fix
  // application, and the interactive findings UI. Nothing here writes to a
  // calendar except applyReviewFinding, and that only runs from the UI's
  // Apply buttons (see presentReviewResults).
  // ==========================================================================

  // Candidate calendars for review: explicit titles when configured,
  // otherwise every writable calendar whose title starts with "chunky-dad".
  async getReviewCalendars(configuredTitles = []) {
    const wanted = (Array.isArray(configuredTitles) ? configuredTitles : [])
      .map((title) => String(title || "").trim())
      .filter((title) => title.length > 0);
    const calendars = await Calendar.forEvents();
    const selected = (Array.isArray(calendars) ? calendars : []).filter(
      (calendar) => {
        const title = String(calendar?.title || "");
        if (wanted.length > 0) return wanted.includes(title);
        return (
          title.startsWith("chunky-dad") &&
          calendar.allowsContentModifications !== false
        );
      },
    );
    console.log(
      `🔎 REVIEW: Reviewing ${selected.length} calendar(s): ${selected.map((calendar) => calendar.title).join(", ") || "(none)"}`,
    );
    return selected;
  }

  // Fetch events over the review window and map them to the plain objects the
  // review core consumes. The live CalendarEvent objects are kept in
  // reviewEventIndex (by finding id) so applyReviewFinding can save them.
  async getReviewCalendarEvents(calendars, windowConfig = {}) {
    const coerceDays = (value, fallback) => {
      const days = Number(value);
      return Number.isFinite(days) && days >= 0 ? days : fallback;
    };
    const lookbackDays = coerceDays(windowConfig.lookbackDays, 365);
    const lookaheadDays = coerceDays(windowConfig.lookaheadDays, 365);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - lookbackDays);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    end.setDate(end.getDate() + lookaheadDays);

    this.reviewEventIndex = {};
    const events = [];
    for (const calendar of Array.isArray(calendars) ? calendars : []) {
      const slice = await CalendarEvent.between(start, end, [calendar]);
      let mapped = 0;
      for (const item of Array.isArray(slice) ? slice : []) {
        if (!item) continue;
        const startIso =
          item.startDate instanceof Date && !isNaN(item.startDate.getTime())
            ? item.startDate.toISOString()
            : String(item.startDate || "");
        const id = String(
          item.identifier || `${calendar.title}|${item.title || ""}|${startIso}`,
        );
        // Recurring series surface one occurrence per identifier — reviewing
        // the same series once is enough (the fix saves through that object).
        if (this.reviewEventIndex[id]) continue;
        this.reviewEventIndex[id] = item;
        const fields = this.parseNotesIntoFields(item.notes || "");
        events.push({
          id,
          calendarTitle: calendar.title,
          title: item.title || "",
          startDate: item.startDate || null,
          location: typeof item.location === "string" ? item.location : "",
          address: typeof fields.address === "string" ? fields.address : "",
          bar: typeof fields.bar === "string" ? fields.bar : "",
          description:
            typeof fields.description === "string" ? fields.description : "",
        });
        mapped += 1;
      }
      console.log(
        `🔎 REVIEW: ${calendar.title} — fetched ${mapped} event(s) (${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)})`,
      );
    }
    return events;
  }

  // Replace or append a single `key: value` line in a notes blob without
  // reformatting the rest — manually created events can carry free text that
  // a full parse → format round-trip would drop.
  upsertNotesField(notes, fieldName, value) {
    const canonicalTarget = SharedEventSchema.canonicalizeEventKey(fieldName, {
      context: "notes",
    });
    const valueString = String(value);
    const formattedLine = `${fieldName}: ${
      SharedEventSchema.isUrlLikeField(fieldName, valueString)
        ? valueString
        : SharedEventSchema.escapeText(valueString)
    }`;
    const keyForLine = (line) => {
      const colonIndex = SharedEventSchema.findUnescaped(line, ":");
      if (colonIndex <= 0) return null;
      const key = SharedEventSchema.unescapeText(
        line.substring(0, colonIndex).trim(),
      );
      if (!key || !SharedEventSchema.isValidMetadataKey(key)) return null;
      return SharedEventSchema.canonicalizeEventKey(key, { context: "notes" });
    };
    const lines = String(notes || "").split("\n");
    const result = [];
    let replaced = false;
    for (let i = 0; i < lines.length; i += 1) {
      if (!replaced && keyForLine(lines[i]) === canonicalTarget) {
        result.push(formattedLine);
        replaced = true;
        // Swallow continuation lines that belonged to the replaced value
        while (
          i + 1 < lines.length &&
          lines[i + 1].trim() &&
          keyForLine(lines[i + 1]) === null
        ) {
          i += 1;
        }
        continue;
      }
      result.push(lines[i]);
    }
    if (!replaced) {
      if (result.length === 1 && result[0].trim() === "") result.pop();
      result.push(formattedLine);
    }
    return result.join("\n");
  }

  // Apply one finding: mutate ONLY the fields in `proposed` on the matching
  // CalendarEvent (location string, or the address line inside notes), then
  // save. Returns { success, appliedFields?, message? }.
  async applyReviewFinding(finding) {
    try {
      const id = finding && finding.id ? String(finding.id) : "";
      const target =
        id && this.reviewEventIndex ? this.reviewEventIndex[id] : null;
      if (!target) {
        return { success: false, message: "calendar event not found" };
      }
      const proposed =
        finding.proposed && typeof finding.proposed === "object"
          ? finding.proposed
          : {};
      const appliedFields = [];
      // Provenance for applied fixes: the reviewer knows each finding's origin
      // (finding.source === 'bar-data' → curated; otherwise the geocode verdict
      // for a pin, or a reverse-geocoded address). Stamp the source ONLY for a
      // field this finding actually wrote.
      const isBarData = finding && finding.source === "bar-data";
      if (
        typeof proposed.location === "string" &&
        proposed.location.trim().length > 0
      ) {
        target.location = proposed.location.trim();
        appliedFields.push("location");
        const pinSource = isBarData
          ? "curated"
          : finding && finding.grade === "exact" && finding.crossCheck !== "fail"
            ? "geocoded-exact"
            : "geocoded-approx";
        target.notes = this.upsertNotesField(
          target.notes || "",
          "pinSource",
          pinSource,
        );
      }
      if (
        typeof proposed.address === "string" &&
        proposed.address.trim().length > 0
      ) {
        target.notes = this.upsertNotesField(
          target.notes || "",
          "address",
          proposed.address.trim(),
        );
        // Curated bar address vs a reverse-geocoded (inferred) one.
        target.notes = this.upsertNotesField(
          target.notes || "",
          "addressSource",
          isBarData ? "curated" : "inferred",
        );
        appliedFields.push("address");
      }
      if (appliedFields.length === 0) {
        return { success: false, message: "no proposed changes" };
      }
      await target.save();
      console.log(
        `🔎 REVIEW: Applied ${appliedFields.join(" + ")} to "${finding.eventTitle}" in ${finding.calendarTitle}`,
      );
      return { success: true, appliedFields };
    } catch (error) {
      console.log(
        `🔎 REVIEW: ✗ Failed to apply finding for "${finding?.eventTitle}": ${error.message}`,
      );
      return { success: false, message: error.message };
    }
  }

  // Resolve a UI action payload to the findings it targets. Only findings
  // with an unapplied proposal are actionable.
  selectReviewFindingsForAction(payload, findings) {
    const all = Array.isArray(findings) ? findings : [];
    const actionable = (finding) =>
      finding &&
      finding.proposed &&
      Object.keys(finding.proposed).length > 0 &&
      !finding._applied &&
      !finding._applyFailed;
    if (payload && payload.action === "apply") {
      const finding = all.find(
        (candidate) => candidate && String(candidate.id) === String(payload.id),
      );
      return finding && actionable(finding) ? [finding] : [];
    }
    if (payload && payload.action === "apply-bulk") {
      if (payload.mode === "missing-only") {
        return all.filter(
          (finding) =>
            actionable(finding) &&
            (finding.status === "missing-pin" ||
              finding.status === "missing-address"),
        );
      }
      return all.filter(actionable);
    }
    return [];
  }

  formatReviewDate(value) {
    const date = value instanceof Date ? value : new Date(value || NaN);
    return isNaN(date.getTime()) ? "" : date.toDateString();
  }

  // Coordinate pin block: coords + Apple Maps link + a collapsed OpenStreetMap
  // embed whose iframe src is only assigned on first expand (keeps the page
  // light; the OSM iframe is the page's only remote resource).
  buildReviewPinHtml(pinString, eventTitle) {
    const parts = String(pinString || "")
      .split(",")
      .map((part) => part.trim());
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (parts.length !== 2 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return "";
    }
    const appleUrl = `https://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(String(eventTitle || "Event"))}`;
    const boxDegrees = 0.004; // ~400m viewport around the pin
    const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lon - boxDegrees},${lat - boxDegrees},${lon + boxDegrees},${lat + boxDegrees}&layer=mapnik&marker=${lat},${lon}`;
    return `
                <div class="pin-block">
                    <span class="pin-coords">📍 ${this.escapeHtml(`${lat}, ${lon}`)}</span>
                    <a class="pin-link" href="${this.escapeHtml(appleUrl)}"> Apple Maps</a>
                    <details class="map-details" ontoggle="loadMapFrame(this)">
                        <summary>🗺️ Map preview</summary>
                        <iframe class="osm-frame" data-src="${this.escapeHtml(embedUrl)}"></iframe>
                    </details>
                </div>`;
  }

  buildReviewFindingCard(finding, statusMeta) {
    const meta = statusMeta[finding.status] || { icon: "❓", label: finding.status };
    const current = finding.current || {};
    const proposed = finding.proposed || {};
    const hasProposal = Object.keys(proposed).length > 0;
    const dateLabel = this.formatReviewDate(finding.startDate);
    const distanceBadge =
      typeof finding.distanceKm === "number" && finding.status === "pin-moved"
        ? `<span class="distance-badge">↔️ ${finding.distanceKm.toFixed(1)} km</span>`
        : "";

    const sideHtml = (label, values, extraClass) => {
      const rows = [];
      if (values.address) {
        rows.push(
          `<div class="review-field">🏠 ${this.escapeHtml(values.address)}</div>`,
        );
      }
      if (values.location) {
        rows.push(this.buildReviewPinHtml(values.location, finding.eventTitle));
      }
      if (rows.length === 0) return "";
      return `
                <div class="review-side ${extraClass}">
                    <div class="review-side-label">${label}</div>
                    ${rows.join("\n")}
                </div>`;
    };
    const currentSide = sideHtml("Current", current, "current");
    const proposedSide = hasProposal
      ? sideHtml("Proposed", proposed, "proposed")
      : "";

    return `
            <div class="event-card review-card" data-finding-id="${this.escapeHtml(String(finding.id))}" data-status="${this.escapeHtml(finding.status)}">
                <div class="review-chip-row">
                    <span class="status-chip status-${this.escapeHtml(finding.status)}">${meta.icon} ${this.escapeHtml(meta.label)}</span>
                    ${distanceBadge}
                </div>
                <div class="event-title">${this.escapeHtml(finding.eventTitle)}</div>
                ${dateLabel ? `<div class="review-meta">📅 ${this.escapeHtml(dateLabel)}</div>` : ""}
                ${finding.detail ? `<div class="review-detail">${this.escapeHtml(finding.detail)}</div>` : ""}
                ${currentSide || proposedSide ? `<div class="review-compare">${currentSide}${proposedSide}</div>` : ""}
                ${hasProposal ? `<div class="review-actions"><button class="apply-btn" onclick="applyFinding(this)">✅ Apply</button></div>` : ""}
            </div>`;
  }

  // Rich HTML for the reviewer findings UI. Same visual language as
  // generateRichHTML (colors, cards, chips, dark mode) but fully
  // self-contained: no external fonts/scripts — the OSM embed iframes are
  // the only remote resources, and they load on first expand.
  generateReviewHTML(findings, options = {}) {
    const list = Array.isArray(findings) ? findings : [];
    const isDarkMode =
      typeof Device !== "undefined" && Device.isUsingDarkAppearance();
    const summary = SharedCore.summarizeReviewFindings(list);
    const statusMeta = {
      ok: { icon: "✅", label: "Looks right" },
      "pin-moved": { icon: "📍", label: "Pin moved" },
      "missing-pin": { icon: "➕", label: "Missing pin" },
      "missing-address": { icon: "🏠", label: "Missing address" },
      unverified: { icon: "⚠️", label: "Unverified" },
      unpinnable: { icon: "🚫", label: "Won't geocode" },
      "no-data": { icon: "❓", label: "No location data" },
    };
    const statusOrder = [
      "pin-moved",
      "missing-pin",
      "missing-address",
      "unverified",
      "unpinnable",
      "no-data",
      "ok",
    ];

    // Group findings per calendar, preserving input order
    const byCalendar = new Map();
    list.forEach((finding) => {
      if (!finding) return;
      const key = finding.calendarTitle || "(unknown calendar)";
      if (!byCalendar.has(key)) byCalendar.set(key, []);
      byCalendar.get(key).push(finding);
    });

    const summaryChips = statusOrder
      .filter((status) => summary.byStatus[status])
      .map(
        (status) =>
          `<span class="summary-chip status-${status}">${statusMeta[status].icon} ${this.escapeHtml(statusMeta[status].label)}: ${summary.byStatus[status]}</span>`,
      )
      .join("\n");

    // Bars freshness line: where the curated bar data came from this run
    // (counts from refreshRemoteBars). Absent when the caller didn't refresh.
    const barDataCount = list.filter(
      (finding) => finding && finding.source === "bar-data",
    ).length;
    const barsFreshness =
      options.barsFreshness && typeof options.barsFreshness === "object"
        ? options.barsFreshness
        : null;
    const barsFreshnessLine = barsFreshness
      ? [
          barsFreshness.remote > 0
            ? `${barsFreshness.remote} ${barsFreshness.remote === 1 ? "city" : "cities"} live from chunky.dad`
            : "",
          barsFreshness.local > 0
            ? `${barsFreshness.local} local fallback`
            : "",
          barsFreshness.unavailable > 0
            ? `${barsFreshness.unavailable} without bar data`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "";

    const sections = [];
    for (const [calendarTitle, calendarFindings] of byCalendar) {
      const okFindings = calendarFindings.filter((f) => f.status === "ok");
      const attention = calendarFindings.filter((f) => f.status !== "ok");
      const okBlock =
        okFindings.length > 0
          ? `
                <details class="ok-details">
                    <summary>✅ ${okFindings.length} event${okFindings.length === 1 ? " looks" : "s look"} right</summary>
                    <ul class="ok-list">
                        ${okFindings
                          .map(
                            (f) =>
                              `<li>${this.escapeHtml(f.eventTitle)}${this.formatReviewDate(f.startDate) ? ` — ${this.escapeHtml(this.formatReviewDate(f.startDate))}` : ""}${f.source === "bar-data" ? ` <span class="ok-bar-note">🍺 ${this.escapeHtml(f.detail || "bar data")}</span>` : ""}</li>`,
                          )
                          .join("\n")}
                    </ul>
                </details>`
          : "";
      sections.push(`
            <div class="section">
                <div class="section-header">
                    <span class="section-icon">📅</span>
                    <span class="section-title">${this.escapeHtml(calendarTitle)}</span>
                    <span class="section-count">${attention.length} finding${attention.length === 1 ? "" : "s"}</span>
                </div>
                ${okBlock}
                ${attention.map((finding) => this.buildReviewFindingCard(finding, statusMeta)).join("\n")}
            </div>`);
    }

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Calendar Reviewer</title>
    <style>
        :root {
            /* chunky.dad brand colors - light mode (matches the scraper UI) */
            --primary-color: #667eea;
            --secondary-color: #ff6b6b;
            --accent-color: #764ba2;
            --ok-color: #2ecc71;
            --warn-color: #f39c12;
            --text-primary: #333;
            --text-secondary: #666;
            --text-inverse: #ffffff;
            --background-primary: #ffffff;
            --background-light: #f8f9ff;
            --gradient-primary: linear-gradient(135deg, var(--primary-color) 0%, var(--accent-color) 100%);
            --border-color: rgba(102, 126, 234, 0.1);
            --card-shadow: 0 4px 15px rgba(0,0,0,0.08);
            --card-hover-shadow: 0 8px 25px rgba(102, 126, 234, 0.15);
        }

        ${
          isDarkMode
            ? `
        :root {
            /* Dark mode overrides for better bar/low-light readability */
            --primary-color: #8b9cf7;
            --secondary-color: #ff8a8a;
            --accent-color: #9575cd;
            --ok-color: #4cd98a;
            --warn-color: #ffb74d;
            --text-primary: #e0e0e0;
            --text-secondary: #b0b0b0;
            --text-inverse: #1a1a1a;
            --background-primary: #2d2d2d;
            --background-light: #1a1a1a;
            --gradient-primary: linear-gradient(135deg, var(--primary-color) 0%, var(--accent-color) 100%);
            --border-color: rgba(139, 156, 247, 0.2);
            --card-shadow: 0 4px 15px rgba(0,0,0,0.3);
            --card-hover-shadow: 0 8px 25px rgba(139, 156, 247, 0.25);
        }
        `
            : ""
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            margin: 0;
            padding: 20px;
            padding-bottom: calc(90px + env(safe-area-inset-bottom));
            background-color: var(--background-light);
            color: var(--text-primary);
            line-height: 1.6;
        }

        a { color: var(--primary-color); text-decoration: none; }
        a:hover { color: var(--accent-color); text-decoration: underline; }

        .header {
            background: var(--gradient-primary);
            color: var(--text-inverse);
            padding: 25px;
            border-radius: 15px;
            margin-bottom: 25px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }

        .header h1 { margin: 0; font-size: 26px; font-weight: 700; }
        .header-subtitle { font-size: 14px; opacity: 0.9; margin-top: 4px; }

        .header .stats { display: flex; gap: 30px; margin-top: 18px; }
        .stat { display: flex; flex-direction: column; text-align: center; }
        .stat-value { font-size: 30px; font-weight: 700; text-shadow: 0 2px 10px rgba(0,0,0,0.2); }
        .stat-label { font-size: 13px; opacity: 0.9; }

        .summary-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
        .bars-freshness { font-size: 12px; opacity: 0.85; margin-top: 10px; }
        .review-error-banner { background: #b3261e; color: #fff; font-size: 13px; font-weight: 600; padding: 10px 16px; }
        .ok-bar-note { opacity: 0.7; font-size: 12px; }
        .summary-chip {
            font-size: 12px;
            font-weight: 600;
            padding: 4px 12px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.18);
            border: 1px solid rgba(255, 255, 255, 0.3);
        }

        .section {
            background: var(--background-primary);
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: var(--card-shadow);
            border: 1px solid var(--border-color);
        }

        .section-header {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 12px;
            border-bottom: 2px solid var(--border-color);
        }
        .section-icon { font-size: 22px; margin-right: 10px; }
        .section-title { font-size: 18px; font-weight: 600; flex: 1; }
        .section-count {
            background: var(--gradient-primary);
            color: var(--text-inverse);
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 600;
        }

        .ok-details {
            margin-bottom: 14px;
            font-size: 14px;
            color: var(--ok-color);
        }
        .ok-details summary { cursor: pointer; font-weight: 600; }
        .ok-list { color: var(--text-secondary); font-size: 13px; margin: 8px 0 0; }

        .event-card {
            background: var(--background-primary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 14px;
            box-shadow: var(--card-shadow);
        }

        .event-title { font-size: 17px; font-weight: 600; margin: 8px 0 2px; }
        .review-meta { font-size: 13px; color: var(--text-secondary); }
        .review-detail { font-size: 13px; color: var(--text-secondary); margin-top: 6px; font-style: italic; }

        .review-chip-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
        .status-chip {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 15px;
            font-size: 12px;
            font-weight: 600;
            color: var(--text-inverse);
        }
        .status-chip.status-ok { background: var(--ok-color); }
        .status-chip.status-pin-moved { background: var(--warn-color); }
        .status-chip.status-missing-pin { background: var(--gradient-primary); }
        .status-chip.status-missing-address { background: var(--accent-color); }
        .status-chip.status-unverified { background: var(--warn-color); }
        .status-chip.status-unpinnable { background: var(--secondary-color); }
        .status-chip.status-no-data { background: var(--text-secondary); }

        .distance-badge {
            font-size: 12px;
            font-weight: 600;
            padding: 3px 10px;
            border-radius: 999px;
            border: 1px solid var(--warn-color);
            color: var(--warn-color);
        }

        .apply-state { font-size: 12px; font-weight: 600; }
        .apply-state.applied { color: var(--ok-color); }
        .apply-state.failed { color: var(--secondary-color); }

        .review-compare { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
        .review-side {
            flex: 1 1 220px;
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 10px 12px;
            font-size: 13px;
        }
        .review-side.proposed { border-color: var(--ok-color); }
        .review-side-label {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary);
            margin-bottom: 6px;
        }
        .review-side.proposed .review-side-label { color: var(--ok-color); }
        .review-field { margin-bottom: 6px; overflow-wrap: anywhere; }

        .pin-block { margin-bottom: 6px; }
        .pin-coords { font-family: ui-monospace, Menlo, monospace; font-size: 12px; margin-right: 8px; }
        .pin-link { font-size: 12px; font-weight: 600; }
        .map-details { margin-top: 6px; font-size: 12px; }
        .map-details summary { cursor: pointer; color: var(--primary-color); font-weight: 600; }
        .osm-frame {
            width: 100%;
            height: 220px;
            border: 1px solid var(--border-color);
            border-radius: 10px;
            margin-top: 6px;
        }

        .review-actions { margin-top: 12px; }
        .apply-btn {
            padding: 8px 16px;
            font-size: 14px;
            font-weight: 600;
            background: var(--gradient-primary);
            color: var(--text-inverse);
            border: none;
            border-radius: 10px;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        }
        .apply-btn:disabled { opacity: 0.55; cursor: default; }

        .review-footer {
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
            background: var(--background-primary);
            border-top: 1px solid var(--border-color);
            box-shadow: 0 -4px 15px rgba(0,0,0,0.1);
        }
        .footer-btn {
            flex: 1;
            padding: 12px 10px;
            font-size: 14px;
            font-weight: 600;
            border: 1px solid var(--primary-color);
            border-radius: 12px;
            background: var(--background-primary);
            color: var(--primary-color);
            cursor: pointer;
        }
        .footer-btn.primary {
            background: var(--gradient-primary);
            color: var(--text-inverse);
            border: none;
        }
        .footer-btn:disabled { opacity: 0.5; cursor: default; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔎 Calendar Reviewer</h1>
        <div class="header-subtitle">Geocode check — nothing changes without an Apply tap</div>
        <div class="stats">
            <div class="stat">
                <span class="stat-value">${summary.findings}</span>
                <span class="stat-label">Events Reviewed</span>
            </div>
            <div class="stat">
                <span class="stat-value">${summary.ok}</span>
                <span class="stat-label">Look Right</span>
            </div>
            <div class="stat">
                <span class="stat-value">${summary.findings - summary.ok}</span>
                <span class="stat-label">Need Attention</span>
            </div>
        </div>
        ${summaryChips ? `<div class="summary-chips">${summaryChips}</div>` : ""}
        ${barDataCount > 0 ? `<div class="bars-freshness">🍺 ${barDataCount} event${barDataCount === 1 ? "" : "s"} verified against curated bar data${barsFreshnessLine ? ` — ${this.escapeHtml(barsFreshnessLine)}` : ""}</div>` : barsFreshnessLine ? `<div class="bars-freshness">🍺 Bars: ${this.escapeHtml(barsFreshnessLine)}</div>` : ""}
    </div>
    <div id="reviewErrorBanner" class="review-error-banner" style="display:none"></div>

    ${sections.join("\n") || '<div class="section">No events found in the review window.</div>'}

    <div class="review-footer">
        <button class="footer-btn" id="missingOnlyBtn" onclick="applyBulk('missing-only')">➕ Add missing only (<span id="missingOnlyCount">0</span>)</button>
        <button class="footer-btn primary" id="applyAllBtn" onclick="applyBulk('all')">✅ Apply all (<span id="applyAllCount">0</span>)</button>
    </div>

    <script>
        // Buttons signal native via a custom-scheme navigation that the
        // Scriptable side intercepts with shouldAllowRequest (set before
        // present()) — the battle-tested webview→native pattern. The nonce
        // makes each tap a distinct navigation so repeat/identical taps still
        // fire. No evaluateJavaScript is in the critical path.
        window.__reviewNonce = 0;
        window.onerror = function (message, source, line) {
            try {
                var banner = document.getElementById('reviewErrorBanner');
                if (banner) {
                    banner.style.display = 'block';
                    banner.textContent = '⚠️ UI error: ' + message + ' (line ' + line + ')';
                }
            } catch (ignore) {}
            return false;
        };
        function reviewSignal(action, id) {
            window.location.href = 'chunkyreview://act?a=' + encodeURIComponent(action) +
                '&id=' + encodeURIComponent(id || '') + '&n=' + (window.__reviewNonce++);
        }

        function pendingCards(missingOnly) {
            var cards = document.querySelectorAll('.review-card');
            var out = [];
            for (var i = 0; i < cards.length; i++) {
                var card = cards[i];
                if (card.getAttribute('data-applied')) continue;
                if (!card.querySelector('.apply-btn')) continue;
                var status = card.getAttribute('data-status');
                if (missingOnly && status !== 'missing-pin' && status !== 'missing-address') continue;
                out.push(card);
            }
            return out;
        }

        function updateFooterCounts() {
            var all = pendingCards(false).length;
            var missing = pendingCards(true).length;
            document.getElementById('applyAllCount').textContent = all;
            document.getElementById('missingOnlyCount').textContent = missing;
            document.getElementById('applyAllBtn').disabled = all === 0;
            document.getElementById('missingOnlyBtn').disabled = missing === 0;
        }

        function applyFinding(btn) {
            var card = btn.closest('.review-card');
            if (!card) return;
            btn.disabled = true;
            btn.textContent = '⏳ Applying…';
            reviewSignal('apply', card.getAttribute('data-finding-id'));
        }

        function applyBulk(mode) {
            var cards = pendingCards(mode === 'missing-only');
            for (var i = 0; i < cards.length; i++) {
                var btn = cards[i].querySelector('.apply-btn');
                if (btn) { btn.disabled = true; btn.textContent = '⏳ Queued…'; }
            }
            reviewSignal('apply-bulk', mode);
        }

        // Called from native after each applyReviewFinding completes.
        function markFindingApplied(id, ok, message) {
            var cards = document.querySelectorAll('.review-card');
            var card = null;
            for (var i = 0; i < cards.length; i++) {
                if (cards[i].getAttribute('data-finding-id') === id) { card = cards[i]; break; }
            }
            if (!card) return;
            card.setAttribute('data-applied', ok ? 'ok' : 'failed');
            var chip = card.querySelector('.apply-state');
            if (!chip) {
                chip = document.createElement('span');
                var row = card.querySelector('.review-chip-row');
                if (row) row.appendChild(chip);
            }
            chip.className = 'apply-state ' + (ok ? 'applied' : 'failed');
            chip.textContent = ok ? '✅ Applied' : ('❌ Failed' + (message ? ': ' + message : ''));
            var btn = card.querySelector('.apply-btn');
            if (btn) { btn.disabled = true; btn.textContent = ok ? '✅ Applied' : '❌ Failed'; }
            updateFooterCounts();
        }

        // Assign the OSM iframe src on first expand only — collapsed maps
        // cost nothing.
        function loadMapFrame(details) {
            if (!details.open) return;
            var frame = details.querySelector('iframe[data-src]');
            if (frame) {
                frame.src = frame.getAttribute('data-src');
                frame.removeAttribute('data-src');
            }
        }

        updateFooterCounts();
    </script>
</body>
</html>`;
  }

  // Parse a chunkyreview:// action URL into { a, id } without `new URL` (the
  // page sends "chunkyreview://act?a=apply&id=<finding>&n=<nonce>").
  parseReviewActionUrl(url) {
    const out = { a: "", id: "" };
    const text = String(url || "");
    const q = text.indexOf("?") >= 0 ? text.slice(text.indexOf("?") + 1) : "";
    q.split("&").forEach((pair) => {
      if (!pair) return;
      const eq = pair.indexOf("=");
      const rawKey = eq >= 0 ? pair.slice(0, eq) : pair;
      const rawVal = eq >= 0 ? pair.slice(eq + 1) : "";
      let key = rawKey;
      let val = rawVal;
      try {
        key = decodeURIComponent(rawKey);
        val = decodeURIComponent(rawVal);
      } catch (error) {
        /* keep raw */
      }
      out[key] = val;
    });
    return out;
  }

  async showReviewSummaryAlert(counts) {
    try {
      const alert = new Alert();
      alert.title = "Calendar Reviewer";
      const applied = `Applied ${counts.applied} fix${counts.applied === 1 ? "" : "es"}`;
      alert.message = counts.failed
        ? `${applied}, ${counts.failed} failed.`
        : `${applied}.`;
      alert.addAction("OK");
      await alert.present();
    } catch (error) {
      /* summary alert is best-effort */
    }
  }

  // Interactive findings UI. Unlike the scraper's static WebView.loadHTML, this
  // needs page buttons to trigger native calendar writes. The reliable
  // Scriptable pattern for that is shouldAllowRequest (NOT evaluateJavaScript,
  // which is unreliable on a presented web view — a 2026-07-17 device run
  // proved a callback/poll bridge dies silently): the handler is assigned
  // BEFORE present(), fires synchronously each time a button navigates to
  // chunkyreview://…, kicks off the native apply, and returns false to cancel
  // the navigation so the page stays put. Chip feedback via evaluateJavaScript
  // is fire-and-forget polish; the authoritative confirmation is the summary
  // Alert after dismissal.
  async presentReviewResults(findings, options = {}) {
    const list = Array.isArray(findings) ? findings : [];
    const html = this.generateReviewHTML(list, options);
    const webView = new WebView();
    await webView.loadHTML(html);

    const appliedCounts = { applied: 0, failed: 0 };
    const inFlight = [];

    webView.shouldAllowRequest = (request) => {
      const url = request && request.url ? String(request.url) : "";
      if (url.indexOf("chunkyreview://") !== 0) {
        return true; // normal navigation (OSM map iframes, about:blank, …)
      }
      const params = this.parseReviewActionUrl(url);
      const payload =
        params.a === "apply-bulk"
          ? { action: "apply-bulk", mode: params.id }
          : { action: "apply", id: params.id };
      const targets = this.selectReviewFindingsForAction(payload, list);
      for (const finding of targets) {
        inFlight.push(this.applyReviewFindingAndReport(finding, webView, appliedCounts));
      }
      return false; // cancel the fake navigation; the page stays put
    };

    await webView.present(true); // blocks until the user dismisses the sheet
    await Promise.allSettled(inFlight);
    console.log(
      `🔎 REVIEW: UI closed — ${appliedCounts.applied} fix(es) applied, ${appliedCounts.failed} failed`,
    );
    if (appliedCounts.applied > 0 || appliedCounts.failed > 0) {
      await this.showReviewSummaryAlert(appliedCounts);
    }
    return appliedCounts;
  }

  // Apply one finding natively and (best-effort) reflect the result in the page.
  // Called fire-and-forget from shouldAllowRequest, which must return a bool
  // synchronously — so the await lives here, not in the handler.
  async applyReviewFindingAndReport(finding, webView, appliedCounts) {
    const result = await this.applyReviewFinding(finding);
    finding._applied = result.success === true;
    finding._applyFailed = result.success !== true;
    if (result.success) {
      appliedCounts.applied += 1;
    } else {
      appliedCounts.failed += 1;
    }
    const updateJs = `markFindingApplied(${JSON.stringify(String(finding.id))}, ${result.success === true}, ${JSON.stringify(result.message || "")})`;
    try {
      await webView.evaluateJavaScript(updateJs, false);
    } catch (error) {
      /* chip feedback is optional; the summary Alert is authoritative */
    }
  }

  // Display/Logging Adapter Implementation
  async logInfo(message) {
    console.log(message);
  }

  async logSuccess(message) {
    console.log(message);
  }

  async logWarn(message) {
    this.warnCount += 1;
    console.warn(message);
  }

  async logError(message) {
    console.error(message);
  }

  shouldSkipResultsUi(results) {
    const config = results?.config || {};
    const runContext = results?.runContext || this.resolveRunContext(results);
    if (results?._isDisplayingSavedRun || runContext?.type === "display") {
      return false;
    }
    // Widgets can never present WebViews/alerts
    if (runContext?.runsInWidget || this.runtimeContext?.runsInWidget) {
      return true;
    }
    // Any automation run (scheduled, Siri, or automation=true override) must not
    // block on UI — even when no parser is automationEnabled
    const automationRun =
      typeof config?.runtime?.automationRun === "boolean"
        ? config.runtime.automationRun
        : runContext?.type === "automated";
    return automationRun;
  }

  // Results Display - Enhanced with calendar preview and comparison
  async displayResults(results) {
    try {
      // Store results for use in other methods
      this.lastResults = results;

      const resolvedRunContext = this.resolveRunContext(results);
      results.runContext = resolvedRunContext;
      const runContextLabel = this.formatRunContext(resolvedRunContext);
      console.log(`📱 Scriptable: Run type: ${runContextLabel}`);

      // First show the enhanced display features in console for debugging
      await this.displayCalendarProperties(results);
      await this.compareWithExistingCalendars(results);
      await this.displayEnrichedEvents(results);

      // Show console summary
      console.log("\n" + "=".repeat(60));
      console.log("🐻 BEAR EVENT SCRAPER RESULTS");
      console.log("=".repeat(60));
      console.log(`Run Type: ${runContextLabel}`);

      console.log(
        `📊 Total Events Found: ${results.totalEvents} (all events from all sources)`,
      );
      console.log(
        `🐻 Raw Bear Events: ${results.rawBearEvents || "N/A"} (after bear filtering)`,
      );
      if (results.duplicatesRemoved > 0) {
        console.log(`🔄 Duplicates Removed: ${results.duplicatesRemoved}`);
        console.log(
          `🐻 Final Bear Events: ${results.bearEvents} (${results.rawBearEvents} - ${results.duplicatesRemoved} dupes)`,
        );
      } else {
        console.log(
          `🐻 Final Bear Events: ${results.bearEvents} (no duplicates found)`,
        );
      }
      console.log(
        `📅 Added to Calendar: ${results.calendarEvents}${results.calendarEvents === 0 ? " (dry run/preview mode - no events written)" : ""}`,
      );

      // Show event actions summary if available
      const allEvents = this.getAllEventsFromResults(results);
      if (allEvents && allEvents.length > 0) {
        const bearReviewCount = allEvents.filter(
          (event) =>
            typeof event?.bearReview === "string" &&
            /^(unlikely|unsure)/i.test(event.bearReview.trim()),
        ).length;
        if (bearReviewCount > 0) {
          console.log(
            `🐻 ${bearReviewCount} event(s) flagged for bear review`,
          );
        }

        const intentCounts = this.countMetricsActions(allEvents);
        const writeCounts = this.countMetricsCalendarActions(allEvents);
        const hasIntentCounts = Object.values(intentCounts).some(
          (count) => count > 0,
        );
        const hasWriteCounts = Object.values(writeCounts).some(
          (count) => count > 0,
        );

        if (hasIntentCounts) {
          console.log("\n🎯 Intent Actions:");
          if (intentCounts.new > 0)
            console.log(`   ➕ NEW: ${intentCounts.new}`);
          if (intentCounts.merge > 0)
            console.log(`   🔄 MERGE: ${intentCounts.merge}`);
          if (intentCounts.conflict > 0)
            console.log(`   ⚠️ CONFLICT: ${intentCounts.conflict}`);
          if (intentCounts.missing_calendar > 0)
            console.log(
              `   ❌ MISSING_CALENDAR: ${intentCounts.missing_calendar}`,
            );
          if (intentCounts.other > 0)
            console.log(`   ❓ OTHER: ${intentCounts.other}`);
        }

        if (hasWriteCounts) {
          console.log("\n📝 Calendar Write Plan:");
          if (writeCounts.create > 0)
            console.log(`   ➕ CREATE: ${writeCounts.create}`);
          if (writeCounts.update > 0)
            console.log(`   🔄 UPDATE: ${writeCounts.update}`);
          if (writeCounts.skip > 0)
            console.log(`   ⏭️ SKIP: ${writeCounts.skip}`);
          if (writeCounts.other > 0)
            console.log(`   ❓ OTHER: ${writeCounts.other}`);
        }
      }

      if (results.errors.length > 0) {
        console.log(`❌ Errors: ${results.errors.length}`);
        results.errors.forEach((error) => console.log(`   • ${error}`));
      }

      // Permanently-gone crawl targets (HTTP 404/410) are reported separately
      // from errors on purpose — they are facts about the web, not run faults,
      // and counting them as errors kept a standing "errors: 7" on runs where
      // nothing was wrong. Still surfaced in full (flag, don't drop).
      if (Array.isArray(results.permanentlyGone) && results.permanentlyGone.length > 0) {
        console.log(`🪦 Permanently gone (404/410): ${results.permanentlyGone.length}`);
        results.permanentlyGone.forEach((entry) => console.log(`   • ${entry}`));
      }

      console.log("\n📋 Parser Results:");
      results.parserResults.forEach((result) => {
        console.log(`   • ${result.name}: ${result.bearEvents} bear events`);
      });

      if (results.discoveredVenueSummary) {
        console.log("\n" + results.discoveredVenueSummary);
      }

      if (results.foreignOrgCrawlSummary) {
        console.log("\n" + results.foreignOrgCrawlSummary);
      }

      console.log("\n" + "=".repeat(60));

      const shouldSkipUi = this.shouldSkipResultsUi(results);
      if (!shouldSkipUi) {
        // Present rich UI display (may update results.calendarEvents if user executes)
        await this.presentRichResults(results);
      } else {
        console.log("📱 Scriptable: Skipping results UI (automation run)");
      }

      // Persist this run for later display (skip when showing saved runs)
      const hasAnalyzedEvents = Array.isArray(results?.analyzedEvents);
      const parserConfigs = results?.config?.parsers || [];
      const runtimeForSave =
        results?.config?.runtime || results?.runContext || {};
      const automationRunForSave =
        Boolean(runtimeForSave.automationRun) ||
        runtimeForSave.type === "automated";
      // Only apply the automationEnabled filter when the schedule filter was
      // actually in effect — override runs (parserName/url input + automation=true)
      // run other parsers and must still be saved for audit/metrics
      const automationFilterForSave =
        automationRunForSave && runtimeForSave.automationFilter !== false;
      const activeParsers = parserConfigs.filter((parser) => {
        if (automationFilterForSave) {
          // Mirrors SharedCore.evaluateAutomationForParser: automationEnabled
          // defaults to true, only an explicit false opts out
          return Boolean(parser) && parser.automationEnabled !== false;
        }
        return parser?.enabled !== false;
      });
      const hasActiveParsers = activeParsers.length > 0;
      const shouldSaveRun =
        !results?._isDisplayingSavedRun &&
        hasAnalyzedEvents &&
        hasActiveParsers;
      const retentionDays = 30;
      if (shouldSaveRun) {
        await this.ensureRelativeStorageDirs();
        const runId = await this.saveRun(results);
        if (runId) {
          results.savedRunId = runId;
          results.savedRunPath = this.getRunFilePath(runId);
          // Venue-queue taps happened before this id existed — stamp it into
          // the entries queued during this session's results sheet.
          await this.backfillQueuedVenueRunIds(results);
        }
        // Cleanup old JSON runs
        await this.cleanupOldFiles("chunky-dad-scraper/runs", {
          maxAgeDays: retentionDays,
          keep: (name) => !name.endsWith(".json"),
        });
      } else {
        const reason = results?._isDisplayingSavedRun
          ? "display mode"
          : !hasActiveParsers
            ? automationFilterForSave
              ? "no automation-enabled parsers"
              : "no enabled parsers"
            : "missing analyzed events";
        console.log(`📱 Scriptable: Skipping run save (${reason})`);
      }

      // Append a log file entry and cleanup logs (skip saved-run display)
      if (!results?._isDisplayingSavedRun) {
        try {
          await this.ensureRelativeStorageDirs();
          await this.appendLogSummary(results);
          await this.cleanupOldFiles("chunky-dad-scraper/logs", {
            maxAgeDays: retentionDays,
            keep: (name) => {
              const lower = name.toLowerCase();
              return lower.includes("performance") || lower.endsWith(".csv");
            },
          });
        } catch (logErr) {
          console.log(
            `📱 Scriptable: Log write/cleanup failed: ${logErr.message}`,
          );
        }
      } else {
        console.log("📱 Scriptable: Skipping log write (display mode)");
      }

      if (!results?._isDisplayingSavedRun) {
        // Append metrics record and update summary
        try {
          await this.ensureRelativeStorageDirs();
          const metricsRecord = this.buildMetricsRecord(results);
          if (metricsRecord) {
            await this.appendMetricsRecord(metricsRecord, retentionDays);
            await this.updateMetricsSummary(metricsRecord);
          } else {
            console.log(
              "📱 Scriptable: Skipping metrics write (missing runId)",
            );
          }
        } catch (metricsErr) {
          console.log(
            `📱 Scriptable: Metrics write failed: ${metricsErr.message}`,
          );
        }
      }

      if (!results?._isDisplayingSavedRun) {
        // Prune persistent caches. Pages past their TTL are dead weight
        // already (readCachedPage ignores them), so they only get a 1-day
        // grace. OCR/classification entries are retained by LAST USE: cache
        // hits rewrite ("touch") the entry at most every 7 days (see
        // AiWebParser.touchCacheEntryOnHit), so a file's mtime tracks its
        // last use to within that window — pruning works from mtime alone,
        // no payload reads, with the touch interval added as grace.
        try {
          const pageTtlDays = this.getPageCacheConfig().ttlDays;
          const prunedPages = await this.cleanupOldFiles(
            "chunky-dad-scraper/storage/pages",
            { maxAgeDays: pageTtlDays + 1, recurse: true },
          );
          if (prunedPages > 0) {
            console.log(
              `📱 Scriptable: Pruned ${prunedPages} expired page cache file(s) (ttl ${pageTtlDays}d)`,
            );
          }
          const ocrRetentionDays = this.getOcrCacheRetentionDays();
          const unusedCutoffDays = ocrRetentionDays + 7;
          const prunedOcr = await this.cleanupOldFiles(
            "chunky-dad-scraper/storage/ocr",
            { maxAgeDays: unusedCutoffDays, recurse: true },
          );
          if (prunedOcr > 0) {
            console.log(
              `📱 Scriptable: Pruned ${prunedOcr} OCR cache entries unused for ${ocrRetentionDays}d`,
            );
          }
          const prunedClassification = await this.cleanupOldFiles(
            "chunky-dad-scraper/storage/classification",
            { maxAgeDays: unusedCutoffDays, recurse: true },
          );
          if (prunedClassification > 0) {
            console.log(
              `📱 Scriptable: Pruned ${prunedClassification} classification cache entries unused for ${ocrRetentionDays}d`,
            );
          }
          const prunedAiResponses = await this.cleanupOldFiles(
            "chunky-dad-scraper/storage/ai-responses",
            { maxAgeDays: unusedCutoffDays, recurse: true },
          );
          if (prunedAiResponses > 0) {
            console.log(
              `📱 Scriptable: Pruned ${prunedAiResponses} AI response cache entries unused for ${ocrRetentionDays}d`,
            );
          }
        } catch (pruneErr) {
          console.log(
            `📱 Scriptable: Cache prune failed: ${pruneErr.message}`,
          );
        }
      }
    } catch (error) {
      console.log(`📱 Scriptable: Error displaying results: ${error.message}`);
    }
  }

  // Error handling with user-friendly alerts
  async showError(title, message) {
    try {
      const alert = new Alert();
      alert.title = title;
      alert.message = message;
      alert.addAction("OK");
      await alert.present();
    } catch (error) {
      console.log(`Failed to show error alert: ${error.message}`);
    }
  }

  // Enhanced Display Methods
  async displayCalendarProperties(results) {
    console.log("\n" + "=".repeat(60));
    console.log("📅 CALENDAR SUMMARY");
    console.log("=".repeat(60));

    // Get all events from all parser results
    const allEvents = this.getAllEventsFromResults(results);
    if (!allEvents || !allEvents.length) {
      console.log("❌ No event data available for preview");
      return;
    }

    // Get available calendars for comparison
    const availableCalendars = await Calendar.forEvents();

    // Get unique calendars needed
    const calendarsNeeded = new Map();
    allEvents.forEach((event) => {
      const calendarName = this.getCalendarNameForDisplay(event);
      if (!calendarsNeeded.has(calendarName)) {
        const exists = availableCalendars.find(
          (cal) => cal.title === calendarName,
        );
        calendarsNeeded.set(calendarName, {
          name: calendarName,
          exists: !!exists,
          calendar: exists,
          eventCount: 0,
        });
      }
      calendarsNeeded.get(calendarName).eventCount++;
    });

    // Show calendar summary
    console.log(`\n📊 Events: ${allEvents.length}`);
    console.log(`📅 Calendars needed: ${calendarsNeeded.size}`);
    for (const [name, info] of calendarsNeeded) {
      if (info.exists) {
        console.log(`   ✅ ${name} (${info.eventCount} events)`);
      } else {
        console.log(
          `   ❌ ${name} (${info.eventCount} events) - create manually`,
        );
      }
    }

    console.log("\n" + "=".repeat(60));
  }

  async compareWithExistingCalendars(results) {
    console.log("\n" + "=".repeat(60));
    console.log("🔍 CALENDAR COMPARISON & CONFLICT CHECK");
    console.log("=".repeat(60));

    // Get all events from all parser results
    const allEvents = this.getAllEventsFromResults(results);
    if (!allEvents || !allEvents.length) {
      console.log("❌ No events to compare");
      return;
    }

    const availableCalendars = await Calendar.forEvents();
    const summary = { checked: 0, missing: 0, duplicates: 0, conflicts: 0 };
    const missingCalendars = new Map();

    for (const event of allEvents) {
      summary.checked++;
      const calendarName = this.getCalendarNameForDisplay(event);
      const calendar = availableCalendars.find(
        (cal) => cal.title === calendarName,
      );

      if (!calendar) {
        summary.missing++;
        missingCalendars.set(
          calendarName,
          (missingCalendars.get(calendarName) || 0) + 1,
        );
        // Mark event as missing calendar for display
        event._action = "missing_calendar";
        event._analysis = {
          action: "missing_calendar",
          reason: `Calendar "${calendarName}" does not exist`,
          calendarName: calendarName,
        };
        continue;
      }

      try {
        // Check for existing events in the time range
        // Ensure dates are Date objects (may be strings from saved runs)
        const startDate =
          typeof event.startDate === "string"
            ? new Date(event.startDate)
            : event.startDate;
        const endDate =
          typeof (event.endDate || event.startDate) === "string"
            ? new Date(event.endDate || event.startDate)
            : event.endDate || event.startDate;

        const searchStart = new Date(startDate);
        const searchEnd = new Date(endDate);
        searchEnd.setDate(searchEnd.getDate() + 30); // Look ahead a month

        const existingEvents = await CalendarEvent.between(
          searchStart,
          searchEnd,
          [calendar],
        );

        // Check for exact duplicates
        const duplicates = existingEvents.filter((existing) => {
          const titleMatch = existing.title === (event.title || event.name);
          const timeMatch =
            Math.abs(existing.startDate.getTime() - startDate.getTime()) <
            60000; // Within 1 minute
          return titleMatch && timeMatch;
        });

        if (duplicates.length > 0) {
          summary.duplicates += duplicates.length;
          const timezone = this.getTimezoneForCity(event.city);
          const sampleDup = duplicates[0];
          const dupLocalTime = sampleDup.startDate.toLocaleString("en-US", {
            timeZone: timezone,
          });
          const dupUtcTime = sampleDup.startDate.toLocaleString("en-US", {
            timeZone: "UTC",
          });
          console.log(
            `⚠️  ${event.title || event.name} → ${duplicates.length} duplicate(s) in ${calendarName}`,
          );
          console.log(
            `   Example: "${sampleDup.title}" at ${dupLocalTime} (UTC: ${dupUtcTime})`,
          );
        }

        // Check for time conflicts (overlapping events)
        const conflicts = existingEvents.filter((existing) => {
          const existingStart = existing.startDate.getTime();
          const existingEnd = existing.endDate.getTime();
          const newStart = startDate.getTime();
          const newEnd = endDate.getTime();

          // Check for overlap
          return newStart < existingEnd && newEnd > existingStart;
        });

        if (conflicts.length > 0) {
          summary.conflicts += conflicts.length;
          console.log(
            `⏰ ${event.title || event.name} → ${conflicts.length} time conflict(s) in ${calendarName}`,
          );
          const timezone = this.getTimezoneForCity(event.city);
          const shownConflicts = conflicts.slice(0, 2);
          shownConflicts.forEach((conflict) => {
            const conflictLocalStart = conflict.startDate.toLocaleString(
              "en-US",
              { timeZone: timezone },
            );
            const conflictLocalEnd = conflict.endDate.toLocaleString("en-US", {
              timeZone: timezone,
            });
            const conflictUtcStart = conflict.startDate.toLocaleString(
              "en-US",
              { timeZone: "UTC" },
            );
            const conflictUtcEnd = conflict.endDate.toLocaleString("en-US", {
              timeZone: "UTC",
            });
            const shouldMerge = this.shouldMergeTimeConflict(conflict, event);
            const mergeNote = shouldMerge ? "merge" : "no merge";
            console.log(
              `   - "${conflict.title}": ${conflictLocalStart} - ${conflictLocalEnd} (UTC: ${conflictUtcStart} - ${conflictUtcEnd}) (${mergeNote})`,
            );
          });
          if (conflicts.length > shownConflicts.length) {
            console.log(
              `   ...and ${conflicts.length - shownConflicts.length} more`,
            );
          }
        }
      } catch (error) {
        console.error(
          `❌ Failed to check calendar "${calendarName}": ${error}`,
        );
      }
    }

    if (missingCalendars.size > 0) {
      const missingList = Array.from(missingCalendars.entries())
        .map(([name, count]) => `${name} (${count})`)
        .join(", ");
      console.log(`❌ Missing calendars: ${missingList}`);
    }

    console.log(
      `✅ Calendar check complete: ${summary.checked} events, ${summary.missing} missing, ${summary.duplicates} duplicates, ${summary.conflicts} conflicts`,
    );
    console.log("\n" + "=".repeat(60));
  }

  async displayAvailableCalendars(results) {
    console.log("\n" + "=".repeat(60));
    console.log("📅 CALENDAR STATUS");
    console.log("=".repeat(60));

    try {
      const availableCalendars = await Calendar.forEvents();

      if (availableCalendars.length === 0) {
        console.log("❌ No calendars found or failed to load");
        return;
      }

      // Get all events to see which calendars we need
      const allEvents = this.getAllEventsFromResults(this.lastResults);
      const neededCalendars = new Set();
      allEvents.forEach((event) => {
        const calendarName = this.getCalendarNameForDisplay(event);
        neededCalendars.add(calendarName);
      });

      console.log(`📊 Calendars needed for events: ${neededCalendars.size}`);

      // Show only the calendars we need and their status
      const foundCalendars = [];
      const missingCalendars = [];

      neededCalendars.forEach((calendarName) => {
        const exists = availableCalendars.find(
          (cal) => cal.title === calendarName,
        );
        if (exists) {
          foundCalendars.push(calendarName);
        } else {
          missingCalendars.push(calendarName);
        }
      });

      if (foundCalendars.length > 0) {
        console.log(`\n✅ Found calendars (${foundCalendars.length}):`);
        foundCalendars.forEach((cal) => console.log(`   • ${cal}`));
      }

      if (missingCalendars.length > 0) {
        console.log(
          `\n❌ Missing calendars (${missingCalendars.length}) - create manually:`,
        );
        missingCalendars.forEach((cal) => console.log(`   • ${cal}`));
      }
    } catch (error) {
      console.error(`❌ Failed to load calendars: ${error}`);
    }

    console.log("\n" + "=".repeat(60));
  }

  async displayEnrichedEvents(results) {
    console.log("\n" + "=".repeat(60));
    console.log("🐻 ENRICHED EVENT INFORMATION");
    console.log("=".repeat(60));

    // Get all events from all parser results
    const allEvents = this.getAllEventsFromResults(results);
    if (!allEvents || !allEvents.length) {
      console.log("❌ No events to display");
      return;
    }

    // Group events by intent action type (display intent can differ from write action)
    const eventsByAction = {
      new: [],
      merge: [],
      conflict: [],
      missing_calendar: [],
      other: [],
    };

    allEvents.forEach((event) => {
      const action = this.normalizeIntentAction(event) || "other";
      if (eventsByAction[action]) {
        eventsByAction[action].push(event);
      } else {
        eventsByAction.other.push(event);
      }
    });

    // Show summary by action type
    console.log(`\n📊 Event Actions Summary:`);
    console.log(`   ➕ New: ${eventsByAction.new.length} events`);
    console.log(`   🔀 Merge: ${eventsByAction.merge.length} events`);
    console.log(`   ⚠️  Conflict: ${eventsByAction.conflict.length} events`);
    console.log(
      `   ❌ Missing Calendar: ${eventsByAction.missing_calendar.length} events`,
    );
    if (eventsByAction.other.length > 0) {
      console.log(`   ❓ Other: ${eventsByAction.other.length} events`);
    }
    // REPORT-ONLY sanity flags (SharedCore.getEventSanityFlags): count line
    // only when something is flagged — flags never change any action above.
    const sanityFlaggedCount = allEvents.filter(
      (event) =>
        Array.isArray(event?._sanityFlags) && event._sanityFlags.length > 0,
    ).length;
    if (sanityFlaggedCount > 0) {
      console.log(`   ⚠️ Sanity flags: ${sanityFlaggedCount} event(s)`);
    }
    // Same shape, same rule (line only when non-zero) for the two series
    // authority states — a headless run must not be the only place these are
    // invisible. Overrides ARE written (as one dated occurrence); proposals
    // are never written and belong to the owner.
    const overrideCount = allEvents.filter((event) =>
      this.isSingleOccurrenceOverride(event),
    ).length;
    if (overrideCount > 0) {
      console.log(
        `   🗓️ Single-occurrence overrides: ${overrideCount} event(s)`,
      );
    }
    const proposalCount = this.collectSeriesChangeProposals({
      analyzedEvents: allEvents,
    }).length;
    if (proposalCount > 0) {
      console.log(
        `   📐 Series-change proposals: ${proposalCount} (not written — owner decides)`,
      );
    }

    const detailedActions = ["merge", "conflict"];
    const actionsToShow = detailedActions.filter(
      (action) => eventsByAction[action].length > 0,
    );
    if (actionsToShow.length === 0 && eventsByAction.new.length > 0) {
      actionsToShow.push("new");
    }

    actionsToShow.forEach((action) => {
      const events = eventsByAction[action];
      if (!events || events.length === 0) return;

      console.log(
        `\n${action.toUpperCase()} Events (showing 1 of ${events.length}):`,
      );
      console.log("─".repeat(50));

      const event = events[0];
      console.log(`• ${event.title || event.name}`);
      console.log(
        `  📍 ${event.venue || event.bar || "TBD"} | 📱 ${this.getCalendarNameForDisplay(event)}`,
      );
      console.log(
        `  🎯 Intent: ${this.formatIntentActionLabel(this.normalizeIntentAction(event))} | 📝 Write: ${this.formatWriteActionLabel(this.getWriteActionFromEvent(event))}`,
      );
      const eventDateForDisplay = new Date(event.startDate);
      // Get timezone from city configuration instead of expecting it on the event
      const timezone = this.getTimezoneForCityOrUtc(event.city);
      const localDateTime = eventDateForDisplay.toLocaleString("en-US", {
        timeZone: timezone,
      });
      const utcDateTime = eventDateForDisplay.toLocaleString("en-US", {
        timeZone: "UTC",
      });
      console.log(`  📅 ${localDateTime} (UTC: ${utcDateTime})`);

      if (action === "merge" && event._mergeDiff) {
        console.log(
          `  🔀 Merge: ${event._mergeDiff.preserved.length} preserved, ${event._mergeDiff.updated.length} updated, ${event._mergeDiff.added.length} added`,
        );
      } else if (action === "conflict" && event._analysis?.reason) {
        console.log(`  ⚠️  Reason: ${event._analysis.reason}`);
      }
      // Additive adjacent line — report-only sanity flags never alter the
      // Intent/Write line above.
      if (Array.isArray(event._sanityFlags) && event._sanityFlags.length > 0) {
        console.log(
          `  ⚠️ Sanity: ${event._sanityFlags.map((flag) => flag.code).join(", ")}`,
        );
      }
      // Additive adjacent lines, same rule: which night an override replaces,
      // and the schedule change this run refused to write.
      if (this.isSingleOccurrenceOverride(event)) {
        const occurrenceLabel = this.getOverrideOccurrenceLabel(event);
        console.log(
          `  🗓️ Override: single occurrence${occurrenceLabel ? ` — ${occurrenceLabel}` : ""} (series not modified)`,
        );
      }
      const sampleProposal = this.getSeriesChangeProposal(event);
      if (sampleProposal) {
        console.log(
          `  📐 Series-change proposal (not written): ${sampleProposal.field || "recurrence"} ${sampleProposal.current || "—"} → ${sampleProposal.proposed || "—"}`,
        );
      }
    });

    console.log("\n" + "=".repeat(60));
  }

  async displaySummaryAndActions(results) {
    console.log("\n" + "=".repeat(60));
    console.log("📊 SUMMARY & RECOMMENDED ACTIONS");
    console.log("=".repeat(60));

    // Get all events from all parser results
    const allEvents = this.getAllEventsFromResults(results);
    if (!allEvents || !allEvents.length) {
      console.log("❌ No event data available for summary");
      return;
    }

    const summary = {
      totalEvents: allEvents.length,
      cities: [...new Set(allEvents.map((e) => e.city).filter(Boolean))],
      calendarsNeeded: [
        ...new Set(allEvents.map((e) => this.getCalendarNameForDisplay(e))),
      ],
      timezones: [...new Set(allEvents.map((e) => e.timezone).filter(Boolean))],
    };

    console.log(`📊 Events: ${summary.totalEvents} total`);

    if (summary.cities.length > 0) {
      console.log(`\n🌍 Cities: ${summary.cities.join(", ")}`);
    }

    console.log(`📅 Calendars needed: ${summary.calendarsNeeded.length}`);
    try {
      const availableCalendars = await Calendar.forEvents();
      summary.calendarsNeeded.forEach((cal) => {
        const exists = availableCalendars.find((c) => c.title === cal);
        console.log(`   - "${cal}" ${exists ? "(exists)" : "(will create)"}`);
      });
    } catch (error) {
      summary.calendarsNeeded.forEach((cal) => {
        console.log(`   - "${cal}" (status unknown)`);
      });
    }

    if (summary.timezones.length > 0) {
      console.log(`\n🕐 Timezones: ${summary.timezones.join(", ")}`);
    }

    // Show action breakdown if events have been analyzed
    const actionsCount = {
      new: 0,
      merge: 0,
      conflict: 0,
      missing_calendar: 0,
      other: 0,
    };

    let hasActions = false;
    allEvents.forEach((event) => {
      const action = this.normalizeIntentAction(event);
      if (!action) return;
      hasActions = true;
      if (actionsCount.hasOwnProperty(action)) {
        actionsCount[action]++;
      } else {
        actionsCount.other++;
      }
    });

    if (hasActions) {
      console.log(`\n🎯 Event Actions Analysis:`);
      Object.entries(actionsCount).forEach(([action, count]) => {
        if (count > 0) {
          const actionIcon =
            {
              new: "➕",
              merge: "🔄",
              conflict: "⚠️",
              missing_calendar: "❌",
              other: "❓",
            }[action] || "❓";

          console.log(
            `   ${actionIcon} ${action.toUpperCase()}: ${count} events`,
          );
        }
      });
    }

    // Add explanation about deduplication if relevant
    if (results.duplicatesRemoved > 0) {
      console.log(`\n💡 About Deduplication:`);
      console.log(
        `   Some venues (like Bearracuda) have events listed on multiple platforms`,
      );
      console.log(
        `   (e.g., both Bearracuda.com and Eventbrite). The scraper finds both`,
      );
      console.log(
        `   versions but removes duplicates to avoid calendar clutter.`,
      );
      console.log(
        `   This is working correctly - ${results.duplicatesRemoved} duplicates were removed.`,
      );
    }

    console.log(`\n🎯 Recommended Actions:`);
    console.log(`   1. Review calendar properties above`);
    console.log(`   2. Check for conflicts in comparison section`);
    console.log(`   3. Verify calendar permissions and settings`);
    console.log(`   4. Set dryRun: false in config to actually add events`);

    console.log("\n" + "=".repeat(60));
  }

  async displayFullEventObjects(results) {
    console.log("\n" + "=".repeat(60));
    console.log("🔍 FULL EVENT OBJECTS (DEBUG)");
    console.log("=".repeat(60));

    const allEvents = this.getAllEventsFromResults(results);
    if (!allEvents || !allEvents.length) {
      console.log("❌ No events to display");
      return;
    }

    // Group events by action type
    const eventsByAction = {};
    allEvents.forEach((event) => {
      const action = event._action || "unprocessed";
      if (!eventsByAction[action]) {
        eventsByAction[action] = [];
      }
      eventsByAction[action].push(event);
    });

    // Display events grouped by action
    Object.entries(eventsByAction).forEach(([action, events]) => {
      console.log(
        `\n━━━ ${action.toUpperCase()} EVENTS (${events.length}) ━━━`,
      );

      events.forEach((event, index) => {
        console.log(
          `\n[${action.toUpperCase()} ${index + 1}/${events.length}] ${event.title || event.name}`,
        );
        console.log("─".repeat(60));

        // Create a clean object for logging (remove circular references)
        const cleanEvent = JSON.parse(
          JSON.stringify(
            event,
            (key, value) => {
              // Skip internal fields that might have circular references
              if (key === "_parserConfig" && value) {
                return { name: value.name, parser: value.parser };
              }
              if (key === "_existingEvent" && value) {
                return {
                  title: value.title,
                  identifier: value.identifier,
                  startDate: value.startDate,
                  endDate: value.endDate,
                  notesLength: value.notes ? value.notes.length : 0,
                };
              }
              if (key === "_conflicts" && value && Array.isArray(value)) {
                return value.map((c) => ({
                  title: c.title,
                  startDate: c.startDate,
                  identifier: c.identifier,
                }));
              }
              if (key === "placeId") {
                return undefined; // Hide placeId from debug display
              }
              if (typeof value === "function") {
                return "[Function]";
              }
              return value;
            },
            2,
          ),
        );

        console.log(JSON.stringify(cleanEvent, null, 2));
      });
    });

    console.log("\n" + "=".repeat(60));
  }

  // Rich UI presentation using WebView with HTML
  async presentRichResults(results) {
    try {
      // Generate HTML for rich display (before the presenting log so the
      // size line lands next to it — WebView.loadHTML fails SILENTLY with a
      // white screen past ~1 MB, so the size must be in the log by itself)
      const html = await this.generateRichHTML(results);
      console.log(
        `📱 Scriptable: Results HTML size: ${Math.round(html.length / 1024)} KB`,
      );
      // The line above counts UTF-16 code units; WebKit holds UTF-8 bytes,
      // and the difference on a page this size is tens of KB.
      console.log(
        `📱 Scriptable: Results HTML size (UTF-8 bytes): ${Math.round(ScriptableAdapter.utf8ByteLength(html) / 1024)} KB`,
      );
      console.log("📱 Scriptable: Presenting results UI...");

      // Present using an instance WebView so page buttons can signal native
      // via shouldAllowRequest (assigned BEFORE present() — the reliable
      // webview→native pattern, see presentReviewResults). Currently used by
      // the discovered-venue "Copy parser entry" buttons (chunkyscrape://).
      const venueEntrySnippets = this.collectVenueEntrySnippets(results);
      // Manual bear/not-bear override taps recorded during the WebView session,
      // applied after dismissal. Keyed by namespaced card id ("k<i>" kept /
      // "d<i>" dropped) so repeat taps stay idempotent and the two directions
      // on one card overwrite each other instead of stacking.
      const bearOverridePending = {
        markedBear: {},
        markedNotBear: {},
        keptMarkedBear: {},
      };
      // Venue-queue taps this session: candidate index → timesSeen after the
      // write. Repeat taps re-flash feedback without re-writing the queue.
      const venueQueueTaps = {};
      // Liveness beacons the page fires on DOM-ready and after first paint.
      // present() resolves the same way whether WebKit rendered the page or
      // silently killed its content process, so this array — and above all
      // its emptiness — is the only evidence of which one happened.
      const pageBeacons = [];
      const webView = new WebView();
      await webView.loadHTML(html);
      webView.shouldAllowRequest = (request) => {
        const url = request && request.url ? String(request.url) : "";
        if (url.indexOf("chunkyscrape://") !== 0) {
          return true; // normal navigation (links, about:blank, …)
        }
        const params = this.parseReviewActionUrl(url);
        if (params.a === "copy-venue") {
          const snippet = venueEntrySnippets[params.id];
          if (typeof snippet === "string" && snippet.length > 0) {
            // Fire-and-forget: the handler must return a bool synchronously
            this.copyVenueEntryAndReport(snippet, params.id, webView);
          }
        } else if (params.a === "mark-bear" || params.a === "mark-not-bear") {
          // Fire-and-forget: records the override natively; the page gets
          // best-effort "Marked ✓" feedback via evaluateJavaScript.
          this.recordBearOverrideAndReport(
            params.a,
            params.id,
            results,
            bearOverridePending,
            webView,
          );
        } else if (params.a === "queue-venue") {
          // Fire-and-forget: appends the candidate to the gathering-only
          // bar-additions queue; the page gets best-effort "Queued ✓"
          // feedback via evaluateJavaScript.
          this.queueVenueCandidateAndReport(
            params.id,
            results,
            venueQueueTaps,
            webView,
          );
        } else if (params.a === "open-url") {
          // Fire-and-forget: opens the registered map verify link in Safari
          // ON TOP of the results sheet (the WebView never navigates).
          this.openMapVerifyUrl(params.id);
        } else if (params.a === "export-ics") {
          // Fire-and-forget: builds the recurring event's ICS natively and
          // hands it to DocumentPicker/ShareSheet (the WebView never
          // navigates; recurring series are export-only, never auto-written).
          this.exportRecurringEventIcs(params.id);
        } else if (params.a === "copy-logs") {
          // Fire-and-forget: the run log is no longer embedded in the page,
          // so 📋 Copy / 📋 Compact ask native for it here.
          this.copyRunLogAndReport(params.id, webView);
        } else if (params.a === "ai-prompts") {
          // Fire-and-forget: native owns the prompt bodies and presents the
          // picker on top of the sheet (same pattern as Safari/DocumentPicker).
          this.presentAiPromptPickerAndCopy(webView);
        } else if (params.a === "beacon") {
          this.recordResultsPageBeacon(params.id, params.d, pageBeacons);
        }
        return false; // cancel the fake navigation; the page stays put
      };
      await webView.present(true);
      // The page's own account of whether it ever rendered. Logged AFTER the
      // sheet closes so a blank review leaves a different trace than a real one.
      this.reportResultsPageLiveness(pageBeacons);

      // Apply recorded overrides: marked-bear drops get the same calendar prep
      // as normally kept events and join the write plan; marked-not-bear events
      // are adjusted in the plan into hidden tombstones.
      const bearOverrideCounts = await this.applyPendingBearOverrides(
        results,
        bearOverridePending,
      );

      // After displaying results, prompt for calendar execution if we have analyzed events
      // Don't prompt when displaying saved runs (they should use isDryRun override instead)
      if (
        results.analyzedEvents &&
        results.analyzedEvents.length > 0 &&
        !results.calendarEvents &&
        !results._isDisplayingSavedRun
      ) {
        // Check if we have any events from non-dry-run parsers
        const eventsFromActiveParsers = SharedCore.filterEventsForExecution(
          results.analyzedEvents,
        );

        const globalDryRun = results.config?.config?.dryRun;
        const hasActiveEvents = eventsFromActiveParsers.length > 0;

        if (!globalDryRun && hasActiveEvents) {
          console.log(
            `📱 Scriptable: Prompting for calendar execution (${eventsFromActiveParsers.length} events)`,
          );
          const executedCount = await this.promptForCalendarExecution(
            eventsFromActiveParsers,
            results.config,
            bearOverrideCounts,
          );
          results.calendarEvents = executedCount;
        } else {
          const reason = globalDryRun ? "global dry run" : "no active events";
          console.log(`📱 Scriptable: Skipping execution prompt (${reason})`);
        }
      } else {
        console.log(
          "📱 Scriptable: Skipping execution prompt (conditions not met)",
        );
      }
    } catch (error) {
      console.log(
        `📱 Scriptable: ✗ Failed to present rich UI: ${error.message}`,
      );
    }
  }

  // Generate rich HTML for WebView display
  async generateRichHTML(results) {
    // Fresh per-render registry for the open-url bridge: every map verify
    // link rendered below registers its real URL natively and embeds only
    // the returned id, so ids in this HTML always match the handler's map.
    this.resetMapVerifyUrls();
    // Same per-render pattern for the recurring-ICS export bridge: each
    // recurring card registers its event natively and embeds only the id.
    this.resetIcsExportEvents();
    const allEvents = this.getAllEventsFromResults(results);
    // Per-render payload budget: every card's debug JSON gets an equal share
    // of one document-wide constant, so page size stops scaling with the
    // number of events (see buildBudgetedEventJson).
    const budgetedCardCount = Array.isArray(allEvents) ? allEvents.length : 0;
    this._eventJsonBudgetReport = [];
    this._eventJsonBudgetBytes =
      this.computeEventJsonBudgetBytes(budgetedCardCount);
    // Same construction for the two merge diff renderings, but shared out
    // over the cards that actually RENDER a diff (only merges carry
    // _original) and over both renderings each of those cards emits — so a
    // run full of brand-new events never shrinks the allowance of the few
    // merges the owner has to adjudicate.
    const diffClaimCount =
      2 *
      Math.max(
        1,
        (Array.isArray(allEvents) ? allEvents : []).filter(
          (event) => event && event._original,
        ).length,
      );
    this._mergeDiffBudgetReport = [];
    this._mergeDiffRemainingBytes =
      ScriptableAdapter.MERGE_DIFF_TOTAL_BUDGET_BYTES;
    this._mergeDiffPerCardBytes = Math.min(
      Math.floor(
        ScriptableAdapter.MERGE_DIFF_TOTAL_BUDGET_BYTES / diffClaimCount,
      ),
      ScriptableAdapter.MERGE_DIFF_MAX_PER_CARD_BYTES,
    );
    const availableCalendars = await Calendar.forEvents();

    // Detect dark mode for better bar/low-light readability
    const isDarkMode = Device.isUsingDarkAppearance();
    const runContextLabel = this.formatRunContext(
      results.runContext || this.resolveRunContext(results),
    );
    const runIdLabel = results.savedRunId || results.sourceRunId || null;
    const runMetaLabel = runIdLabel
      ? `Run: ${runContextLabel} | ID: ${runIdLabel}`
      : `Run: ${runContextLabel}`;
    // Run identity handed to each event card's provenance/export-issue section
    const provenanceRunInfo = { runId: runIdLabel };
    const shouldShowLogs = results?._isDisplayingSavedRun === true;
    const runLogInfo = shouldShowLogs
      ? await this.loadRunLogsForDisplay(results)
      : null;
    const runPromptInfo = shouldShowLogs
      ? this.loadAiPromptsForDisplay(results, runLogInfo)
      : null;
    const logSectionHtml = shouldShowLogs
      ? this.buildRunLogSectionHtml(runLogInfo, runPromptInfo)
      : "";
    // Per-render sources the Run Logs buttons read natively on tap. Always
    // called, so a live run clears whatever a previous saved-run render left.
    this.registerRunLogCopySources(runLogInfo, runPromptInfo);
    // Still parsed — the one-line run-health badge in the header is derived
    // from it. The two big "What Happened" / "What We Did" sections it used to
    // render are gone: the owner never used them.
    const runInsights = this.loadRunInsightsForDisplay(results, runLogInfo);
    const runHealthBadgeHtml = this.buildRunHealthBadgeHtml(
      runInsights,
      results,
    );
    const headerLogoData = await this.loadHeaderLogoData();
    const headerLogoSrc = headerLogoData || HEADER_LOGO_URL;
    // Async section (reads the gathering-only venue queue for badge state),
    // pre-rendered here because the template below is synchronous.
    const newVenueSectionHtml =
      await this.generateNewVenueCandidateSection(results);

    // Group events by intent actions (intent can differ from write action for overrides).
    // Each entry keeps its index into allEvents — which IS the index into
    // results.analyzedEvents (getAllEventsFromResults preserves order) — so a
    // card's bear-verdict buttons address the right event over the bridge.
    const newEvents = [];
    const mergeEvents = [];
    const conflictEvents = [];

    allEvents.forEach((event, index) => {
      const entry = { event, index };
      switch (this.normalizeIntentAction(event)) {
        case "new":
          newEvents.push(entry);
          break;
        case "merge":
          mergeEvents.push(entry);
          break;
        case "conflict":
        case "missing_calendar":
          conflictEvents.push(entry);
          break;
        default:
          // Fallback for events without analysis
          newEvents.push(entry);
          break;
      }
    });

    // Kept events are, by definition, the cascade's "bear" verdicts: their
    // cards show that verdict active with a one-tap "Mark as not bear" beside
    // it. Saved-run display renders the verdict read-only (no execution).
    const keptCardsInteractive = results?._isDisplayingSavedRun !== true;
    const keptCard = (entry) =>
      this.generateEventCard(entry.event, provenanceRunInfo, {
        bearIdx: `k${entry.index}`,
        bearVerdict: "bear",
        interactive: keptCardsInteractive,
      });

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bear Event Scraper Results</title>
    <style>
        :root {
            /* Typography. NOTHING here may be a network request: WKWebView
               blocks first paint on an external stylesheet, so the Google
               Fonts stylesheet element that used to sit above this style
               block turned any stalled/blocked/slow font fetch into a white
               screen for as long as the request took to time out —
               indistinguishable from a crash. The system stack is already
               installed on the device, costs zero bytes and zero requests,
               and paints immediately. */
            --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;

            /* chunky.dad brand colors - light mode */
            --primary-color: #667eea;
            --secondary-color: #ff6b6b;
            --accent-color: #764ba2;
            --text-primary: #333;
            --text-secondary: #666;
            --text-inverse: #ffffff;
            --background-primary: #ffffff;
            --background-light: #f8f9ff;
            --gradient-primary: linear-gradient(135deg, var(--primary-color) 0%, var(--accent-color) 100%);
            --border-color: rgba(102, 126, 234, 0.1);
            --card-shadow: 0 4px 15px rgba(0,0,0,0.08);
            --card-hover-shadow: 0 8px 25px rgba(102, 126, 234, 0.15);
        }

        ${
          isDarkMode
            ? `
        :root {
            /* Dark mode overrides for better bar/low-light readability */
            --primary-color: #8b9cf7;
            --secondary-color: #ff8a8a;
            --accent-color: #9575cd;
            --text-primary: #e0e0e0;
            --text-secondary: #b0b0b0;
            --text-inverse: #1a1a1a;
            --background-primary: #2d2d2d;
            --background-light: #1a1a1a;
            --gradient-primary: linear-gradient(135deg, var(--primary-color) 0%, var(--accent-color) 100%);
            --border-color: rgba(139, 156, 247, 0.2);
            --card-shadow: 0 4px 15px rgba(0,0,0,0.3);
            --card-hover-shadow: 0 8px 25px rgba(139, 156, 247, 0.25);
        }
        `
            : ""
        }
        
        body {
            font-family: var(--font-sans);
            margin: 0;
            padding: 20px;
            background-color: var(--background-light);
            color: var(--text-primary);
            line-height: 1.6;
        }
        
        /* Global link styles */
        a {
            color: var(--primary-color);
            text-decoration: none;
            transition: color 0.2s ease;
        }
        
        a:hover {
            color: var(--accent-color);
            text-decoration: underline;
        }
        
        .header {
            background: var(--gradient-primary);
            color: var(--text-inverse);
            padding: 30px;
            border-radius: 15px;
            margin-bottom: 30px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            position: relative;
            overflow: hidden;
        }
        
        .header-controls {
            margin-top: 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 20px;
        }
        
        .display-toggle {
            display: flex;
            align-items: center;
            gap: 10px;
            background: rgba(255, 255, 255, 0.1);
            padding: 8px 16px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
        }
        
        .sfw-toggle {
            display: flex;
            align-items: center;
            cursor: pointer;
            user-select: none;
        }
        
        .sfw-toggle input[type="checkbox"] {
            display: none;
        }
        
        .toggle-slider {
            width: 50px;
            height: 24px;
            background-color: rgba(255, 255, 255, 0.3);
            border-radius: 12px;
            position: relative;
            transition: background-color 0.3s ease;
            margin-right: 10px;
        }
        
        .toggle-slider::before {
            content: '';
            position: absolute;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background-color: white;
            top: 2px;
            left: 2px;
            transition: transform 0.3s ease;
        }
        
        .sfw-toggle input[type="checkbox"]:checked + .toggle-slider {
            background-color: rgba(255, 255, 255, 0.8);
        }
        
        .sfw-toggle input[type="checkbox"]:checked + .toggle-slider::before {
            transform: translateX(26px);
        }
        
        .toggle-label {
            color: var(--text-inverse);
            font-weight: 500;
            font-size: 14px;
        }
        
        .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: radial-gradient(circle at 30% 70%, rgba(255, 255, 255, 0.1) 0%, transparent 50%),
                        radial-gradient(circle at 70% 30%, rgba(255, 255, 255, 0.05) 0%, transparent 50%);
            pointer-events: none;
        }
        
        .header-content {
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            gap: 20px;
        }
        
        .header-logo {
            width: 80px;
            height: 80px;
            border-radius: 15px;
            transition: transform 0.3s ease;
            display: block;
            flex-shrink: 0;
        }
        
        .header-logo:hover {
            transform: scale(1.05);
        }
        
        .header h1 {
            margin: 0;
            font-size: 28px;
            position: relative;
            z-index: 1;
            font-weight: 700;
            line-height: 1.2;
            flex: 1;
        }
        
        .header-title {
            font-size: 32px;
            font-weight: 700;
            margin-bottom: 5px;
        }
        
        .header-subtitle {
            font-size: 18px;
            font-weight: 400;
            opacity: 0.9;
        }
        
        .header-run-context {
            font-size: 12px;
            font-weight: 500;
            opacity: 0.85;
            margin-top: 6px;
        }

        .header-health-badge {
            display: inline-block;
            font-size: 12px;
            font-weight: 600;
            margin-top: 6px;
            padding: 3px 10px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.15);
            border: 1px solid rgba(255, 255, 255, 0.25);
        }

        .header-health-badge.warn {
            background: rgba(254, 202, 87, 0.25);
            border-color: rgba(254, 202, 87, 0.6);
        }
        
        .disclaimer {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
            text-align: center;
        }
        
        .disclaimer-content {
            color: var(--text-inverse);
            font-size: 14px;
            font-weight: 500;
            opacity: 0.9;
        }
        
        .header .stats {
            display: flex;
            gap: 30px;
            margin-top: 20px;
            position: relative;
            z-index: 1;
        }
        
        .stat {
            display: flex;
            flex-direction: column;
            text-align: center;
        }
        
        .stat-value {
            font-size: 32px;
            font-weight: 700;
            text-shadow: 0 2px 10px rgba(0,0,0,0.2);
        }
        
        .stat-label {
            font-size: 14px;
            opacity: 0.9;
            font-weight: 400;
        }
        
        .section {
            background: var(--background-primary);
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 20px;
            box-shadow: var(--card-shadow);
            border: 1px solid var(--border-color);
        }
        
        .section-header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid var(--border-color);
        }
        
        .section-icon {
            font-size: 24px;
            margin-right: 10px;
        }
        
        .section-title {
            font-size: 20px;
            font-weight: 600;
            flex: 1;
        }
        
        .section-count {
            background: var(--gradient-primary);
            color: var(--text-inverse);
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        }

        .log-copy-btn {
            margin-left: 10px;
            padding: 4px 10px;
            font-size: 12px;
            background: var(--primary-color);
            color: var(--text-inverse);
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-family: var(--font-sans);
            font-weight: 500;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        }

        .log-copy-btn:hover {
            transform: translateY(-1px);
        }
        
        .event-card {
            background: var(--background-primary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 16px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: var(--card-shadow);
        }
        
        .event-card:hover {
            box-shadow: var(--card-hover-shadow);
            transform: translateY(-3px);
            border-color: var(--border-color);
        }

        /* Dropped-as-non-bear cards reuse the normal card so they read as real
           events; the accent stripe is the only visual difference. */
        .event-card.bear-dropped-card {
            border-left: 4px solid var(--secondary-color);
        }

        /* Bear verdict row: both directions on every card, active one filled. */
        .bear-verdict-row {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
            margin: 0 0 12px 0;
            padding: 8px 10px;
            background: var(--background-light);
            border: 1px solid var(--border-color);
            border-radius: 10px;
        }

        .bear-verdict-label {
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--text-secondary);
        }

        .bear-verdict-btn {
            font-family: var(--font-sans);
            font-size: 12px;
            font-weight: 600;
            padding: 6px 12px;
            border-radius: 999px;
            border: 1px solid var(--border-color);
            background: var(--background-primary);
            color: var(--text-secondary);
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .bear-verdict-btn:hover:not(:disabled) {
            transform: translateY(-1px);
            border-color: var(--primary-color);
            color: var(--text-primary);
        }

        .bear-verdict-btn.is-active {
            border-color: transparent;
            color: var(--text-inverse);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
        }

        .bear-verdict-btn[data-bear-act="mark-bear"].is-active {
            background: #34c759;
        }

        .bear-verdict-btn[data-bear-act="mark-not-bear"].is-active {
            background: var(--secondary-color);
        }

        .bear-verdict-btn:disabled {
            cursor: default;
            opacity: 0.75;
        }

        .bear-verdict-note {
            font-size: 11px;
            color: var(--text-secondary);
            flex: 1 1 100%;
        }
        
        .event-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--text-primary);
            line-height: 1.3;
            font-family: var(--font-sans);
        }
        
        .event-details {
            display: flex;
            flex-direction: column;
            gap: 8px;
            font-size: 14px;
            color: var(--text-secondary);
            font-family: var(--font-sans);
        }
        
        .event-detail {
            display: flex;
            align-items: flex-start;
            gap: 8px;
        }
        
        .event-detail span:first-child {
            font-size: 16px;
            min-width: 24px;
            text-align: center;
        }
        
        .event-metadata {
            background: var(--background-primary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 10px;
            margin-top: 10px;
            font-size: 13px;
        }
        
        .metadata-item {
            display: flex;
            margin-bottom: 5px;
        }
        
        .metadata-label {
            font-weight: 500;
            margin-right: 8px;
            color: var(--text-secondary);
            min-width: 80px;
        }
        
        .action-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 15px;
            font-size: 12px;
            font-weight: 500;
            margin-bottom: 10px;
        }
        
        .badge-new {
            background: var(--gradient-primary);
            color: var(--text-inverse);
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        }
        
        .badge-new::before {
            content: "➕ ";
        }
        
        .badge-merge {
            background: linear-gradient(45deg, var(--primary-color), var(--secondary-color));
            color: var(--text-inverse);
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        }
        
        .badge-merge::before {
            content: "🔀 ";
        }
        
        .badge-conflict {
            background: var(--secondary-color);
            color: var(--text-inverse);
            box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
        }
        
        .badge-conflict::before {
            content: "⚠️ ";
        }
        
        .badge-warning {
            background: var(--secondary-color);
            color: var(--text-inverse);
            box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
        }
        
        .badge-warning::before {
            content: "⚠️ ";
        }
        
        .badge-error {
            background: var(--secondary-color);
            color: var(--text-inverse);
            box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
        }
        
        .badge-error::before {
            content: "❌ ";
        }

        .write-action-note {
            margin: -4px 0 10px;
            font-size: 12px;
            color: var(--text-secondary);
        }
        
        .conflict-info {
            background: ${isDarkMode ? "rgba(255, 193, 7, 0.1)" : "#fff3cd"};
            border: 1px solid ${isDarkMode ? "rgba(255, 193, 7, 0.3)" : "#ffeaa7"};
            border-radius: 8px;
            padding: 10px;
            margin-top: 10px;
            font-size: 13px;
            color: ${isDarkMode ? "#ffc107" : "#856404"};
        }
        
        .existing-info {
            background: ${isDarkMode ? "rgba(23, 162, 184, 0.1)" : "#d1ecf1"};
            border: 1px solid ${isDarkMode ? "rgba(23, 162, 184, 0.3)" : "#bee5eb"};
            border-radius: 8px;
            padding: 10px;
            margin-top: 10px;
            font-size: 13px;
            color: ${isDarkMode ? "#17a2b8" : "#0c5460"};
        }
        
        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--text-secondary);
            font-family: var(--font-sans);
        }
        
        .error-item {
            background: rgba(255, 107, 107, 0.1);
            border: 1px solid rgba(255, 107, 107, 0.3);
            border-radius: 12px;
            padding: 15px;
            margin-bottom: 10px;
            font-size: 14px;
            color: var(--secondary-color);
            font-family: var(--font-sans);
            font-weight: 500;
        }
        
        .calendar-status {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px;
            background: #f0f0f0;
            border-radius: 8px;
            margin-bottom: 10px;
        }
        
        .status-icon {
            font-size: 20px;
        }
        
        .notes-preview {
            background: ${isDarkMode ? "#242424" : "#f8f8f8"};
            border-left: 3px solid var(--primary-color);
            padding: 12px;
            margin-top: 10px;
            font-size: 13px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            max-height: 280px;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            color: var(--text-primary);
        }
        
        .diff-view {
            border: 1px solid var(--border-color);
            border-radius: 8px;
            background: var(--background-primary);
            position: relative;
        }

        /* Shared chrome that used to be repeated as an inline style="" on
           every copy button, every merge-table cell and every line-diff row.
           At ~200 bytes a copy and ~2400 table cells per big run that
           repetition alone was ~300 KB of the 3198 KB page. */
        .copy-json-btn {
            padding: 4px 8px;
            font-size: 11px;
            background: var(--primary-color);
            color: var(--text-inverse);
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-family: var(--font-sans);
            font-weight: 500;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        }

        .raw-json {
            font-size: 11px;
            background: #333;
            color: #fff;
            padding: 10px;
            border-radius: 5px;
            overflow-x: auto;
        }

        .payload-cap-note {
            font-size: 11px;
            color: var(--warn-color);
            margin-bottom: 6px;
            line-height: 1.5;
        }

        .cmp-table {
            width: 100%;
            font-size: 12px;
            border-collapse: collapse;
            table-layout: auto;
        }

        .cmp-table th,
        .cmp-table td {
            padding: 5px;
            border-bottom: 1px solid var(--border-color);
            word-wrap: break-word;
            overflow-wrap: break-word;
            word-break: break-word;
            color: var(--text-primary);
            text-align: left;
        }

        .cmp-table th { vertical-align: bottom; }
        .cmp-table td.cmp-field { vertical-align: top; }
        .cmp-table td.cmp-field small { color: var(--text-secondary); }
        .cmp-table th.cmp-flow,
        .cmp-table td.cmp-flow {
            text-align: center;
            font-size: 16px;
            color: var(--primary-color);
            word-break: normal;
        }
        .cmp-table td.cmp-result { text-align: center; }

        .notes-line { margin: 2px 0; }
        .notes-line strong { color: #666; }

        /* "…+N chars" affordance on a truncated diff value. */
        .cmp-more {
            color: var(--text-secondary);
            font-size: 10px;
            white-space: nowrap;
        }

        .notes-preview strong {
            font-weight: 600;
            color: var(--text-primary);
        }
        
        details {
            background: ${isDarkMode ? "rgba(255, 255, 255, 0.05)" : "rgba(255, 255, 255, 0.5)"};
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 5px;
            transition: all 0.2s ease;
        }
        
        details summary {
            padding: 5px 10px;
            font-weight: 500;
            user-select: none;
            outline: none;
            list-style: none;
        }
        
        details summary::-webkit-details-marker {
            display: none;
        }
        
        details summary:before {
            content: '▶';
            display: inline-block;
            margin-right: 5px;
            transition: transform 0.2s ease;
        }
        
        details[open] summary:before {
            transform: rotate(90deg);
        }
        
        details summary:hover {
            background: ${isDarkMode ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.05)"};
            border-radius: 5px;
        }
        
        details[open] {
            background: ${isDarkMode ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.8)"};
        }
        
        details[open] summary {
            border-bottom: 1px solid var(--border-color);
            margin-bottom: 10px;
        }

        /* Event description styling for readability */
        .event-description {
            background: ${isDarkMode ? "rgba(102, 126, 234, 0.12)" : "#f0f8ff"};
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 8px;
            margin-top: 8px;
            color: var(--text-primary);
        }

        /* Cleaner, larger image presentation */
        .event-image {
            margin: 10px 0 12px 0;
            text-align: center;
        }
        .event-image img {
            width: 100%;
            max-width: 560px;
            max-height: 340px;
            height: auto;
            border-radius: 12px;
            object-fit: cover;
            box-shadow: 0 4px 12px ${isDarkMode ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.15)"};
            border: 2px solid var(--border-color);
            transition: transform 0.2s ease;
        }
        .event-image img:hover { transform: scale(1.01); }

        /* Line-by-line diff styling - dark-mode friendly */
        .diff-line { 
            padding: 6px 8px; 
            margin: 3px 0; 
            border-left: 3px solid; 
            border-radius: 4px; 
            font-family: 'SF Mono', Monaco, 'Courier New', monospace;
            word-wrap: break-word;
            overflow-wrap: break-word;
            word-break: break-all;
            max-width: 100%;
            overflow-x: auto;
        }
        .diff-meta { color: var(--text-secondary); font-size: 10px; }
        .diff-header { color: var(--text-secondary); font-size: 11px; margin-bottom: 4px; font-weight: bold; }
        .diff-sep { border-top: 1px solid var(--border-color); margin: 8px 0 4px 0; }
        .diff-added {
            background: ${isDarkMode ? "rgba(52, 208, 88, 0.12)" : "#e6ffec"};
            border-left-color: #34d058;
            color: ${isDarkMode ? "#c8facc" : "#166534"};
        }
        .diff-removed {
            background: ${isDarkMode ? "rgba(215, 58, 73, 0.14)" : "#ffeef0"};
            border-left-color: #d73a49;
            color: ${isDarkMode ? "#ffb3ba" : "#7f1d1d"};
        }
        .diff-context {
            background: ${isDarkMode ? "rgba(255, 193, 7, 0.12)" : "#fff3cd"};
            border-left-color: #ffc107;
            color: ${isDarkMode ? "#ffe08a" : "#7a5e00"};
        }
        .diff-same {
            background: ${isDarkMode ? "rgba(3, 102, 214, 0.14)" : "#f1f8ff"};
            border-left-color: #0366d6;
            color: ${isDarkMode ? "#9ecbff" : "#0b3e86"};
        }
        .diff-ignored {
            background: ${isDarkMode ? "rgba(219, 171, 9, 0.16)" : "#fff5b4"};
            border-left-color: #dbab09;
            color: ${isDarkMode ? "#ffe79a" : "#7a5e00"};
        }
        .diff-merged {
            background: ${isDarkMode ? "rgba(52, 208, 88, 0.14)" : "#e6ffec"};
            border-left-color: #34d058;
            color: ${isDarkMode ? "#bbf7d0" : "#166534"};
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
            body {
                padding: 10px;
            }
            
            .header {
                padding: 20px;
                margin-bottom: 20px;
            }
            
            .header h1 {
                font-size: 24px;
                font-weight: 700;
            }
            
            .header-logo {
                width: 60px;
                height: 60px;
            }
            
            .header-content {
                gap: 15px;
                flex-direction: column;
                text-align: center;
            }
            
            .header-content .header-logo {
                align-self: center;
            }
            
            .header .stats {
                flex-direction: column;
                gap: 15px;
            }
            
            .stat {
                text-align: center;
            }
            
            .controls-section {
                flex-direction: column !important;
                gap: 15px !important;
                align-items: stretch !important;
            }
            
            .search-container {
                max-width: none !important;
                order: 2;
            }
            
            .display-toggle {
                justify-content: center;
                order: 1;
            }
            
            .action-buttons {
                justify-content: center;
                order: 3;
            }
            
            .action-buttons button {
                flex: 1;
                max-width: 150px;
            }
            
            .section {
                padding: 15px;
            }
            
            .event-card {
                margin-bottom: 15px;
            }
            
            .event-title {
                font-size: 16px;
            }
            
            .event-detail {
                font-size: 13px;
                padding: 6px 0;
            }
            
            .raw-display {
                font-size: 11px;
                max-height: 200px;
            }
            
            .diff-view {
                padding: 8px !important;
            }
        }
        
        @media (max-width: 480px) {
            .header .stats {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
            }
            
            .stat:last-child {
                grid-column: 1 / -1;
            }
            
            .action-buttons {
                flex-direction: column;
            }
            
            .action-buttons button {
                max-width: none;
            }
            
            .diff-view {
                padding: 6px !important;
            }
        }
        
        details pre {
            margin: 0;
            font-family: 'SF Mono', Monaco, 'Courier New', monospace;
        }
        
        .coordinates {
            font-family: monospace;
            font-size: 12px;
            color: var(--text-secondary);
        }
        
        .controls-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            align-items: center;
        }
        
        @media (max-width: 768px) {
            .controls-grid {
                grid-template-columns: 1fr;
                gap: 20px;
            }
        }
        
        .control-group {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .control-label {
            font-weight: 600;
            font-size: 16px;
            color: var(--text-primary);
            margin-bottom: 8px;
        }
        
        .control-toggle {
            display: flex;
            align-items: center;
            gap: 12px;
            justify-content: center;
        }
        
        .toggle-label {
            font-weight: 500;
            font-size: 14px;
            color: var(--text-secondary);
            transition: color 0.3s ease;
        }
        
        .modern-toggle {
            position: relative;
            display: inline-block;
            width: 50px;
            height: 28px;
        }
        
        .modern-toggle input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        
        .toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(135deg, #e0e0e0, #c0c0c0);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            border-radius: 28px;
            box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .toggle-slider:before {
            position: absolute;
            content: "";
            height: 22px;
            width: 22px;
            left: 3px;
            bottom: 3px;
            background: linear-gradient(135deg, #ffffff, #f0f0f0);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            border-radius: 50%;
            box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        }
        
        .modern-toggle input:checked + .toggle-slider {
            background: linear-gradient(135deg, var(--primary-color), #667eea);
            box-shadow: inset 0 2px 4px rgba(102, 126, 234, 0.3);
        }
        
        .modern-toggle input:checked + .toggle-slider:before {
            transform: translateX(22px);
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
        }
        
        .modern-toggle:hover .toggle-slider {
            box-shadow: inset 0 2px 6px rgba(0,0,0,0.15);
        }
        
        .modern-toggle:hover input:checked + .toggle-slider {
            box-shadow: inset 0 2px 6px rgba(102, 126, 234, 0.4);
        }
        
        .raw-display {
            display: none;
            background: ${isDarkMode ? "#1e1e1e" : "#f8f8f8"};
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 15px;
            margin-top: 10px;
            font-family: monospace;
            font-size: 12px;
            line-height: 1.4;
            white-space: pre-wrap;
            max-height: 300px;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            color: var(--text-primary);
        }

        .log-details {
            margin-top: 10px;
        }

        .discovery-output {
            background: ${isDarkMode ? "#1e1e1e" : "#f8f8f8"};
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 12px;
            font-family: monospace;
            font-size: 12px;
            line-height: 1.5;
            white-space: pre-wrap;
            max-height: 300px;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            color: var(--text-primary);
        }

        .disc-tab-btn {
            padding: 4px 12px;
            background: var(--background-light);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
            font-family: var(--font-sans);
            color: var(--text-primary);
            transition: all 0.2s ease;
        }

        .disc-tab-btn.disc-tab-active {
            background: var(--primary-color);
            color: var(--text-inverse);
            border-color: var(--primary-color);
        }

        .log-empty {
            color: var(--text-secondary);
            font-size: 14px;
        }

        /* Injected by applyResultsHtmlSizeGuard when the page is over budget. */
        .results-size-warning {
            margin: 0;
            padding: 12px 16px;
            background: ${isDarkMode ? "rgba(255, 204, 128, 0.15)" : "rgba(239, 108, 0, 0.12)"};
            color: ${isDarkMode ? "#ffcc80" : "#ef6c00"};
            font-size: 13px;
            line-height: 1.5;
            font-weight: 600;
        }

        /* Per-event provenance section (built by event-provenance.js) */
        .provenance-details {
            margin-top: 12px;
            border-top: 1px solid var(--border-color);
            padding-top: 8px;
        }

        .provenance-details > summary {
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            color: var(--primary-color);
            padding: 5px 0;
        }

        .provenance-meta {
            font-size: 11px;
            color: var(--text-secondary);
            margin: 4px 0;
        }

        .provenance-url {
            font-family: monospace;
            word-break: break-all;
        }

        .provenance-table-wrap {
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            margin-top: 6px;
        }

        .provenance-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
        }

        .provenance-table th {
            text-align: left;
            padding: 4px 6px;
            border-bottom: 1px solid var(--border-color);
            color: var(--text-primary);
            white-space: nowrap;
        }

        .provenance-table td {
            padding: 4px 6px;
            border-bottom: 1px solid var(--border-color);
            color: var(--text-primary);
            word-break: break-word;
            vertical-align: top;
        }

        .provenance-table .provenance-field {
            font-family: monospace;
            font-weight: 600;
            white-space: nowrap;
        }

        .provenance-table .provenance-missing {
            color: var(--text-secondary);
        }

        .provenance-table .provenance-decision {
            color: var(--text-secondary);
            font-style: italic;
        }

        .provenance-note {
            color: var(--text-secondary);
            font-size: 11px;
            margin: 6px 0 0;
        }

        .provenance-export {
            margin-top: 10px;
        }

        .provenance-export-btn {
            padding: 4px 10px;
            font-size: 11px;
            background: var(--primary-color);
            color: var(--text-inverse);
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-family: var(--font-sans);
            font-weight: 500;
        }

        .provenance-export-text {
            width: 100%;
            box-sizing: border-box;
            margin-top: 8px;
            font-family: monospace;
            font-size: 10px;
            background: var(--background-light);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 8px;
        }

        .provenance-export-status {
            font-size: 11px;
            font-weight: 600;
            color: var(--primary-color);
            margin-top: 4px;
        }

        .event-card.raw-mode .event-details,
        .event-card.raw-mode .event-metadata,
        .event-card.raw-mode .existing-info,
        .event-card.raw-mode .conflict-info,
        .event-card.raw-mode details:not(.raw-json-details) {
            display: none !important;
        }
        
        .event-card.raw-mode .raw-display {
            display: block;
        }
        
        .event-card.raw-mode {
            background: #1e1e1e;
            border-color: #333;
        }
        
        .event-card.raw-mode .event-title {
            color: #fff;
            font-family: monospace;
            font-size: 14px;
        }
        
        .event-card.raw-mode .action-badge {
            background: #333;
            border: 1px solid #555;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <img src="${headerLogoSrc}" 
                 alt="chunky.dad logo" class="header-logo">
            <h1>
                <div class="header-title">chunky.dad</div>
                <div class="header-subtitle">Bear Event Scraper Results</div>
                <div class="header-run-context">${runMetaLabel}</div>
                ${runHealthBadgeHtml}
            </h1>
        </div>
        <div class="header-controls">
            <!-- Controls moved to a separate section below -->
        </div>
        <div class="stats">
            <div class="stat">
                <div class="stat-value">${results.totalEvents}</div>
                <div class="stat-label">Total Events Found</div>
            </div>
            <div class="stat">
                <div class="stat-value">${results.rawBearEvents || "N/A"}</div>
                <div class="stat-label">Raw Bear Events</div>
            </div>
            <div class="stat">
                <div class="stat-value">${results.bearEvents}</div>
                <div class="stat-label">Final Bear Events${results.duplicatesRemoved > 0 ? ` (-${results.duplicatesRemoved} dupes)` : ""}</div>
            </div>
            <div class="stat">
                <div class="stat-value">${results.calendarEvents}</div>
                <div class="stat-label">Calendar Actions${results.calendarEvents === 0 ? " (dry run/preview mode)" : ""}</div>
            </div>
        </div>
    </div>
    
    <div class="controls-section" style="
        background: var(--background-primary);
        border-radius: 15px;
        padding: 20px;
        margin-bottom: 20px;
        box-shadow: var(--card-shadow);
    ">
        <div class="controls-grid">
            <div class="control-group">
                <div class="control-label">Display Mode</div>
                <div class="control-toggle">
                    <span class="toggle-label">Pretty</span>
                    <label class="modern-toggle">
                        <input type="checkbox" id="displayToggle" onchange="toggleDisplayMode()">
                        <span class="toggle-slider"></span>
                    </label>
                    <span class="toggle-label">Raw</span>
                </div>
            </div>
            
            <div class="control-group">
                <div class="control-label">Images</div>
                <div class="control-toggle">
                    <span class="toggle-label">Hide</span>
                    <label class="modern-toggle">
                        <input type="checkbox" id="sfwToggle" onchange="toggleImages()" checked>
                        <span class="toggle-slider"></span>
                    </label>
                    <span class="toggle-label">Show</span>
                </div>
            </div>
        </div>
    </div>
    
    <div class="controls-section" style="
        background: var(--background-primary);
        border-radius: 15px;
        padding: 20px;
        margin-bottom: 20px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.08);
        border: 1px solid rgba(102, 126, 234, 0.1);
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        align-items: center;
        justify-content: space-between;
    ">
        
        <div class="search-container" style="
            display: flex;
            align-items: center;
            gap: 10px;
            flex-grow: 1;
            max-width: 400px;
        ">
            <span style="font-weight: 500;">🔍</span>
            <input type="text" id="searchInput" placeholder="Search events..." onkeyup="filterEvents()" style="
                flex-grow: 1;
                padding: 8px 12px;
                border: 2px solid rgba(102, 126, 234, 0.2);
                border-radius: 8px;
                font-size: 14px;
                outline: none;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                font-family: var(--font-sans);
                background: var(--background-primary);
            " onfocus="this.style.borderColor='var(--primary-color)'; this.style.boxShadow='0 0 0 3px rgba(102, 126, 234, 0.1)'" 
               onblur="this.style.borderColor='rgba(102, 126, 234, 0.2)'; this.style.boxShadow='none'">
            <button onclick="clearSearch()" style="
                padding: 6px 10px;
                background: var(--background-light);
                border: 1px solid rgba(102, 126, 234, 0.2);
                border-radius: 6px;
                font-size: 12px;
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                font-family: var(--font-sans);
                color: var(--text-primary);
            " onmouseover="this.style.background='var(--primary-color)'; this.style.color='var(--text-inverse)'; this.style.transform='translateY(-1px)'" 
               onmouseout="this.style.background='var(--background-light)'; this.style.color='var(--text-primary)'; this.style.transform='translateY(0)'">
                Clear
            </button>
        </div>
        
        <div class="action-buttons" style="display: flex; gap: 10px;">
            <button onclick="copyRawOutput()" style="
                padding: 8px 16px;
                background: var(--primary-color);
                color: var(--text-inverse);
                border: none;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
                font-family: var(--font-sans);
            " onmouseover="this.style.background='var(--accent-color)'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 15px rgba(102, 126, 234, 0.4)'" 
               onmouseout="this.style.background='var(--primary-color)'; this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(102, 126, 234, 0.3)'">
                📋 Copy Raw Output
            </button>
            
            <button onclick="exportAsJSON()" style="
                padding: 8px 16px;
                background: var(--secondary-color);
                color: var(--text-inverse);
                border: none;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
                font-family: var(--font-sans);
            " onmouseover="this.style.background='#ff5252'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 15px rgba(255, 107, 107, 0.4)'" 
               onmouseout="this.style.background='var(--secondary-color)'; this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(255, 107, 107, 0.3)'">
                📄 Export JSON
            </button>
        </div>
    </div>
    
    ${
      newEvents.length > 0
        ? `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">✨</span>
            <span class="section-title">New Events to Add</span>
            <span class="section-count">${newEvents.length}</span>
        </div>
        ${newEvents.map(keptCard).join("")}
    </div>
    `
        : ""
    }
    
    ${
      mergeEvents.length > 0
        ? `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">🔀</span>
            <span class="section-title">Events to Merge (Adding Info)</span>
            <span class="section-count">${mergeEvents.length}</span>
        </div>
        ${mergeEvents.map(keptCard).join("")}
    </div>
    `
        : ""
    }
    
    ${
      conflictEvents.length > 0
        ? `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">⚠️</span>
                            <span class="section-title">Events Requiring Review</span>
            <span class="section-count">${conflictEvents.length}</span>
        </div>
        ${conflictEvents.map(keptCard).join("")}
    </div>
    `
        : ""
    }
    
    ${
      results.errors && results.errors.length > 0
        ? `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">❌</span>
            <span class="section-title">Errors</span>
            <span class="section-count">${results.errors.length}</span>
        </div>
        ${results.errors
          .map(
            (error) => `
            <div class="error-item">${this.escapeHtml(error)}</div>
        `,
          )
          .join("")}
    </div>
    `
        : ""
    }
    
    ${
      allEvents.length === 0 &&
      !results.parserResults?.some((r) => r.discoveryOnly)
        ? `
    <div class="section">
        <div class="empty-state">
            <div style="font-size: 48px; margin-bottom: 20px;">🔍</div>
            <div>No events found to process</div>
        </div>
    </div>
    `
        : ""
    }

    ${this.generateSeriesChangeProposalSection(results)}${this.generateBearDroppedSection(results)}

    ${this.generateDiscoveredVenueSection(results)}

    ${newVenueSectionHtml}

    ${this.generateDiscoverySection(results)}

    ${logSectionHtml}
    
    <script>
        // Discovered-venue copy buttons signal native via a custom-scheme
        // navigation intercepted by shouldAllowRequest (set before present()) —
        // the same battle-tested webview→native pattern as the review UI. The
        // nonce makes each tap a distinct navigation so repeat taps still fire.
        // The snippet text itself stays native-side, keyed by venue index.
        window.__venueCopyNonce = 0;
        function copyVenueEntry(btn) {
            var venueIndex = btn ? (btn.getAttribute('data-venue-index') || '') : '';
            window.location.href = 'chunkyscrape://act?a=copy-venue&id=' +
                encodeURIComponent(venueIndex) + '&n=' + (window.__venueCopyNonce++);
        }
        function markVenueEntryCopied(venueIndex) {
            try {
                var btn = document.querySelector('.venue-copy-btn[data-venue-index="' + venueIndex + '"]');
                if (btn) {
                    btn.textContent = '✅ Copied!';
                    setTimeout(function () { btn.textContent = '📋 Copy parser entry'; }, 2000);
                }
            } catch (ignore) {}
        }

        // Manual bear/not-bear override buttons use the same chunkyscrape://
        // navigation bridge (shouldAllowRequest, set before present()); the
        // per-tap nonce keeps repeat taps firing as distinct navigations.
        window.__bearOverrideNonce = 0;
        function markBearOverride(btn) {
            var idx = btn ? (btn.getAttribute('data-bear-idx') || '') : '';
            var act = btn ? (btn.getAttribute('data-bear-act') || '') : '';
            if (act !== 'mark-bear' && act !== 'mark-not-bear') return;
            window.location.href = 'chunkyscrape://act?a=' + encodeURIComponent(act) +
                '&id=' + encodeURIComponent(idx) + '&n=' + (window.__bearOverrideNonce++);
        }
        // Feedback flips which of the card's two verdict buttons reads as
        // active, so the tile always shows the verdict that will be saved.
        function markBearOverrideDone(idx, act) {
            try {
                var buttons = document.querySelectorAll('.bear-override-btn[data-bear-idx="' + idx + '"]');
                for (var i = 0; i < buttons.length; i++) {
                    var isTapped = buttons[i].getAttribute('data-bear-act') === act;
                    if (isTapped) {
                        buttons[i].classList.add('is-active');
                    } else {
                        buttons[i].classList.remove('is-active');
                    }
                }
                var row = buttons.length > 0 ? buttons[0].closest('.bear-verdict-row') : null;
                if (row) {
                    row.setAttribute('data-bear-verdict', act === 'mark-bear' ? 'bear' : 'not-bear');
                    var note = row.querySelector('.bear-verdict-note');
                    if (!note) {
                        note = document.createElement('span');
                        note.className = 'bear-verdict-note';
                        row.appendChild(note);
                    }
                    note.textContent = act === 'mark-bear' ? 'Marked as bear ✓ (applied when you close this view)' : 'Marked as not bear ✓ (applied when you close this view)';
                }
            } catch (ignore) {}
        }

        // "Queue for bars data" buttons use the same chunkyscrape://
        // navigation bridge (shouldAllowRequest, set before present()); the
        // per-tap nonce keeps repeat taps firing as distinct navigations.
        window.__venueQueueNonce = 0;
        function queueVenueCandidate(btn) {
            var idx = btn ? (btn.getAttribute('data-nvq-index') || '') : '';
            window.location.href = 'chunkyscrape://act?a=queue-venue&id=' +
                encodeURIComponent(idx) + '&n=' + (window.__venueQueueNonce++);
        }
        function markVenueCandidateQueued(idx, timesSeen) {
            try {
                var btn = document.querySelector('.venue-queue-btn[data-nvq-index="' + idx + '"]');
                if (btn) {
                    btn.textContent = 'Queued ✓ (seen ' + timesSeen + ' times)';
                    btn.disabled = true;
                }
            } catch (ignore) {}
        }

        // Map verify links: a plain https href would navigate this WebView
        // away (shouldAllowRequest returns true for normal URLs), so the
        // links route through the same chunkyscrape:// bridge — native looks
        // the real URL up by id and opens Safari ON TOP of the results
        // sheet. Per-tap nonce keeps repeat taps firing as distinct
        // navigations; returning false cancels the default '#' navigation.
        window.__mapVerifyNonce = 0;
        function openMapVerify(el) {
            var id = el ? (el.getAttribute('data-map-url-id') || '') : '';
            window.location.href = 'chunkyscrape://act?a=open-url&id=' +
                encodeURIComponent(id) + '&n=' + (window.__mapVerifyNonce++);
            return false;
        }

        // "Save recurring (.ics)" buttons ride the same chunkyscrape://
        // navigation bridge (shouldAllowRequest, set before present()); the
        // ICS itself is built native-side from the registered event — only
        // the integer id travels. Per-tap nonce keeps repeat taps firing.
        window.__icsExportNonce = 0;
        function exportRecurringIcs(btn) {
            var id = btn ? (btn.getAttribute('data-ics-export-id') || '') : '';
            window.location.href = 'chunkyscrape://act?a=export-ics&id=' +
                encodeURIComponent(id) + '&n=' + (window.__icsExportNonce++);
        }

        // Inline OSM map toggle — pure page JS, no bridge. Lazy by design:
        // the iframe src is only assigned on the FIRST tap (no map tiles
        // load until asked), later taps just show/hide the already-loaded
        // frame. OpenStreetMap embed because it is keyless and matches the
        // Nominatim geocoding stack the scraper already uses; Google Maps
        // embeds require an API key.
        function toggleCandidateMap(btn) {
            try {
                var target = document.getElementById(btn.getAttribute('data-map-target') || '');
                if (!target) return;
                if (target.style.display === 'none') {
                    // Lazy: every iframe in the container (OSM + the legacy
                    // Google embed) gets its src from its own data-map-embed
                    // only on the first reveal — nothing loads until then.
                    var frames = target.tagName === 'IFRAME'
                        ? [target]
                        : target.querySelectorAll('iframe');
                    for (var i = 0; i < frames.length; i++) {
                        if (!frames[i].getAttribute('src')) {
                            frames[i].setAttribute('src', frames[i].getAttribute('data-map-embed') || '');
                        }
                    }
                    target.style.display = 'block';
                    btn.textContent = '🗺️ Hide maps';
                } else {
                    target.style.display = 'none';
                    btn.textContent = '🗺️ Show maps';
                }
            } catch (ignore) {}
        }

        function copyDiscoveryText(btn) {
            const encoded = btn.getAttribute('data-encoded') || '';
            let text = '';
            try {
                text = decodeURIComponent(encoded);
            } catch (e) {
                console.error('copyDiscoveryText: failed to decode data', e);
                alert('Could not decode graph data for copying.');
                return;
            }
            copyTextWithFeedback(text, btn, null);
        }

        function switchDiscoveryTab(btn, tabId) {
            const parser = btn.closest('.discovery-parser');
            if (!parser) return;
            parser.querySelectorAll('.disc-tab-btn').forEach(b => b.classList.remove('disc-tab-active'));
            parser.querySelectorAll('.disc-tab-panel').forEach(t => { t.style.display = 'none'; });
            btn.classList.add('disc-tab-active');
            const panel = document.getElementById(tabId);
            if (panel) panel.style.display = 'block';
        }

        function toggleDisplayMode() {
            const toggle = document.getElementById('displayToggle');
            const eventCards = document.querySelectorAll('.event-card');
            // Raw mode is the first moment the debug dump is actually looked
            // at, so that is when the compact payload gets re-indented.
            if (toggle && toggle.checked) prettyPrintCardPayloads();

            eventCards.forEach(card => {
                if (toggle.checked) {
                    card.classList.add('raw-mode');
                } else {
                    card.classList.remove('raw-mode');
                }
            });
        }
        
        function toggleDiffView(button, safeEventId) {
            const safeEventKey = String(safeEventId || '');
            const tableView = document.getElementById('table-view-' + safeEventKey);
            const lineView = document.getElementById('line-view-' + safeEventKey);
            if (!tableView || !lineView) {
                return;
            }
            
            // Check current state - table view is visible if display is not 'none'
            const isTableVisible = tableView && tableView.style.display !== 'none';
            
            if (isTableVisible) {
                // Switch to line view
                if (tableView) tableView.style.display = 'none';
                if (lineView) lineView.style.display = 'block';
                button.textContent = 'Switch to Table View';
            } else {
                // Switch to table view
                if (tableView) tableView.style.display = 'block';
                if (lineView) lineView.style.display = 'none';
                button.textContent = 'Switch to Line View';
            }
        }
        
        function toggleComparisonSection(safeEventId) {
            const safeEventKey = String(safeEventId || '');
            const content = document.getElementById('comparison-content-' + safeEventKey);
            const icon = document.getElementById('expand-icon-' + safeEventKey);
            const diffToggle = document.getElementById('diff-toggle-' + safeEventKey);
            
            if (content && content.style.display === 'none') {
                content.style.display = 'block';
                if (icon) icon.textContent = '▼';
                if (diffToggle) diffToggle.style.display = 'block';
            } else {
                if (content) content.style.display = 'none';
                if (icon) icon.textContent = '▶';
                if (diffToggle) diffToggle.style.display = 'none';
            }
        }
        
        // Run Logs buttons: the log text is no longer embedded in this page
        // (it was ~450 KB of a file already on disk), so the copy happens
        // natively over the chunkyscrape:// bridge and flashes the button back
        // through markLogsCopied.
        function requestNativeLogCopy(mode) {
            window.location.href = 'chunkyscrape://act?a=copy-logs&id=' + encodeURIComponent(mode);
        }

        function markLogsCopied(mode) {
            const button = document.querySelector('[data-log-copy-mode="' + mode + '"]');
            if (button) showCopySuccess(button);
        }

        function copyLogs() {
            requestNativeLogCopy('full');
        }

        function copyCompactLogs() {
            requestNativeLogCopy('compact');
        }

        // Same move for the prompt bodies (~225 KB as an attribute): native
        // owns the list and presents the picker on top of this sheet.
        function showAiPromptPicker() {
            window.location.href = 'chunkyscrape://act?a=ai-prompts';
        }

        function copyTextWithFeedback(text, button, onSuccess) {
            if (!text) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    if (typeof onSuccess === 'function') onSuccess();
                    if (button) showCopySuccess(button);
                }).catch(err => {
                    console.error('Modern clipboard failed, trying fallback: ', err);
                    const fallbackSucceeded = copyToClipboardFallback(text, button);
                    if (fallbackSucceeded && typeof onSuccess === 'function') onSuccess();
                });
            } else {
                const fallbackSucceeded = copyToClipboardFallback(text, button);
                if (fallbackSucceeded && typeof onSuccess === 'function') onSuccess();
            }
        }

        function copyRawOutput() {
            // Get all event cards
            prettyPrintCardPayloads();
            const eventCards = document.querySelectorAll('.event-card');
            let rawOutput = '';
            
            // Add header
            rawOutput += '🐻 BEAR EVENT SCRAPER - RAW OUTPUT\\n';
            rawOutput += '=' + '='.repeat(50) + '\\n\\n';
            
            // Add summary stats
            const totalEvents = document.querySelector('.stat-value').textContent;
            const bearEvents = document.querySelectorAll('.stat-value')[1].textContent;
            const calendarActions = document.querySelectorAll('.stat-value')[2].textContent;
            
            rawOutput += \`📊 SUMMARY:\\\\n\`;
            rawOutput += \`Total Events: \${totalEvents}\\\\n\`;
            rawOutput += \`Bear Events: \${bearEvents}\\\\n\`;
            rawOutput += \`Calendar Actions: \${calendarActions}\\\\n\\\\n\`;
            
            // Process each event
            eventCards.forEach((card, index) => {
                const title = card.querySelector('.event-title')?.textContent || 'Untitled Event';
                const rawData = card.querySelector('.raw-display')?.textContent || 'No raw data available';
                
                rawOutput += \`EVENT \${index + 1}: \${title}\\\\n\`;
                rawOutput += '-'.repeat(60) + '\\n';
                rawOutput += rawData + '\\n\\n';
            });
            
            // Copy to clipboard with fallback support
            const button = document.querySelector('button[onclick="copyRawOutput()"]');
            
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(rawOutput).then(() => {
                    if (button) showCopySuccess(button);
                }).catch(err => {
                    console.error('Modern clipboard failed, trying fallback: ', err);
                    copyToClipboardFallback(rawOutput, button);
                });
            } else {
                copyToClipboardFallback(rawOutput, button);
            }
        }
        
        function filterEvents() {
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();
            const eventCards = document.querySelectorAll('.event-card');
            const sections = document.querySelectorAll('.section');
            let visibleCount = 0;
            
            eventCards.forEach(card => {
                const title = card.querySelector('.event-title')?.textContent.toLowerCase() || '';
                const venue = card.querySelector('.event-detail span')?.textContent.toLowerCase() || '';
                const content = card.textContent.toLowerCase();
                
                const isVisible = searchTerm === '' || 
                                title.includes(searchTerm) || 
                                venue.includes(searchTerm) || 
                                content.includes(searchTerm);
                
                if (isVisible) {
                    card.style.display = 'block';
                    visibleCount++;
                } else {
                    card.style.display = 'none';
                }
            });
            
            // Update section visibility and counts
            sections.forEach(section => {
                const visibleCards = section.querySelectorAll('.event-card[style*="block"], .event-card:not([style*="none"])').length;
                const sectionCount = section.querySelector('.section-count');
                
                if (visibleCards > 0) {
                    section.style.display = 'block';
                    if (sectionCount) {
                        sectionCount.textContent = visibleCards;
                    }
                } else {
                    section.style.display = 'none';
                }
            });
            
            // Show/hide "no results" message
            let noResultsMsg = document.getElementById('noResultsMessage');
            if (visibleCount === 0 && searchTerm !== '') {
                if (!noResultsMsg) {
                    noResultsMsg = document.createElement('div');
                    noResultsMsg.id = 'noResultsMessage';
                    noResultsMsg.innerHTML = \`
                        <div style="
                            background: white;
                            border-radius: 15px;
                            padding: 40px;
                            margin-bottom: 20px;
                            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
                            text-align: center;
                            color: #666;
                        ">
                            <div style="font-size: 48px; margin-bottom: 20px;">🔍</div>
                            <h3 style="margin: 0 0 10px 0; color: #333;">No events found</h3>
                            <p style="margin: 0; font-size: 14px;">Try adjusting your search terms or clearing the search.</p>
                        </div>
                    \`;
                    document.body.appendChild(noResultsMsg);
                }
                noResultsMsg.style.display = 'block';
            } else if (noResultsMsg) {
                noResultsMsg.style.display = 'none';
            }
        }
        
        function clearSearch() {
            document.getElementById('searchInput').value = '';
            filterEvents();
        }
        
        // Per-event "Export issue" (provenance section). WKWebView has no
        // reliable navigator.clipboard and no window.open, so: reveal a
        // readonly textarea holding the JSON (auto-selects on focus), attempt
        // the legacy execCommand copy, and tell the user which worked.
        function exportProvenanceIssue(button) {
            try {
                const wrapper = button.closest ? button.closest('.provenance-export') : button.parentElement;
                if (!wrapper) return;
                const area = wrapper.querySelector('.provenance-export-area');
                const textarea = wrapper.querySelector('.provenance-export-text');
                const status = wrapper.querySelector('.provenance-export-status');
                if (!area || !textarea || !status) return;

                let text = '';
                try {
                    text = decodeURIComponent(button.getAttribute('data-payload') || '');
                } catch (decodeError) {
                    text = button.getAttribute('data-payload') || '';
                }
                // The attribute carries COMPACT json (percent-encoding charges
                // 3 bytes per indent space). Re-indent for the textarea so what
                // the owner copies is the same readable payload as before.
                try {
                    text = JSON.stringify(JSON.parse(text), null, 2);
                } catch (reindentError) {
                    // Not parseable (older payload, or the error stub) - show as-is.
                }

                area.style.display = 'block';
                textarea.value = text;
                textarea.focus();
                textarea.select();
                if (textarea.setSelectionRange) {
                    textarea.setSelectionRange(0, textarea.value.length);
                }

                let copied = false;
                try {
                    copied = document.execCommand('copy');
                } catch (copyError) {
                    copied = false;
                }
                status.textContent = copied ? 'Copied ✓' : 'Select & copy above';
            } catch (error) {
                console.error('Export issue failed: ' + error);
            }
        }

        // Each card embeds its event JSON exactly ONCE, compact, in
        // .raw-display pre.raw-json. Both the pretty debug dump and the two
        // Copy JSON buttons are derived from that single payload in the DOM
        // instead of being three escaped copies in the HTML string.
        function prettyPrintCardPayloads() {
            const payloads = document.querySelectorAll('pre.raw-json');
            for (let i = 0; i < payloads.length; i++) {
                const pre = payloads[i];
                if (pre.getAttribute('data-pretty') === '1') continue;
                try {
                    pre.textContent = JSON.stringify(JSON.parse(pre.textContent), null, 2);
                } catch (error) {
                    // Leave the payload byte-for-byte as embedded.
                }
                pre.setAttribute('data-pretty', '1');
            }
        }

        // Copy semantics are unchanged from the old data-event-json attribute:
        // the same slimmed event, indented two spaces, minus _original at any
        // depth (the Merge Comparison table is where provenance is read).
        function readCardEventJSON(button) {
            const card = button && button.closest ? button.closest('.event-card') : null;
            const pre = card ? card.querySelector('pre.raw-json') : null;
            const text = pre ? pre.textContent : '';
            if (!text) return '';
            try {
                const parsed = JSON.parse(text, function (key, value) {
                    return key === '_original' ? undefined : value;
                });
                return JSON.stringify(parsed, null, 2);
            } catch (error) {
                return text;
            }
        }

        function copyEventJSON(button) {
            prettyPrintCardPayloads();
            const eventJSON = readCardEventJSON(button);

            // Try modern clipboard API first
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(eventJSON).then(() => {
                    showCopySuccess(button);
                }).catch(err => {
                    console.error('Modern clipboard failed, trying fallback: ', err);
                    copyToClipboardFallback(eventJSON, button);
                });
            } else {
                // Fallback for older WebViews
                copyToClipboardFallback(eventJSON, button);
            }
        }
        
        function copyToClipboardFallback(text, button) {
            try {
                // Create a temporary textarea element
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                
                // Select and copy
                textArea.focus();
                textArea.select();
                
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                
                if (successful) {
                    showCopySuccess(button);
                    return true;
                } else {
                    throw new Error('execCommand failed');
                }
            } catch (err) {
                console.error('Fallback copy failed: ', err);
                // Show the JSON in an alert as last resort
                alert('Copy failed. Here is the JSON data:\\n\\n' + text.substring(0, 500) + (text.length > 500 ? '...' : ''));
                return false;
            }
        }
        
        function showCopySuccess(button) {
            const originalText = button.innerHTML;
                                    button.innerHTML = '✅ Copied!';
                        button.style.background = 'var(--secondary-color)';
            
            setTimeout(() => {
                button.innerHTML = originalText;
                button.style.background = 'var(--primary-color)';
            }, 2000);
        }
        
        function exportAsJSON() {
            prettyPrintCardPayloads();
            const eventCards = document.querySelectorAll('.event-card');
            const exportData = {
                timestamp: new Date().toISOString(),
                summary: {
                    totalEvents: document.querySelector('.stat-value').textContent,
                    bearEvents: document.querySelectorAll('.stat-value')[1].textContent,
                    calendarActions: document.querySelectorAll('.stat-value')[2].textContent
                },
                events: []
            };
            
            eventCards.forEach(card => {
                const title = card.querySelector('.event-title')?.textContent || 'Untitled Event';
                const rawData = card.querySelector('.raw-display')?.textContent || '';
                const action = card.querySelector('.action-badge')?.textContent || 'UNKNOWN';
                
                // Try to parse raw data for structured information
                let eventData = { title, action, rawData };
                
                // Extract key information from the card
                const eventDetails = card.querySelectorAll('.event-detail');
                eventDetails.forEach(detail => {
                    const spans = detail.querySelectorAll('span');
                    if (spans.length >= 2) {
                        const key = spans[0].textContent.trim();
                        const value = spans[1].textContent.trim();
                        
                        // Map emoji keys to readable names
                        const keyMapping = {
                            '📍': 'venue',
                            '📅': 'date',
                            '🕐': 'time',
                            '📱': 'calendar',
                            '☕': 'tea',
                            '📸': 'instagram',
                            '👥': 'facebook',
                            '🌐': 'website',
                            '🗺️': 'googleMaps',
                            '💵': 'price'
                        };
                        
                        const mappedKey = keyMapping[key] || key;
                        eventData[mappedKey] = value;
                    }
                });
                
                exportData.events.push(eventData);
            });
            
            const jsonString = JSON.stringify(exportData, null, 2);
            
            // Copy to clipboard with fallback support
            const button = document.querySelector('button[onclick="exportAsJSON()"]');
            
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(jsonString).then(() => {
                    if (button) {
                        const originalText = button.innerHTML;
                        button.innerHTML = '✅ JSON Copied!';
                        button.style.background = 'var(--primary-color)';
                        
                        setTimeout(() => {
                            button.innerHTML = originalText;
                            button.style.background = 'var(--secondary-color)';
                        }, 2000);
                    }
                }).catch(err => {
                    console.error('Modern clipboard failed, trying fallback: ', err);
                    copyToClipboardFallback(jsonString, button);
                });
            } else {
                copyToClipboardFallback(jsonString, button);
            }
                }
                
        function toggleImages() {
            const toggle = document.getElementById('sfwToggle');
            const imageContainers = document.querySelectorAll('.image-container');
            
            imageContainers.forEach(container => {
                if (toggle.checked) {
                    container.style.display = 'block';
                } else {
                    container.style.display = 'none';
                }
            });
        }

        // -------------------------------------------------------------------
        // Liveness beacons (page → native, same chunkyscrape:// bridge every
        // other button uses; NEVER evaluateJavaScript on a presented WebView).
        //
        // A blank results sheet used to be unfalsifiable: generateRichHTML,
        // loadHTML and present() all return successfully whether WebKit
        // painted the page or its content process died, so the log read
        // exactly the same either way. These two navigations are the page
        // saying "I parsed" and "I painted". Their ABSENCE from the run log
        // is itself the diagnosis — see reportResultsPageLiveness.
        // -------------------------------------------------------------------
        var __beaconQueue = [];
        var __beaconDraining = false;

        function sendResultsBeacon(stage, detail) {
            __beaconQueue.push({ stage: stage, detail: detail });
            if (__beaconDraining) return;
            __beaconDraining = true;
            drainResultsBeacons();
        }

        // Serialized with a small gap: two location assignments in the same
        // task would collapse into one navigation and lose a beacon.
        function drainResultsBeacons() {
            if (!__beaconQueue.length) {
                __beaconDraining = false;
                return;
            }
            var next = __beaconQueue.shift();
            try {
                window.location.href = 'chunkyscrape://act?a=beacon&id=' +
                    encodeURIComponent(String(next.stage)) +
                    '&d=' + encodeURIComponent(String(next.detail == null ? '' : next.detail));
            } catch (error) {
                /* diagnostics must never break the page they are diagnosing */
            }
            setTimeout(drainResultsBeacons, 50);
        }

        // Initialize image display state on page load
        document.addEventListener('DOMContentLoaded', function() {
            toggleImages();
            sendResultsBeacon('dom-ready', document.querySelectorAll('.event-card').length + ' cards');
            // Two frames deep: the first callback can be scheduled before the
            // first paint, the second only runs after one has happened. If
            // rendering is blocked, this beacon never fires — which is the
            // distinction the log could not make before.
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(function() {
                    requestAnimationFrame(function() {
                        sendResultsBeacon('painted', (document.body ? document.body.scrollHeight : 0) + 'px');
                    });
                });
            }
            // One gesture-backed beacon, so "no beacons" can be told apart
            // from "programmatic navigation was suppressed": if the page is
            // visible enough to touch, this one gets through regardless.
            var interactionBeaconSent = false;
            document.addEventListener('touchstart', function() {
                if (interactionBeaconSent) return;
                interactionBeaconSent = true;
                sendResultsBeacon('interacted', 'first touch');
            }, true);
        });
    </script>
</body>
</html>
        `;

    this.logEventJsonBudgetReport();
    this.logMergeDiffBudgetReport();

    return this.applyResultsHtmlSizeGuard(html, budgetedCardCount);
  }

  buildRunLogSectionHtml(logInfo, promptInfo = null) {
    if (!logInfo) {
      return "";
    }
    const runLabel = logInfo.runId ? `run ${logInfo.runId}` : "this run";
    if (!logInfo.exists) {
      let emptyMessage = `No logs available for ${runLabel}.`;
      if (logInfo.reason === "missing-run-id") {
        emptyMessage = "No run ID available for log lookup.";
      } else if (logInfo.reason === "missing-log-file") {
        emptyMessage = `No log file found for ${runLabel}.`;
      } else if (logInfo.reason === "empty-log-file") {
        emptyMessage = `Log file for ${runLabel} is empty.`;
      } else if (logInfo.reason === "read-failed") {
        emptyMessage = `Log file for ${runLabel} could not be read.`;
      }
      return `
    <div class="section log-section">
        <div class="section-header">
            <span class="section-icon">LOG</span>
            <span class="section-title">Run Logs</span>
            <span class="section-count">0</span>
        </div>
        <div class="log-empty">${this.escapeHtml(emptyMessage)}</div>
    </div>
            `;
    }

    const totalLines = Number.isFinite(logInfo.totalLines)
      ? logInfo.totalLines
      : logInfo.shownLines || 0;
    const shownLines = Number.isFinite(logInfo.shownLines)
      ? logInfo.shownLines
      : totalLines;
    const summaryLabel = logInfo.truncated
      ? `Showing last ${shownLines} of ${totalLines} lines`
      : `Showing ${totalLines} lines`;
    const prompts = Array.isArray(promptInfo?.prompts)
      ? promptInfo.prompts
      : [];
    const promptCount = prompts.length;
    const promptCountBadge =
      promptCount > 0 ? ` • AI prompts: ${promptCount}` : "";
    const promptButtonHtml =
      promptCount > 0
        ? `<button onclick="showAiPromptPicker(this)" class="log-copy-btn" data-log-copy-mode="prompts">🤖 AI Prompts</button>`
        : "";

    // DELIVERY, not capability: the log text and the AI prompt bodies used to
    // be embedded in this section (a raw <pre> plus a data-ai-prompts
    // attribute) — together the single largest thing on a saved-run page, and
    // every byte of it was already sitting in a file on disk. The buttons now
    // ask native for the same content over the chunkyscrape:// bridge, which
    // reads the per-render registries registerRunLogCopySources() filled in.
    // Nothing the owner could do before is gone; only the copy in the HTML is.
    return `
    <div class="section log-section">
        <div class="section-header">
            <span class="section-icon">LOG</span>
            <span class="section-title">Run Logs</span>
            <span class="section-count">${totalLines}</span>
            <button onclick="copyLogs(this)" class="log-copy-btn" data-log-copy-mode="full">📋 Copy</button>
            <button onclick="copyCompactLogs(this)" class="log-copy-btn" data-log-copy-mode="compact">📋 Compact</button>
            ${promptButtonHtml}
        </div>
        <div class="log-empty">${this.escapeHtml(`${summaryLabel}${promptCountBadge}`)} — tap 📋 Copy to put the full log on the clipboard.</div>
    </div>
        `;
  }

  // Per-render sources for the Run Logs buttons. The page carries only the
  // button; the content lives here and is copied natively on tap, so the
  // HTML never has to hold a second copy of a 450 KB log file.
  // Always called (with nulls on a live run) so a previous render's log can
  // never leak into the next one's buttons.
  registerRunLogCopySources(logInfo, promptInfo) {
    this._runLogCopyText =
      logInfo && logInfo.exists && typeof logInfo.text === "string"
        ? logInfo.text
        : "";
    this._runAiPrompts = Array.isArray(promptInfo?.prompts)
      ? promptInfo.prompts
      : [];
  }

  // Native twin of the page's old compactifyLogs(): drops the full-prompt
  // dump lines, which are the bulk of a long run's log and are individually
  // retrievable through the 🤖 AI Prompts button.
  compactifyRunLogText(text) {
    return String(text || "")
      .split("\n")
      .filter(
        (line) =>
          !/🤖 AI Web: Full prompt \(extraction pass\)(?: \(\d+ chars\))?/.test(
            line,
          ),
      )
      .join("\n");
  }

  // Copy the run log natively (📋 Copy / 📋 Compact). Fire-and-forget from
  // shouldAllowRequest, which must return a bool synchronously.
  async copyRunLogAndReport(mode, webView) {
    const full = typeof this._runLogCopyText === "string" ? this._runLogCopyText : "";
    if (!full) {
      console.log(
        "📱 Scriptable: Run log copy requested but no log text is registered for this render",
      );
      return;
    }
    const text = mode === "compact" ? this.compactifyRunLogText(full) : full;
    try {
      Pasteboard.copy(text);
      console.log(
        `📱 Scriptable: Copied ${mode === "compact" ? "compact" : "full"} run log to clipboard (${text.length} chars)`,
      );
    } catch (error) {
      console.warn(
        `📱 Scriptable: Failed to copy run log: ${error.message}`,
      );
      return;
    }
    try {
      await webView.evaluateJavaScript(
        `markLogsCopied(${JSON.stringify(String(mode))})`,
        false,
      );
    } catch (error) {
      /* button feedback is optional polish; the copy already happened */
    }
  }

  // 🤖 AI Prompts: native picker over the per-render prompt registry, then
  // Pasteboard.copy of the chosen prompt. Same "native UI on top of the
  // presented sheet" pattern the map-verify and ICS-export bridges use.
  async presentAiPromptPickerAndCopy(webView) {
    const prompts = Array.isArray(this._runAiPrompts) ? this._runAiPrompts : [];
    if (prompts.length === 0) {
      console.log(
        "📱 Scriptable: AI prompt picker requested but no prompts are registered for this render",
      );
      return;
    }
    const MAX_ACTIONS = 12;
    const shown = prompts.slice(0, MAX_ACTIONS);
    if (prompts.length > shown.length) {
      // No silent caps: say which ones the sheet could not list.
      console.log(
        `📱 Scriptable: AI prompt picker lists the first ${shown.length} of ${prompts.length} prompts — the remaining ${prompts.length - shown.length} are in the saved run log (📋 Copy)`,
      );
    }
    try {
      const alert = new Alert();
      alert.title = "AI Prompts";
      alert.message =
        prompts.length > shown.length
          ? `${prompts.length} prompts captured; showing the first ${shown.length}. Pick one to copy it to the clipboard.`
          : `${prompts.length} prompt${prompts.length === 1 ? "" : "s"} captured. Pick one to copy it to the clipboard.`;
      shown.forEach((entry, index) => {
        const pass = entry && entry.pass ? String(entry.pass) : `prompt ${index + 1}`;
        const chars = Number.isFinite(Number(entry?.chars))
          ? ` — ${Number(entry.chars)} chars`
          : "";
        alert.addAction(`${pass}${chars}`);
      });
      alert.addCancelAction("Cancel");
      const choice = await alert.presentSheet();
      if (choice < 0 || !shown[choice]) return;
      const promptText =
        typeof shown[choice].prompt === "string" ? shown[choice].prompt : "";
      if (!promptText) return;
      Pasteboard.copy(promptText);
      console.log(
        `📱 Scriptable: Copied AI prompt "${shown[choice].pass || choice}" to clipboard (${promptText.length} chars)`,
      );
      try {
        await webView.evaluateJavaScript('markLogsCopied("prompts")', false);
      } catch (error) {
        /* button feedback is optional polish; the copy already happened */
      }
    } catch (error) {
      console.warn(
        `📱 Scriptable: AI prompt picker failed: ${error.message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Run-insight summary. The "What Happened" / "What We Did" sections this
  // used to render are gone (the owner never used them); what remains feeds
  // the one-line run-health badge in the results header.
  // ---------------------------------------------------------------------------

  // Parse a run log into the structured insight summary (business logic lives
  // in the shared run-log-summary module; this is just the environment glue).
  buildRunInsightsFromLogText(text) {
    try {
      const trimmed = typeof text === "string" ? text : "";
      if (!trimmed.trim()) {
        return {
          available: false,
          reason: "No log lines captured for this run.",
          summary: null,
        };
      }
      return {
        available: true,
        reason: null,
        summary: RunLogSummary.summarizeLogText(trimmed),
      };
    } catch (error) {
      return {
        available: false,
        reason: `Log summary failed: ${error.message}`,
        summary: null,
      };
    }
  }

  // Choose the insight data source: the saved run's log file when re-displaying
  // a saved run, otherwise the FileLogger's in-memory entries for the live run.
  loadRunInsightsForDisplay(results, logInfo = null) {
    try {
      if (results?._isDisplayingSavedRun) {
        if (logInfo?.exists) {
          return this.buildRunInsightsFromLogText(
            logInfo.fullText || logInfo.text || "",
          );
        }
        const runLabel = logInfo?.runId ? `run ${logInfo.runId}` : "this run";
        return {
          available: false,
          reason: `Log not found for ${runLabel} — crawl and decision details from the log are unavailable.`,
          summary: null,
        };
      }
      return this.buildRunInsightsFromLogText(
        logger.getLogText({ mode: "full" }),
      );
    } catch (error) {
      return {
        available: false,
        reason: `Log summary failed: ${error.message}`,
        summary: null,
      };
    }
  }

  // One-line run-health badge for the results-UI header, derived from the same
  // insight summary that feeds the What Happened/What We Did sections. The
  // verdict logic lives in run-log-summary.js; a failure here must never
  // block the results display, so this degrades to an empty string.
  buildRunHealthBadgeHtml(runInsights, results) {
    try {
      const signals = RunLogSummary.buildRunSignals(
        runInsights?.available ? runInsights.summary : null,
        results,
      );
      const health = RunLogSummary.evaluateRunHealth(signals, {
        errorsCount: (results?.errors || []).length,
      });
      const badgeText = RunLogSummary.formatRunHealthBadge(health);
      const variant = health.status === "warn" ? "warn" : "ok";
      return `<div class="header-health-badge ${variant}">${this.escapeHtml(badgeText)}</div>`;
    } catch (error) {
      console.log(
        `📱 Scriptable: Health badge build failed: ${error.message}`,
      );
      return "";
    }
  }

  // Per-event "🔍 Provenance" section (field origins, merge decisions, and the
  // export-issue payload). Builders live in the pure event-provenance module;
  // this is just the environment glue. A failure here must never block an
  // event card, so this degrades to an empty string (mirrors
  // buildRunHealthBadgeHtml).
  buildEventProvenanceHtml(event, runInfo = {}) {
    try {
      return EventProvenance.buildEventProvenanceSectionHtml(event, {
        action: this.normalizeIntentAction(event),
        runId: runInfo.runId || null,
        timestamp: runInfo.timestamp || null,
      });
    } catch (error) {
      console.log(
        `📱 Scriptable: Provenance section build failed for "${event?.title || "unknown"}": ${error.message}`,
      );
      return "";
    }
  }

  // Generate HTML for the segments panel in discovery section
  generateDiscoverySegmentsPanel(safeId, segmentsByUrl) {
    const segmentUrlEntries = Object.entries(segmentsByUrl);
    if (segmentUrlEntries.length === 0)
      return { button: "", panel: "", totalSegments: 0 };

    const totalSegments = segmentUrlEntries.reduce(
      (sum, [, segs]) => sum + segs.length,
      0,
    );
    const urlBlocks = segmentUrlEntries
      .map(([url, segs]) => {
        const segmentItems = segs
          .map((seg) => {
            const imageHtml =
              Array.isArray(seg.imageUrls) && seg.imageUrls.length > 0
                ? `<div style="margin-top:8px; display:flex; gap:8px; overflow-x:auto; padding-bottom:4px;">
                        ${seg.imageUrls.map((img) => `<img src="${this.escapeHtml(img)}" style="height:80px; width:auto; border-radius:6px; border:1px solid var(--border-color); background:var(--background-primary); object-fit:cover;" onerror="this.style.display='none'">`).join("")}
                       </div>`
                : "";
            return `<div style="padding:8px; background:var(--background-light); border-left:3px solid var(--border-color); margin-bottom:6px; font-size:11px; font-family:monospace; border-radius:0 6px 6px 0;">
                    <div style="margin-bottom:4px;"><span style="opacity:0.6; font-weight:bold;">Segment ${seg.index} (${seg.lineCount} lines):</span></div>
                    <div style="line-height:1.4; color:var(--text-primary);">${this.escapeHtml(seg.preview)}</div>
                    ${imageHtml}
                </div>`;
          })
          .join("");
        return `<div style="margin-bottom:12px;">
                <div style="font-size:11px; font-family:monospace; opacity:0.7; margin-bottom:6px; word-break:break-all; border-bottom:1px solid var(--border-color); padding-bottom:2px;">${this.escapeHtml(url)} — ${segs.length} segment(s)</div>
                ${segmentItems}
            </div>`;
      })
      .join("");

    const button = `<button onclick="switchDiscoveryTab(this,'segments_${safeId}')" class="disc-tab-btn" data-tab="segments_${safeId}">Segments (${totalSegments})</button>`;
    const panel = `<div id="segments_${safeId}" class="disc-tab-panel" style="display:none">${urlBlocks}</div>`;
    return { button, panel, totalSegments };
  }

  // Discovered venue calendars (enrich-only ticket crawl): hosts whose sibling
  // events were dropped, with a paste-ready parser entry and a copy button.
  // The button signals native via the chunkyscrape:// scheme handled in
  // presentRichResults (shouldAllowRequest → Pasteboard.copy).
  generateDiscoveredVenueSection(results) {
    const venues = Array.isArray(results && results.discoveredVenueCalendars)
      ? results.discoveredVenueCalendars
      : [];
    if (venues.length === 0) return "";

    const venueBlocks = venues
      .map((venue, index) => {
        const sampleTitles = Array.isArray(venue.sampleTitles)
          ? venue.sampleTitles
          : [];
        const extraCount = venue.droppedCount - sampleTitles.length;
        const titlesText =
          sampleTitles.join(", ") +
          (extraCount > 0 ? `, … (+${extraCount} more)` : "");
        const viaText = venue.parentTitle
          ? ` — reached via ticket link from "${venue.parentTitle}"`
          : "";
        return `
        <div class="discovered-venue" style="margin-bottom:14px; padding:10px; background:var(--background-light); border-radius:8px;">
            <div style="font-weight:600; margin-bottom:4px;">${this.escapeHtml(venue.host)} <span style="font-weight:400; opacity:0.7;">— ${venue.droppedCount} event(s) found but not ingested (enrich-only ticket crawl)${this.escapeHtml(viaText)}</span></div>
            ${titlesText ? `<div style="font-size:12px; margin-bottom:6px; color:var(--text-secondary);">Titles: ${this.escapeHtml(titlesText)}</div>` : ""}
            <div style="display:flex; gap:6px; margin-bottom:6px; flex-wrap:wrap; align-items:center;">
                <button onclick="copyVenueEntry(this)" class="log-copy-btn venue-copy-btn" data-venue-index="${index}">📋 Copy parser entry</button>
                <span style="font-size:12px; color:var(--text-secondary);">To scrape this venue, paste into parsers[] in scraper-input.js</span>
            </div>
            <pre class="discovery-output">${this.escapeHtml(venue.parserEntrySnippet || "")}</pre>
        </div>`;
      })
      .join("");

    return `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">📋</span>
            <span class="section-title">Discovered Venue Calendars</span>
            <span class="section-count">${venues.length}</span>
        </div>
        ${venueBlocks}
    </div>
    `;
  }

  // Native-side snippet map for the chunkyscrape://copy-venue bridge: venue
  // index → paste-ready parser entry. Snippets never travel through the URL.
  collectVenueEntrySnippets(results) {
    const venues = Array.isArray(results && results.discoveredVenueCalendars)
      ? results.discoveredVenueCalendars
      : [];
    const snippets = {};
    venues.forEach((venue, index) => {
      if (venue && typeof venue.parserEntrySnippet === "string") {
        snippets[String(index)] = venue.parserEntrySnippet;
      }
    });
    return snippets;
  }

  // ---------------------------------------------------------------------------
  // Results-page liveness (results-UI → native, chunkyscrape:// bridge).
  // The page fires "dom-ready" once it has parsed and "painted" after its
  // first rendered frame. Before this existed, a white screen and a fully
  // reviewed page produced byte-identical logs — presentRichResults' catch
  // never fired either way, because nothing in the failure mode throws.
  // ---------------------------------------------------------------------------

  recordResultsPageBeacon(stage, detail, seen) {
    const label = String(stage || "unknown");
    if (Array.isArray(seen)) seen.push(label);
    const extra = detail ? ` (${detail})` : "";
    console.log(`📱 Scriptable: 🫀 Results page beacon: ${label}${extra}`);
  }

  // One verdict line per presentation. The interesting case is the empty one.
  reportResultsPageLiveness(seen) {
    const stages = Array.isArray(seen) ? seen : [];
    if (stages.indexOf("painted") >= 0) {
      console.log(
        `📱 Scriptable: ✅ Results page rendered on device (beacons: ${stages.join(", ")})`,
      );
      return;
    }
    if (stages.indexOf("interacted") >= 0) {
      // A touch reached the page, so it was on screen and alive; only the
      // unattended beacons were suppressed. Not a blank sheet.
      console.log(
        `📱 Scriptable: ✅ Results page was interacted with, but reported no painted frame (beacons: ${stages.join(", ")}) — unattended page→native navigation is being suppressed; the page itself rendered.`,
      );
      return;
    }
    if (stages.length > 0) {
      console.log(
        `📱 Scriptable: ⚠️ Results page parsed but never reported a painted frame (beacons: ${stages.join(", ")}) — the sheet was blank or blocked before first paint. Check for a stalled remote asset or a WebKit content-process termination.`,
      );
      return;
    }
    console.log(
      "📱 Scriptable: ⚠️ Results page never reported liveness — no beacon arrived at all, so WebKit did not run the page. That is a blank white sheet, not a reviewed one; treat any approval from this run as unverified.",
    );
  }

  // Copy one venue's parser entry natively and (best-effort) flash the button.
  // Called fire-and-forget from shouldAllowRequest, which must synchronously
  // return a bool — so the await lives here, not in the handler.
  async copyVenueEntryAndReport(snippet, venueIndex, webView) {
    try {
      Pasteboard.copy(snippet);
      console.log(
        `📱 Scriptable: Copied discovered-venue parser entry #${venueIndex} to clipboard`,
      );
    } catch (error) {
      console.warn(
        `📱 Scriptable: Failed to copy venue parser entry: ${error.message}`,
      );
      return;
    }
    const feedbackJs = `markVenueEntryCopied(${JSON.stringify(String(venueIndex))})`;
    try {
      await webView.evaluateJavaScript(feedbackJs, false);
    } catch (error) {
      /* button feedback is optional polish; the copy already happened */
    }
  }

  // ---------------------------------------------------------------------------
  // Map verify links (results-UI ↔ chunkyscrape:// bridge, read-only).
  // The owner verifies a venue by comparing three independent Google Maps
  // lookups: what the bar name+city resolves to, what the address resolves
  // to, and where the stored pin actually is. Each row gets up to three
  // compact links (only for data that exists). A plain https href would
  // navigate the results WebView away (shouldAllowRequest returns true for
  // normal URLs), so links route through the chunkyscrape:// bridge: the
  // page navigates to chunkyscrape://act?a=open-url&id=<n>, native looks the
  // real URL up in a per-render registry and calls Safari.open — Safari
  // opens ON TOP and the results sheet stays put. URLs are built with
  // encodeURIComponent only (no `new URL`/URLSearchParams in this runtime).
  // ---------------------------------------------------------------------------

  // "lat, lng" text → { lat, lng } numbers, or null (shared by the pin link
  // and the OSM embed; candidates/events store coordinates as one string).
  parseCoordinatePairText(value) {
    const parts = String(value || "").split(",");
    if (parts.length !== 2) return null;
    const lat = Number(parts[0].trim());
    const lng = Number(parts[1].trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  // Human-searchable city name for Maps queries. The generated
  // scraper-cities.js carries no display name, but each city's FIRST alias
  // pattern is its full lowercase name ("nyc" → "new york", "la" →
  // "los angeles"); unknown keys fall back to the de-hyphenated key
  // ("fort-lauderdale" → "fort lauderdale"). Maps search is case-insensitive.
  getCityDisplayNameForMaps(cityKey) {
    const key = typeof cityKey === "string" ? cityKey.trim() : "";
    if (!key) return "";
    const cityConfig = this.cities ? this.cities[key] : null;
    const firstPattern =
      cityConfig && Array.isArray(cityConfig.patterns)
        ? cityConfig.patterns[0]
        : "";
    if (typeof firstPattern === "string" && firstPattern.trim()) {
      return firstPattern.trim();
    }
    return key.replace(/-/g, " ");
  }

  buildMapsSearchUrl(query) {
    const text = typeof query === "string" ? query.trim() : "";
    if (!text) return "";
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
  }

  // Bar query: "<bar name>, <city>" ("" without a bar). The single Bar link
  // and the Route link both build from this exact string.
  buildBarMapsQuery(barName, cityKey) {
    const name = typeof barName === "string" ? barName.trim() : "";
    if (!name) return "";
    const city = this.getCityDisplayNameForMaps(cityKey);
    return city ? `${name}, ${city}` : name;
  }

  // Bar link: what "<bar name>, <city>" resolves to on Google Maps.
  buildBarMapsSearchUrl(barName, cityKey) {
    return this.buildMapsSearchUrl(this.buildBarMapsQuery(barName, cityKey));
  }

  // Address query: the stored address, with the city appended ONLY when the
  // address doesn't already contain the city name (case-insensitive) — bare
  // street addresses are ambiguous across cities. Shared by the single
  // Address link and the Route link.
  buildAddressMapsQuery(address, cityKey) {
    const text = typeof address === "string" ? address.trim() : "";
    if (!text) return "";
    const city = this.getCityDisplayNameForMaps(cityKey);
    const alreadyHasCity =
      city && text.toLowerCase().includes(city.toLowerCase());
    return city && !alreadyHasCity ? `${text}, ${city}` : text;
  }

  // Address link: what the stored address resolves to.
  buildAddressMapsSearchUrl(address, cityKey) {
    return this.buildMapsSearchUrl(this.buildAddressMapsQuery(address, cityKey));
  }

  // Pin query: "lat,lng" ("" without a coordinate pair). Shared by the
  // single Pin link and the Route link.
  buildPinMapsQuery(coordinates) {
    const pair = this.parseCoordinatePairText(coordinates);
    if (!pair) return "";
    return `${pair.lat},${pair.lng}`;
  }

  // Pin link: where the stored coordinates actually land.
  buildPinMapsSearchUrl(coordinates) {
    return this.buildMapsSearchUrl(this.buildPinMapsQuery(coordinates));
  }

  // Route link: one Google Maps Directions URL threading every stored
  // location signal (bar+city query → address query → pin), using the SAME
  // query strings as the single links above. Purpose: if all points resolve
  // to the same venue, the rendered route is ~0 m — a one-glance identity
  // check; a pin or address belonging to a different place shows up as a
  // real route. Requires at least two of {bar+city, address, coordinates};
  // with all three the address rides as a waypoint, with two the pair maps
  // to origin → destination. "" when fewer than two points exist.
  buildRouteMapsDirectionsUrl({ bar, city, address, coordinates } = {}) {
    const barQuery = this.buildBarMapsQuery(bar, city);
    const addressQuery = this.buildAddressMapsQuery(address, city);
    const pinQuery = this.buildPinMapsQuery(coordinates);
    const points = [barQuery, addressQuery, pinQuery].filter(Boolean);
    if (points.length < 2) return "";
    const origin = points[0];
    const destination = points[points.length - 1];
    const waypoints = points.length === 3 ? points[1] : "";
    let url =
      "https://www.google.com/maps/dir/?api=1" +
      `&origin=${encodeURIComponent(origin)}` +
      `&destination=${encodeURIComponent(destination)}`;
    if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
    return url;
  }

  // Keyless OpenStreetMap embed centered on the pin (~400m box, marker on
  // the pin). OSM because it needs no API key and matches the Nominatim
  // stack the scraper already geocodes with; Google Maps embeds require an
  // API key. Same viewport as the review UI's buildReviewPinHtml.
  buildOsmEmbedUrl(coordinates) {
    const pair = this.parseCoordinatePairText(coordinates);
    if (!pair) return "";
    const boxDegrees = 0.004;
    const bbox = `${pair.lng - boxDegrees},${pair.lat - boxDegrees},${pair.lng + boxDegrees},${pair.lat + boxDegrees}`;
    const marker = `${pair.lat},${pair.lng}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(marker)}`;
  }

  // Keyless LEGACY Google Maps embed centered on the pin, shown alongside
  // the OSM embed so the reviewer sees Google's venue-aware basemap (POI
  // labels at the pin) next to OSM's. NOTE: maps.google.com/maps?...&output=
  // embed is an unofficial keyless endpoint — the official Maps Embed API
  // requires an API key — and it may break without notice; the OSM embed
  // above remains the dependable inline map.
  buildGoogleEmbedUrl(coordinates) {
    const pair = this.parseCoordinatePairText(coordinates);
    if (!pair) return "";
    return `https://maps.google.com/maps?q=${encodeURIComponent(`${pair.lat},${pair.lng}`)}&z=16&output=embed`;
  }

  // Per-render native-side URL registry for the open-url bridge (same
  // pattern as collectVenueEntrySnippets: URLs never travel through the
  // chunkyscrape:// URL, only their ids do). generateRichHTML resets it so
  // ids embedded in the HTML always match what the handler reads.
  resetMapVerifyUrls() {
    this._mapVerifyUrls = {};
    this._mapVerifyUrlNextId = 0;
  }

  registerMapVerifyUrl(url) {
    if (!this._mapVerifyUrls || typeof this._mapVerifyUrlNextId !== "number") {
      this.resetMapVerifyUrls();
    }
    const id = String(this._mapVerifyUrlNextId++);
    this._mapVerifyUrls[id] = url;
    return id;
  }

  // Compact "Verify:" row with up to four bridge links; "" when no data.
  buildMapVerifyLinksHtml({ bar, city, address, coordinates } = {}) {
    const links = [];
    const barUrl = this.buildBarMapsSearchUrl(bar, city);
    if (barUrl) links.push({ label: "Bar", url: barUrl });
    const addressUrl = this.buildAddressMapsSearchUrl(address, city);
    if (addressUrl) links.push({ label: "Address", url: addressUrl });
    const pinUrl = this.buildPinMapsSearchUrl(coordinates);
    if (pinUrl) links.push({ label: "Pin", url: pinUrl });
    // Route: only when ≥2 points exist (the builder returns "" otherwise).
    const routeUrl = this.buildRouteMapsDirectionsUrl({
      bar,
      city,
      address,
      coordinates,
    });
    if (routeUrl) links.push({ label: "Route", url: routeUrl });
    if (links.length === 0) return "";
    const anchors = links
      .map(({ label, url }) => {
        const id = this.registerMapVerifyUrl(url);
        return `<a href="#" onclick="return openMapVerify(this)" data-map-url-id="${id}" class="map-verify-link" style="color:var(--primary-color); text-decoration:none;">${label} ↗</a>`;
      })
      .join("");
    return `<div class="map-verify-row" style="display:flex; gap:10px; align-items:center; font-size:12px; margin:4px 0;"><span style="color:var(--text-secondary);">Verify:</span>${anchors}</div>`;
  }

  // Muted "Evidence" block from SharedCore.buildEventEvidenceLines output
  // (computed consistency checks — distances, POI match, provenance). One
  // line per string; "" when there are no lines (fail open — the panel is
  // additive and its absence never blocks a card or candidate row).
  buildEvidenceLinesHtml(lines) {
    const list = Array.isArray(lines)
      ? lines.filter((line) => typeof line === "string" && line.trim())
      : [];
    if (list.length === 0) return "";
    const rows = list
      .map((line) => `<div>${this.escapeHtml(line)}</div>`)
      .join("");
    return `<div class="evidence-block" style="font-size:11px; color:var(--text-secondary); margin:4px 0; line-height:1.6;"><div style="font-weight:600;">Evidence</div>${rows}</div>`;
  }

  // ---------------------------------------------------------------------------
  // Recurring-event ICS export (results-UI ↔ chunkyscrape:// bridge).
  // Recurring series are display+export only: the scraper never writes them
  // to the calendar. Each recurring card gets a "Save recurring (.ics)"
  // button; a tap builds the ICS natively and hands it to DocumentPicker.
  // Same per-render registry pattern as the map-verify links: events stay
  // native-side, only integer ids travel through the bridge URL.
  // ---------------------------------------------------------------------------
  resetIcsExportEvents() {
    this._icsExportEvents = {};
    this._icsExportNextId = 0;
  }

  registerIcsExportEvent(event) {
    if (!this._icsExportEvents || typeof this._icsExportNextId !== "number") {
      this.resetIcsExportEvents();
    }
    const id = String(this._icsExportNextId++);
    this._icsExportEvents[id] = event;
    return id;
  }

  // Build the ICS for one registered recurring event and hand it off via
  // DocumentPicker.exportString (fallback: temp file + ShareSheet). Called
  // fire-and-forget from shouldAllowRequest (which must synchronously return
  // false to cancel the fake navigation).
  async exportRecurringEventIcs(id) {
    try {
      const event = this._icsExportEvents
        ? this._icsExportEvents[String(id)]
        : undefined;
      if (!event || typeof event !== "object") return;
      const timezone = this.getTimezoneForCityOrUtc(event.city);
      const icsText = SharedEventSchema.buildRecurringEventIcs(event, {
        timezone,
      });
      if (!icsText) return;
      const slug =
        SharedEventSchema.slugifyIcsText(event.title || event.name || "") ||
        "chunky-dad-recurring";
      const fileName = `${slug}.ics`;
      // HANDOFF ORDER, most-capable first. Each step is independently guarded
      // so one unavailable API can never sink the others.
      //
      // ShareSheet leads because it is the iOS surface that actually routes a
      // .ics onward (Calendar included). QuickLook, which this used to lead
      // with, only PREVIEWS the file — on device it does not offer the import
      // flow Safari gives you (reported 2026-07-30: "doesn't open up the same
      // way it would on safari"), so the preview was a dead end.
      // DocumentPicker remains last: it saves to Files, which still needs a
      // second trip through the Files app to reach the calendar.
      let exportedVia = "";
      let filePath = "";
      try {
        const fm = FileManager.local();
        filePath = fm.joinPath(fm.temporaryDirectory(), fileName);
        fm.writeString(filePath, icsText);
      } catch (writeError) {
        console.warn(
          `📱 Scriptable: Could not stage the ICS file (${writeError.message}) — trying a direct export`,
        );
        filePath = "";
      }
      if (filePath && typeof ShareSheet !== "undefined" && ShareSheet && typeof ShareSheet.present === "function") {
        try {
          // Scriptable's ShareSheet resolves on ANY dismissal, carrying
          // {completed: bool} — user-cancel resolves too (review 2026-07-30).
          // A cancel is a deliberate choice: mark it handled so the fallbacks
          // don't double-present, but never log it as a successful handoff.
          const shareResult = await ShareSheet.present([filePath]);
          const cancelled = shareResult && typeof shareResult === "object"
            && shareResult.completed === false;
          exportedVia = cancelled ? "ShareSheet (cancelled by user)" : "ShareSheet";
        } catch (shareError) {
          console.warn(
            `📱 Scriptable: ShareSheet ICS handoff failed (${shareError.message}) — falling back to QuickLook`,
          );
        }
      }
      if (!exportedVia && filePath && typeof QuickLook !== "undefined" && QuickLook && typeof QuickLook.present === "function") {
        try {
          await QuickLook.present(filePath, false);
          exportedVia = "QuickLook";
        } catch (quickLookError) {
          console.warn(
            `📱 Scriptable: QuickLook ICS preview failed (${quickLookError.message}) — falling back to DocumentPicker`,
          );
        }
      }
      if (!exportedVia) {
        if (
          typeof DocumentPicker !== "undefined" &&
          DocumentPicker &&
          typeof DocumentPicker.exportString === "function"
        ) {
          await DocumentPicker.exportString(icsText, fileName);
          exportedVia = "DocumentPicker";
        } else {
          const fm = FileManager.local();
          const filePath = fm.joinPath(fm.temporaryDirectory(), fileName);
          fm.writeString(filePath, icsText);
          await ShareSheet.present([filePath]);
          exportedVia = "ShareSheet";
        }
      }
      console.log(
        `📱 Scriptable: Exported recurring event ICS "${fileName}" (#${id})`,
      );
      console.log(
        `📱 Scriptable: Recurring ICS handed off via ${exportedVia}`,
      );
    } catch (error) {
      console.warn(
        `📱 Scriptable: Failed to export recurring event ICS: ${error.message}`,
      );
    }
  }

  // Prefill link into the website's event-builder page for one event card.
  // Params ride loadStateFromUrl's alias map (event-schema): name, startDate/
  // endDate (local wall-clock YYYY-MM-DDTHH:MM — the builder rejects zoned
  // datetimes), city, venue, address, description, cover, website,
  // recurrence, socials. Built by string concat + encodeURIComponent — no
  // new URL()/URLSearchParams in this runtime.
  buildEventBuilderUrl(event) {
    if (!event || typeof event !== "object") return "";
    const timezone = this.getTimezoneForCityOrUtc(event.city);
    const formatLocalDateTime = (value) => {
      if (!value) return "";
      const date = value instanceof Date ? value : new Date(value);
      if (isNaN(date.getTime())) return "";
      // Reuse the ICS wall-clock formatter (YYYYMMDDTHHMMSS) and reshape to
      // the builder's datetime-local format.
      const compact = SharedEventSchema.formatIcsDateInTimezone(
        date,
        timezone,
      );
      if (!compact) return "";
      return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}`;
    };
    const params = [];
    const addParam = (key, value) => {
      const text =
        value === null || value === undefined ? "" : String(value).trim();
      if (!text) return;
      params.push(`${key}=${encodeURIComponent(text)}`);
    };
    addParam("name", event.title || event.name);
    addParam("startDate", formatLocalDateTime(event.startDate));
    addParam("endDate", formatLocalDateTime(event.endDate));
    addParam("city", event.city);
    // The event's OWN timezone. Without it the builder falls back to the
    // DEVICE's zone: start/end are handed over as city-local wall clock, so a
    // phone in Eastern saved an LA 9PM event as 9PM ET (= 01:00Z instead of
    // 04:00Z). That 3-hour shift then made the next scrape fail merge
    // eligibility against the very record it had just written, and poisoned
    // the stored `timezone:` note (CubScout, 2026-07-30).
    addParam("timezone", timezone);
    addParam("venue", event.bar || event.venue);
    addParam("address", event.address);
    addParam("description", event.description);
    addParam("cover", event.cover);
    addParam("website", event.website || event.url);
    // recurrenceRule ONLY — never fall back to `recurrence`. On an override
    // card that field holds the SERIES rule leaked off the source occurrence's
    // notes during the merge, so the fallback prefilled the builder with a rule
    // the event does not have; submitting that form would turn a
    // single-occurrence override back into a whole series. Real series carry
    // recurrenceRule (buildAnalyzedCalendarEvent copies it across).
    addParam("recurrence", event.recurrenceRule);
    addParam("instagram", event.instagram);
    addParam("facebook", event.facebook);
    // Coordinates. Without these the builder has no pin and the human has to
    // re-derive it by hand — the gap hit when the recurring-ICS button was used
    // as a workaround. `location` is ALWAYS coordinates by doctrine.
    addParam("location", event.location);
    addParam("ticketUrl", event.ticketUrl);
    addParam("gmaps", event.gmaps);
    addParam("image", event.image);
    // Orientation slots ride along so the builder can edit them; both are
    // optional (orientation is only knowable for a minority of URLs).
    addParam("imageVertical", event.imageVertical);
    addParam("imageHorizontal", event.imageHorizontal);
    addParam("shortName", event.shortName);
    this.addEventBuilderEditingParams(addParam, event);
    const query = params.length > 0 ? `?${params.join("&")}` : "";
    return `https://chunky.dad/testing/event-builder.html${query}`;
  }

  // Editing context. Without it the builder opens in "brand new event" mode
  // even when the run that produced the link just matched, merged and
  // confirmed the event — which is why a saved series kept being re-created
  // instead of updated. Emits nothing when nothing was matched, so a genuine
  // discovery still opens as new.
  //
  // Two shapes carry a matched record: `_existingEvent` (a merge) and
  // `_seriesMatch` (a series we matched but withhold from writing).
  // Occurrence-override prefill is deliberately NOT emitted — it needs a
  // recurrence-id in the page's local datetime format plus its timezone, and
  // getting that wrong is exactly how an LA series ended up saved in Eastern.
  addEventBuilderEditingParams(addParam, event) {
    const seriesMatch = event && event._seriesMatch ? event._seriesMatch : null;
    const matched = seriesMatch || (event ? event._existingEvent : null);
    if (!matched) return;

    // The builder matches against the published city ICS, which keys on bare
    // ICS UIDs; a Scriptable identifier is `<calendarUUID>:<icsUid>`.
    const rawIdentifier = String(matched.identifier || matched.id || "").trim();
    if (!rawIdentifier) return;
    const uid =
      SharedCore.extractIcsUidFromIdentifier(rawIdentifier) || rawIdentifier;
    if (!uid) return;

    const toIso = (value) => {
      if (!value) return "";
      const date = value instanceof Date ? value : new Date(value);
      return isNaN(date.getTime()) ? "" : date.toISOString();
    };
    // The identifier match compares searchStartDate against THIS record's
    // start, so the matched record's own times are the only correct window.
    const searchStart = toIso(matched.startDate);
    if (!searchStart) return;

    addParam("edit", "1");
    addParam("euid", uid);
    // 'series' disables the builder's Scriptable handoff and routes the save
    // to the ICS export, which reuses this UID with SEQUENCE+1 — the only
    // channel that can update a saved series. 'occurrence' with no occurrence
    // id is a plain existing-event edit and keeps the Scriptable handoff.
    addParam("emode", seriesMatch ? "series" : "occurrence");
    if (seriesMatch) {
      // Pre-select the record in the "Edit or Copy Existing Event" picker so
      // the owner is one click from loading it. We cannot build the picker's
      // exact result id — its date key is formatted in the BROWSER's timezone
      // from the series anchor date, neither of which the phone knows — but
      // renderExistingResults falls back to matching on the uid alone when the
      // full id misses, and that fallback only reads the uid segment. The
      // `series` type keeps isOccurrenceResultId false, so this does not flip
      // the page into occurrence-override mode.
      //
      // The click matters: it is the only path that reads the record's real
      // SEQUENCE out of the published calendar, and an ICS update carrying the
      // wrong revision is silently ignored by the calendar. Every published
      // event has one (162 of 162), so the page refuses to export rather than
      // guess.
      addParam("occid", `${uid}::series::`);
    }
    addParam("searchStartDate", searchStart);
    addParam("searchEndDate", toIso(matched.endDate) || searchStart);
  }

  // Per-card actions row: an Event Builder prefill link on EVERY card (rides
  // the existing open-url bridge), plus the ICS export button on recurring
  // cards. "" only when no builder URL could be built.
  buildEventCardActionsHtml(event) {
    const parts = [];
    const builderUrl = this.buildEventBuilderUrl(event);
    if (builderUrl) {
      const id = this.registerMapVerifyUrl(builderUrl);
      parts.push(
        `<a href="#" onclick="return openMapVerify(this)" data-map-url-id="${id}" class="event-builder-link" style="color:var(--primary-color); text-decoration:none; font-size:12px;">🛠 Event Builder</a>`,
      );
    }
    if (SharedCore.isRecurringSeriesEvent(event)) {
      // A derived-occurrence series with no stated start time cannot build a
      // meaningful ICS (the export needs a real time): the card offers only
      // the Event Builder link, where the owner supplies the time.
      if (event._recurringNoStartTime === true) {
        console.log(
          `🔁 RECURRING: "${event.title || event.name || "Unknown"}" has no start time — ICS export disabled, use Event Builder`,
        );
      } else {
        const exportId = this.registerIcsExportEvent(event);
        parts.push(
          `<button onclick="exportRecurringIcs(this)" class="log-copy-btn ics-export-btn" data-ics-export-id="${exportId}">💾 Save recurring (.ics)</button>`,
        );
      }
    }
    if (parts.length === 0) return "";
    return `<div class="event-actions-row" style="display:flex; gap:12px; align-items:center; margin:6px 0;">${parts.join("")}</div>`;
  }

  // Open one registered verify link in Safari, on top of the results sheet.
  // Called fire-and-forget from shouldAllowRequest (which must synchronously
  // return false to cancel the fake navigation) — Safari opens over the
  // sheet and the results WebView never navigates.
  openMapVerifyUrl(id) {
    try {
      const url = this._mapVerifyUrls
        ? this._mapVerifyUrls[String(id)]
        : undefined;
      if (typeof url !== "string" || url.indexOf("https://") !== 0) return;
      Safari.open(url);
      console.log(`📱 Scriptable: Opened map verify link #${id} in Safari`);
    } catch (error) {
      console.warn(
        `📱 Scriptable: Failed to open map verify link: ${error.message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // New venue candidates (results-UI ↔ chunkyscrape:// bridge, GATHERING-ONLY).
  // Confirmed-new venues detected by SharedCore.buildNewVenueCandidates get a
  // "Queue for bars data" button; a tap appends evidence to bar-additions.json.
  // The queue is loaded here ONLY for the "Queued ✓" badge — the scraping
  // pipeline never reads it, and promotion to data/bars/<city>.json happens
  // out-of-band after verification against independent references.
  // ---------------------------------------------------------------------------

  // "New venue candidates (N)" section: live runs only (no queue writes on
  // saved-run display), rendered only when the run produced candidates.
  // Already-queued candidates show a "Queued ✓ (seen N times)" badge instead
  // of the button.
  async generateNewVenueCandidateSection(results) {
    if (results && results._isDisplayingSavedRun === true) return "";
    const candidates = Array.isArray(results && results.newVenueCandidates)
      ? results.newVenueCandidates
      : [];
    if (candidates.length === 0) return "";
    const queue = await this.loadBarAdditions();

    const rows = candidates
      .map((candidate, index) => {
        if (!candidate) return "";
        const signalsText = Array.isArray(candidate.signals)
          ? candidate.signals.join(", ")
          : "";
        const sourceEvents = Array.isArray(candidate.sourceEvents)
          ? candidate.sourceEvents
          : [];
        const eventsText = sourceEvents
          .map((event) => {
            const dateLabel = this.formatBearOverrideDate(event && event.date);
            const title = (event && event.title) || "Unknown";
            return dateLabel ? `${title} (${dateLabel})` : title;
          })
          .join(", ");
        const queuedEntry =
          candidate.key && queue[candidate.key] ? queue[candidate.key] : null;
        const control = queuedEntry
          ? `<span style="font-size:12px; color:var(--text-secondary);">Queued ✓ (seen ${Number(queuedEntry.timesSeen) || 1} times)</span>`
          : `<button onclick="queueVenueCandidate(this)" class="log-copy-btn venue-queue-btn" data-nvq-index="${index}">➕ Queue for bars data</button>`;
        // Primary verification surface: Bar/Address/Pin Google Maps links
        // (bridge-routed so Safari opens over the sheet) plus a lazy inline
        // OSM map — no iframe loads anything until its toggle is tapped.
        const verifyRow = this.buildMapVerifyLinksHtml({
          bar: candidate.name,
          city: candidate.city,
          address: candidate.address,
          coordinates: candidate.coordinates,
        });
        // Computed evidence panel (SharedCore.buildNewVenueCandidates attaches
        // candidate.evidence); "" when nothing was computable.
        const evidenceBlock = this.buildEvidenceLinesHtml(candidate.evidence);
        const osmEmbedUrl = this.buildOsmEmbedUrl(candidate.coordinates);
        // Second, side-by-side inline map: the keyless legacy Google embed
        // (see buildGoogleEmbedUrl — unofficial endpoint, may break without
        // notice; OSM stays the dependable one). Both iframes stay lazy:
        // each carries its URL in data-map-embed and gets a src only on the
        // first "Show maps" tap (pure page JS, no bridge involvement).
        const googleEmbedUrl = this.buildGoogleEmbedUrl(candidate.coordinates);
        const mapToggle = osmEmbedUrl
          ? `<button onclick="toggleCandidateMap(this)" class="log-copy-btn nvq-map-btn" data-map-target="nvq_map_${index}">🗺️ Show maps</button>`
          : "";
        const embedFrameStyle =
          "width:100%; height:220px; border:0; border-radius:8px;";
        const mapFrame = osmEmbedUrl
          ? `<div id="nvq_map_${index}" class="nvq-map-frames" style="display:none; margin-top:6px;"><iframe class="nvq-map-frame" data-map-embed="${this.escapeHtml(osmEmbedUrl)}" style="${embedFrameStyle}"></iframe>${googleEmbedUrl ? `<iframe class="nvq-map-frame" data-map-embed="${this.escapeHtml(googleEmbedUrl)}" style="${embedFrameStyle} margin-top:6px;"></iframe>` : ""}</div>`
          : "";
        return `
        <div class="new-venue-candidate" style="margin-bottom:14px; padding:10px; background:var(--background-light); border-radius:8px;">
            <div style="font-weight:600; margin-bottom:4px;">${this.escapeHtml(candidate.name || "Unknown")} <span style="font-weight:400; opacity:0.7;">(${this.escapeHtml(candidate.city || "unknown city")})</span></div>
            ${candidate.address ? `<div style="font-size:12px; margin-bottom:2px; color:var(--text-secondary);">${this.escapeHtml(candidate.address)}</div>` : ""}
            <div style="font-size:12px; margin-bottom:2px; color:var(--text-secondary);">Signals: ${this.escapeHtml(signalsText)}</div>
            ${eventsText ? `<div style="font-size:12px; margin-bottom:6px; color:var(--text-secondary);">Hosting: ${this.escapeHtml(eventsText)}</div>` : ""}
            ${verifyRow}
            ${evidenceBlock}
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                ${control}
                ${mapToggle}
            </div>
            ${mapFrame}
        </div>`;
      })
      .join("");

    return `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">🆕</span>
            <span class="section-title">New venue candidates</span>
            <span class="section-count">${candidates.length}</span>
        </div>
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:8px;">Corroborated venues not in curated bars data. Queueing gathers evidence only — it never changes scraping behavior; promotion to data/bars happens out-of-band after verification.</div>
        ${rows}
    </div>
    `;
  }

  // Queue one tapped candidate natively and (best-effort) flash its button.
  // Called fire-and-forget from shouldAllowRequest, which must synchronously
  // return a bool — so the await lives here, not in the handler. Repeat taps
  // (per-tap nonce keeps them firing) skip the write and just re-flash.
  async queueVenueCandidateAndReport(id, results, tapped, webView) {
    try {
      const key = String(id || "");
      const index = Number(key);
      const candidates = Array.isArray(results && results.newVenueCandidates)
        ? results.newVenueCandidates
        : [];
      if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
        return;
      }
      const candidate = candidates[index];
      if (!candidate) return;
      let timesSeen = tapped[key];
      if (timesSeen === undefined) {
        const queue = await this.loadBarAdditions();
        const runId = results.savedRunId || results.sourceRunId || null;
        const entry = this.mergeBarAdditionEntry(
          queue,
          candidate,
          runId,
          new Date().toISOString(),
        );
        if (!entry) return;
        await this.saveBarAdditions(queue);
        timesSeen = Number(entry.timesSeen) || 1;
        tapped[key] = timesSeen;
        // Remember which entries this session wrote: the run id does not
        // exist yet (the run is saved after the sheet is dismissed), so
        // backfillQueuedVenueRunIds stamps it into these keys post-save.
        if (!Array.isArray(results._queuedVenueCandidateKeys)) {
          results._queuedVenueCandidateKeys = [];
        }
        if (!results._queuedVenueCandidateKeys.includes(candidate.key)) {
          results._queuedVenueCandidateKeys.push(candidate.key);
        }
        console.log(
          `📱 Scriptable: Queued venue candidate "${candidate.name}" (${candidate.city}) — seen ${timesSeen} time(s)`,
        );
      }
      const feedbackJs = `markVenueCandidateQueued(${JSON.stringify(key)}, ${JSON.stringify(String(timesSeen))})`;
      try {
        await webView.evaluateJavaScript(feedbackJs, false);
      } catch (error) {
        /* in-page feedback is optional polish; the queue write already happened */
      }
    } catch (error) {
      console.warn(
        `📱 Scriptable: Failed to queue venue candidate: ${error.message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Manual bear/not-bear overrides (results-UI ↔ chunkyscrape:// bridge).
  // The owner's verdict is stamped as `bearSource: manual-*` in the event's
  // notes, so it persists on the calendar record and wins over the AI on
  // future scrapes (see SharedCore.prepareEventsForCalendar).
  // ---------------------------------------------------------------------------

  // Compact date label for override rows ("" when absent/unparseable).
  formatBearOverrideDate(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return "";
    return date.toDateString();
  }

  // Bear verdict controls stamped onto EVERY event card — kept and dropped
  // alike — so the current verdict is visible and either direction is one tap
  // away. `bearIdx` is namespaced because the two source lists share one
  // bridge: "k<i>" = results.analyzedEvents[i], "d<i>" =
  // results.bearDroppedEvents[i]. Returns "" without an index (a plain card).
  buildBearVerdictActionsHtml(options) {
    const opts = options && typeof options === "object" ? options : {};
    const rawIdx = typeof opts.bearIdx === "string" ? opts.bearIdx : "";
    if (!rawIdx) return "";
    const idx = this.escapeHtml(rawIdx);
    const isBear = opts.bearVerdict !== "not-bear";
    // Saved-run display has no post-dismissal execution, and a drop already
    // rescued by a calendar record must not be double-marked: both render the
    // verdict read-only rather than hiding it.
    const interactive = opts.interactive === true;
    const disabledAttr = interactive ? "" : " disabled";
    const button = (act, label) => {
      const active = (act === "mark-bear") === isBear;
      return `<button type="button" onclick="markBearOverride(this)" class="bear-verdict-btn bear-override-btn${active ? " is-active" : ""}" data-bear-idx="${idx}" data-bear-act="${act}"${disabledAttr}>${label}</button>`;
    };
    const note = opts.note
      ? `<span class="bear-verdict-note">${this.escapeHtml(String(opts.note))}</span>`
      : "";
    return `
            <div class="bear-verdict-row" data-bear-verdict="${isBear ? "bear" : "not-bear"}">
                <span class="bear-verdict-label">Bear verdict</span>
                ${button("mark-bear", "🐻 Mark as bear")}
                ${button("mark-not-bear", "🚫 Mark as not bear")}
                ${note}
            </div>`;
  }

  // "Dropped as non-bear (N)" section: enforce-mode bear-check drops rendered
  // with the SAME event-card markup the kept events use (they are real events
  // the cascade rejected, not a debug list), each carrying both verdict
  // buttons. Buttons go read-only for saved-run display (no post-dismissal
  // execution there) and for rows already rescued by a calendar manual-bear
  // record.
  generateBearDroppedSection(results) {
    const entries = Array.isArray(results && results.bearDroppedEvents)
      ? results.bearDroppedEvents
      : [];
    if (entries.length === 0) return "";
    const interactive = !results || results._isDisplayingSavedRun !== true;
    const runInfo = {
      runId: (results && (results.savedRunId || results.sourceRunId)) || null,
    };

    const cards = entries
      .map((entry, index) => {
        if (!entry) return "";
        // The drop entry keeps the full event under `.event`; older/partial
        // entries fall back to the flat summary fields so a card still renders.
        const hasFullEvent = !!(entry.event && typeof entry.event === "object");
        const event = hasFullEvent
          ? entry.event
          : {
              title: entry.title,
              startDate: entry.startDate,
              bar: entry.venue,
            };
        // Two rescue flags, one treatment: `rescued` (a calendar manual-bear
        // record pre-empted the drop) and `manuallyMarkedBear` (the owner
        // rescued it during the run via the verdict buttons — saved runs
        // persist the flag on the same entry) both render read-only with the
        // verdict shown as bear. Fallback cards without `.event` also go
        // read-only: recordBearOverrideAndReport cannot act on them, so live
        // buttons would be silently dead.
        const isRescued =
          entry.rescued === true || entry.manuallyMarkedBear === true;
        return this.generateEventCard(event, runInfo, {
          dropped: true,
          bearIdx: `d${index}`,
          bearVerdict: isRescued ? "bear" : "not-bear",
          interactive: interactive && !isRescued && hasFullEvent,
          dropReason: entry.reason || "",
          dropHost: entry.host || "",
          note: entry.rescued
            ? "Rescued (manual override on calendar record)"
            : entry.manuallyMarkedBear === true
              ? "Rescued (marked bear by calendar owner this run)"
              : "",
        });
      })
      .join("");

    return `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">🚫</span>
            <span class="section-title">Dropped as non-bear</span>
            <span class="section-count">${entries.length}</span>
        </div>
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:12px;">These events were filtered out by the bear check and will NOT be written. Tap "Mark as bear" to pull one back into this run's write plan — the verdict sticks on the calendar record for future scrapes.</div>
        ${cards}
    </div>
    `;
  }

  // Every distinct series-change proposal this run refused to write. Several
  // occurrences of one series carry the same proposal, so identical entries
  // collapse — the owner decides once per series, not once per date.
  collectSeriesChangeProposals(results) {
    const events = Array.isArray(results && results.analyzedEvents)
      ? results.analyzedEvents
      : [];
    const seen = new Set();
    const proposals = [];
    events.forEach((event) => {
      const proposal = this.getSeriesChangeProposal(event);
      if (!proposal) return;
      const calendarName =
        proposal.calendarName || this.getCalendarNameForDisplay(event) || "";
      const entry = { ...proposal, calendarName };
      const key = [
        entry.calendarName,
        entry.eventTitle,
        entry.field,
        entry.current,
        entry.proposed,
      ].join("||");
      if (seen.has(key)) return;
      seen.add(key);
      proposals.push(entry);
    });
    return proposals;
  }

  // The human-facing half of the refusal: the owner should be able to accept
  // or reject a schedule change from this section alone, without opening the
  // source page. Display-only — no button here writes anything, by design.
  generateSeriesChangeProposalSection(results) {
    const proposals = this.collectSeriesChangeProposals(results);
    if (proposals.length === 0) return "";

    const cards = proposals
      .map((proposal) => {
        const sourceLink = proposal.sourceUrl
          ? this.isSafeExternalUrl(proposal.sourceUrl)
            ? `<a href="${this.escapeHtml(proposal.sourceUrl)}" target="_blank" rel="noopener" style="font-size:12px; color:var(--primary-color); word-break:break-all;">${this.escapeHtml(proposal.sourceUrl)}</a>`
            : `<span style="font-size:12px; color:var(--text-secondary); word-break:break-all;">${this.escapeHtml(proposal.sourceUrl)}</span>`
          : "";
        const columnStyle =
          "flex:1 1 200px; border:1px solid var(--border-color); border-radius:8px; padding:8px;";
        const labelStyle =
          "font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-secondary); margin-bottom:4px;";
        const valueStyle =
          "font-size:13px; font-family:monospace; word-break:break-word; color:var(--text-primary);";
        return `
        <div class="event-card series-proposal-card">
            <span class="action-badge badge-warning series-proposal-badge">📐 proposal — not written</span>
            <div class="write-action-note">Field: ${this.escapeHtml(proposal.field || "recurrence")}${proposal.calendarName ? ` • Calendar: ${this.escapeHtml(proposal.calendarName)}` : ""}</div>
            <div class="event-title">${this.escapeHtml(proposal.eventTitle || "Untitled series")}</div>
            <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
                <div style="${columnStyle}">
                    <div style="${labelStyle}">Calendar says today</div>
                    <div style="${valueStyle}">${this.escapeHtml(proposal.current || "—")}</div>
                </div>
                <div style="${columnStyle}">
                    <div style="${labelStyle}">Source proposes</div>
                    <div style="${valueStyle}">${this.escapeHtml(proposal.proposed || "—")}</div>
                </div>
            </div>
            ${proposal.evidence ? `<div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">Evidence: “${this.escapeHtml(proposal.evidence)}”</div>` : ""}
            ${sourceLink}
        </div>
        `;
      })
      .join("");

    return `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">📐</span>
            <span class="section-title">Series-change proposals</span>
            <span class="section-count">${proposals.length}</span>
        </div>
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:12px;">A source that owns these series says their schedule changed. The scraper does NOT write series changes: a wrong override costs one night and is reversible, a wrong series change repeats into the future. Nothing here is in this run's write plan — accept one by editing the series yourself (ICS import).</div>
        ${cards}
    </div>
    `;
  }

  // Split a namespaced card id into its source list and array index:
  //   "k7" → { list: "kept",    index: 7 }  (results.analyzedEvents[7])
  //   "d2" → { list: "dropped", index: 2 }  (results.bearDroppedEvents[2])
  // Both lists are addressable in both directions now that every card carries
  // both buttons, so the id — not the action — says which list to read.
  parseBearCardId(id) {
    const key = String(id == null ? "" : id);
    const match = /^([kd])(\d+)$/.exec(key);
    if (!match) return null;
    const index = Number(match[2]);
    if (!Number.isInteger(index) || index < 0) return null;
    return { list: match[1] === "k" ? "kept" : "dropped", index, key };
  }

  // Record one override tap natively and (best-effort) flip the card's verdict
  // buttons. Called fire-and-forget from shouldAllowRequest, which must
  // synchronously return a bool — so the await lives here, not in the handler.
  // Repeat taps (per-tap nonce keeps them firing) overwrite the same pending
  // slot, and tapping the opposite direction clears the other slot, so the
  // last tap on a card always wins.
  async recordBearOverrideAndReport(action, id, results, pending, webView) {
    try {
      const parsed = this.parseBearCardId(id);
      if (!parsed) return;
      const { key, index } = parsed;
      let title = "";
      if (parsed.list === "dropped") {
        const entries = Array.isArray(results && results.bearDroppedEvents)
          ? results.bearDroppedEvents
          : [];
        const entry = entries[index];
        if (!entry || !entry.event || entry.rescued) return;
        title = entry.title || "";
        if (action === "mark-bear") {
          pending.markedBear[key] = entry;
        } else {
          // "Mark as not bear" on a drop just confirms the drop — undo any
          // pending rescue and leave the event out of the write plan.
          delete pending.markedBear[key];
        }
      } else {
        const events = Array.isArray(results && results.analyzedEvents)
          ? results.analyzedEvents
          : [];
        const event = events[index];
        if (!event) return;
        title = event.title || "";
        if (action === "mark-bear") {
          pending.keptMarkedBear[key] = event;
          delete pending.markedNotBear[key];
        } else {
          pending.markedNotBear[key] = event;
          delete pending.keptMarkedBear[key];
        }
      }
      console.log(
        `📱 Scriptable: Bear override tapped — ${action} #${key} "${title}"`,
      );
      const feedbackJs = `markBearOverrideDone(${JSON.stringify(key)}, ${JSON.stringify(String(action))})`;
      try {
        await webView.evaluateJavaScript(feedbackJs, false);
      } catch (error) {
        /* in-page feedback is optional polish; the override is recorded */
      }
    } catch (error) {
      console.warn(
        `📱 Scriptable: Failed to record bear override: ${error.message}`,
      );
    }
  }

  // Apply the overrides recorded during the WebView session. Returns
  // { markedBear, markedNotBear } counts for the execution-confirmation Alert.
  async applyPendingBearOverrides(results, pending) {
    const counts = { markedBear: 0, markedNotBear: 0 };
    const markedBearIds = Object.keys(
      pending && pending.markedBear ? pending.markedBear : {},
    );
    const markedNotBearIds = Object.keys(
      pending && pending.markedNotBear ? pending.markedNotBear : {},
    );
    const keptMarkedBearIds = Object.keys(
      pending && pending.keptMarkedBear ? pending.keptMarkedBear : {},
    );
    if (
      markedBearIds.length === 0 &&
      markedNotBearIds.length === 0 &&
      keptMarkedBearIds.length === 0
    ) {
      return counts;
    }
    const core = this.getIdentityCore();
    if (!core) {
      console.warn(
        "📱 Scriptable: Bear overrides skipped (identity core failed to initialize)",
      );
      return counts;
    }

    // Marked not-bear: the analyzed event stays in the write plan but is
    // adjusted in place — its one write stamps the hidden tombstone (the
    // bearReview flag the website already hides, plus bearSource manual-*).
    for (const id of markedNotBearIds) {
      const event = pending.markedNotBear[id];
      if (!event) continue;
      const overriddenReason =
        typeof event.bearReview === "string" && event.bearReview
          ? event.bearReview
          : typeof event.bearSource === "string" && event.bearSource
            ? `${event.bearSource} verdict`
            : "";
      event.bearSource = SharedCore.buildManualBearSource(
        "not-bear",
        overriddenReason,
      );
      if (!/^(unlikely|unsure)/i.test(String(event.bearReview || "").trim())) {
        event.bearReview = "unlikely — manual: marked not-bear by calendar owner";
      }
      event.notes = core.formatEventNotes(event);
      counts.markedNotBear += 1;
      console.log(
        `📱 Scriptable: Manual override — "${event.title || "Unknown"}" marked not-bear (hidden tombstone will be written)`,
      );
    }

    // Kept event confirmed bear: it is already in the write plan, so the only
    // change is stamping the owner's verdict in place (same notes path as the
    // not-bear branch) — that locks the event against a future AI flip.
    for (const id of keptMarkedBearIds) {
      const event = pending.keptMarkedBear[id];
      if (!event) continue;
      const overriddenReason =
        typeof event.bearReview === "string" && event.bearReview
          ? event.bearReview
          : typeof event.bearSource === "string" && event.bearSource
            ? `${event.bearSource} verdict`
            : "";
      event.isBearEvent = true;
      event.bearSource = SharedCore.buildManualBearSource(
        "bear",
        overriddenReason,
      );
      // The website hides flagged events; an explicit owner "bear" clears it.
      if (typeof event.bearReview === "string" && event.bearReview) {
        delete event.bearReview;
      }
      event.notes = core.formatEventNotes(event);
      counts.markedBear += 1;
      console.log(
        `📱 Scriptable: Manual override — "${event.title || "Unknown"}" confirmed bear (manual verdict stamped on the existing write)`,
      );
    }

    // Marked bear: stamp the manual verdict, then run the SAME calendar prep
    // (calendar assignment + merge analysis) the normal flow uses so these
    // late-added events join the write plan as fully analyzed events.
    const toPrep = [];
    for (const id of markedBearIds) {
      const entry = pending.markedBear[id];
      if (!entry || !entry.event) continue;
      toPrep.push({
        ...entry.event,
        isBearEvent: true,
        bearSource: SharedCore.buildManualBearSource("bear", entry.reason),
      });
      entry.manuallyMarkedBear = true;
    }
    if (toPrep.length > 0) {
      try {
        const globalConfig =
          (results && results.config && results.config.config) || {};
        const prepped = await core.prepareEventsForCalendar(
          toPrep,
          this,
          globalConfig,
        );
        if (!Array.isArray(results.analyzedEvents)) {
          results.analyzedEvents = [];
        }
        // Duplicate-row guard (same ordering defect as the prep-time rescue in
        // SharedCore): these events join the plan after both dedup passes have
        // run, so a twin already in the plan would leave two rows aimed at ONE
        // calendar record. Fold into the existing row when there is one — the
        // owner's verdict still counts either way, so the tally is unchanged.
        const added = [];
        for (const preppedEvent of prepped) {
          const folded = core.foldBearOverrideIntoPlanEntry(
            results.analyzedEvents,
            preppedEvent,
            {
              existingIdentifier:
                preppedEvent._existingEvent &&
                preppedEvent._existingEvent.identifier,
              manualBearSource: preppedEvent.bearSource,
            },
          );
          if (folded) continue;
          results.analyzedEvents.push(preppedEvent);
          added.push(preppedEvent);
        }
        counts.markedBear += prepped.length;
        added.forEach((event) =>
          console.log(
            `📱 Scriptable: Manual override — "${event.title || "Unknown"}" marked bear and prepped for calendar (${event._action || "new"})`,
          ),
        );
      } catch (error) {
        console.warn(
          `📱 Scriptable: Manual bear override prep failed: ${error.message}`,
        );
      }
    }
    return counts;
  }

  // Generate HTML for URL discovery section (discoveryOnly mode results)
  generateDiscoverySection(results) {
    const parserResults = Array.isArray(results && results.parserResults)
      ? results.parserResults
      : [];
    const discoveryParsers = parserResults.filter(
      (r) => r && r.discoveryOnly && r.mermaidGraph,
    );
    if (discoveryParsers.length === 0) return "";

    const sections = discoveryParsers
      .map((r, index) => {
        // Include index to guarantee unique IDs even when multiple parsers share a name
        const safeId = `${(r.name || "parser").replace(/[^a-zA-Z0-9]/g, "_")}_${index}`;
        const nodeCount =
          r.discoveryTree && r.discoveryTree.allNodes
            ? r.discoveryTree.allNodes.length
            : 0;
        const mermaidEncoded = encodeURIComponent(r.mermaidGraph || "");
        const asciiEncoded = encodeURIComponent(r.asciiTree || "");
        // Paste-ready parser entry (the log header line is dropped — the copied
        // text starts at "{" so it pastes straight into parsers[]).
        const suggestedConfigText =
          typeof r.suggestedConfig === "string"
            ? r.suggestedConfig
                .split("\n")
                .filter((line) => !line.startsWith("📋"))
                .join("\n")
                .trim()
            : "";
        const suggestedEncoded = encodeURIComponent(suggestedConfigText);
        const hasSuggestedConfig = suggestedConfigText.length > 0;
        const urlListItems =
          r.discoveryTree && Array.isArray(r.discoveryTree.allNodes)
            ? r.discoveryTree.allNodes
                .map((u) => `<li>${this.escapeHtml(u)}</li>`)
                .join("")
            : "";

        const segmentsByUrl =
          r.discoveryTree && r.discoveryTree.segmentsByUrl
            ? r.discoveryTree.segmentsByUrl
            : {};
        const {
          button: segmentsTabButton,
          panel: segmentsPanel,
          totalSegments,
        } = this.generateDiscoverySegmentsPanel(safeId, segmentsByUrl);
        const hasSegments = totalSegments > 0;

        return `
        <div class="discovery-parser" style="margin-bottom:16px;">
            <div style="font-weight:600; margin-bottom:8px;">${this.escapeHtml(r.name || "Parser")} <span style="font-weight:400; opacity:0.7;">— ${nodeCount} URL(s) found${hasSegments ? `, ${totalSegments} segment(s)` : ""}</span></div>
            <div style="display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap;">
                ${hasSuggestedConfig ? `<button onclick="switchDiscoveryTab(this,'suggested_${safeId}')" class="disc-tab-btn disc-tab-active" data-tab="suggested_${safeId}">📋 Suggested Config</button>` : ""}
                <button onclick="switchDiscoveryTab(this,'mermaid_${safeId}')" class="disc-tab-btn${hasSuggestedConfig ? "" : " disc-tab-active"}" data-tab="mermaid_${safeId}">Mermaid Graph</button>
                <button onclick="switchDiscoveryTab(this,'ascii_${safeId}')" class="disc-tab-btn" data-tab="ascii_${safeId}">ASCII Tree</button>
                <button onclick="switchDiscoveryTab(this,'urls_${safeId}')" class="disc-tab-btn" data-tab="urls_${safeId}">URL List</button>
                ${segmentsTabButton}
            </div>
            ${
              hasSuggestedConfig
                ? `<div id="suggested_${safeId}" class="disc-tab-panel">
                <div style="display:flex; gap:6px; margin-bottom:6px; flex-wrap:wrap; align-items:center;">
                    <button onclick="copyDiscoveryText(this)" class="log-copy-btn" data-encoded="${this.escapeHtml(suggestedEncoded)}">📋 Copy Config</button>
                    <span style="font-size:12px; color:var(--text-secondary);">Paste into parsers[] in scraper-input.js</span>
                </div>
                <pre class="discovery-output">${this.escapeHtml(suggestedConfigText)}</pre>
            </div>`
                : ""
            }
            <div id="mermaid_${safeId}" class="disc-tab-panel"${hasSuggestedConfig ? ' style="display:none"' : ""}>
                <div style="display:flex; gap:6px; margin-bottom:6px; flex-wrap:wrap;">
                    <button onclick="copyDiscoveryText(this)" class="log-copy-btn" data-encoded="${this.escapeHtml(mermaidEncoded)}">📋 Copy Mermaid</button>
                    <a href="https://mermaid.live" target="_blank" style="padding:4px 10px; background:var(--background-light); border:1px solid var(--border-color); border-radius:6px; font-size:12px; color:var(--primary-color); text-decoration:none;">Open mermaid.live ↗</a>
                </div>
                <pre class="discovery-output">${this.escapeHtml(r.mermaidGraph || "")}</pre>
            </div>
            <div id="ascii_${safeId}" class="disc-tab-panel" style="display:none">
                <div style="margin-bottom:6px;">
                    <button onclick="copyDiscoveryText(this)" class="log-copy-btn" data-encoded="${this.escapeHtml(asciiEncoded)}">📋 Copy Tree</button>
                </div>
                <pre class="discovery-output">${this.escapeHtml(r.asciiTree || "")}</pre>
            </div>
            <div id="urls_${safeId}" class="disc-tab-panel" style="display:none">
                <ul style="margin:0; padding-left:18px; font-size:12px; font-family:monospace;">${urlListItems}</ul>
            </div>
            ${segmentsPanel}
        </div>
            `;
      })
      .join("");

    return `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">🔍</span>
            <span class="section-title">URL Discovery</span>
            <span class="section-count">${discoveryParsers.length}</span>
        </div>
        <p style="font-size:12px; color:var(--text-secondary); margin:0 0 12px;">Discovery-only mode: links found up to configured depth. Paste the Mermaid graph at <a href="https://mermaid.live" target="_blank">mermaid.live</a> to visualize.</p>
        ${sections}
    </div>
        `;
  }

  // Generate HTML for individual event card
  generateEventCard(event, runInfo = {}, bearOptions = null) {
    // bearOptions carries this card's bear verdict + bridge index (see
    // buildBearVerdictActionsHtml). Absent → a plain card with no verdict row,
    // which is what the standalone-card unit tests and any future caller get.
    const bearOpts =
      bearOptions && typeof bearOptions === "object" ? bearOptions : {};
    const isDroppedCard = bearOpts.dropped === true;
    const bearVerdictRow = this.buildBearVerdictActionsHtml(bearOpts);
    const intentAction = this.normalizeIntentAction(event) || "other";
    const writeAction = this.getWriteActionFromEvent(event);
    // Dropped-as-non-bear cards never reached calendar analysis, so their
    // intent/write labels would read "OTHER / OTHER" — the drop badge and the
    // bear-check reason say something true instead.
    const actionBadge = isDroppedCard
      ? '<span class="action-badge badge-error">🚫 DROPPED — NOT BEAR</span>'
      : {
          new: '<span class="action-badge badge-new">NEW</span>',
          merge: '<span class="action-badge badge-merge">MERGE</span>',
          conflict: '<span class="action-badge badge-warning">CONFLICT</span>',
          missing_calendar:
            '<span class="action-badge badge-error">MISSING CALENDAR</span>',
        }[intentAction] ||
        '<span class="action-badge badge-warning">OTHER</span>';
    // Recurring series are display+export only (never auto-written): badge
    // the card and offer the ICS export instead of a calendar write.
    const recurringBadge = SharedCore.isRecurringSeriesEvent(event)
      ? '<span class="action-badge badge-warning recurring-badge">🔁 recurring — save via ICS</span>'
      : "";
    // Additive second badge: "recurring — save via ICS" reads identically
    // whether this series is already in the calendar or has never been seen.
    // When the run matched a saved series, say so on the card — that ambiguity
    // is what made a matched CubScout look like a brand-new event.
    const seriesMatchBadge =
      event && event._seriesMatch
        ? '<span class="action-badge badge-merge series-match-badge">🔁 already saved — matches this series</span>'
        : "";
    // Additive third badge, same pattern as seriesMatchBadge: report-only
    // sanity flags (SharedCore.getEventSanityFlags) — compact codes only,
    // details live in the run log's ⚠️ SANITY line. Never changes the
    // action badge or the write plan.
    const sanityFlags = Array.isArray(event && event._sanityFlags)
      ? event._sanityFlags
      : [];
    const sanityBadge =
      sanityFlags.length > 0
        ? `<span class="action-badge badge-warning sanity-flag-badge">⚠️ sanity: ${this.escapeHtml(
            sanityFlags.map((flag) => flag.code).join(", "),
          )}</span>`
        : "";
    // Additive fourth badge, same pattern again: a slot-host source writes a
    // single-occurrence override of a series it does not own. Neither NEW nor
    // a series change — say which night it replaces so the action badge above
    // ("MERGE"/"CREATE") is not the only thing the card claims.
    const overrideOccurrenceLabel = this.isSingleOccurrenceOverride(event)
      ? this.getOverrideOccurrenceLabel(event)
      : "";
    const overrideBadge = this.isSingleOccurrenceOverride(event)
      ? `<span class="action-badge badge-merge series-override-badge">🗓️ override — this date only${
          overrideOccurrenceLabel
            ? `: ${this.escapeHtml(overrideOccurrenceLabel)}`
            : ""
        }</span>`
      : "";
    // Fifth badge: the refusal case. This event's source owns the series and
    // asserts a different schedule — the card says so, the proposals section
    // carries the detail, and nothing about the write plan changes.
    const seriesProposalBadge = this.getSeriesChangeProposal(event)
      ? '<span class="action-badge badge-warning series-proposal-badge">📐 series change proposed — not written</span>'
      : "";
    // Cadence a slot-host page implies. Reported, never turned into an RRULE.
    const cadenceHint = this.getCadenceHint(event);
    const cadenceHintNote = cadenceHint
      ? `<div class="write-action-note">Cadence hint (not written): ${this.escapeHtml(
          [
            cadenceHint.rrule,
            cadenceHint.evidence ? `“${cadenceHint.evidence}”` : "",
          ]
            .filter(Boolean)
            .join(" — "),
        )}</div>`
      : "";
    const dropDetail = [
      bearOpts.dropReason ? String(bearOpts.dropReason) : "",
      bearOpts.dropHost ? `from ${bearOpts.dropHost}` : "",
    ]
      .filter(Boolean)
      .join(" • ");
    const actionNote = isDroppedCard
      ? dropDetail
        ? `<div class="write-action-note">Bear check: ${this.escapeHtml(dropDetail)}</div>`
        : ""
      : `<div class="write-action-note">Intent: ${this.formatIntentActionLabel(intentAction)} • Write: ${this.formatWriteActionLabel(writeAction)}</div>`;

    const eventDate = new Date(event.startDate);
    const endDate = event.endDate ? new Date(event.endDate) : null;

    // Get timezone from city configuration instead of expecting it on the event
    const timezone = this.getTimezoneForCityOrUtc(event.city);
    const timeZoneOptions = { timeZone: timezone };

    const dateStr = eventDate.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      ...timeZoneOptions,
    });
    const timeStr = eventDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      ...timeZoneOptions,
    });
    const endTimeStr = endDate
      ? endDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          ...timeZoneOptions,
        })
      : "";

    // Also show UTC time for verification
    const utcTimeStr = eventDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    });
    const endUtcTimeStr = endDate
      ? endDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "UTC",
        })
      : "";

    // Use the final notes that will actually be saved
    const notes = event.notes || "";
    const calendarName = this.getCalendarNameForDisplay(event);

    // Secondary verification surface (kept small): the same Bar/Address/Pin
    // Google Maps links as the new-venue-candidates section, rendered only
    // when the card has data for them (empty string otherwise).
    const mapVerifyRow = this.buildMapVerifyLinksHtml({
      bar: event.bar || event.venue,
      city: event.city,
      address: event.address,
      coordinates: event.location,
    });
    // Computed evidence panel (SharedCore attaches _evidenceLines during
    // calendar prep); "" when absent — e.g. saved-run display (fail open).
    const evidenceBlock = this.buildEvidenceLinesHtml(event._evidenceLines);
    // Event Builder prefill link (every card) + ICS export (recurring cards).
    const eventActionsRow = this.buildEventCardActionsHtml(event);

    let html = `
        <div class="event-card${isDroppedCard ? " bear-dropped-card" : ""}">
            ${actionBadge}${recurringBadge}${seriesMatchBadge}${sanityBadge}${overrideBadge}${seriesProposalBadge}
            ${actionNote}${cadenceHintNote}
            <div class="event-title">${this.escapeHtml(event.title || event.name)}</div>
            ${bearVerdictRow}
            
            <!-- Main Event Info -->
            <div class="event-details">
                ${
                  event.venue || event.bar
                    ? `
                    <div class="event-detail">
                        <span>📍</span>
                        <span>${this.escapeHtml(event.venue || event.bar)}</span>
                    </div>
                `
                    : ""
                }
                ${
                  event.address
                    ? `
                    <div class="event-detail">
                        <span>🏠</span>
                        <span>${this.escapeHtml(event.address)}</span>
                    </div>
                `
                    : ""
                }
                ${
                  event.location
                    ? `
                    <div class="event-detail coordinates">
                        <span>🌐</span>
                        <span>Coordinates: ${this.escapeHtml(event.location)}</span>
                    </div>
                `
                    : ""
                }
                ${mapVerifyRow}
                ${eventActionsRow}
                ${evidenceBlock}
                <div class="event-detail">
                    <span>📅</span>
                    <span>${dateStr} ${timeStr}${endTimeStr ? ` - ${endTimeStr}` : ""}</span>
                </div>
                <div class="event-detail" style="font-size: 12px; color: #666; margin-left: 20px;">
                    <span>🌍</span>
                    <span>UTC: ${utcTimeStr}${endUtcTimeStr ? ` - ${endUtcTimeStr}` : ""}</span>
                </div>
                <div class="event-detail">
                    <span>📱</span>
                    <span>${this.escapeHtml(calendarName)}</span>
                </div>
                ${
                  event.description
                    ? `
                    <div class=\"event-detail event-description\">
                        <span>📝</span>
                        <span>${this.escapeHtml(event.description)}</span>
                    </div>
                `
                    : ""
                }
                ${
                  event.tea
                    ? `
                    <div class="event-detail" style="background: #e8f5e9; padding: 8px; border-radius: 5px; margin-top: 8px;">
                        <span>☕</span>
                        <span style="font-style: italic;">${this.escapeHtml(event.tea)}</span>
                    </div>
                `
                    : ""
                }
                ${
                  event.image
                    ? `
                    <div class=\"event-image\">
                        <a href=\"${this.escapeHtml(event.image)}\" target=\"_blank\" rel=\"noopener\" style=\"color: var(--primary-color); font-weight: 500;\">View Full Image</a>
                        <div class=\"image-container\" style=\"margin-top: 8px; display: block;\">
                            <img src=\"${this.escapeHtml(event.image)}\" alt=\"Event Image\" onerror=\"this.style.display='none'\">
                        </div>
                    </div>
                `
                    : ""
                }
                ${
                  event.instagram
                    ? `
                    <div class="event-detail">
                        <span>📸</span>
                        <span><a href="${this.escapeHtml(event.instagram)}" target="_blank" rel="noopener" style="color: var(--primary-color);">Instagram</a></span>
                    </div>
                `
                    : ""
                }
                ${
                  event.facebook
                    ? `
                    <div class="event-detail">
                        <span>👥</span>
                        <span><a href="${this.escapeHtml(event.facebook)}" target="_blank" rel="noopener" style="color: var(--primary-color);">Facebook</a></span>
                    </div>
                `
                    : ""
                }
                ${
                  event.ticketUrl
                    ? `
                    <div class="event-detail">
                        <span>🎟️</span>
                        <span><a href="${this.escapeHtml(event.ticketUrl)}" target="_blank" rel="noopener" style="color: var(--primary-color);">Tickets</a></span>
                    </div>
                `
                    : ""
                }
                ${
                  event.url || event.website
                    ? `
                    <div class="event-detail">
                        <span>🌐</span>
                        <span><a href="${this.escapeHtml(event.url || event.website)}" target="_blank" rel="noopener" style="color: var(--primary-color);">Website</a></span>
                    </div>
                `
                    : ""
                }
                ${
                  event.googleMapsLink
                    ? `
                    <div class="event-detail">
                        <span>🗺️</span>
                        <span><a href="${this.escapeHtml(event.googleMapsLink)}" target="_blank" rel="noopener" style="color: var(--primary-color);">Google Maps</a></span>
                    </div>
                `
                    : ""
                }
                ${
                  event.price
                    ? `
                    <div class="event-detail">
                        <span>💵</span>
                        <span>${this.escapeHtml(event.price)}</span>
                    </div>
                `
                    : ""
                }
                
                <!-- Calendar Notes Preview -->
                ${
                  notes
                    ? `
                    <details style="margin-top: 10px;">
                        <summary style="cursor: pointer; font-size: 13px; color: #007aff; padding: 5px;">📝 Calendar Notes Preview</summary>
                        <div class="notes-preview">
                            ${(() => {
                              // Parse and format notes for better readability
                              const lines = notes.split("\n");
                              let formattedHtml = "";

                              lines.forEach((line) => {
                                const trimmed = line.trim();
                                if (trimmed === "") {
                                  formattedHtml += "<br>";
                                  return;
                                }

                                const colonIndex = line.indexOf(":");
                                if (colonIndex > 0) {
                                  // Key-value metadata line
                                  const key = line
                                    .substring(0, colonIndex)
                                    .trim();
                                  const value = line
                                    .substring(colonIndex + 1)
                                    .trim();
                                  formattedHtml += `<div class="notes-line"><strong>${this.escapeHtml(key)}:</strong> ${this.escapeHtml(value)}</div>`;
                                } else {
                                  // Freeform description line
                                  formattedHtml += `<div class="notes-line">${this.escapeHtml(line)}</div>`;
                                }
                              });

                              return formattedHtml || "<em>No notes</em>";
                            })()}
                        </div>
                    </details>
                `
                    : ""
                }
            </div>
            
            <!-- Show comparison for all non-new events with original data -->
            ${
              event._original && this.normalizeIntentAction(event) !== "new"
                ? (() => {
                    const hasDifferences = this.hasEventDifferences(event);
                    const eventId =
                      event.key ||
                      `event-${Math.random().toString(36).substr(2, 9)}`;
                    // Decode HTML entities before creating safe ID
                    const decodedEventId = eventId
                      .replace(/&amp;/g, "&")
                      .replace(/&lt;/g, "<")
                      .replace(/&gt;/g, ">")
                      .replace(/&quot;/g, '"')
                      .replace(/&#39;/g, "'");
                    const safeEventId = decodedEventId.replace(
                      /[^a-zA-Z0-9\-_]/g,
                      "_",
                    ); // Create safe ID for DOM elements
                    const isExpanded = false; // Start collapsed; expand on click

                    return `
                <div style="margin-top: 15px; border-top: 1px solid #e0e0e0; padding-top: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <div style="display: flex; align-items: center; cursor: pointer; flex: 1;"
                             onclick="toggleComparisonSection('${safeEventId}')">
                            <h4 style="margin: 0; font-size: 14px;">
                                <span id="expand-icon-${safeEventId}" style="display: inline-block; width: 20px; transition: transform 0.2s;">
                                    ${isExpanded ? "▼" : "▶"}
                                </span>
                                📊 ${event._action === "conflict" ? "Conflict Resolution" : "Merge Comparison"}
                                ${hasDifferences ? '<span style="color: #ff9500; font-size: 12px; margin-left: 8px;">• Has changes</span>' : ""}
                            </h4>
                        </div>
                        <button onclick="toggleDiffView(this, '${safeEventId}');" 
                                style="padding: 4px 10px; font-size: 11px; background: var(--primary-color); color: var(--text-inverse); border: none; border-radius: 8px; cursor: pointer; font-family: var(--font-sans); font-weight: 500; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3); ${!isExpanded ? "display: none;" : ""}"
                                id="diff-toggle-${safeEventId}">
                            Switch to Line View
                        </button>
                    </div>
                    
                    <div id="comparison-content-${safeEventId}" style="${!isExpanded ? "display: none;" : ""}">
                    <!-- Simple three-object comparison -->
                    <div style="margin-bottom: 10px;">
                        <div style="font-size: 12px; color: #666; margin-bottom: 5px;">
                            📊 <strong>Scraper:</strong> ${Object.keys(event._original?.scraper || {}).length} fields |
                            📅 <strong>Calendar:</strong> ${Object.keys(event._original?.calendar || {}).length} fields |
                            🔀 <strong>Merged:</strong> ${Object.keys(event._original?.merged || {}).length} fields
                        </div>
                    </div>
                    
                    <!-- Table view (default) -->
                    <div id="table-view-${safeEventId}" class="diff-view" style="display: block; padding: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                            <div style="font-size: 12px; color: #666;">
                                <strong>📊 Field-by-Field Comparison</strong>
                                <div style="font-size: 10px; margin-top: 2px; color: #888;">
                                    Shows how each field will be merged between existing and new event data
                                </div>
                            </div>
                            <button onclick="copyEventJSON(this)" class="copy-json-btn">
                                📋 Copy JSON
                            </button>
                        </div>
                        <table class="cmp-table">
                            <tr>
                                <th>Field</th>
                                <th>Existing Event</th>
                                <th class="cmp-flow">Flow</th>
                                <th>New Event</th>
                                <th>Result</th>
                            </tr>
                            ${this.claimMergeDiffBudget(
                              "field-by-field comparison",
                              this.generateComparisonRows(event),
                              event,
                              { asTableRow: true },
                            )}
                        </table>
                    </div>
                    
                    <!-- Line view (hidden by default) -->
                    <div id="line-view-${safeEventId}" class="diff-view" style="display: none; padding: 10px;">
                        <div style="margin-bottom: 12px;">
                            <strong style="font-size: 12px; color: #666;">📝 Line-by-Line Diff</strong>
                            <div style="font-size: 10px; margin-top: 2px; color: #888;">
                                Git-style diff showing additions (+), deletions (-), and unchanged (=) fields
                            </div>
                        </div>
                        ${this.claimMergeDiffBudget(
                          "line-by-line diff",
                          this.generateLineDiffView(event),
                          event,
                        )}
                    </div>
                    </div>
                </div>
                `;
                  })()
                : ""
            }

            <!-- Per-event provenance (field origins + export-issue button) -->
            ${this.buildEventProvenanceHtml(event, runInfo)}

            <!-- Simplified metadata -->
            ${
              event._action === "conflict" && event._conflicts
                ? `
                <div class="conflict-info">
                    <strong>⚠️ Overlapping Events:</strong> ${event._conflicts.length} event(s) at same time
                    <div style="margin-top: 10px;">
                    ${event._conflicts
                      .map((conflict) => {
                        const shouldMerge = event._conflictAnalysis?.find(
                          (a) => a.event === conflict,
                        )?.shouldMerge;
                        return `
                        <div style="background: ${shouldMerge ? "#d4edda" : "#f8d7da"}; padding: 8px; border-radius: 5px; margin-bottom: 5px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <strong>"${this.escapeHtml(conflict.title)}"</strong>
                                    <div style="font-size: 12px; color: #666; margin-top: 2px;">
                                        ${(() => {
                                          // Get timezone from city configuration instead of expecting it on the conflict
                                          const timezone =
                                            this.getTimezoneForCityOrUtc(
                                              event.city,
                                            );
                                          return new Date(
                                            conflict.startDate,
                                          ).toLocaleString("en-US", {
                                            timeZone: timezone,
                                          });
                                        })()}
                                    </div>
                                </div>
                                <div style="font-size: 12px; font-weight: 600; color: ${shouldMerge ? "#155724" : "#721c24"};">
                                    ${shouldMerge ? "✓ Will Merge" : "✗ Different Event"}
                                </div>
                            </div>
                        </div>
                        `;
                      })
                      .join("")}
                    </div>
                </div>
            `
                : ""
            }
            
            ${
              event._action === "missing_calendar"
                ? `
                <div class="conflict-info">
                    <strong>Calendar "${this.escapeHtml(calendarName)}" not found!</strong>
                    <br>Please create this calendar manually before running the scraper.
                </div>
                        `
                : ""
            }
            
            <div class="raw-display">
                ${(() => {
                  // ONE payload per card. Keeps _original (merge provenance)
                  // but drops the AI prompt/validation blobs — see
                  // buildEmbeddedEventJson — and is budgeted so a big run
                  // cannot grow the page without bound (buildBudgetedEventJson).
                  const payload = this.buildBudgetedEventJson(event, runInfo);
                  const what = [
                    payload.dropped.length
                      ? `dropped ${payload.dropped.join(", ")}`
                      : "",
                    payload.truncated && payload.truncated.length
                      ? `shortened ${payload.truncated.slice(0, 6).join(", ")}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join("; ");
                  const notice = payload.capped
                    ? `<div class="payload-cap-note">✂️ Debug JSON trimmed to fit the page (${this.escapeHtml(
                        what,
                      )}). Everything trimmed is still rendered above in this card; the untrimmed event is in the saved run file${
                        payload.runFile
                          ? ` <code>${this.escapeHtml(payload.runFile)}</code>`
                          : ""
                      }.</div>`
                    : "";
                  return `${notice}<pre class="raw-json">${this.escapeHtml(payload.json)}</pre>`;
                })()}
                <div style="margin-top: 8px; text-align: right;">
                    <button onclick="copyEventJSON(this)" class="copy-json-btn">
                        📋 Copy JSON
                    </button>
                </div>
            </div>
        </div>
        `;

    return html;
  }

  // Shared serializer for every place a full event is embedded into the
  // results HTML (the two "Copy JSON" button attributes and the raw <pre>
  // debug dump). ONE replacer so the slimming rules live in one place:
  //   - _aiPrompts/_aiValidation are dropped at ANY depth — the full AI
  //     prompt texts are already surfaced via the dedicated "🤖 AI Prompts"
  //     button, and duplicating ~20 KB of them per event 2-3x per card is
  //     what pushed the Bearracuda run's page (1.76 MB) past
  //     WebView.loadHTML's silent ~1 MB white-screen threshold
  //     (runs 20260725-205758/210227).
  //   - _original is dropped entirely from the BUTTON embeds
  //     (includeOriginal: false); the raw <pre> keeps it (minus the AI
  //     blobs) since that's where a human reads the merge provenance.
  //   - _parserConfig/_existingEvent/_conflicts/placeId/function slimming
  //     is unchanged from the previous inline replacers.
  //   - pretty:false emits the SAME object with no indentation. The card now
  //     embeds the payload exactly once (compact, in the raw <pre>) and the
  //     page re-indents it in the DOM on load, so the ~15% of the payload
  //     that was pure indent whitespace never crosses into the HTML string.
  buildEmbeddedEventJson(event, { includeOriginal = true, pretty = true } = {}) {
    return JSON.stringify(
      event,
      (key, value) => {
        if (key === "_aiPrompts" || key === "_aiValidation") {
          return undefined; // Already available via the AI Prompts button
        }
        if (!includeOriginal && key === "_original") {
          return undefined;
        }
        if (key === "_parserConfig" && value) {
          return { name: value.name, parser: value.parser };
        }
        if (key === "_existingEvent" && value) {
          return {
            title: value.title,
            identifier: value.identifier,
          };
        }
        if (key === "_conflicts" && value && Array.isArray(value)) {
          return value.map((c) => ({
            title: c.title,
            startDate: c.startDate,
            identifier: c.identifier,
          }));
        }
        if (key === "placeId") {
          return undefined; // Hide placeId from debug display
        }
        if (typeof value === "function") {
          return "[Function]";
        }
        return value;
      },
      pretty ? 2 : 0,
    );
  }

  // ---------------------------------------------------------------------
  // Embedded-payload budget.
  //
  // The debug JSON is the single heaviest thing a card emits, and it grows
  // with the event's own content (notes/description/_original), so "it fits
  // today" was luck, not design: run 20260803-143036 (52 events) rendered a
  // 3198 KB page and WebView.loadHTML white-screened.
  //
  // The budget is DOCUMENT-scoped, not per-card: every card gets
  // TOTAL_BUDGET / eventCount, clamped to a per-card maximum so small runs
  // (the common case) are never touched. That makes the payload contribution
  // O(TOTAL_BUDGET) instead of O(events x content) — a 200-event run is
  // bounded by the same constant a 5-event run is.
  //
  // Nothing here is deleted silently: whatever gets pruned is named in the
  // in-card notice, stamped into the copied JSON under `_trimmed`, and
  // logged once per run by logEventJsonBudgetReport().
  // ---------------------------------------------------------------------
  static get EVENT_JSON_TOTAL_BUDGET_BYTES() {
    return 220 * 1024;
  }

  static get EVENT_JSON_MAX_PER_CARD_BYTES() {
    return 24 * 1024;
  }

  // Same shape, one level up: a document-wide allowance for the two merge
  // DIFF RENDERINGS (the 📊 Merge Comparison table and its line-by-line
  // alternate view). Both are collapsed by default and both are derived
  // views of _original, which the card's own payload still carries — so
  // trimming them defers detail, it never destroys the only copy.
  static get MERGE_DIFF_TOTAL_BUDGET_BYTES() {
    return 400 * 1024;
  }

  static get MERGE_DIFF_MAX_PER_CARD_BYTES() {
    return 40 * 1024;
  }

  // Ceiling for the whole page, in UTF-8 BYTES (what WebKit actually holds,
  // not the UTF-16 code-unit count this used to measure — every non-ASCII
  // character in the page, and there are many, made the old number too small).
  //
  // The previous value, 1923 KB, was circular: it was set to "the largest
  // page the owner had ever reviewed", so by construction it could never fire
  // below its own evidence. It then failed to fire on the BEEFMINCE run,
  // which came up blank at 986 KB — half of it. 960 KB sits just under that
  // observed blank, and comfortably above the 825 KB the same run now
  // renders at after the Run Logs cut, so it warns approaching the danger
  // zone instead of after it.
  //
  // Crossing it is not fatal, but it must never be silent — see
  // applyResultsHtmlSizeGuard, which both logs it and puts a banner on the
  // page, because the owner is looking at a WebView, not at the log.
  static get RESULTS_HTML_WARN_BYTES() {
    return 960 * 1024;
  }

  // UTF-8 byte length without Buffer/TextEncoder (neither exists in
  // Scriptable). String.length counts UTF-16 code units and undercounts
  // every multi-byte character on the page.
  static utf8ByteLength(text) {
    const value = typeof text === "string" ? text : String(text || "");
    let bytes = 0;
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        // Surrogate pair → one 4-byte code point (consume the low surrogate).
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  // Pruned in this order, heaviest-and-most-redundant first. Every one of
  // these is ALSO rendered as HTML elsewhere in the same card, so pruning it
  // from the debug dump never removes the only copy:
  //   _original        -> the "📊 Merge Comparison" table renders it
  //                       field-by-field (existing / new / result)
  //   _mergeDiff       -> same table's Result column
  //   _mergeDecisions  -> same table's Result column + the AI merge insights
  //   _fieldPriorities -> same table's per-field strategy label
  //   _evidenceLines   -> the card's own evidence lines section
  //   _analysis        -> the card's action badge + reason line
  static get EVENT_JSON_PRUNE_ORDER() {
    return [
      "_original",
      "_mergeDiff",
      "_mergeDecisions",
      "_fieldPriorities",
      "_evidenceLines",
      "_analysis",
    ];
  }

  // Successively tighter per-string caps, tried in order once key-dropping
  // has bottomed out. 320 chars still shows a whole notes line; 60 is the
  // last resort on a run large enough that nothing else would fit.
  static get EVENT_JSON_STRING_CAPS() {
    return [1200, 480, 240, 120, 60];
  }

  // Depth-first copy with every long string shortened to `maxChars` and a
  // marker appended naming the true length and where the full value lives.
  // Never mutates the input — the calendar writer reads these same objects.
  truncateLongStringsForBudget(value, maxChars, record, runFile) {
    if (typeof value === "string") {
      if (value.length <= maxChars) return value;
      return `${value.substring(0, maxChars)}... [truncated ${
        value.length - maxChars
      } of ${value.length} chars to fit the results page — full value in ${
        runFile || "the saved run JSON"
      }]`;
    }
    if (Array.isArray(value)) {
      return value.map((item) =>
        this.truncateLongStringsForBudget(item, maxChars, record, runFile),
      );
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value)) {
        const child = value[key];
        if (typeof child === "string" && child.length > maxChars) {
          record.push(key);
        }
        out[key] = this.truncateLongStringsForBudget(
          child,
          maxChars,
          record,
          runFile,
        );
      }
      return out;
    }
    return value;
  }

  // Per-card payload budget for a run of `eventCount` cards.
  computeEventJsonBudgetBytes(eventCount) {
    const cards = Number.isFinite(eventCount) && eventCount > 0 ? eventCount : 1;
    const share = Math.floor(
      ScriptableAdapter.EVENT_JSON_TOTAL_BUDGET_BYTES / cards,
    );
    return Math.min(share, ScriptableAdapter.EVENT_JSON_MAX_PER_CARD_BYTES);
  }

  // Serialize one card's payload within the active budget.
  // Returns { json, capped, dropped[], bytes, budget, runFile }.
  buildBudgetedEventJson(event, runInfo = {}) {
    const budget = Number.isFinite(this._eventJsonBudgetBytes)
      ? this._eventJsonBudgetBytes
      : ScriptableAdapter.EVENT_JSON_MAX_PER_CARD_BYTES;
    const runFile = runInfo && runInfo.runId ? `data/runs/${runInfo.runId}.json` : "";

    let working = event;
    const dropped = [];
    let json = this.buildEmbeddedEventJson(working, {
      includeOriginal: true,
      pretty: false,
    });

    for (const key of ScriptableAdapter.EVENT_JSON_PRUNE_ORDER) {
      if (json.length <= budget) break;
      if (!working || typeof working !== "object" || !(key in working)) continue;
      // Shallow clone so the analyzed event itself is never mutated — the
      // calendar writer reads these same keys after the HTML is built.
      working = { ...working };
      delete working[key];
      dropped.push(key);
      json = this.buildEmbeddedEventJson(working, {
        includeOriginal: true,
        pretty: false,
      });
    }

    // Dropping whole keys bottoms out at the event's own content (title,
    // notes, description). Past that the only way to stay inside the budget
    // is to shorten the long VALUES — with a marker that says how much was
    // cut and where the whole thing still is, so a truncated payload can
    // never be misread as a complete one.
    const truncatedFields = [];
    if (json.length > budget) {
      for (const cap of ScriptableAdapter.EVENT_JSON_STRING_CAPS) {
        truncatedFields.length = 0;
        const shortened = this.truncateLongStringsForBudget(
          working,
          cap,
          truncatedFields,
          runFile,
        );
        json = this.buildEmbeddedEventJson(shortened, {
          includeOriginal: true,
          pretty: false,
        });
        if (json.length <= budget) {
          working = shortened;
          break;
        }
        working = shortened;
      }
    }

    if (!dropped.length && !truncatedFields.length) {
      return { json, capped: false, dropped, bytes: json.length, budget, runFile };
    }

    // Stamp the provenance of the trim INTO the payload, so a copied JSON
    // can never be mistaken for the complete object.
    working = {
      ...working,
      _trimmed: {
        reason: "results-html-budget",
        droppedKeys: dropped,
        truncatedFields: truncatedFields.slice(0, 20),
        note: "Dropped keys are rendered field-by-field in this card's Merge Comparison table.",
        fullEventAt: runFile || "the saved run JSON",
      },
    };
    json = this.buildEmbeddedEventJson(working, {
      includeOriginal: true,
      pretty: false,
    });

    const title = (event && (event.title || event.name)) || "(untitled)";
    const uniqueTruncated = [...new Set(truncatedFields)];
    if (Array.isArray(this._eventJsonBudgetReport)) {
      this._eventJsonBudgetReport.push({
        title,
        dropped,
        truncated: uniqueTruncated,
        bytes: json.length,
        budget,
      });
    }
    return {
      json,
      capped: true,
      dropped,
      truncated: uniqueTruncated,
      bytes: json.length,
      budget,
      runFile,
    };
  }

  // Per-card allowance for the merge diff renderings, drawn from a shared
  // document-wide pool. A card that spends less leaves the rest for later
  // cards, but no card may draw more than its equal share — so the total is
  // <= MERGE_DIFF_TOTAL_BUDGET_BYTES no matter how many events a run has.
  claimMergeDiffBudget(kind, html, event, { asTableRow = false } = {}) {
    const text = typeof html === "string" ? html : "";
    if (!text) return text;
    if (!Number.isFinite(this._mergeDiffRemainingBytes)) return text;

    const share = Number.isFinite(this._mergeDiffPerCardBytes)
      ? this._mergeDiffPerCardBytes
      : ScriptableAdapter.MERGE_DIFF_MAX_PER_CARD_BYTES;
    const allowance = Math.min(share, this._mergeDiffRemainingBytes);

    if (text.length <= allowance) {
      this._mergeDiffRemainingBytes -= text.length;
      return text;
    }

    const title = (event && (event.title || event.name)) || "(untitled)";
    if (Array.isArray(this._mergeDiffBudgetReport)) {
      this._mergeDiffBudgetReport.push({ title, kind, bytes: text.length, allowance });
    }
    const notice = `✂️ This card's ${this.escapeHtml(kind)} was too large to render inline (${Math.round(
      text.length / 1024,
    )} KB) and was deferred to keep the page renderable. The same before/after values are in this card's 📋 Copy JSON and in the saved run JSON.`;
    // A <table> child has to stay a row or the WebView drops it entirely.
    return asTableRow
      ? `<tr><td colspan="5" class="payload-cap-note">${notice}</td></tr>`
      : `<div class="payload-cap-note">${notice}</div>`;
  }

  // One line per run naming exactly which cards were trimmed and why. A cap
  // nobody can see reads as "everything is here" when it is not.
  logMergeDiffBudgetReport() {
    const report = Array.isArray(this._mergeDiffBudgetReport)
      ? this._mergeDiffBudgetReport
      : [];
    if (!report.length) return;
    const detail = report
      .slice(0, 12)
      .map((entry) => `"${entry.title}" (${entry.kind}, ${Math.round(entry.bytes / 1024)} KB)`)
      .join(", ");
    const more = report.length > 12 ? `, +${report.length - 12} more` : "";
    console.log(
      `📱 Scriptable: Merge diff rendering deferred on ${report.length} card section(s) to stay inside the ${Math.round(
        ScriptableAdapter.MERGE_DIFF_TOTAL_BUDGET_BYTES / 1024,
      )} KB page diff budget — the same values remain in each card's Copy JSON and the saved run JSON: ${detail}${more}`,
    );
  }

  // Last line of defence: the page can still be large for reasons no budget
  // here controls (one fixed card per event). It must never be large
  // SILENTLY, because a white-screened review looks exactly like an approved
  // one from the log.
  logResultsHtmlSizeGuard(html, eventCount) {
    const bytes = ScriptableAdapter.utf8ByteLength(html);
    if (bytes <= ScriptableAdapter.RESULTS_HTML_WARN_BYTES) return;
    console.log(
      `📱 Scriptable: ⚠️ Results HTML is ${Math.round(bytes / 1024)} KB for ${eventCount} event(s) — above the ${Math.round(
        ScriptableAdapter.RESULTS_HTML_WARN_BYTES / 1024,
      )} KB size that has actually rendered on device. If the results screen comes up blank, that is why: re-run with fewer parsers, or review from the saved run JSON.`,
    );
  }

  // The log line above is invisible to someone staring at a WebView, which is
  // exactly the situation the guard exists to describe. So the same warning
  // also goes ON the page, at the very top, where it is the first thing that
  // renders — and if the page never renders, its absence and the missing
  // liveness beacons say the same thing from two directions.
  applyResultsHtmlSizeGuard(html, eventCount) {
    const page = typeof html === "string" ? html : "";
    this.logResultsHtmlSizeGuard(page, eventCount);
    const bytes = ScriptableAdapter.utf8ByteLength(page);
    if (bytes <= ScriptableAdapter.RESULTS_HTML_WARN_BYTES) return page;
    const banner = `
    <div class="results-size-warning">⚠️ This page is ${Math.round(bytes / 1024)} KB for ${eventCount} event(s), above the ${Math.round(
      ScriptableAdapter.RESULTS_HTML_WARN_BYTES / 1024,
    )} KB that has reliably rendered on device. If it looks blank or stops scrolling, that is why — re-run with fewer parsers, or review the saved run JSON.</div>`;
    const bodyIndex = page.indexOf("<body>");
    if (bodyIndex === -1) return page;
    const insertAt = bodyIndex + "<body>".length;
    return page.slice(0, insertAt) + banner + page.slice(insertAt);
  }

  logEventJsonBudgetReport() {
    const report = Array.isArray(this._eventJsonBudgetReport)
      ? this._eventJsonBudgetReport
      : [];
    if (!report.length) return;
    const detail = report
      .slice(0, 12)
      .map((entry) => {
        const parts = [];
        if (entry.dropped.length) parts.push(`-${entry.dropped.join("/")}`);
        if (entry.truncated && entry.truncated.length) {
          parts.push(`shortened ${entry.truncated.slice(0, 4).join("/")}`);
        }
        return `"${entry.title}" (${parts.join("; ")})`;
      })
      .join(", ");
    const more = report.length > 12 ? `, +${report.length - 12} more` : "";
    console.log(
      `📱 Scriptable: Debug JSON trimmed on ${report.length} card(s) to stay inside the ${Math.round(
        ScriptableAdapter.EVENT_JSON_TOTAL_BUDGET_BYTES / 1024,
      )} KB page payload budget — every trimmed key is still rendered in that card's Merge Comparison table: ${detail}${more}`,
    );
  }

  // Helper to escape HTML
  escapeHtml(text) {
    if (!text) return "";
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.toString().replace(/[&<>"']/g, (m) => map[m]);
  }

  // Fallback to UITable if WebView fails
  async presentUITableFallback(results) {
    try {
      const table = new UITable();
      table.showSeparators = true;

      // Header row
      const headerRow = new UITableRow();
      headerRow.isHeader = true;
      headerRow.height = 50;

      const headerCell = headerRow.addText("🐻 Bear Event Scraper Results");
      headerCell.titleFont = Font.boldSystemFont(18);
      headerCell.titleColor = Color.white();
      headerCell.backgroundColor = Color.brown();

      table.addRow(headerRow);

      // Summary section
      const summaryRow = new UITableRow();
      summaryRow.height = 80;

      const runContextLabel = this.formatRunContext(
        results.runContext || this.resolveRunContext(results),
      );
      const deduplicationInfo =
        results.duplicatesRemoved > 0
          ? `\n🔄 Duplicates removed: ${results.duplicatesRemoved}`
          : "";
      const summaryText = `Run Type: ${runContextLabel}
📊 Total Events: ${results.totalEvents}${deduplicationInfo}
🐻 Bear Events: ${results.bearEvents}
📅 Added to Calendar: ${results.calendarEvents}
${results.errors.length > 0 ? `❌ Errors: ${results.errors.length}` : "✅ No errors"}`;

      const summaryCell = summaryRow.addText(summaryText);
      summaryCell.titleFont = Font.systemFont(14);
      summaryCell.subtitleColor = Color.gray();

      table.addRow(summaryRow);

      // Parser results section
      if (results.parserResults && results.parserResults.length > 0) {
        const parserHeaderRow = new UITableRow();
        parserHeaderRow.height = 40;

        const parserHeaderCell = parserHeaderRow.addText("📋 Parser Results");
        parserHeaderCell.titleFont = Font.boldSystemFont(16);
        parserHeaderCell.titleColor = Color.blue();

        table.addRow(parserHeaderRow);

        results.parserResults.forEach((result) => {
          const parserRow = new UITableRow();
          parserRow.height = 50;

          const parserCell = parserRow.addText(`${result.name}`);
          parserCell.titleFont = Font.systemFont(14);
          parserCell.subtitleText = `${result.bearEvents} bear events found`;
          parserCell.subtitleColor = Color.gray();

          table.addRow(parserRow);
        });
      }

      // Events section
      const allEvents = this.getAllEventsFromResults(results);
      if (allEvents && allEvents.length > 0) {
        const eventsHeaderRow = new UITableRow();
        eventsHeaderRow.height = 40;

        const eventsHeaderCell = eventsHeaderRow.addText("🎉 Found Events");
        eventsHeaderCell.titleFont = Font.boldSystemFont(16);
        eventsHeaderCell.titleColor = Color.green();

        table.addRow(eventsHeaderRow);

        allEvents.slice(0, 10).forEach((event, i) => {
          // Show first 10 events
          const eventRow = new UITableRow();
          eventRow.height = 60;

          const eventCell = eventRow.addText(
            event.title || event.name || `Event ${i + 1}`,
          );
          eventCell.titleFont = Font.systemFont(14);

          const subtitle = [];
          if (event.venue || event.bar) {
            subtitle.push(`📍 ${event.venue || event.bar}`);
          }
          if (event.day || event.time) {
            subtitle.push(`📅 ${event.day || ""} ${event.time || ""}`.trim());
          }
          const calendarName = this.getCalendarNameForDisplay(event);
          if (calendarName) {
            subtitle.push(`📱 ${calendarName}`);
          }

          eventCell.subtitleText = subtitle.join(" • ") || "Event details";
          eventCell.subtitleColor = Color.gray();

          table.addRow(eventRow);
        });

        if (allEvents.length > 10) {
          const moreRow = new UITableRow();
          moreRow.height = 40;

          const moreCell = moreRow.addText(
            `... and ${allEvents.length - 10} more events`,
          );
          moreCell.titleFont = Font.italicSystemFont(12);
          moreCell.titleColor = Color.gray();

          table.addRow(moreRow);
        }
      }

      // Errors section
      if (results.errors && results.errors.length > 0) {
        const errorsHeaderRow = new UITableRow();
        errorsHeaderRow.height = 40;

        const errorsHeaderCell = errorsHeaderRow.addText("❌ Errors");
        errorsHeaderCell.titleFont = Font.boldSystemFont(16);
        errorsHeaderCell.titleColor = Color.red();

        table.addRow(errorsHeaderRow);

        results.errors.slice(0, 5).forEach((error) => {
          // Show first 5 errors
          const errorRow = new UITableRow();
          errorRow.height = 50;

          const errorCell = errorRow.addText(error);
          errorCell.titleFont = Font.systemFont(12);
          errorCell.titleColor = Color.red();

          table.addRow(errorRow);
        });
      }

      // Actions section
      const actionsRow = new UITableRow();
      actionsRow.height = 80;

      const actionsText = `🎯 Next Steps:
• Review calendar conflicts above
• Check calendar permissions
• Set dryRun: false to add events
• Verify timezone settings`;

      const actionsCell = actionsRow.addText(actionsText);
      actionsCell.titleFont = Font.systemFont(12);
      actionsCell.titleColor = Color.blue();

      table.addRow(actionsRow);

      await table.present(false); // Present in normal mode (not fullscreen)
    } catch (error) {
      console.log(
        `📱 Scriptable: ✗ Failed to present UITable: ${error.message}`,
      );
      throw error;
    }
  }

  // ── Parser picker (run-start parser selection UI) ─────────────────────────
  // Staleness helpers ported from scripts/stale-parsers.js (not imported —
  // that script self-executes on load). Kept pure so they test headlessly.

  parseMetricsNdjsonForPicker(text) {
    const lines = String(text || "")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    if (lines.length === 0) return [];

    const records = [];
    lines.forEach((line) => {
      try {
        const record = JSON.parse(line);
        if (record) records.push(record);
      } catch (_) {
        // skip malformed lines
      }
    });

    records.sort((a, b) => {
      const aTime = a?.finished_at ? new Date(a.finished_at).getTime() : 0;
      const bTime = b?.finished_at ? new Date(b.finished_at).getTime() : 0;
      return aTime - bTime;
    });

    return records;
  }

  getLastCalendarWriteAtForPicker(records, parserName) {
    for (let i = records.length - 1; i >= 0; i -= 1) {
      const record = records[i];
      const parserRecords = Array.isArray(record?.parsers) ? record.parsers : [];
      const match = parserRecords.find((pr) => pr?.parser_name === parserName);
      if (!match) continue;
      const ca = match.calendar_actions || {};
      if ((ca.create || 0) > 0 || (ca.update || 0) > 0) {
        return record.finished_at || null;
      }
    }
    return null;
  }

  formatDaysSinceForPicker(daysSince) {
    if (daysSince === null || daysSince === undefined) return "never";
    const d = Math.floor(daysSince);
    if (d <= 0) return "today";
    if (d === 1) return "1d ago";
    return `${d}d ago`;
  }

  async readMetricsRecordsForPicker() {
    try {
      const fm = this.fm || FileManager.iCloud();
      const path = this.getMetricsFilePath();
      if (!fm.fileExists(path)) return [];
      try {
        await fm.downloadFileFromiCloud(path);
      } catch (_) {
        // fall through to reading whatever local copy exists
      }
      return this.parseMetricsNdjsonForPicker(fm.readString(path) || "");
    } catch (_) {
      return [];
    }
  }

  // Manual runs only: knob must be explicitly on, and no automation/widget/
  // action-extension context (mirrors the runtime checks in shouldSkipResultsUi).
  shouldPresentParserPicker(config) {
    return (
      config?.config?.pickParsers === true &&
      !config?.runtime?.automationRun &&
      !config?.runtime?.runsInWidget &&
      !config?.runtime?.runsInActionExtension
    );
  }

  // Spread copies only — never mutates the importModule'd parser objects.
  // Unknown names in the set are ignored naturally (no parser matches them).
  // The `enabled` flags written here are SESSION-SCOPED: parser entries in
  // scraper-input.js carry no static enabled flags anymore — the picker owns
  // manual run selection, and shared-core's manual enabled filter acts only
  // on these per-session values.
  applyParserPickerSelection(parsers, pickedSet) {
    return parsers.map((p) => ({ ...p, enabled: pickedSet.has(p.name) }));
  }

  // The picker OWNS manual run selection. A confirmed selection runs exactly
  // those parsers; null (swipe-down dismissal or a picker error) CANCELS the
  // run by disabling every parser for the session — with no static enabled
  // flags left in config, "run as configured" would mean run-ALL by accident.
  applyParserPickerOutcome(parsers, picked, total = parsers.length) {
    if (picked) {
      console.log(
        `📱 Scriptable: Parser picker: running ${picked.size} of ${total} parsers`,
      );
      return this.applyParserPickerSelection(parsers, picked);
    }
    console.log(
      "📱 Scriptable: Parser picker dismissed — run cancelled (no parsers selected)",
    );
    return this.applyParserPickerSelection(parsers, new Set());
  }

  // ── Picker-state persistence (feeds the "Rerun last" row, NOT a default) ──

  getPickerStatePath() {
    return this.fm.joinPath(this.baseDir, "picker-state.json");
  }

  // Pure: parse a persisted picker-state payload ({ selected: [names] }) and
  // return the selected names filtered to currently-known parser names.
  // Missing/corrupt/misshapen input → [] (nothing pre-selected).
  parsePickerState(text, knownNames) {
    try {
      const parsed = JSON.parse(String(text));
      const selected = Array.isArray(parsed?.selected) ? parsed.selected : null;
      if (!selected) return [];
      const known = new Set(knownNames || []);
      return selected.filter(
        (name) => typeof name === "string" && known.has(name),
      );
    } catch (_) {
      return [];
    }
  }

  async loadPickerState(knownNames) {
    try {
      const fm = this.fm || FileManager.iCloud();
      const path = this.getPickerStatePath();
      if (!fm.fileExists(path)) return [];
      try {
        await fm.downloadFileFromiCloud(path);
      } catch (_) {
        // fall through to reading whatever local copy exists
      }
      return this.parsePickerState(fm.readString(path) || "", knownNames);
    } catch (_) {
      return [];
    }
  }

  // Persist a confirmed selection (Run selected / Run all). Best-effort:
  // failure only costs the next run's pre-selection.
  async savePickerState(names) {
    try {
      const list = Array.from(names || []);
      // Never persist an empty selection: writing [] would erase the
      // remembered set behind "Rerun last". Confirmed selections are always
      // non-empty; anything else keeps the previous state on disk.
      if (list.length === 0) return false;
      const fm = this.fm || FileManager.iCloud();
      if (!fm.fileExists(this.baseDir)) {
        fm.createDirectory(this.baseDir, true);
      }
      const payload = {
        selected: list,
        savedAt: new Date().toISOString(),
      };
      fm.writeString(
        this.getPickerStatePath(),
        JSON.stringify(payload, null, 2),
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  // One-line preview of what "Rerun last" would run ("" when nothing is
  // remembered). Long lists are truncated so the row subtitle stays readable.
  formatRerunLastSubtitle(names) {
    const list = Array.isArray(names) ? names.filter(Boolean) : [];
    if (list.length === 0) return "";
    const shown = list.slice(0, 3).join(", ");
    return list.length > 3
      ? `${shown} +${list.length - 3} more`
      : shown;
  }

  // Stalest-first ordering (ports computeStaleStatus's sort semantics from
  // stale-parsers.js): never-written → Infinity → top, then descending
  // days-since-last-write, name as tiebreak.
  buildParserPickerEntries(parsers, records, now = Date.now()) {
    const entries = parsers.map((parser) => {
      const lastWriteAt = this.getLastCalendarWriteAtForPicker(
        records,
        parser.name,
      );
      let daysSince = null;
      if (lastWriteAt) {
        const writeTime = new Date(lastWriteAt).getTime();
        if (Number.isFinite(writeTime) && writeTime > 0) {
          daysSince = (now - writeTime) / (24 * 60 * 60 * 1000);
        }
      }
      return {
        name: parser.name,
        daysSince,
        lastWriteAt,
      };
    });

    entries.sort((a, b) => {
      const aDays =
        a.daysSince === null ? Number.POSITIVE_INFINITY : a.daysSince;
      const bDays =
        b.daysSince === null ? Number.POSITIVE_INFINITY : b.daysSince;
      if (bDays !== aDays) return bDays - aDays;
      return String(a.name).localeCompare(String(b.name));
    });

    return entries;
  }

  // Presents a UITable listing all configured parsers (stalest-first) with
  // checkmark toggles, ALL unchecked (the previous run's set is offered as an
  // explicit "Rerun last" action row instead of being pre-ticked).
  // Resolves with a Set of picked parser names, or null on
  // swipe-down dismissal / any error — the caller treats null as CANCEL (no
  // parsers run), never as run-as-configured.
  async presentParserPicker(config) {
    try {
      const parsers = Array.isArray(config?.parsers) ? config.parsers : [];
      if (parsers.length === 0) return null;

      const records = await this.readMetricsRecordsForPicker();
      const entries = this.buildParserPickerEntries(parsers, records);

      // NOTHING is pre-selected: a fresh picker always starts empty, so the
      // common "run one different parser" case is one tap on that parser plus
      // one on Run selected — no un-checking of last run's leftovers first.
      // The previous run's confirmed selection is still remembered (written by
      // savePickerState below) and offered as an explicit "Rerun last" row.
      const lastSelection = await this.loadPickerState(
        entries.map((entry) => entry.name),
      );
      const selected = new Set();

      let resolved = false;
      let resolveSelection;
      const selectionPromise = new Promise((resolve) => {
        resolveSelection = resolve;
      });
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        resolveSelection(value);
      };

      const table = new UITable();
      table.showSeparators = true;

      const rebuild = () => {
        table.removeAllRows();

        // Header row
        const headerRow = new UITableRow();
        headerRow.isHeader = true;
        headerRow.height = 50;

        const headerCell = headerRow.addText("🐻 Pick Parsers");
        headerCell.titleFont = Font.boldSystemFont(18);
        headerCell.titleColor = Color.white();
        headerCell.backgroundColor = Color.brown();

        table.addRow(headerRow);

        // Action rows (default dismissOnSelect: tapping dismisses the table)

        // "Rerun last" replaces the old sticky pre-selection: the remembered
        // set is one tap away instead of being forced on every run. Hidden on
        // the first run (nothing remembered yet).
        if (lastSelection.length > 0) {
          const rerunRow = new UITableRow();
          rerunRow.height = 50;
          const rerunCell = rerunRow.addText(
            `↻ Rerun last (${lastSelection.length})`,
          );
          rerunCell.titleFont = Font.boldSystemFont(16);
          rerunCell.titleColor = Color.blue();
          rerunCell.subtitleText = this.formatRerunLastSubtitle(lastSelection);
          rerunCell.subtitleColor = Color.gray();
          rerunRow.onSelect = () => {
            console.log(
              `📱 Scriptable: Parser picker: rerun last selection (${lastSelection.length} parsers)`,
            );
            finish(new Set(lastSelection));
          };
          table.addRow(rerunRow);
        }

        const runSelectedRow = new UITableRow();
        runSelectedRow.height = 50;
        // With nothing checked, "Run selected (0)" is a disabled no-op: it
        // must neither finish nor dismiss. An empty confirm would start a run
        // with every parser disabled AND overwrite the remembered "Rerun
        // last" selection with [] (hiding that row forever). Gray title
        // signals disabled; blue means armed.
        const hasSelection = selected.size > 0;
        runSelectedRow.dismissOnSelect = hasSelection;
        const runSelectedCell = runSelectedRow.addText(
          `▶ Run selected (${selected.size})`,
        );
        runSelectedCell.titleFont = Font.boldSystemFont(16);
        runSelectedCell.titleColor = hasSelection ? Color.blue() : Color.gray();
        runSelectedRow.onSelect = () => {
          if (selected.size === 0) return;
          finish(new Set(selected));
        };
        table.addRow(runSelectedRow);

        const runAllRow = new UITableRow();
        runAllRow.height = 50;
        const runAllCell = runAllRow.addText(`▶ Run all (${entries.length})`);
        runAllCell.titleFont = Font.boldSystemFont(16);
        runAllCell.titleColor = Color.blue();
        runAllRow.onSelect = () => {
          finish(new Set(entries.map((entry) => entry.name)));
        };
        table.addRow(runAllRow);

        // One row per parser, stalest-first
        entries.forEach((entry) => {
          const row = new UITableRow();
          row.height = 50;
          row.dismissOnSelect = false;

          const isPicked = selected.has(entry.name);
          const cell = row.addText(
            `${isPicked ? "☑" : "☐"} ${entry.name}`,
          );
          cell.titleFont = Font.systemFont(14);
          cell.subtitleText = `${this.formatDaysSinceForPicker(entry.daysSince)} (last write)`;
          cell.subtitleColor = Color.gray();

          row.onSelect = () => {
            if (selected.has(entry.name)) {
              selected.delete(entry.name);
            } else {
              selected.add(entry.name);
            }
            rebuild();
            table.reload();
          };

          table.addRow(row);
        });
      };

      rebuild();

      // present() resolves when the table is dismissed — by an action row
      // (finish already ran; this finish(null) is a no-op) or by swipe-down
      // (no selection was made → resolve null).
      table.present(false).then(
        () => finish(null),
        () => finish(null),
      );

      const picked = await selectionPromise;
      // Persist confirmed selections only (Rerun last / Run selected / Run
      // all) — the next run's picker offers them behind "Rerun last", never
      // as a pre-selection. Dismissal keeps the previous state, and an empty
      // set must never reach savePickerState (it would wipe "Rerun last").
      if (picked && picked.size > 0) {
        await this.savePickerState(Array.from(picked));
      }
      return picked;
    } catch (error) {
      console.log(
        `📱 Scriptable: ✗ Parser picker failed: ${error.message}`,
      );
      return null;
    }
  }

  // Helper method to create a text summary for QuickLook
  createResultsSummary(results) {
    const lines = [];
    const runContextLabel = this.formatRunContext(
      results.runContext || this.resolveRunContext(results),
    );
    lines.push("🐻 BEAR EVENT SCRAPER RESULTS");
    lines.push("=".repeat(40));
    lines.push("");
    lines.push(`Run Type: ${runContextLabel}`);
    lines.push("");
    lines.push(
      `📊 Total Events Found: ${results.totalEvents} (all events from all sources)`,
    );
    lines.push(
      `🐻 Raw Bear Events: ${results.rawBearEvents || "N/A"} (after bear filtering)`,
    );
    if (results.duplicatesRemoved > 0) {
      lines.push(`🔄 Duplicates Removed: ${results.duplicatesRemoved}`);
      lines.push(
        `🐻 Final Bear Events: ${results.bearEvents} (${results.rawBearEvents} - ${results.duplicatesRemoved} dupes)`,
      );
    } else {
      lines.push(
        `🐻 Final Bear Events: ${results.bearEvents} (no duplicates found)`,
      );
    }
    lines.push(
      `📅 Added to Calendar: ${results.calendarEvents}${results.calendarEvents === 0 ? " (dry run/preview mode - no events written)" : ""}`,
    );

    if (results.errors && results.errors.length > 0) {
      lines.push(`❌ Errors: ${results.errors.length}`);
    }

    lines.push("");
    lines.push("📋 Parser Results:");
    if (results.parserResults) {
      results.parserResults.forEach((result) => {
        lines.push(`  • ${result.name}: ${result.bearEvents} bear events`);
      });
    }

    if (results.discoveredVenueSummary) {
      lines.push("");
      lines.push(results.discoveredVenueSummary);
    }

    if (results.foreignOrgCrawlSummary) {
      lines.push("");
      lines.push(results.foreignOrgCrawlSummary);
    }

    const allEvents = this.getAllEventsFromResults(results);
    if (allEvents && allEvents.length > 0) {
      lines.push("");
      lines.push("🎉 Found Events:");
      allEvents.slice(0, 5).forEach((event, i) => {
        const title = event.title || event.name || `Event ${i + 1}`;
        const venue = event.venue || event.bar || "";
        const calendarName = this.getCalendarNameForDisplay(event);
        lines.push(`  • ${title}`);
        if (venue) lines.push(`    📍 ${venue}`);
        if (calendarName) lines.push(`    📱 ${calendarName}`);
      });

      if (allEvents.length > 5) {
        lines.push(`  ... and ${allEvents.length - 5} more events`);
      }
    }

    if (results.errors && results.errors.length > 0) {
      lines.push("");
      lines.push("❌ Errors:");
      results.errors.slice(0, 3).forEach((error) => {
        lines.push(`  • ${error}`);
      });
    }

    lines.push("");
    lines.push("🎯 Next Steps:");
    lines.push("  • Review calendar conflicts");
    lines.push("  • Check calendar permissions");
    lines.push("  • Set dryRun: false to add events");

    return lines.join("\n");
  }

  // Helper method to extract all events from parser results
  getAllEventsFromResults(results) {
    // Events must be analyzed to have action types - no fallback to raw parser results
    if (
      !results ||
      !results.analyzedEvents ||
      !Array.isArray(results.analyzedEvents)
    ) {
      throw new Error(
        "No analyzed events available - event analysis must succeed for the system to function",
      );
    }

    let events = results.analyzedEvents;

    // If this is from a saved run, convert date strings to Date objects
    if (results && results._isDisplayingSavedRun && events.length > 0) {
      events = events.map((event) => {
        const convertedEvent = { ...event };
        if (typeof convertedEvent.startDate === "string") {
          convertedEvent.startDate = new Date(convertedEvent.startDate);
        }
        if (typeof convertedEvent.endDate === "string") {
          convertedEvent.endDate = new Date(convertedEvent.endDate);
        }
        return convertedEvent;
      });
    }

    return events;
  }

  // Helper method to determine if time conflicts should be merged.
  // Delegates to SharedCore's same-event identity detection so this report always
  // agrees with the merge decision made in analyzeEventAction.
  shouldMergeTimeConflict(existingEvent, newEvent) {
    const core = this.getIdentityCore();
    if (!core) {
      console.log(
        "📱 Scriptable: Merge eligibility unavailable (identity core failed to initialize)",
      );
      return false;
    }
    const signal = core.getSameEventIdentitySignal(newEvent, existingEvent);
    const existingLabel = existingEvent.title || existingEvent.name || "";
    const newLabel = newEvent.title || newEvent.name || "";
    console.log(
      `📱 Scriptable: Merge eligibility ${signal ? `match (${signal})` : "no match"} — "${existingLabel}" vs "${newLabel}"`,
    );
    return Boolean(signal);
  }

  // Lazily build a SharedCore instance for identity checks
  getIdentityCore() {
    if (this._identityCore === undefined) {
      try {
        this._identityCore = new SharedCore(this.cities || {}, {
          eventSchema: SharedEventSchema,
        });
      } catch (error) {
        console.warn(
          `📱 Scriptable: Could not initialize identity core: ${error}`,
        );
        this._identityCore = null;
      }
    }
    return this._identityCore;
  }

  // Helper method to calculate title similarity
  calculateTitleSimilarity(title1, title2) {
    // Simple Jaccard similarity based on words
    const words1 = new Set(title1.split(/\s+/));
    const words2 = new Set(title2.split(/\s+/));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  // Helper to get calendar name for display purposes only
  getCalendarNameForDisplay(event) {
    const city = event.city || "default";
    return this.getCalendarName(city);
  }

  // Check if event has actual differences to show
  hasEventDifferences(event) {
    if (!event._original) return false;

    // Get all fields used for comparison display (includes core fields beyond notes)
    const fieldsToCheck = this.getFieldsForComparison(event);

    for (const field of fieldsToCheck) {
      // Skip notes field as it's a computed field that combines other fields
      if (field === "notes") continue;

      let newValue = event._original.scraper[field] || "";
      let existingValue = event._original.calendar?.[field] || "";

      // Skip empty fields
      if (!newValue && !existingValue) continue;

      const isDateField = field.toLowerCase().includes("date");

      // Check for differences (date-aware to avoid timezone noise)
      if (isDateField) {
        if (!this.datesEqualForDisplay(existingValue, newValue)) {
          return true;
        }
      } else if (newValue !== existingValue) {
        return true;
      }
    }

    return false;
  }

  // Get all fields that should be compared/displayed - check ALL fields except underscore fields and functions
  getFieldsForComparison(event) {
    // Get all fields from both new and existing events
    const allFields = new Set();

    // Exclude only internal/Scriptable/search helper fields from comparison.
    // Keep core calendar fields (title/startDate/endDate/location) and coordinates
    // even though they are not stored in notes.
    const excludeFields = new Set([
      "notes",
      "isBearEvent",
      "source",
      "city",
      "setDescription",
      "_analysis",
      "_action",
      "_existingEvent",
      "_existingKey",
      "_conflicts",
      "_parserConfig",
      "_fieldPriorities",
      "_original",
      "_mergeInfo",
      "_changes",
      "_mergeDiff",
      "originalTitle",
      "name", // These are usually duplicates of title
      // Scriptable-specific properties that shouldn't be in comparison
      "identifier",
      "availability",
      "timeZone",
      "calendar",
      "addRecurrenceRule",
      "removeAllRecurrenceRules",
      "save",
      "remove",
      "presentEdit",
      "_staticFields",
      // Recurrence metadata used for matching, not for notes storage
      "recurrenceId",
      "recurrenceIdTimezone",
      "sequence",
      // Search helper fields used only for identifier matching
      "searchStartDate",
      "searchEndDate",
      // Location-specific fields that are internal to geocoding
      "placeId",
      // Coordinate helpers that should not show in comparisons
      "lat",
      "lng",
    ]);

    // Helper function to check if a field should be included
    const shouldIncludeField = (obj, field) => {
      if (field.startsWith("_")) return false;
      if (typeof obj[field] === "function") return false;
      if (excludeFields.has(field)) return false;
      return true;
    };

    // Add fields from scraper event
    if (event._original?.scraper) {
      Object.keys(event._original.scraper).forEach((field) => {
        if (shouldIncludeField(event._original.scraper, field)) {
          allFields.add(field);
        }
      });
    }

    // Add fields from calendar event
    if (event._original?.calendar) {
      Object.keys(event._original.calendar).forEach((field) => {
        if (shouldIncludeField(event._original.calendar, field)) {
          allFields.add(field);
        }
      });
    }

    // Add fields from merged event
    if (event._original?.merged) {
      Object.keys(event._original.merged).forEach((field) => {
        if (shouldIncludeField(event._original.merged, field)) {
          allFields.add(field);
        }
      });
    }

    // Add fields from final event
    Object.keys(event).forEach((field) => {
      if (shouldIncludeField(event, field)) {
        allFields.add(field);
      }
    });

    // Convert to array and sort with logical grouping
    const fieldArray = Array.from(allFields);

    // Define field priority order - group related fields together
    // Prefer canonical keys
    const fieldPriority = {
      // Core event info - keep name fields together
      title: 1,
      shortName: 2,

      description: 5,
      tea: 6, // alias for description (kept if description missing)
      info: 7, // alias for description (kept if description missing)

      // Date/Time fields - keep start/end times together
      startDate: 10,
      endDate: 11,
      date: 12,
      day: 13,
      time: 14,
      startTime: 15,
      endTime: 16,

      // Location fields
      venue: 20,
      bar: 20, // alias for venue
      location: 20, // alias for venue
      host: 20, // alias for venue
      address: 21,
      coordinates: 22,
      lat: 23,
      lng: 24,
      // Note: city is now excluded as it shouldn't be saved to calendar

      // Contact/Social fields
      website: 30,
      url: 38, // native iOS calendar URL field (same concept as website)
      facebook: 31,
      instagram: 32,
      twitter: 33,
      phone: 34,
      email: 35,
      googleMapsLink: 36, // canonical Google Maps
      gmaps: 36, // alias fallback
      ticketUrl: 37, // ticket purchase links

      // Event details
      price: 40,
      cover: 40, // alias for price
      cost: 40, // alias for price
      category: 41,
      type: 42,
      eventtype: 42, // alias for type
      tags: 43,

      // Calendar specific - move notes to end since it's computed
      calendar: 50,
      calendarId: 51,
      identifier: 52,

      // Debug fields
      debugcity: 60,
      debugsource: 61,
      debugtimezone: 62,
      debugimage: 63,

      // Computed fields should be last - notes is combination of other fields
      notes: 99,

      // Other fields get default priority
    };

    return fieldArray.sort((a, b) => {
      const priorityA = fieldPriority[a] || 100;
      const priorityB = fieldPriority[b] || 100;

      // If same priority, sort alphabetically
      if (priorityA === priorityB) {
        return a.localeCompare(b);
      }

      return priorityA - priorityB;
    });
  }

  // Generate comparison rows for conflict display
  generateComparisonRows(event) {
    if (!event._original) return "";

    // Use the same field logic as comparison (includes core fields not in notes)
    const fieldsToCompare = this.getFieldsForComparison(event);
    const rows = [];

    fieldsToCompare.forEach((field) => {
      // Skip notes field as it's a computed field that combines other fields
      // This makes the comparison confusing and it's often broken
      if (field === "notes") return;

      // Get the actual scraped value - don't default to empty string yet
      let newValue = event._original?.scraper?.[field];
      let existingValue = event._original?.calendar?.[field];
      let finalValue = event[field];

      // Fix: Use _fieldPriorities instead of _fieldMergeStrategies
      const strategy =
        event._fieldPriorities?.[field]?.merge ||
        event._fieldMergeStrategies?.[field] ||
        "preserve";

      // Determine what was used by comparing final value with source values
      let wasUsed = "unknown";
      if (finalValue === newValue && finalValue !== existingValue) {
        wasUsed = "new";
      } else if (finalValue === existingValue && finalValue !== newValue) {
        wasUsed = "existing";
      } else if (finalValue === existingValue && finalValue === newValue) {
        wasUsed = "same";
      }

      // For preserve fields, we want to show BOTH the scraped value AND the existing value
      // This matches the old behavior: "show both and then say 'choosing original because preserve'"

      // Skip if both are empty and no final value, unless it's a field with explicit strategy
      // For preserve/clobber fields, always show them to demonstrate the strategy in action
      if (!newValue && !existingValue && !finalValue && !strategy) return;

      // For preserve fields, always show them if they have a strategy configured
      // This ensures we show "scraped X, existing undefined, choosing undefined because preserve"
      // Don't skip preserve fields even if they appear empty - user needs to see what was preserved
      if (strategy === "preserve") {
        // Always show preserve fields to demonstrate the strategy, even if all values are empty
        // This is important for showing "scraped value X, existing undefined, preserved undefined"
      }

      // Format values for display - show exactly what the merge logic saw.
      // `anchor` is the index of the first character at which the two sides
      // of this row diverge; the visible window is centred there so a long
      // description whose change is at character 900 does not render as two
      // identical-looking 30-character stubs.
      const formatValue = (val, anchor = 0, maxLength = 30) => {
        if (val === null) return '<em style="color: #999;">null</em>';
        if (val === undefined) return '<em style="color: #999;">undefined</em>';
        if (val === "") return '<em style="color: #999;">empty string</em>';
        if (!val) return '<em style="color: #999;">falsy</em>';

        if (field.includes("Date") && val) {
          // For date fields in event debugging, get timezone from city configuration
          if (field === "startDate" || field === "endDate") {
            const timezone = this.getTimezoneForCityOrUtc(event?.city);
            var eventForField = { timeZone: timezone };
          } else {
            var eventForField = {};
          }
          return new Date(val).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            ...eventForField,
          });
        }
        let stringValue = "";
        if (typeof val === "object") {
          try {
            stringValue = JSON.stringify(val);
          } catch (e) {
            stringValue = String(val);
          }
        } else {
          stringValue = val.toString();
        }
        const str = stringValue;
        if (str.length > maxLength) {
          // BOUNDED BY CONSTRUCTION. This used to emit the ENTIRE value into a
          // title="" attribute on both the existing and the new cell, so a
          // single long description cost ~2x its own length per row, per
          // event, forever. Visible text is capped at maxLength and the
          // tooltip at TOOLTIP_MAX_CHARS; the "+N chars" badge is the
          // affordance that says how much is hidden and the complete value is
          // one tap away via this card's 📋 Copy JSON / raw dump.
          const TOOLTIP_MAX_CHARS = 240;
          const start =
            anchor > maxLength ? Math.max(0, anchor - Math.floor(maxLength / 3)) : 0;
          const lead = start > 0 ? "..." : "";
          const visible = str.substring(start, start + maxLength);
          const tooltipSource = str.substring(start);
          const tooltip =
            tooltipSource.length > TOOLTIP_MAX_CHARS
              ? `${tooltipSource.substring(0, TOOLTIP_MAX_CHARS)}... (+${
                  tooltipSource.length - TOOLTIP_MAX_CHARS
                } more chars - use Copy JSON for the full value)`
              : tooltipSource;
          return `<span title="${this.escapeHtml(tooltip)}">${lead}${this.escapeHtml(visible)}...</span><span class="cmp-more"> ${str.length} chars</span>`;
        }
        return this.escapeHtml(str);
      };

      // Index of the first character at which the two sides differ, so a
      // truncated diff always shows the part that actually changed.
      const diffAnchor = (() => {
        const asText = (v) => {
          if (v === null || v === undefined || typeof v === "object") return "";
          return String(v);
        };
        const a = asText(existingValue);
        const b = asText(newValue);
        if (!a || !b) return 0;
        const max = Math.min(a.length, b.length);
        let i = 0;
        while (i < max && a[i] === b[i]) i++;
        return i;
      })();

      // Identity for DISPLAY only. Strict === was reporting startDate/endDate
      // as CLOBBERED on every merge even when nothing changed: those values are
      // Date objects (or a Date on one side and an ISO string on the other),
      // and two Dates naming the same instant are never ===. Mirrors
      // SharedCore.mergeValuesEqualForTracking, which already fixed the same
      // bug for the merge LOG line but was never applied to this table.
      const mergeValuesLookIdentical = (a, b) => {
        if (a === b) return true;
        const toMs = (value) => {
          if (value instanceof Date) return value.getTime();
          if (typeof value === "string") {
            const parsed = Date.parse(value);
            return Number.isNaN(parsed) ? null : parsed;
          }
          return null;
        };
        if (a instanceof Date || b instanceof Date) {
          const aMs = toMs(a);
          const bMs = toMs(b);
          return aMs !== null && aMs === bMs;
        }
        return false;
      };

      // Determine flow direction and result
      let flowIcon = "";
      let resultText = "";

      if (!existingValue && newValue) {
        // New field being added
        flowIcon = "→";
        resultText = '<span style="color: #34c759;">ADDED</span>';
      } else if (existingValue && newValue && mergeValuesLookIdentical(existingValue, newValue)) {
        // Both values are identical - no change needed
        flowIcon = "—";
        resultText = '<span style="color: #999;">SAME VALUE</span>';
      } else if (strategy === "ai") {
        // AI-arbitrated strategy — show which side the AI picked (or that it fell back)
        const arbitration = event._original?.aiArbitration;
        if (arbitration?.fallbacks?.includes(field)) {
          flowIcon = "→";
          resultText = '<span style="color: #ff9500;">AI FALLBACK (CLOBBERED)</span>';
        } else if (arbitration?.arbitrated?.includes(field)) {
          if (finalValue === existingValue && existingValue !== newValue) {
            flowIcon = "←";
            resultText = '<span style="color: #007aff;">🤝 AI CHOSE EXISTING</span>';
          } else {
            flowIcon = "→";
            resultText = '<span style="color: #34c759;">🤝 AI CHOSE NEW</span>';
          }
        } else if (newValue !== undefined && finalValue === newValue) {
          // No genuine conflict → clobber semantics applied
          flowIcon = "→";
          resultText = '<span style="color: #ff9500;">CLOBBERED</span>';
        } else if (!newValue && !finalValue) {
          flowIcon = "→";
          resultText = '<span style="color: #ff9500;">CLEARED</span>';
        } else {
          flowIcon = "—";
          resultText = '<span style="color: #999;">NO CHANGE</span>';
        }
      } else if (strategy === "clobber") {
        // Clobber strategy - should always use new value (even if empty)
        // For clobber, we should trust that the merge logic worked correctly
        // The finalValue should match newValue, but there might be edge cases with processing
        if (newValue !== undefined && finalValue === newValue) {
          flowIcon = "→";
          resultText = '<span style="color: #ff9500;">CLOBBERED</span>';
        } else if (!newValue && !finalValue) {
          // Clobber with empty new value - clears the field
          flowIcon = "→";
          resultText = '<span style="color: #ff9500;">CLEARED</span>';
        } else if (newValue !== undefined) {
          // For clobber, if we have a new value, assume it worked
          // The display might show differences due to processing, but trust the merge logic
          flowIcon = "→";
          resultText = '<span style="color: #ff9500;">CLOBBERED</span>';
        } else {
          // Only show failure if we truly can't determine what happened
          flowIcon = "⚠️";
          resultText = '<span style="color: #ff3b30;">CLOBBER UNCLEAR</span>';
        }
      } else if (strategy === "preserve") {
        // Preserve strategy - ALWAYS keep existing value (even if null/empty)
        // For preserve, if existing is undefined, final should also be undefined
        const preserveWorked =
          (existingValue === undefined && finalValue === undefined) ||
          (existingValue !== undefined && finalValue === existingValue);

        if (preserveWorked) {
          flowIcon = "←";
          if (existingValue !== undefined) {
            resultText =
              '<span style="color: #007aff;">PRESERVED EXISTING</span>';
          } else {
            resultText =
              '<span style="color: #007aff;">PRESERVED UNDEFINED (ignored scraped)</span>';
          }
        } else {
          // Provenance companion fields (pinSource/addressSource/imageSource/
          // barSource/bearSource) legitimately CHANGE under preserve: the
          // stamp follows the finalized value (setProvenanceSource), so when a
          // higher authority vouches for the SAME kept value the attribution
          // upgrades (e.g. pinSource geocoded-exact → curated once the bar
          // joins the curated data). Equal-or-higher tier → informational;
          // lower tier → a genuine downgrade warning. Unknown values (null
          // tier) fail open to the PRESERVE FAILED line, byte-identical to
          // before — as do all non-provenance fields.
          const existingTier = SharedCore.isProvenanceCompanionField(field)
            ? SharedCore.getProvenanceTrustTier(field, existingValue)
            : null;
          const finalTier = SharedCore.isProvenanceCompanionField(field)
            ? SharedCore.getProvenanceTrustTier(field, finalValue)
            : null;
          const describeStamp = (val) =>
            val === undefined || val === null || String(val).trim() === ""
              ? "unstamped"
              : this.escapeHtml(String(val));
          if (existingTier !== null && finalTier !== null && finalTier >= existingTier) {
            flowIcon = "→";
            resultText = `<span style="color: #34c759;">PROVENANCE UPGRADED (${describeStamp(existingValue)} → ${describeStamp(finalValue)})</span>`;
          } else if (existingTier !== null && finalTier !== null) {
            flowIcon = "⚠️";
            resultText = `<span style="color: #ff3b30;">PROVENANCE DOWNGRADED (${describeStamp(existingValue)} → ${describeStamp(finalValue)})</span>`;
          } else {
            // Preserve didn't work as expected - should always keep existing
            flowIcon = "⚠️";
            resultText = `<span style="color: #ff3b30;">PRESERVE FAILED (expected: ${existingValue === undefined ? "undefined" : existingValue}, got: ${finalValue === undefined ? "undefined" : finalValue})</span>`;
          }
        }
      } else if (wasUsed === "existing") {
        // Merge strategy explicitly chose existing value
        flowIcon = "←";
        resultText = '<span style="color: #007aff;">EXISTING</span>';
      } else if (finalValue === newValue) {
        // Replaced with new value
        flowIcon = "→";
        resultText = '<span style="color: #ff9500;">NEW</span>';
      } else if (finalValue === existingValue && existingValue !== newValue) {
        // Preserved existing value when values differ
        flowIcon = "←";
        resultText = '<span style="color: #007aff;">EXISTING</span>';
      } else if (
        finalValue &&
        finalValue !== existingValue &&
        finalValue !== newValue
      ) {
        // Merged/combined value
        flowIcon = "↔";
        resultText = '<span style="color: #32d74b;">MERGED</span>';
      } else {
        flowIcon = "—";
        resultText = '<span style="color: #999;">NO CHANGE</span>';
      }

      rows.push(
        `<tr><td class="cmp-field"><strong>${field}</strong><br><small>${strategy}</small></td>` +
          `<td>${formatValue(existingValue, diffAnchor)}</td>` +
          `<td class="cmp-flow">${flowIcon}</td>` +
          `<td>${formatValue(newValue, diffAnchor)}</td>` +
          `<td class="cmp-result">${resultText}</td></tr>`,
      );
    });

    return rows.join("");
  }

  // Longest slice of any single value the line-by-line diff will render.
  static get LINE_DIFF_MAX_CHARS() {
    return 220;
  }

  // BOUNDED BY CONSTRUCTION.
  //
  // The line diff used to emit every value with escapeHtml() and no cap at
  // all, and a REPLACED field emits both sides — so one 6 KB description
  // cost ~12 KB of page, per event, forever. It is the one place in a card
  // whose size was set purely by how chatty a venue's copywriter is.
  //
  // The slice is capped at LINE_DIFF_MAX_CHARS and anchored on the first
  // diverging character, so the visible text always contains the change. The
  // affordance is explicit: the badge states the true length and names where
  // the complete value still lives (this card's 📋 Copy JSON / raw dump).
  renderBoundedDiffValue(text, anchor = 0) {
    const str = text === null || text === undefined ? "" : String(text);
    const max = ScriptableAdapter.LINE_DIFF_MAX_CHARS;
    if (str.length <= max) return this.escapeHtml(str);
    const start = anchor > max ? Math.max(0, anchor - Math.floor(max / 4)) : 0;
    const lead = start > 0 ? "..." : "";
    const visible = str.substring(start, start + max);
    return `${lead}${this.escapeHtml(visible)}...<span class="cmp-more"> [${str.length} chars total — 📋 Copy JSON for the full value]</span>`;
  }

  // Generate line-by-line diff view
  generateLineDiffView(event) {
    if (!event._original) return "<p>No comparison data available</p>";

    // Use the same field logic as comparison (includes core fields not in notes)
    const fieldsToCompare = this.getFieldsForComparison(event);
    let html =
      "<div style=\"font-family: 'SF Mono', Monaco, 'Courier New', monospace; font-size: 12px; background: var(--background-primary); padding: 12px; border-radius: 8px; line-height: 1.6; color: var(--text-primary);\">";

    fieldsToCompare.forEach((field, index) => {
      // Skip notes field as it's a computed field that combines other fields
      // This makes the comparison confusing and it's often broken
      if (field === "notes") return;

      let newValue = event._original.scraper[field] || "";
      let existingValue = event._original.calendar?.[field] || "";
      let finalValue = event[field] || "";
      // Fix: Use _fieldPriorities instead of _fieldMergeStrategies
      const strategy =
        event._fieldPriorities?.[field]?.merge ||
        event._fieldMergeStrategies?.[field] ||
        "preserve";

      // Skip if both are empty and no final value
      if (!newValue && !existingValue && !finalValue) return;

      // Format dates
      const formatValue = (val) => {
        if (!val) return "";
        if (field.includes("Date") && val) {
          // Get timezone from city configuration instead of expecting it on the event
          const timezone = this.getTimezoneForCityOrUtc(event.city);
          return new Date(val).toLocaleString("en-US", { timeZone: timezone });
        }
        if (typeof val === "object") {
          try {
            return JSON.stringify(val);
          } catch (e) {
            return String(val);
          }
        }
        return val.toString();
      };

      // First character at which the two sides diverge — renderBoundedDiffValue
      // centres its window there, so a replaced 4 KB description shows the
      // part that actually changed instead of two identical opening lines.
      const diffAnchor = (() => {
        const a = formatValue(existingValue);
        const b = formatValue(newValue);
        if (!a || !b) return 0;
        const max = Math.min(a.length, b.length);
        let i = 0;
        while (i < max && a[i] === b[i]) i++;
        return i;
      })();

      // Determine what happened with this field by comparing values
      let wasUsed = "unknown";
      if (finalValue === newValue && finalValue !== existingValue) {
        wasUsed = "new";
      } else if (finalValue === existingValue && finalValue !== newValue) {
        wasUsed = "existing";
      } else if (finalValue === existingValue && finalValue === newValue) {
        wasUsed = "same";
      }
      const isNew = !existingValue && newValue;
      const isUnchanged = existingValue && !newValue;

      const isDateField = field.toLowerCase().includes("date");
      const equalForDisplay = isDateField
        ? this.datesEqualForDisplay(existingValue, newValue)
        : existingValue === newValue;
      const isSame = existingValue && newValue && equalForDisplay;

      const isReplaced =
        existingValue &&
        newValue &&
        finalValue === newValue &&
        !equalForDisplay;
      const isKept =
        existingValue &&
        newValue &&
        finalValue === existingValue &&
        !equalForDisplay;
      const isMerged =
        existingValue &&
        newValue &&
        finalValue &&
        finalValue !== existingValue &&
        finalValue !== newValue &&
        !equalForDisplay;

      // Add field separator for readability (except for first field)
      if (index > 0) {
        html += `<div class=\"diff-sep\"></div>`;
      }

      // Add field header
      html += `<div class=\"diff-header\">
                        ${field}
                     </div>`;

      // Show git-style diff
      if (isNew) {
        // Only new value exists - show as addition
        html += `<div class=\"diff-line diff-added\">`;
        html += `<span>+</span> ${this.renderBoundedDiffValue(formatValue(newValue), diffAnchor)} <em class=\"diff-meta\">(new field)</em>`;
        html += `</div>`;
      } else if (isUnchanged) {
        // Only existing value exists - show as context (orange)
        html += `<div class=\"diff-line diff-context\">`;
        html += `<span>═</span> ${this.renderBoundedDiffValue(formatValue(existingValue), diffAnchor)} <em class=\"diff-meta\">(existing, unchanged)</em>`;
        html += `</div>`;
      } else if (isSame) {
        // Existing and new are the same for display - avoid +/- noise
        html += `<div class=\"diff-line diff-same\">`;
        html += `<span>═</span> ${this.renderBoundedDiffValue(formatValue(existingValue), diffAnchor)} <em class=\"diff-meta\">(same in both)</em>`;
        html += `</div>`;
      } else if (isReplaced) {
        // Value was replaced - show old as deletion, new as addition
        html += `<div class=\"diff-line diff-removed\">`;
        html += `<span>-</span> ${this.renderBoundedDiffValue(formatValue(existingValue), diffAnchor)} <em class=\"diff-meta\">(removed)</em>`;
        html += `</div>`;
        html += `<div class=\"diff-line diff-added\">`;
        html += `<span>+</span> ${this.renderBoundedDiffValue(formatValue(newValue), diffAnchor)} <em class=\"diff-meta\">(added)</em>`;
        html += `</div>`;
      } else if (isKept) {
        // New value exists but existing was kept - show both with context
        html += `<div class=\"diff-line diff-same\">`;
        html += `<span>═</span> ${this.renderBoundedDiffValue(formatValue(existingValue), diffAnchor)} <em class=\"diff-meta\">(kept existing)</em>`;
        html += `</div>`;
        html += `<div class=\"diff-line diff-ignored\" style=\"opacity:0.85;\">`;
        html += `<span>~</span> ${this.renderBoundedDiffValue(formatValue(newValue), diffAnchor)} <em class=\"diff-meta\">(ignored new value)</em>`;
        html += `</div>`;
      } else if (isMerged) {
        // Values were merged - show all three
        html += `<div class=\"diff-line diff-removed\">`;
        html += `<span>-</span> ${this.renderBoundedDiffValue(formatValue(existingValue), diffAnchor)} <em class=\"diff-meta\">(original)</em>`;
        html += `</div>`;
        html += `<div class=\"diff-line diff-ignored\">`;
        html += `<span>~</span> ${this.renderBoundedDiffValue(formatValue(newValue), diffAnchor)} <em class=\"diff-meta\">(proposed)</em>`;
        html += `</div>`;
        html += `<div class=\"diff-line diff-merged\">`;
        html += `<span>+</span> ${this.renderBoundedDiffValue(formatValue(finalValue), diffAnchor)} <em class=\"diff-meta\">(merged result)</em>`;
        html += `</div>`;
      }

      // Add spacing after each field (except last one)
      if (index < fieldsToCompare.length - 1) {
        html += `<div style="margin-bottom: 12px;"></div>`;
      }
    });

    html += "</div>";
    return html;
  }

  // Compare two date inputs for display equality, avoiding timezone-related false diffs
  datesEqualForDisplay(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    const da = new Date(a);
    const db = new Date(b);
    if (isNaN(da.getTime()) || isNaN(db.getTime())) {
      return String(a) === String(b);
    }
    if (da.getTime() === db.getTime()) return true;
    try {
      return da.toLocaleString() === db.toLocaleString();
    } catch (e) {
      return da.toString() === db.toString();
    }
  }

  // Prompt user for calendar execution after displaying results
  async promptForCalendarExecution(analyzedEvents, config, overrideCounts = null) {
    if (!analyzedEvents || analyzedEvents.length === 0) {
      return false;
    }

    const alert = new Alert();
    alert.title = "Execute Calendar Actions?";

    // Count actions by type (intent and write) — analyzedEvents already
    // includes manually marked-bear rescues and adjusted not-bear tombstones,
    // so these counts reflect the adjusted plan.
    const intentCounts = this.countMetricsActions(analyzedEvents);
    const writeCounts = this.countMetricsCalendarActions(analyzedEvents);

    let message = "Ready to execute the following calendar actions:\n\n";
    if (intentCounts.new)
      message += `🎯 Intent NEW: ${intentCounts.new} events\n`;
    if (intentCounts.merge)
      message += `🎯 Intent MERGE: ${intentCounts.merge} events\n`;
    if (intentCounts.conflict)
      message += `🎯 Intent CONFLICT: ${intentCounts.conflict} events\n`;
    if (intentCounts.new || intentCounts.merge || intentCounts.conflict)
      message += `\n`;
    if (writeCounts.create)
      message += `➕ Create ${writeCounts.create} events\n`;
    if (writeCounts.update)
      message += `🔄 Update ${writeCounts.update} events\n`;
    if (writeCounts.skip) message += `⚠️ Skip ${writeCounts.skip} events\n`;
    if (writeCounts.other)
      message += `❓ Other write actions: ${writeCounts.other}\n`;
    if (
      overrideCounts &&
      (overrideCounts.markedBear || overrideCounts.markedNotBear)
    ) {
      message += `\n🐻 Manual overrides: ${overrideCounts.markedBear || 0} marked bear, ${overrideCounts.markedNotBear || 0} marked not-bear (hidden)\n`;
    }

    alert.message = message;
    alert.addAction("Execute");
    alert.addCancelAction("Cancel");

    const response = await alert.presentAlert();

    if (response === 0) {
      // Before executing writes, attempt to persist capability by writing a temp file. If this fails, abort.
      await this.ensureRelativeStorageDirs();
      const testFilePath = this.fm.joinPath(this.runsDir, ".write-test.json");
      try {
        // Write test file directly using our FileManager
        this.fm.writeString(
          testFilePath,
          JSON.stringify({ ts: new Date().toISOString() }),
        );
        // remove temp file
        const fm = this.fm || FileManager.iCloud();
        if (fm.fileExists(testFilePath)) fm.remove(testFilePath);
      } catch (e) {
        const errorAlert = new Alert();
        errorAlert.title = "Cannot Proceed";
        errorAlert.message =
          "Failed to write to runs directory. Calendar changes will not be executed.";
        errorAlert.addAction("OK");
        await errorAlert.presentAlert();
        return 0;
      }

      // User selected Execute and write preflight works — proceed to execute
      const processedCount = await this.executeCalendarActions(
        analyzedEvents,
        config,
      );

      const successAlert = new Alert();
      successAlert.title = "Calendar Updated";
      successAlert.message = `Successfully processed ${processedCount} events.`;
      successAlert.addAction("OK");
      await successAlert.presentAlert();

      return processedCount;
    }

    return 0;
  }


  async ensureRelativeStorageDirs() {
    try {
      const fm = this.fm || FileManager.iCloud();

      console.log(`📱 Scriptable: Ensuring directories in: ${this.baseDir}`);
      if (!fm.fileExists(this.baseDir)) fm.createDirectory(this.baseDir, true);
      if (!fm.fileExists(this.runsDir)) fm.createDirectory(this.runsDir, true);
      if (!fm.fileExists(this.logsDir)) fm.createDirectory(this.logsDir, true);
      if (!fm.fileExists(this.metricsDir))
        fm.createDirectory(this.metricsDir, true);
      if (!fm.fileExists(this.cacheDir))
        fm.createDirectory(this.cacheDir, true);
    } catch (e) {
      console.log(
        `📱 Scriptable: Failed to ensure relative storage dirs: ${e.message}`,
      );
    }
  }

  getRunId(timestamp = new Date()) {
    // Use a filesystem-friendly timestamp
    const pad = (n) => String(n).padStart(2, "0");
    const y = timestamp.getFullYear();
    const m = pad(timestamp.getMonth() + 1);
    const d = pad(timestamp.getDate());
    const hh = pad(timestamp.getHours());
    const mm = pad(timestamp.getMinutes());
    const ss = pad(timestamp.getSeconds());
    return `${y}${m}${d}-${hh}${mm}${ss}`;
  }

  getRunFilePath(runId) {
    return this.fm.joinPath(this.runsDir, `${runId}.json`);
  }

  async saveRun(results) {
    if (!this.fm) return;
    try {
      // Ensure directories exist first
      await this.ensureRelativeStorageDirs();

      const ts = new Date();
      const runId = this.getRunId(ts);
      const runFilePath = this.getRunFilePath(runId);
      const runContext = results.runContext || null;
      const analyzedEvents = this.sanitizeEventsForRunSave(
        results.analyzedEvents || [],
      );

      const summary = {
        runId,
        timestamp: ts.toISOString(),
        runContext,
        totals: {
          totalEvents: results.totalEvents || 0,
          bearEvents: results.bearEvents || 0,
          calendarEvents: results.calendarEvents || 0,
          errors: (results.errors || []).length,
        },
        parserSummaries: (results.parserResults || []).map((r) => ({
          name: r.name,
          bearEvents: r.bearEvents,
          totalEvents: r.totalEvents,
        })),
      };

      const payload = {
        version: 2,
        summary,
        runContext,
        config: results.config || null,
        analyzedEvents,
        // Events the bear check dropped. Saved so a past run can be reviewed
        // as it actually happened: the results UI renders these as real event
        // cards, and without them that section is simply missing from every
        // saved-run display — which is exactly where you go to audit a bear
        // call after the fact. Sanitized copies only: this list is for the
        // display, and parserResults below already carries the raw entries.
        bearDroppedEvents: this.sanitizeDroppedEntriesForRunSave(
          results.bearDroppedEvents,
        ),
        parserResults: results.parserResults || [],
        errors: results.errors || [],
      };

      // Ensure directory exists before writing (same pattern as FileLogger)
      if (!this.fm.fileExists(this.runsDir)) {
        try {
          this.fm.createDirectory(this.runsDir, true);
          console.log(`📱 Scriptable: Created runs directory: ${this.runsDir}`);
        } catch (dirErr) {
          console.log(
            `📱 Scriptable: Directory creation failed: ${dirErr.message}`,
          );
          throw dirErr;
        }
      }

      // Check if path is a directory
      if (this.fm.fileExists(runFilePath) && this.fm.isDirectory(runFilePath)) {
        throw new Error("Run file path is a directory, please delete!");
      }

      // Save run using absolute path
      this.fm.writeString(runFilePath, JSON.stringify(payload));
      console.log(`📱 Scriptable: ✓ Saved run ${runId} to ${runFilePath}`);
      return runId;
    } catch (e) {
      console.log(`📱 Scriptable: ✗ Failed to save run: ${e.message}`);
    }
  }

  async cleanupOldFiles(
    relDirPath,
    { maxAgeDays = 30, keep = () => false, recurse = false, afterCleanup = null } = {},
  ) {
    // Use documents directory as base, not script directory
    const documentsDir = this.fm.documentsDirectory();
    const dirPath = this.fm.joinPath(documentsDir, relDirPath);
    const fm = this.fm || FileManager.iCloud();
    if (!fm.fileExists(dirPath)) return 0;
    const now = Date.now();
    const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
    const removeOldEntries = (currentDir) => {
      let removed = 0;
      const files = fm.listContents(currentDir) || [];
      files.forEach((name) => {
        if (keep(name)) return;
        const path = fm.joinPath(currentDir, name);
        // Nested cache layouts (storage/<scope>/<host>/<file>) opt into
        // descending; flat dirs (runs/, logs/) keep the original behavior
        if (recurse) {
          let isDirectory = false;
          try {
            isDirectory = fm.isDirectory(path);
          } catch (_) {}
          if (isDirectory) {
            removed += removeOldEntries(path);
            return;
          }
        }
        let mtime = null;
        try {
          mtime = fm.modificationDate(path);
        } catch (_) {}
        const ms = mtime ? mtime.getTime() : null;
        if (ms && ms < cutoff) {
          try {
            fm.remove(path);
            removed += 1;
          } catch (_) {}
        }
      });
      return removed;
    };
    const removedCount = removeOldEntries(dirPath);
    if (typeof afterCleanup === "function") {
      await afterCleanup();
    }
    return removedCount;
  }

  // Metrics helpers
  getMetricsFilePath() {
    return this.fm.joinPath(this.metricsDir, "metrics.ndjson");
  }

  getMetricsSummaryPath() {
    return this.fm.joinPath(this.metricsDir, "metrics-summary.json");
  }

  createMetricsActionCounts() {
    return {
      new: 0,
      merge: 0,
      conflict: 0,
      missing_calendar: 0,
      other: 0,
    };
  }

  createMetricsCalendarActionCounts() {
    return {
      create: 0,
      update: 0,
      skip: 0,
      failed: 0,
      other: 0,
    };
  }

  normalizeWriteAction(event) {
    const action = String(event?._action || "").toLowerCase();
    if (!action) return null;
    if (action === "key_conflict" || action === "time_conflict")
      return "conflict";
    return action;
  }

  getWriteActionFromEvent(event) {
    const action = this.normalizeWriteAction(event);
    if (!action) return null;
    // A recurring series is withheld from execution by
    // SharedCore.filterEventsForExecution, so "CREATE"/"UPDATE" on the card is
    // a promise the run never keeps. Display-only: countMetricsCalendarActions
    // buckets off normalizeWriteAction, not this, so the metrics schema is
    // untouched.
    if (SharedCore.isRecurringSeriesEvent(event)) return "withheld";
    // Same display-only treatment for the other direction: a slot-host source
    // fills in ONE dated occurrence of somebody else's series, so the write is
    // neither a new event nor a change to the series. Checked after the
    // recurring guard on purpose — filterEventsForExecution is the real gate,
    // and a withheld event must never be labelled as a write that happens.
    if (this.isSingleOccurrenceOverride(event)) return "override";
    if (action === "new") return "create";
    if (action === "merge") return "update";
    if (action === "conflict" || action === "missing_calendar") return "skip";
    return "other";
  }

  // --- Series authority (stamped upstream, consumed read-only here) --------
  // SharedCore stamps _seriesAuthority on events whose source's relationship
  // to a series is known. Absent (every run before the stamp, every saved run)
  // → "" and every surface below renders exactly as it did before.
  getSeriesAuthority(event) {
    const raw =
      typeof event?._seriesAuthority === "string"
        ? event._seriesAuthority.trim().toLowerCase()
        : "";
    return raw === "series-owner" || raw === "slot-host" || raw === "unknown"
      ? raw
      : "";
  }

  // A slot-host source (e.g. a venue announcing it hosts this week's leg of a
  // traveling brand) yields a single-occurrence override of a series it does
  // not own — never a series write.
  isSingleOccurrenceOverride(event) {
    return this.getSeriesAuthority(event) === "slot-host";
  }

  // Which occurrence the override replaces. RECURRENCE-ID wins because it
  // names the series slot; the event's own start is the fallback for a
  // slot-host event whose override identity is not stamped yet. Date only —
  // the point is which night, and the card already shows the times.
  getOverrideOccurrenceLabel(event) {
    const dateOptions = {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    };
    const format = (date, timeZone) => {
      try {
        return date.toLocaleDateString("en-US", { ...dateOptions, timeZone });
      } catch (error) {
        return date.toLocaleDateString("en-US", {
          ...dateOptions,
          timeZone: "UTC",
        });
      }
    };
    const recurrenceId = this.normalizeOverrideRecurrenceId(
      event?.overrideRecurrenceId || "",
    );
    if (recurrenceId) {
      const zoned = /^TZID=([^:]+):(.+)$/i.exec(recurrenceId);
      const value = zoned ? zoned[2] : recurrenceId;
      const parts = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(
        value,
      );
      if (parts) {
        if (parts[7] === "Z") {
          // A UTC instant: render it in the calendar's own timezone, or the
          // occurrence lands on the wrong night for late-evening events.
          const instant = new Date(
            Date.UTC(
              Number(parts[1]),
              Number(parts[2]) - 1,
              Number(parts[3]),
              Number(parts[4] || 0),
              Number(parts[5] || 0),
              Number(parts[6] || 0),
            ),
          );
          return format(
            instant,
            zoned ? zoned[1] : this.getTimezoneForCityOrUtc(event?.city),
          );
        }
        // Floating or TZID-local: the digits already ARE the calendar date.
        const wallClock = new Date(
          Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])),
        );
        return format(wallClock, "UTC");
      }
    }
    const start = event?.startDate ? new Date(event.startDate) : null;
    if (start && !Number.isNaN(start.getTime())) {
      return format(start, this.getTimezoneForCityOrUtc(event?.city));
    }
    return "";
  }

  // A cadence a slot-host source implies (e.g. "every Thursday") is evidence
  // about someone else's series, never an RRULE this run writes. Surfaced so
  // the reading is not silently discarded (flag, don't drop).
  getCadenceHint(event) {
    const raw =
      event && typeof event._cadenceHint === "object" && event._cadenceHint
        ? event._cadenceHint
        : null;
    if (!raw) return null;
    const rrule = this.stringifyAuthorityValue(raw.rrule);
    const evidence = this.stringifyAuthorityValue(raw.evidence);
    const sourceUrl = this.stringifyAuthorityValue(raw.sourceUrl);
    if (!rrule && !evidence) return null;
    return { rrule, evidence, sourceUrl };
  }

  // The refusal case: a source that OWNS a series asserts a different
  // schedule. Never auto-written — a wrong override costs one night and is
  // reversible, a wrong series change is wrong repeatedly into the future.
  getSeriesChangeProposal(event) {
    const raw =
      event &&
      typeof event._seriesChangeProposal === "object" &&
      event._seriesChangeProposal
        ? event._seriesChangeProposal
        : null;
    if (!raw) return null;
    const proposal = {
      field: this.stringifyAuthorityValue(raw.field),
      current: this.stringifyAuthorityValue(raw.current),
      proposed: this.stringifyAuthorityValue(raw.proposed),
      evidence: this.stringifyAuthorityValue(raw.evidence),
      sourceUrl: this.stringifyAuthorityValue(raw.sourceUrl),
      calendarName: this.stringifyAuthorityValue(raw.calendarName),
      eventTitle: this.stringifyAuthorityValue(event.title || event.name),
    };
    // A proposal with nothing to compare is not a decision the owner can make.
    if (!proposal.current && !proposal.proposed) return null;
    return proposal;
  }

  // Authority payloads come from scraped pages: coerce anything (object RRULE,
  // number, null) to a plain trimmed string before it reaches escapeHtml.
  stringifyAuthorityValue(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (error) {
        return "";
      }
    }
    return String(value).trim();
  }

  // Scraped URLs are untrusted: only http(s) becomes a link, anything else
  // (javascript:, data:) is shown as escaped text so it can still be read.
  isSafeExternalUrl(url) {
    return /^https?:\/\/\S+$/i.test(String(url || "").trim());
  }

  formatIntentActionLabel(action) {
    const normalized = String(action || "").toLowerCase();
    if (normalized === "merge") return "MERGE";
    if (normalized === "new") return "NEW";
    if (normalized === "conflict") return "CONFLICT";
    if (normalized === "missing_calendar") return "MISSING_CALENDAR";
    return "OTHER";
  }

  formatWriteActionLabel(action) {
    const normalized = String(action || "").toLowerCase();
    if (normalized === "create") return "CREATE";
    if (normalized === "update") return "UPDATE";
    if (normalized === "skip") return "SKIP";
    if (normalized === "withheld") return "WITHHELD";
    if (normalized === "override") return "OVERRIDE";
    return "OTHER";
  }

  normalizeIntentAction(event) {
    const action = this.normalizeWriteAction(event);
    if (!action) return null;
    if (action !== "new") return action;

    const overrideUid =
      typeof event?.overrideUid === "string" ? event.overrideUid.trim() : "";
    const overrideRecurrenceId =
      typeof event?.overrideRecurrenceId === "string"
        ? event.overrideRecurrenceId.trim()
        : "";
    const hasOverrideIdentity = Boolean(overrideUid && overrideRecurrenceId);
    const hasSourceEvent = Boolean(event?._analysis?.sourceEvent);
    const reason = String(event?._analysis?.reason || "").toLowerCase();
    const reasonSuggestsOverride = reason.includes("override");

    if (hasOverrideIdentity || hasSourceEvent || reasonSuggestsOverride) {
      // Override creates are merge intent, even though calendar operation is "create".
      return "merge";
    }
    return "new";
  }

  normalizeMetricsIntentAction(event) {
    return this.normalizeIntentAction(event);
  }

  countMetricsActions(events) {
    const counts = this.createMetricsActionCounts();
    if (!Array.isArray(events)) return counts;
    events.forEach((event) => {
      const action = this.normalizeMetricsIntentAction(event);
      if (!action) return;
      if (Object.prototype.hasOwnProperty.call(counts, action)) {
        counts[action] += 1;
      } else {
        counts.other += 1;
      }
    });
    return counts;
  }

  countMetricsActionsByParser(events) {
    const countsByParser = {};
    if (!Array.isArray(events)) return countsByParser;
    events.forEach((event) => {
      const parserName = event?._parserConfig?.name || null;
      if (!parserName) return;
      if (!countsByParser[parserName]) {
        countsByParser[parserName] = this.createMetricsActionCounts();
      }
      const action = this.normalizeMetricsIntentAction(event);
      if (!action) return;
      if (
        Object.prototype.hasOwnProperty.call(countsByParser[parserName], action)
      ) {
        countsByParser[parserName][action] += 1;
      } else {
        countsByParser[parserName].other += 1;
      }
    });
    return countsByParser;
  }

  countMetricsCalendarActions(events) {
    const counts = this.createMetricsCalendarActionCounts();
    if (!Array.isArray(events)) return counts;
    events.forEach((event) => {
      const action = this.normalizeWriteAction(event);
      if (!action) return;
      if (action === "new") {
        counts.create += 1;
      } else if (action === "merge") {
        counts.update += 1;
      } else if (action === "conflict" || action === "missing_calendar") {
        counts.skip += 1;
      } else {
        counts.other += 1;
      }
    });
    return counts;
  }

  countMetricsCalendarActionsByParser(events) {
    const countsByParser = {};
    if (!Array.isArray(events)) return countsByParser;
    events.forEach((event) => {
      const parserName = event?._parserConfig?.name || null;
      if (!parserName) return;
      if (!countsByParser[parserName]) {
        countsByParser[parserName] = this.createMetricsCalendarActionCounts();
      }
      const counts = countsByParser[parserName];
      const action = this.normalizeWriteAction(event);
      if (!action) return;
      if (action === "new") {
        counts.create += 1;
      } else if (action === "merge") {
        counts.update += 1;
      } else if (action === "conflict" || action === "missing_calendar") {
        counts.skip += 1;
      } else {
        counts.other += 1;
      }
    });
    return countsByParser;
  }

  getMetricsStatus(results, errorsCount, warningsCount) {
    const errorTotal = Number.isFinite(errorsCount) ? errorsCount : 0;
    const warningTotal = Number.isFinite(warningsCount) ? warningsCount : 0;
    if (errorTotal > 0) {
      return "failed";
    }
    if (warningTotal > 0) {
      return "partial";
    }
    return "success";
  }

  // Compact per-run guard/AI/quality signals for the metrics record and the
  // results-UI health badge. All parsing/aggregation logic lives in
  // run-log-summary.js — this method only supplies the in-memory log text
  // (or a saved run's log text via logText) and the structured results.
  buildRunSignalsFromResults(results, logText = null) {
    try {
      const text =
        typeof logText === "string"
          ? logText
          : logger.getLogText({ mode: "full" });
      const summary = RunLogSummary.summarizeLogText(text);
      return RunLogSummary.buildRunSignals(summary, results);
    } catch (error) {
      console.log(
        `📱 Scriptable: Run signals extraction failed: ${error.message}`,
      );
      return null;
    }
  }

  buildMetricsRecord(results) {
    const runId =
      results?.savedRunId ||
      results?.sourceRunId ||
      results?.runId ||
      results?.summary?.runId ||
      null;
    if (!runId) {
      return null;
    }

    const finishedAt = new Date();
    const startedAt =
      this.runStartedAt instanceof Date ? this.runStartedAt : null;
    const durationMs = startedAt
      ? finishedAt.getTime() - startedAt.getTime()
      : null;
    const errorsCount = (results?.errors || []).length;
    const analyzedEvents = Array.isArray(results?.analyzedEvents)
      ? results.analyzedEvents
      : [];
    const parserResults = Array.isArray(results?.parserResults)
      ? results.parserResults
      : [];
    const runContext = results?.runContext || null;
    const triggerType =
      runContext?.type === "manual" || runContext?.type === "automated"
        ? runContext.type
        : "unknown";
    const actions = this.countMetricsActions(analyzedEvents);
    const actionsByParser = this.countMetricsActionsByParser(analyzedEvents);
    const plannedCalendarActions =
      this.countMetricsCalendarActions(analyzedEvents);
    const plannedCalendarActionsByParser =
      this.countMetricsCalendarActionsByParser(analyzedEvents);
    const allowExecutedCalendarActions =
      results?.config?.config?.dryRun === false;
    const rawExecutionCounts = allowExecutedCalendarActions
      ? this.lastExecutionActionCounts
      : null;
    const hasExecutionCounts = Boolean(
      rawExecutionCounts &&
      Number.isFinite(rawExecutionCounts.analyzed) &&
      rawExecutionCounts.analyzed === analyzedEvents.length,
    );
    const calendarActions = hasExecutionCounts
      ? {
          create: rawExecutionCounts.create || 0,
          update: rawExecutionCounts.update || 0,
          skip: rawExecutionCounts.skip || 0,
          failed: rawExecutionCounts.failed || 0,
          other: 0,
        }
      : plannedCalendarActions;
    const calendarActionsMode = hasExecutionCounts ? "executed" : "planned";
    const warningActionsCount =
      (actions.conflict || 0) +
      (actions.missing_calendar || 0) +
      (actions.other || 0);
    const warningsCount = (this.warnCount || 0) + warningActionsCount;

    const mergeDiffFieldsUpdated = analyzedEvents.reduce((sum, event) => {
      const updatedCount = event?._mergeDiff?.updated?.length || 0;
      return sum + updatedCount;
    }, 0);

    // Aggregates only (counts + milliseconds), never payloads — see
    // buildRunSignals in run-log-summary.js. Additive: old readers ignore it.
    const signals = this.buildRunSignalsFromResults(results);

    const totals = {
      total_events: results?.totalEvents || 0,
      raw_bear_events: results?.rawBearEvents || 0,
      final_bear_events: results?.bearEvents || 0,
      duplicates_removed: results?.duplicatesRemoved || 0,
      deduplicated_events: results?.deduplicatedEvents || 0,
      calendar_events: results?.calendarEvents || 0,
    };

    const parsers = parserResults.map((result) => {
      const parserName = result?.name || null;
      const parserType = result?.parserType || result?.config?.parser || null;
      const parserActions =
        parserName && actionsByParser[parserName]
          ? actionsByParser[parserName]
          : this.createMetricsActionCounts();
      const parserCalendarActions =
        parserName && plannedCalendarActionsByParser[parserName]
          ? plannedCalendarActionsByParser[parserName]
          : this.createMetricsCalendarActionCounts();
      return {
        parser_name: parserName,
        parser_type: parserType,
        url_count: Number.isFinite(result?.urlCount) ? result.urlCount : 0,
        total_events: result?.totalEvents || 0,
        raw_bear_events: result?.rawBearEvents || 0,
        final_bear_events: result?.bearEvents || 0,
        duplicates_removed: result?.duplicatesRemoved || 0,
        duration_ms: Number.isFinite(result?.durationMs)
          ? result.durationMs
          : null,
        actions: parserActions,
        calendar_actions: parserCalendarActions,
      };
    });

    return {
      schema_version: 2,
      run_id: runId,
      started_at: startedAt ? startedAt.toISOString() : null,
      finished_at: finishedAt.toISOString(),
      duration_ms: durationMs,
      trigger_type: triggerType,
      status: this.getMetricsStatus(results, errorsCount, warningsCount),
      environment:
        runContext?.environment ||
        this.runtimeContext?.environment ||
        "unknown",
      run_context: runContext,
      config_files: ["scraper-input.js", "scraper-cities.js"],
      run_file_path: this.getRunFilePath(runId),
      log_file_path: this.getLogFilePath(runId),
      metrics_file_path: this.getMetricsFilePath(),
      summary_file_path: this.getMetricsSummaryPath(),
      errors_count: errorsCount,
      warnings_count: warningsCount,
      totals,
      actions,
      calendar_actions: calendarActions,
      calendar_actions_mode: calendarActionsMode,
      merge_diff_fields_updated: mergeDiffFieldsUpdated,
      signals,
      parsers,
    };
  }

  async appendMetricsRecord(record, retentionDays) {
    const fm = this.fm || FileManager.iCloud();
    const path = this.getMetricsFilePath();
    let existing = "";

    if (fm.fileExists(path)) {
      fm.downloadFileFromiCloud(path);
      existing = fm.readString(path) || "";
    }

    const retentionMs = (retentionDays || 0) * 24 * 60 * 60 * 1000;
    const cutoffMs = retentionMs > 0 ? Date.now() - retentionMs : null;
    const lines = existing.split("\n").filter((line) => line.trim().length > 0);
    const keptLines = [];

    let corruptLines = 0;
    lines.forEach((line) => {
      let parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch (parseError) {
        // A single corrupt line (interrupted write, partial sync) must not
        // poison the whole file and block every future metrics append
        corruptLines += 1;
        return;
      }
      const finishedAtMs = parsed?.finished_at
        ? new Date(parsed.finished_at).getTime()
        : null;
      if (!Number.isFinite(finishedAtMs)) {
        // Keep records without a parseable finished_at; only retention pruning
        // is allowed to drop lines
        keptLines.push(line);
        return;
      }
      if (!cutoffMs || finishedAtMs >= cutoffMs) {
        keptLines.push(line);
      }
    });
    if (corruptLines > 0) {
      console.warn(
        `📱 Scriptable: Dropped ${corruptLines} corrupt metrics line(s) during append`,
      );
    }

    const line = JSON.stringify(record);
    keptLines.push(line);
    const newContent = `${keptLines.join("\n")}\n`;

    fm.writeString(path, newContent);
    console.log(`📱 Scriptable: ✓ Appended metrics to ${path}`);
  }

  createMetricsSummaryBucket() {
    return {
      runs: 0,
      statuses: { success: 0, partial: 0, failed: 0 },
      errors_count: 0,
      warnings_count: 0,
      duration_ms_total: 0,
      totals: {
        total_events: 0,
        raw_bear_events: 0,
        final_bear_events: 0,
        duplicates_removed: 0,
        deduplicated_events: 0,
        calendar_events: 0,
      },
      actions: this.createMetricsActionCounts(),
      calendar_actions: this.createMetricsCalendarActionCounts(),
      merge_diff_fields_updated: 0,
    };
  }

  createParserSummaryBucket() {
    return {
      runs: 0,
      duration_ms_total: 0,
      statuses: { success: 0, partial: 0, failed: 0 },
      totals: {
        total_events: 0,
        raw_bear_events: 0,
        final_bear_events: 0,
        duplicates_removed: 0,
      },
      actions: this.createMetricsActionCounts(),
      calendar_actions: this.createMetricsCalendarActionCounts(),
    };
  }

  createParserSummaryGroup() {
    return {
      totals: this.createParserSummaryBucket(),
      by_day: {},
      by_month: {},
    };
  }

  applyMetricsRecordToBucket(bucket, record) {
    bucket.runs += 1;
    if (bucket.statuses && record.status) {
      bucket.statuses[record.status] =
        (bucket.statuses[record.status] || 0) + 1;
    }
    bucket.errors_count += record.errors_count || 0;
    bucket.warnings_count += record.warnings_count || 0;
    bucket.duration_ms_total += record.duration_ms || 0;

    Object.keys(bucket.totals).forEach((key) => {
      bucket.totals[key] += record.totals?.[key] || 0;
    });

    Object.keys(bucket.actions).forEach((key) => {
      bucket.actions[key] += record.actions?.[key] || 0;
    });
    if (!bucket.calendar_actions) {
      bucket.calendar_actions = this.createMetricsCalendarActionCounts();
    }
    Object.keys(bucket.calendar_actions).forEach((key) => {
      bucket.calendar_actions[key] += record.calendar_actions?.[key] || 0;
    });

    bucket.merge_diff_fields_updated += record.merge_diff_fields_updated || 0;
  }

  applyParserRecordToBucket(bucket, parserRecord, runStatus) {
    bucket.runs += 1;
    bucket.duration_ms_total += parserRecord.duration_ms || 0;
    if (!bucket.statuses) {
      bucket.statuses = { success: 0, partial: 0, failed: 0 };
    }
    const normalizedStatus = String(runStatus || "").toLowerCase();
    if (
      Object.prototype.hasOwnProperty.call(bucket.statuses, normalizedStatus)
    ) {
      bucket.statuses[normalizedStatus] += 1;
    }

    Object.keys(bucket.totals).forEach((key) => {
      bucket.totals[key] += parserRecord?.[key] || 0;
    });

    Object.keys(bucket.actions).forEach((key) => {
      bucket.actions[key] += parserRecord.actions?.[key] || 0;
    });
    if (!bucket.calendar_actions) {
      bucket.calendar_actions = this.createMetricsCalendarActionCounts();
    }
    Object.keys(bucket.calendar_actions).forEach((key) => {
      bucket.calendar_actions[key] += parserRecord.calendar_actions?.[key] || 0;
    });
  }

  async updateMetricsSummary(record) {
    const fm = this.fm || FileManager.iCloud();
    const summaryPath = this.getMetricsSummaryPath();
    let summary = null;

    if (fm.fileExists(summaryPath)) {
      fm.downloadFileFromiCloud(summaryPath);
      const summaryText = fm.readString(summaryPath);
      summary = JSON.parse(summaryText);
      if (!summary || typeof summary !== "object") {
        throw new Error("Metrics summary is invalid");
      }
    } else {
      summary = {
        version: 2,
        updated_at: null,
        totals: this.createMetricsSummaryBucket(),
        by_day: {},
        by_month: {},
        by_parser_name: {},
        by_parser_type: {},
      };
    }

    const dayKey = record.finished_at.slice(0, 10);
    const monthKey = record.finished_at.slice(0, 7);

    summary.updated_at = new Date().toISOString();
    if (!summary.totals) summary.totals = this.createMetricsSummaryBucket();
    this.applyMetricsRecordToBucket(summary.totals, record);

    summary.by_day = summary.by_day || {};
    if (!summary.by_day[dayKey])
      summary.by_day[dayKey] = this.createMetricsSummaryBucket();
    this.applyMetricsRecordToBucket(summary.by_day[dayKey], record);

    summary.by_month = summary.by_month || {};
    if (!summary.by_month[monthKey])
      summary.by_month[monthKey] = this.createMetricsSummaryBucket();
    this.applyMetricsRecordToBucket(summary.by_month[monthKey], record);

    summary.by_parser_name = summary.by_parser_name || {};
    summary.by_parser_type = summary.by_parser_type || {};

    record.parsers.forEach((parserRecord) => {
      if (parserRecord.parser_name) {
        if (!summary.by_parser_name[parserRecord.parser_name]) {
          summary.by_parser_name[parserRecord.parser_name] =
            this.createParserSummaryGroup();
        }
        const parserGroup = summary.by_parser_name[parserRecord.parser_name];
        this.applyParserRecordToBucket(
          parserGroup.totals,
          parserRecord,
          record.status,
        );
        if (!parserGroup.by_day[dayKey])
          parserGroup.by_day[dayKey] = this.createParserSummaryBucket();
        this.applyParserRecordToBucket(
          parserGroup.by_day[dayKey],
          parserRecord,
          record.status,
        );
        if (!parserGroup.by_month[monthKey])
          parserGroup.by_month[monthKey] = this.createParserSummaryBucket();
        this.applyParserRecordToBucket(
          parserGroup.by_month[monthKey],
          parserRecord,
          record.status,
        );
      }

      if (parserRecord.parser_type) {
        if (!summary.by_parser_type[parserRecord.parser_type]) {
          summary.by_parser_type[parserRecord.parser_type] =
            this.createParserSummaryGroup();
        }
        const parserTypeGroup =
          summary.by_parser_type[parserRecord.parser_type];
        this.applyParserRecordToBucket(
          parserTypeGroup.totals,
          parserRecord,
          record.status,
        );
        if (!parserTypeGroup.by_day[dayKey])
          parserTypeGroup.by_day[dayKey] = this.createParserSummaryBucket();
        this.applyParserRecordToBucket(
          parserTypeGroup.by_day[dayKey],
          parserRecord,
          record.status,
        );
        if (!parserTypeGroup.by_month[monthKey])
          parserTypeGroup.by_month[monthKey] = this.createParserSummaryBucket();
        this.applyParserRecordToBucket(
          parserTypeGroup.by_month[monthKey],
          parserRecord,
          record.status,
        );
      }
    });

    fm.writeString(summaryPath, JSON.stringify(summary));
    console.log(`📱 Scriptable: ✓ Updated metrics summary at ${summaryPath}`);
  }

  // Log helpers (prefer user's file logger)
  resolveLogConfig(config) {
    const configRoot = config?.config || {};
    const logging = config?.logging || configRoot.logging || {};
    const mode = String(
      logging.mode || configRoot.logMode || "tail",
    ).toLowerCase();
    const maxLines = Number.isFinite(logging.maxLines)
      ? logging.maxLines
      : Number.isFinite(configRoot.logMaxLines)
        ? configRoot.logMaxLines
        : DEFAULT_CAPTURE_LOG_MAX_LINES;
    const maxBytes = Number.isFinite(logging.maxBytes)
      ? logging.maxBytes
      : Number.isFinite(configRoot.logMaxBytes)
        ? configRoot.logMaxBytes
        : DEFAULT_CAPTURE_LOG_MAX_BYTES;
    const displayMaxLines = Number.isFinite(logging.displayMaxLines)
      ? logging.displayMaxLines
      : Number.isFinite(configRoot.logDisplayMaxLines)
        ? configRoot.logDisplayMaxLines
        : DEFAULT_DISPLAY_LOG_MAX_LINES;
    return { mode, maxLines, maxBytes, displayMaxLines };
  }

  applyLogConfig(config) {
    const logConfig = this.resolveLogConfig(config);
    let captureMode = "all";
    if (["summary", "off", "none"].includes(logConfig.mode)) {
      captureMode = "none";
    } else if (["errors", "error"].includes(logConfig.mode)) {
      captureMode = "errors";
    }
    logger.configure({
      maxLines: logConfig.maxLines,
      maxBytes: logConfig.maxBytes,
      captureMode,
    });
  }

  resolveLogOutputMode(logConfig, results) {
    const mode = String(logConfig.mode || "tail").toLowerCase();
    if (["summary", "off", "none"].includes(mode)) {
      return "summary";
    }
    if (["errors", "error", "errors-only"].includes(mode)) {
      return "errors";
    }
    if (
      ["failures", "failure", "failures-only", "failure-only"].includes(mode)
    ) {
      const hasErrors = (results?.errors || []).length > 0;
      return hasErrors ? "full" : "summary";
    }
    return "full";
  }

  getRunIdForLogs(results) {
    return (
      results?.sourceRunId ||
      results?.savedRunId ||
      results?.runId ||
      results?.summary?.runId ||
      null
    );
  }

  normalizeAiPromptEntry(entry, fallbackPass = "extraction") {
    if (!entry || typeof entry !== "object") return null;
    const prompt = typeof entry.prompt === "string" ? entry.prompt : "";
    if (!prompt) return null;
    const pass =
      String(entry.pass || fallbackPass || "extraction").trim() || "extraction";
    const model = String(entry.model || "").trim();
    const endpoint = String(entry.endpoint || "").trim();
    const chars = Number.isFinite(Number(entry.chars))
      ? Number(entry.chars)
      : prompt.length;
    return { pass, model, endpoint, chars, prompt };
  }

  dedupeAiPromptEntries(entries) {
    if (!Array.isArray(entries)) return [];
    const seen = new Set();
    const deduped = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const promptText = String(entry.prompt || "");
      const promptFingerprint = `${promptText.length}:${promptText.slice(0, 120)}:${promptText.slice(-120)}`;
      const key = `${entry.pass || ""}::${entry.model || ""}::${promptFingerprint}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(entry);
    }
    return deduped;
  }

  extractAiPromptsFromLogText(logText) {
    const text = typeof logText === "string" ? logText : "";
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const promptHeaderRegex =
      /🤖 AI Web: Full prompt(?: \(([^)]+)\))?(?: \((\d+) chars\))?/;
    const nextLogEntryRegex =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[[A-Z]+\] /;
    const prompts = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const headerMatch = line.match(promptHeaderRegex);
      if (!headerMatch) continue;

      const pass =
        String(headerMatch[1] || "extraction").trim() || "extraction";
      const chars = Number.isFinite(Number(headerMatch[2]))
        ? Number(headerMatch[2])
        : null;
      const promptLines = [];
      let cursor = i + 1;
      while (cursor < lines.length) {
        const candidate = lines[cursor];
        if (
          candidate.match(nextLogEntryRegex) ||
          candidate.includes("🤖 AI Web: Full prompt")
        ) {
          break;
        }
        promptLines.push(candidate);
        cursor += 1;
      }
      i = cursor - 1;
      const prompt = promptLines.join("\n").trim();
      if (!prompt) continue;
      prompts.push({
        pass,
        model: "",
        endpoint: "",
        chars: chars || prompt.length,
        prompt,
      });
    }

    return prompts;
  }

  loadAiPromptsForDisplay(results, logInfo = null) {
    const collected = [];
    const events = Array.isArray(results?.analyzedEvents)
      ? results.analyzedEvents
      : [];
    events.forEach((event) => {
      const eventPrompts = Array.isArray(event?._aiPrompts)
        ? event._aiPrompts
        : [];
      eventPrompts.forEach((entry) => {
        const normalized = this.normalizeAiPromptEntry(entry);
        if (normalized) {
          collected.push(normalized);
        }
      });
    });

    if (
      collected.length === 0 &&
      logInfo?.exists &&
      typeof logInfo.text === "string"
    ) {
      this.extractAiPromptsFromLogText(logInfo.text).forEach((entry) => {
        const normalized = this.normalizeAiPromptEntry(entry);
        if (normalized) {
          collected.push(normalized);
        }
      });
    }

    const prompts = this.dedupeAiPromptEntries(collected);
    return {
      count: prompts.length,
      prompts,
    };
  }

  async loadRunLogsForDisplay(results) {
    const runId = this.getRunIdForLogs(results);
    if (!runId) {
      return { runId: null, exists: false, reason: "missing-run-id" };
    }
    const logPath = this.getLogFilePath(runId);
    if (!logPath) {
      return { runId, exists: false, reason: "missing-log-path" };
    }
    const fm = this.fm || FileManager.iCloud();
    if (!fm.fileExists(logPath)) {
      return { runId, exists: false, reason: "missing-log-file" };
    }

    try {
      try {
        await fm.downloadFileFromiCloud(logPath);
      } catch (downloadError) {
        console.log(
          `📱 Scriptable: Log iCloud download failed: ${downloadError.message}`,
        );
      }
      const content = fm.readString(logPath);
      if (!content || !content.trim()) {
        return { runId, exists: false, reason: "empty-log-file" };
      }
      let lines = content.split(/\r?\n/);
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines = lines.slice(0, -1);
      }
      const totalLines = lines.length;
      const logConfig = this.resolveLogConfig(results?.config || {});
      const maxLines =
        Number.isFinite(logConfig.displayMaxLines) &&
        logConfig.displayMaxLines > 0
          ? logConfig.displayMaxLines
          : DEFAULT_DISPLAY_LOG_MAX_LINES;
      let displayLines = lines;
      let truncated = false;
      if (lines.length > maxLines) {
        displayLines = lines.slice(lines.length - maxLines);
        truncated = true;
      }
      const text = displayLines.join("\n");
      return {
        runId,
        exists: true,
        text,
        // Untruncated log content for the run-insight summary (parsed, never
        // embedded in the HTML — only summary lines end up in the display).
        fullText: content,
        totalLines,
        shownLines: displayLines.length,
        truncated,
      };
    } catch (e) {
      console.log(`📱 Scriptable: Failed to read log file: ${e.message}`);
      return { runId, exists: false, reason: "read-failed" };
    }
  }

  getLogFilePath(runId) {
    if (!runId) {
      return null;
    }
    return this.fm.joinPath(this.logsDir, `${runId}.log`);
  }

  async appendLogSummary(results) {
    try {
      const runId =
        results?.savedRunId ||
        results?.sourceRunId ||
        results?.runId ||
        results?.summary?.runId ||
        null;
      const runContext = results?.runContext || null;
      const logPath = this.getLogFilePath(runId);
      if (!logPath) {
        console.log("📱 Scriptable: Skipping log write (missing runId)");
        return;
      }
      const summary = {
        timestamp: new Date().toISOString(),
        runId,
        runContext,
        totals: {
          totalEvents: results.totalEvents || 0,
          bearEvents: results.bearEvents || 0,
          calendarEvents: results.calendarEvents || 0,
          errors: (results.errors || []).length,
        },
      };
      const summaryLine = `${new Date().toISOString()} - ${JSON.stringify(summary)}`;
      const logConfig = this.resolveLogConfig(results?.config || {});
      const outputMode = this.resolveLogOutputMode(logConfig, results);
      const logText = logger.getLogText({ mode: outputMode });
      const content = logText
        ? `${summaryLine}\n${logText}`
        : `${summaryLine}\n`;

      const fm = this.fm || FileManager.iCloud();
      if (!fm.fileExists(this.logsDir)) {
        fm.createDirectory(this.logsDir, true);
      }

      fm.writeString(logPath, content);
      console.log(`📱 Scriptable: Successfully wrote log to ${logPath}`);
    } catch (e) {
      console.log(`📱 Scriptable: Failed to append log: ${e.message}`);
    }
  }
}

// Scriptable-specific CalendarEvent fields that must not be written to notes.
// Passed to SharedCore via options.additionalExcludedFields so that shared-core.js
// stays free of iOS-only API knowledge.
ScriptableAdapter.NOTES_EXCLUDED_FIELDS = new Set([
  "identifier",
  "availability",
  "timeZone",
  "calendar",
  "addRecurrenceRule",
  "removeAllRecurrenceRules",
  "save",
  "remove",
  "presentEdit",
  "_staticFields",
  "searchStartDate",
  "searchEndDate",
]);

// The run-log console tee: appends (level, args) into this module's singleton
// FileLogger — the same buffer captureConsole() fills — so the orchestrator can
// route other modules' per-module consoles into the saved run log.
function getConsoleTee() {
  return logger.getConsoleTee();
}

// Export for Scriptable environment (FileLogger exported for tests)
module.exports = { ScriptableAdapter, FileLogger, getConsoleTee };

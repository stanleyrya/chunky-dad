// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: clock;

// Stale Parsers Widget
// Shows how many bear-event parsers haven't written to calendar recently.
// A parser is "stale" when its last calendar write (create or update) is older
// than the configured threshold (default: 7 days) or has never written at all.
//
// Widget parameter: "days=N" to override the default stale threshold.
// Example: "days=14" makes parsers stale after 14 days.
//
// Tapping a stale-parser row launches bear-event-scraper-unified for that parser.
// Tapping the widget background (or small/lock-screen widgets) opens display-run-metrics.

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
const SCRAPER_SCRIPT = 'bear-event-scraper-unified';
const DISPLAY_METRICS_SCRIPT = 'display-run-metrics';
const DEFAULT_STALE_DAYS = 7;
const FAVICON_CACHE_TTL_DAYS = 14;
const LOGO_CACHE_TTL_DAYS = 7;

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
      widgetParameter: null
    };
    try {
      if (typeof config !== 'undefined') {
        runtime.runsInWidget = !!config.runsInWidget;
        runtime.widgetFamily = config.widgetFamily || null;
      }
      if (typeof args !== 'undefined') {
        runtime.widgetParameter = args.widgetParameter || null;
      }
    } catch (error) {
      console.log(`StaleParsers: Runtime detection failed: ${error.message}`);
    }
    return runtime;
  }

  // ── Parameter parsing ───────────────────────────────────────────────────────

  parseStaleDays(widgetParam) {
    if (!widgetParam) return DEFAULT_STALE_DAYS;
    const raw = String(widgetParam).trim();
    if (!raw) return DEFAULT_STALE_DAYS;
    const tokens = raw.split(/[|;,&?]+/).map(t => t.trim()).filter(Boolean);
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (lower.startsWith('days=')) {
        const val = token.slice(token.indexOf('=') + 1).trim();
        const parsed = Number.parseInt(val, 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
      if (lower.startsWith('days:')) {
        const val = token.slice(token.indexOf(':') + 1).trim();
        const parsed = Number.parseInt(val, 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
    }
    return DEFAULT_STALE_DAYS;
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  async loadMetricsRecords() {
    const path = this.fm.joinPath(this.metricsDir, 'metrics.ndjson');
    if (!this.fm.fileExists(path)) {
      return [];
    }
    try {
      await this.fm.downloadFileFromiCloud(path);
    } catch (error) {
      console.log(`StaleParsers: iCloud download failed: ${error.message}`);
    }
    const content = this.fm.readString(path) || '';
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];

    const records = [];
    lines.forEach(line => {
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

  loadConfiguredParsers() {
    try {
      const scraperConfig = importModule('scraper-input');
      const parsers = Array.isArray(scraperConfig?.parsers) ? scraperConfig.parsers : [];
      return parsers
        .filter(parser => parser && parser.name)
        .map(parser => ({
          name: parser.name,
          iconUrl: parser.iconUrl || parser.faviconUrl || null
        }));
    } catch (error) {
      console.log(`StaleParsers: Could not load scraper-input: ${error.message}`);
      return [];
    }
  }

  // ── Staleness logic ─────────────────────────────────────────────────────────

  getLastCalendarWriteAt(records, parserName) {
    for (let i = records.length - 1; i >= 0; i -= 1) {
      const record = records[i];
      const parserRecords = Array.isArray(record?.parsers) ? record.parsers : [];
      const match = parserRecords.find(pr => pr?.parser_name === parserName);
      if (!match) continue;
      const ca = match.calendar_actions || {};
      if ((ca.create || 0) > 0 || (ca.update || 0) > 0) {
        return record.finished_at || null;
      }
    }
    return null;
  }

  computeStaleStatus(records, configuredParsers, staleDays) {
    const now = Date.now();
    const threshold = staleDays > 0 ? staleDays : DEFAULT_STALE_DAYS;
    const stale = [];
    const upToDate = [];

    configuredParsers.forEach(parser => {
      const lastWriteAt = this.getLastCalendarWriteAt(records, parser.name);
      let daysSince = null;
      let isStale = true;
      if (lastWriteAt) {
        const writeTime = new Date(lastWriteAt).getTime();
        if (Number.isFinite(writeTime) && writeTime > 0) {
          daysSince = (now - writeTime) / (24 * 60 * 60 * 1000);
          isStale = daysSince > threshold;
        }
      }
      const entry = { name: parser.name, iconUrl: parser.iconUrl, daysSince, lastWriteAt };
      if (isStale) {
        stale.push(entry);
      } else {
        upToDate.push(entry);
      }
    });

    return { total: configuredParsers.length, stale, upToDate };
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

  async getParserIcon(iconUrl) {
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

  // ── Formatting helpers ──────────────────────────────────────────────────────

  formatDaysSince(daysSince) {
    if (daysSince === null || daysSince === undefined) return 'never';
    const d = Math.floor(daysSince);
    if (d <= 0) return 'today';
    if (d === 1) return '1d ago';
    return `${d}d ago`;
  }

  truncateText(value, maxLength) {
    const raw = String(value || '');
    if (!Number.isFinite(maxLength) || maxLength <= 0) return raw;
    if (raw.length <= maxLength) return raw;
    return `${raw.slice(0, maxLength - 1)}…`;
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
    const title = header.addText(headerText || 'Stale Parsers');
    title.font = Font.boldSystemFont(family === 'small' ? FONT_SIZES.widget.small : FONT_SIZES.widget.label);
    title.textColor = new Color(BRAND.text);
    title.lineLimit = 1;
    widget.addSpacer(family === 'small' ? 4 : 6);
  }

  // ── Widget renderers ────────────────────────────────────────────────────────

  async renderSmallWidget(status) {
    const widget = new ListWidget();
    widget.backgroundColor = new Color(BRAND.primary);
    widget.setPadding(12, 12, 12, 12);
    widget.url = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT);

    const logoImage = await this.loadLogoImage();

    if (logoImage) {
      const logo = widget.addImage(logoImage);
      logo.imageSize = new Size(24, 24);
      widget.addSpacer(6);
    }

    if (status.stale.length === 0) {
      const check = widget.addText('✓');
      check.font = Font.boldSystemFont(28);
      check.textColor = new Color(BRAND.success);
      check.centerAlignText();
      widget.addSpacer(2);
      const label = widget.addText('All up to date');
      label.font = Font.systemFont(FONT_SIZES.widget.small);
      label.textColor = new Color(BRAND.textMuted);
      label.centerAlignText();
    } else {
      const count = widget.addText(String(status.stale.length));
      count.font = Font.boldSystemFont(32);
      count.textColor = new Color(BRAND.danger);
      count.centerAlignText();
      widget.addSpacer(2);
      const label = widget.addText(status.stale.length === 1 ? 'parser stale' : 'parsers stale');
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
    widget.url = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT);

    const logoImage = await this.loadLogoImage();
    this.addWidgetHeader(widget, logoImage, 'Stale Parsers');

    if (status.stale.length === 0) {
      widget.addSpacer();
      const row = widget.addStack();
      row.centerAlignContent();
      if (logoImage) {
        const img = row.addImage(logoImage);
        img.imageSize = new Size(28, 28);
        row.addSpacer(8);
      }
      const label = row.addText('All up to date! 🐻');
      label.font = Font.boldSystemFont(FONT_SIZES.widget.label);
      label.textColor = new Color(BRAND.success);
      label.lineLimit = 1;
      widget.addSpacer();
      return widget;
    }

    const maxRows = 3;
    const items = status.stale.slice(0, maxRows);

    for (let i = 0; i < items.length; i += 1) {
      if (i > 0) widget.addSpacer(4);
      const parser = items[i];
      const cell = this.addWidgetCell(widget, 'medium');
      cell.url = this.buildScriptableUrl(SCRAPER_SCRIPT, { parserName: parser.name });

      const headerRow = cell.addStack();
      headerRow.layoutHorizontally();
      headerRow.centerAlignContent();
      headerRow.spacing = 4;

      const iconImage = await this.getParserIcon(parser.iconUrl);
      if (iconImage) {
        const icon = headerRow.addImage(iconImage);
        icon.imageSize = new Size(11, 11);
      }

      const nameText = headerRow.addText(this.truncateText(parser.name, 16));
      nameText.font = Font.boldSystemFont(FONT_SIZES.widget.small);
      nameText.textColor = new Color(BRAND.text);
      nameText.lineLimit = 1;

      headerRow.addSpacer();

      const daysBadgeLabel = this.formatDaysSince(parser.daysSince);
      this.addWidgetBadge(headerRow, daysBadgeLabel, BRAND.danger);
    }

    if (status.stale.length > maxRows) {
      widget.addSpacer(4);
      const more = widget.addText(`+${status.stale.length - maxRows} more stale`);
      more.font = Font.systemFont(FONT_SIZES.widget.small);
      more.textColor = new Color(BRAND.textMuted);
    }

    return widget;
  }

  async renderLargeWidget(status) {
    const widget = new ListWidget();
    widget.backgroundColor = new Color(BRAND.primary);
    widget.setPadding(12, 12, 12, 12);
    widget.url = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT);

    const logoImage = await this.loadLogoImage();
    this.addWidgetHeader(widget, logoImage, 'Stale Parsers');

    if (status.stale.length === 0) {
      widget.addSpacer();
      const row = widget.addStack();
      row.centerAlignContent();
      if (logoImage) {
        const img = row.addImage(logoImage);
        img.imageSize = new Size(36, 36);
        row.addSpacer(10);
      }
      const label = row.addText('All up to date! 🐻');
      label.font = Font.boldSystemFont(FONT_SIZES.widget.title);
      label.textColor = new Color(BRAND.success);
      label.lineLimit = 1;
      widget.addSpacer();
    } else {
      const maxRows = 6;
      const items = status.stale.slice(0, maxRows);

      for (let i = 0; i < items.length; i += 1) {
        if (i > 0) widget.addSpacer(4);
        const parser = items[i];
        const cell = this.addWidgetCell(widget, 'large');
        cell.url = this.buildScriptableUrl(SCRAPER_SCRIPT, { parserName: parser.name });

        const headerRow = cell.addStack();
        headerRow.layoutHorizontally();
        headerRow.centerAlignContent();
        headerRow.spacing = 4;

        const iconImage = await this.getParserIcon(parser.iconUrl);
        if (iconImage) {
          const icon = headerRow.addImage(iconImage);
          icon.imageSize = new Size(11, 11);
        }

        const nameText = headerRow.addText(this.truncateText(parser.name, 20));
        nameText.font = Font.boldSystemFont(FONT_SIZES.widget.small);
        nameText.textColor = new Color(BRAND.text);
        nameText.lineLimit = 1;

        headerRow.addSpacer();

        const daysBadgeLabel = this.formatDaysSince(parser.daysSince);
        this.addWidgetBadge(headerRow, daysBadgeLabel, BRAND.danger);

        if (parser.lastWriteAt) {
          const dateText = cell.addText(`Last write: ${this.formatDaysSince(parser.daysSince)}`);
          dateText.font = Font.systemFont(FONT_SIZES.widget.small);
          dateText.textColor = new Color(BRAND.textMuted);
          dateText.lineLimit = 1;
        } else {
          const neverText = cell.addText('Never written to calendar');
          neverText.font = Font.systemFont(FONT_SIZES.widget.small);
          neverText.textColor = new Color(BRAND.textMuted);
          neverText.lineLimit = 1;
        }
      }

      if (status.stale.length > maxRows) {
        widget.addSpacer(4);
        const more = widget.addText(`+${status.stale.length - maxRows} more stale`);
        more.font = Font.systemFont(FONT_SIZES.widget.small);
        more.textColor = new Color(BRAND.textMuted);
      }
    }

    if (status.upToDate.length > 0) {
      widget.addSpacer(6);
      const summaryCell = this.addWidgetCell(widget, 'large');
      const summaryText = summaryCell.addText(`✅ ${status.upToDate.length} up to date`);
      summaryText.font = Font.systemFont(FONT_SIZES.widget.small);
      summaryText.textColor = new Color(BRAND.success);
      summaryText.lineLimit = 1;
    }

    return widget;
  }

  renderAccessoryCircularWidget(status) {
    const widget = new ListWidget();
    widget.url = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT);

    if (status.stale.length === 0) {
      const check = widget.addText('✓');
      check.font = Font.boldSystemFont(20);
      check.textColor = new Color(BRAND.success);
      check.centerAlignText();
    } else {
      const count = widget.addText(String(status.stale.length));
      count.font = Font.boldSystemFont(24);
      count.textColor = new Color(BRAND.danger);
      count.centerAlignText();
      widget.addSpacer(2);
      const label = widget.addText('stale');
      label.font = Font.systemFont(10);
      label.textColor = new Color(BRAND.textMuted);
      label.centerAlignText();
    }

    return widget;
  }

  renderAccessoryRectangularWidget(status) {
    const widget = new ListWidget();
    widget.url = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT);

    const title = widget.addText('Stale Parsers');
    title.font = Font.boldSystemFont(FONT_SIZES.widget.small);
    title.lineLimit = 1;

    widget.addSpacer(2);

    if (status.stale.length === 0) {
      const label = widget.addText('All up to date ✓');
      label.font = Font.systemFont(FONT_SIZES.widget.small);
      label.lineLimit = 1;
    } else {
      const countText = status.stale.length === 1 ? '1 parser stale' : `${status.stale.length} parsers stale`;
      const label = widget.addText(countText);
      label.font = Font.systemFont(FONT_SIZES.widget.small);
      label.lineLimit = 1;

      if (status.stale.length > 0) {
        const firstName = this.truncateText(status.stale[0].name, 18);
        const firstLabel = widget.addText(firstName);
        firstLabel.font = Font.systemFont(10);
        firstLabel.lineLimit = 1;
      }
    }

    return widget;
  }

  renderAccessoryInlineWidget(status) {
    const widget = new ListWidget();
    widget.url = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT);

    if (status.stale.length === 0) {
      const label = widget.addText('Parsers: All up to date');
      label.font = Font.systemFont(FONT_SIZES.widget.small);
      label.lineLimit = 1;
    } else {
      const countText = status.stale.length === 1 ? '1 stale' : `${status.stale.length} stale`;
      const label = widget.addText(`Parsers: ${countText}`);
      label.font = Font.systemFont(FONT_SIZES.widget.small);
      label.lineLimit = 1;
    }

    return widget;
  }

  // ── App-mode (non-widget) display ───────────────────────────────────────────

  async showAppAlert(status, staleDays) {
    const alert = new Alert();
    alert.title = 'Stale Parsers';

    if (status.stale.length === 0) {
      alert.message = `All ${status.total} parsers are up to date (threshold: ${staleDays} days).`;
      alert.addAction('Open Metrics');
      alert.addCancelAction('Dismiss');
      const idx = await alert.present();
      if (idx === 0) {
        const url = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT);
        Safari.open(url);
      }
      return;
    }

    const staleLines = status.stale.map(p => {
      const when = this.formatDaysSince(p.daysSince);
      return `• ${p.name} (${when})`;
    });
    alert.message = [
      `${status.stale.length} of ${status.total} parsers haven't written to calendar in ${staleDays}+ days:`,
      '',
      ...staleLines
    ].join('\n');

    alert.addAction('Open Metrics');
    if (status.stale.length === 1) {
      alert.addAction(`Run ${status.stale[0].name}`);
    } else {
      alert.addAction('Run Stale Parsers…');
    }
    alert.addCancelAction('Dismiss');

    const idx = await alert.present();
    if (idx === 0) {
      const url = this.buildScriptableUrl(DISPLAY_METRICS_SCRIPT);
      Safari.open(url);
    } else if (idx === 1) {
      if (status.stale.length === 1) {
        const url = this.buildScriptableUrl(SCRAPER_SCRIPT, { parserName: status.stale[0].name });
        Safari.open(url);
      } else {
        await this.showParserPicker(status.stale);
      }
    }
  }

  async showParserPicker(staleParsers) {
    const alert = new Alert();
    alert.title = 'Run Stale Parser';
    alert.message = 'Choose a parser to run:';
    staleParsers.forEach(p => {
      const when = this.formatDaysSince(p.daysSince);
      alert.addAction(`${p.name} (${when})`);
    });
    alert.addCancelAction('Cancel');
    const idx = await alert.present();
    if (idx >= 0 && idx < staleParsers.length) {
      const url = this.buildScriptableUrl(SCRAPER_SCRIPT, { parserName: staleParsers[idx].name });
      Safari.open(url);
    }
  }

  // ── Main render dispatcher ──────────────────────────────────────────────────

  async render(status, staleDays) {
    const family = this.runtime.widgetFamily;

    if (family === 'accessoryCircular') {
      return this.renderAccessoryCircularWidget(status);
    }
    if (family === 'accessoryRectangular') {
      return this.renderAccessoryRectangularWidget(status);
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

(async () => {
  try {
    const checker = new StaleParsersChecker();
    const staleDays = checker.parseStaleDays(checker.runtime.widgetParameter);

    console.log(`StaleParsers: Starting (threshold: ${staleDays} days)`);

    const records = await checker.loadMetricsRecords();
    const configuredParsers = checker.loadConfiguredParsers();

    console.log(`StaleParsers: Loaded ${records.length} metric records, ${configuredParsers.length} configured parsers`);

    const status = checker.computeStaleStatus(records, configuredParsers, staleDays);

    console.log(`StaleParsers: ${status.stale.length} stale, ${status.upToDate.length} up to date`);

    if (checker.runtime.runsInWidget) {
      const widget = await checker.render(status, staleDays);
      Script.setWidget(widget);
    } else {
      await checker.showAppAlert(status, staleDays);
    }
  } catch (error) {
    console.log(`StaleParsers: Fatal error: ${error.message}`);

    // Show a minimal error widget so the widget slot doesn't go blank
    if (typeof config !== 'undefined' && config.runsInWidget) {
      try {
        const errWidget = new ListWidget();
        errWidget.backgroundColor = new Color(BRAND.primary);
        errWidget.setPadding(12, 12, 12, 12);
        const errText = errWidget.addText('Stale Parsers\nError loading data');
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
})();

// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: chart-bar;

// Display Run Metrics
// Shows aggregated + per-parser metrics for Scriptable runs.

const BRAND = {
  primary: '#667eea',
  secondary: '#ff6b6b',
  text: '#ffffff'
};

const LOGO_URL = 'https://chunky.dad/favicons/logo-hero.png';
const DISPLAY_SAVED_RUN_SCRIPT = 'display-saved-run';

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

  async loadLatestRecord() {
    const path = this.getMetricsFilePath();
    if (!this.fm.fileExists(path)) {
      return null;
    }

    try {
      await this.fm.downloadFileFromiCloud(path);
    } catch (error) {
      console.log(`Metrics: iCloud download failed: ${error.message}`);
    }

    const content = this.fm.readString(path) || '';
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    if (lines.length === 0) {
      return null;
    }

    let latest = null;
    let latestMs = 0;

    lines.forEach(line => {
      try {
        const record = JSON.parse(line);
        const finishedAt = record?.finished_at ? new Date(record.finished_at).getTime() : null;
        const ts = Number.isFinite(finishedAt) ? finishedAt : 0;
        if (!latest || ts >= latestMs) {
          latest = record;
          latestMs = ts;
        }
      } catch (_) {
        return;
      }
    });

    return latest;
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

  buildParserHealth(latestRecord, configuredParsers) {
    const parserRecords = Array.isArray(latestRecord?.parsers) ? latestRecord.parsers : [];
    const byName = {};
    parserRecords.forEach(record => {
      if (record?.parser_name) {
        byName[record.parser_name] = record;
      }
    });

    const hasConfig = configuredParsers.length > 0;
    const parserNames = hasConfig ? configuredParsers : Object.keys(byName);

    const items = parserNames.map(name => {
      const record = byName[name] || null;
      const actions = record?.actions ? record.actions : this.createActionCounts();
      const totalEvents = record?.total_events || 0;
      const ran = !!record;
      const status = ran
        ? (totalEvents > 0 || this.sumActions(actions) > 0 ? 'ran' : 'ran-empty')
        : 'not-run';
      return {
        name,
        ran,
        status,
        totalEvents,
        finalBearEvents: record?.final_bear_events || 0,
        durationMs: record?.duration_ms || null,
        actions
      };
    });

    return {
      hasConfig,
      configuredCount: configuredParsers.length,
      ranCount: parserRecords.length,
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
    if (parts.length === 0) return 'none';
    return parts.join(', ');
  }

  buildScriptableUrl(scriptName, params = {}) {
    const base = `scriptable:///run?scriptName=${encodeURIComponent(scriptName)}`;
    const query = Object.keys(params)
      .filter(key => params[key] !== undefined && params[key] !== null)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    return query ? `${base}&${query}` : base;
  }

  parseViewParam(param) {
    if (!param) return null;
    const raw = String(param).trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (lower.startsWith('parser:')) {
      const parserName = raw.slice('parser:'.length).trim();
      return parserName ? { mode: 'parser', parserName } : { mode: 'parsers' };
    }
    if (lower === 'parsers' || lower === 'parser-health') return { mode: 'parsers' };
    if (lower === 'aggregate' || lower === 'summary' || lower === 'totals') return { mode: 'aggregate' };
    if (lower === 'overview' || lower === 'last-run') return { mode: 'overview' };
    return { mode: 'overview' };
  }

  async resolveView() {
    const paramView = this.parseViewParam(this.runtime.widgetParameter);
    if (paramView) return paramView;
    if (this.runtime.runsInWidget) return { mode: 'overview' };

    const alert = new Alert();
    alert.title = 'Metrics View';
    alert.message = 'Choose a view';
    alert.addAction('Overview');
    alert.addAction('Parser health');
    alert.addAction('Aggregate totals');
    alert.addCancelAction('Cancel');
    const idx = await alert.present();
    if (idx === 1) return { mode: 'parsers' };
    if (idx === 2) return { mode: 'aggregate' };
    return { mode: 'overview' };
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
      image.imageSize = new Size(22, 22);
    }
    const title = header.addText('Chunky Dad Metrics');
    title.font = Font.boldSystemFont(12);
    title.textColor = new Color(BRAND.text);
    widget.addSpacer(6);
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
    const maxRows = this.getWidgetMaxRows();

    if (!latest && view.mode !== 'aggregate') {
      const message = widget.addText('No metrics found yet.');
      message.font = Font.systemFont(12);
      message.textColor = new Color(BRAND.text);
      return widget;
    }

    if (view.mode === 'overview') {
      const lastRun = latest?.finished_at ? this.formatRelativeTime(latest.finished_at) : 'Unknown';
      const duration = this.formatDuration(latest?.duration_ms);
      const status = latest?.status || 'unknown';
      const header = widget.addText(`Last run: ${lastRun} (${duration})`);
      header.font = Font.systemFont(12);
      header.textColor = new Color(BRAND.text);

      const issues = widget.addText(`Status: ${status} | Errors: ${latest?.errors_count || 0} | Warnings: ${latest?.warnings_count || 0}`);
      issues.font = Font.systemFont(11);
      issues.textColor = new Color(BRAND.text);

      const totals = latest?.totals || {};
      const eventsLine = `Events: final ${this.formatNumber(totals.final_bear_events || 0)} | calendar ${this.formatNumber(totals.calendar_events || 0)}`;
      const eventsText = widget.addText(eventsLine);
      eventsText.font = Font.systemFont(11);
      eventsText.textColor = new Color(BRAND.text);

      if (maxRows >= 4) {
        const actionsText = widget.addText(`Actions: ${this.formatActions(latest?.actions)}`);
        actionsText.font = Font.systemFont(11);
        actionsText.textColor = new Color(BRAND.text);
      }
    } else if (view.mode === 'parsers') {
      const parserLine = parserHealth.hasConfig
        ? `Parsers run: ${parserHealth.ranCount} / ${parserHealth.configuredCount}`
        : `Parsers run: ${parserHealth.ranCount}`;
      const parserText = widget.addText(parserLine);
      parserText.font = Font.systemFont(12);
      parserText.textColor = new Color(BRAND.text);

      const items = parserHealth.items.slice(0, maxRows);
      items.forEach(item => {
        const statusLabel = item.ran ? (item.totalEvents > 0 ? 'ran' : 'ran (0)') : 'not run';
        const line = `${item.name}: ${statusLabel} | events ${this.formatNumber(item.finalBearEvents)}`;
        const row = widget.addText(line);
        row.font = Font.systemFont(11);
        row.textColor = new Color(BRAND.text);
      });

      if (parserHealth.items.length > items.length) {
        const more = widget.addText(`+${parserHealth.items.length - items.length} more`);
        more.font = Font.systemFont(10);
        more.textColor = new Color(BRAND.text);
      }
    } else if (view.mode === 'parser') {
      const record = parserHealth.items.find(item => item.name === view.parserName);
      const title = widget.addText(`Parser: ${view.parserName}`);
      title.font = Font.systemFont(12);
      title.textColor = new Color(BRAND.text);

      if (!record || !record.ran) {
        const none = widget.addText('Not run in last run.');
        none.font = Font.systemFont(11);
        none.textColor = new Color(BRAND.text);
      } else {
        const stats = widget.addText(`Events: ${this.formatNumber(record.finalBearEvents)} | Duration: ${this.formatDuration(record.durationMs)}`);
        stats.font = Font.systemFont(11);
        stats.textColor = new Color(BRAND.text);
        const actions = widget.addText(`Actions: ${this.formatActions(record.actions)}`);
        actions.font = Font.systemFont(11);
        actions.textColor = new Color(BRAND.text);
      }
    } else if (view.mode === 'aggregate') {
      if (!summary?.totals) {
        const message = widget.addText('No summary metrics yet.');
        message.font = Font.systemFont(12);
        message.textColor = new Color(BRAND.text);
      } else {
        const totals = summary.totals;
        const runsLine = `Runs: ${this.formatNumber(totals.runs || 0)} | Success: ${totals.statuses?.success || 0}`;
        const runsText = widget.addText(runsLine);
        runsText.font = Font.systemFont(12);
        runsText.textColor = new Color(BRAND.text);
        const eventsLine = `Final events: ${this.formatNumber(totals.totals?.final_bear_events || 0)}`;
        const eventsText = widget.addText(eventsLine);
        eventsText.font = Font.systemFont(11);
        eventsText.textColor = new Color(BRAND.text);
        if (maxRows >= 4) {
          const actionsText = widget.addText(`Actions: ${this.formatActions(totals.actions)}`);
          actionsText.font = Font.systemFont(11);
          actionsText.textColor = new Color(BRAND.text);
        }
      }
    }

    if (latest?.run_id) {
      widget.url = this.buildScriptableUrl(DISPLAY_SAVED_RUN_SCRIPT, {
        runId: latest.run_id,
        readOnly: true
      });
    }

    return widget;
  }

  async renderAppTable(data, view) {
    const table = new UITable();
    table.backgroundColor = new Color(BRAND.primary);
    table.showSeparators = true;

    const logoImage = await this.loadLogoImage();
    const header = new UITableRow();
    header.backgroundColor = new Color(BRAND.primary);
    if (logoImage) {
      const img = header.addImage(logoImage);
      img.imageSize = new Size(28, 28);
    }
    const titleCell = header.addText('Chunky Dad Metrics', 'Scriptable run metrics');
    titleCell.titleFont = Font.boldSystemFont(16);
    titleCell.titleColor = new Color(BRAND.text);
    titleCell.subtitleFont = Font.systemFont(12);
    titleCell.subtitleColor = new Color(BRAND.text);
    table.addRow(header);

    const latest = data.latestRecord;
    const summary = data.summary;
    const parserHealth = data.parserHealth;

    if (!latest && view.mode !== 'aggregate') {
      const row = new UITableRow();
      row.backgroundColor = new Color(BRAND.primary);
      const cell = row.addText('No metrics found yet.', 'Run the scraper to generate metrics.');
      cell.titleColor = new Color(BRAND.text);
      cell.subtitleColor = new Color(BRAND.text);
      table.addRow(row);
      await table.present();
      return;
    }

    if (view.mode === 'overview') {
      this.addSectionHeader(table, 'Last run');
      const lastRun = latest?.finished_at ? this.formatRelativeTime(latest.finished_at) : 'Unknown';
      const duration = this.formatDuration(latest?.duration_ms);
      this.addInfoRow(table, `Last run: ${lastRun}`, `Duration: ${duration}`);
      this.addInfoRow(
        table,
        `Status: ${latest?.status || 'unknown'}`,
        `Errors: ${latest?.errors_count || 0} | Warnings: ${latest?.warnings_count || 0}`
      );

      const totals = latest?.totals || {};
      this.addInfoRow(
        table,
        `Events: final ${this.formatNumber(totals.final_bear_events || 0)}`,
        `Calendar events: ${this.formatNumber(totals.calendar_events || 0)}`
      );
      this.addInfoRow(table, 'Actions', this.formatActions(latest?.actions));

      this.addSectionHeader(table, 'Parsers');
      const parserLine = parserHealth.hasConfig
        ? `Parsers run: ${parserHealth.ranCount} / ${parserHealth.configuredCount}`
        : `Parsers run: ${parserHealth.ranCount}`;
      this.addInfoRow(table, parserLine, parserHealth.hasConfig ? 'Not run parsers are listed as not run.' : 'Showing parsers from last run.');

      const items = parserHealth.items.slice(0, 10);
      items.forEach(item => {
        const statusLabel = item.ran ? (item.totalEvents > 0 ? 'ran' : 'ran (0)') : 'not run';
        const subtitle = item.ran
          ? `Events: ${this.formatNumber(item.finalBearEvents)} | Actions: ${this.formatActions(item.actions)}`
          : 'No run data for latest run.';
        this.addInfoRow(table, `${item.name}: ${statusLabel}`, subtitle);
      });
      if (parserHealth.items.length > items.length) {
        this.addInfoRow(table, `+${parserHealth.items.length - items.length} more parsers`, 'Run with a widget parameter to focus on a parser.');
      }
    } else if (view.mode === 'parsers') {
      this.addSectionHeader(table, 'Parser health');
      const parserLine = parserHealth.hasConfig
        ? `Parsers run: ${parserHealth.ranCount} / ${parserHealth.configuredCount}`
        : `Parsers run: ${parserHealth.ranCount}`;
      this.addInfoRow(table, parserLine, parserHealth.hasConfig ? 'Not run is neutral.' : 'Showing parsers from last run.');
      parserHealth.items.forEach(item => {
        const statusLabel = item.ran ? (item.totalEvents > 0 ? 'ran' : 'ran (0)') : 'not run';
        const subtitle = item.ran
          ? `Events: ${this.formatNumber(item.finalBearEvents)} | Actions: ${this.formatActions(item.actions)}`
          : 'No run data for latest run.';
        this.addInfoRow(table, `${item.name}: ${statusLabel}`, subtitle);
      });
    } else if (view.mode === 'aggregate') {
      this.addSectionHeader(table, 'Aggregated totals');
      if (!summary?.totals) {
        this.addInfoRow(table, 'No summary metrics found.', 'Run the scraper to generate summary metrics.');
      } else {
        const totals = summary.totals;
        this.addInfoRow(table, `Runs: ${this.formatNumber(totals.runs || 0)}`, `Success: ${totals.statuses?.success || 0} | Partial: ${totals.statuses?.partial || 0} | Failed: ${totals.statuses?.failed || 0}`);
        this.addInfoRow(
          table,
          `Final bear events: ${this.formatNumber(totals.totals?.final_bear_events || 0)}`,
          `Calendar events: ${this.formatNumber(totals.totals?.calendar_events || 0)}`
        );
        this.addInfoRow(table, 'Actions', this.formatActions(totals.actions));

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
        this.addInfoRow(table, `Events: ${this.formatNumber(record.finalBearEvents)}`, `Duration: ${this.formatDuration(record.durationMs)}`);
        this.addInfoRow(table, 'Actions', this.formatActions(record.actions));
      }
    }

    if (latest?.run_id) {
      const linkRow = new UITableRow();
      linkRow.backgroundColor = new Color(BRAND.secondary);
      const linkCell = linkRow.addText('Open last run details', `Run ID: ${latest.run_id}`);
      linkCell.titleColor = new Color('#ffffff');
      linkCell.subtitleColor = new Color('#ffffff');
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

  addSectionHeader(table, title) {
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);
    const text = row.addText(title);
    text.titleFont = Font.boldSystemFont(14);
    text.titleColor = new Color(BRAND.text);
    table.addRow(row);
  }

  addInfoRow(table, title, subtitle) {
    const row = new UITableRow();
    row.backgroundColor = new Color(BRAND.primary);
    const cell = row.addText(title, subtitle);
    cell.titleFont = Font.systemFont(13);
    cell.subtitleFont = Font.systemFont(11);
    cell.titleColor = new Color(BRAND.text);
    cell.subtitleColor = new Color(BRAND.text);
    table.addRow(row);
  }
}

async function runMetricsDisplay() {
  const display = new MetricsDisplay();
  await display.ensureDirs();

  const latestRecord = await display.loadLatestRecord();
  const summary = await display.loadSummary();
  const configuredParsers = display.getConfiguredParsers();
  const parserHealth = display.buildParserHealth(latestRecord, configuredParsers);
  const data = { latestRecord, summary, parserHealth };

  const view = await display.resolveView();

  if (display.runtime.runsInWidget) {
    const widget = await display.renderWidget(data, view);
    Script.setWidget(widget);
  } else {
    await display.renderAppTable(data, view);
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

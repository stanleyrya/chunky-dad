// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: broom;

// Page Cache Maintenance
// Admin script for reviewing and pruning downloaded website cache files.

const BRAND = {
  primary: '#667eea',
  secondary: '#ff6b6b',
  text: '#ffffff',
  textMuted: '#e6ebff',
  textSoft: '#f5f7ff',
  success: '#2ed573',
  warning: '#feca57',
  danger: '#ff6b6b',
  neutral: '#a7b0cc',
  dark: '#111827'
};

const FONT_SIZES = {
  widget: {
    title: 13,
    label: 12,
    small: 11,
    metric: 24
  }
};

const LOGO_URL = 'https://chunky.dad/favicons/logo-hero.png';
const LOGO_CACHE_TTL_DAYS = 7;
const DEFAULT_PRUNE_DAYS = 7;
const QUICK_DAY_OPTIONS = [3, 7, 14, 30, 60];
const MAX_HOST_ROWS = 40;

class PageCacheMaintenance {
  constructor() {
    this.fm = FileManager.iCloud();
    const documentsDir = this.fm.documentsDirectory();
    this.baseDir = this.fm.joinPath(documentsDir, 'chunky-dad-scraper');
    this.storageDir = this.fm.joinPath(this.baseDir, 'storage');
    this.pageStorageDir = this.fm.joinPath(this.storageDir, 'pages');
    this.ocrStorageDir = this.fm.joinPath(this.storageDir, 'ocr');
    this.cacheScopes = [
      {
        key: 'pages',
        label: 'Page cache',
        dir: this.pageStorageDir,
        footerLabel: 'storage/pages'
      },
      {
        key: 'ocr',
        label: 'OCR cache',
        dir: this.ocrStorageDir,
        footerLabel: 'storage/ocr'
      }
    ];
    this.cacheDir = this.fm.joinPath(this.baseDir, 'cache');
    this.runtime = this.getRuntimeContext();
  }

  getCacheScopeFooterSummary(separator = ' and ') {
    return this.cacheScopes.map(scope => scope.footerLabel).join(separator);
  }

  getCacheScopeDirectorySummary(separator = '\n') {
    return this.cacheScopes.map(scope => scope.dir).join(separator);
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
      console.log(`PageCacheMaintenance: Runtime detection failed: ${error.message}`);
    }
    return runtime;
  }

  getConfiguredDefaultDays() {
    try {
      const scraperConfig = importModule('scraper-input');
      const raw = scraperConfig?.config?.pageCache?.ttlDays;
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    } catch (error) {
      console.log(`PageCacheMaintenance: Could not load scraper-input: ${error.message}`);
    }
    return DEFAULT_PRUNE_DAYS;
  }

  parseDaysValue(value) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (Number.isNaN(parsed) || parsed <= 0) return null;
    return parsed;
  }

  parseDaysParameter(rawValue) {
    if (!rawValue) return null;
    const raw = String(rawValue).trim();
    if (!raw) return null;
    const direct = this.parseDaysValue(raw);
    if (direct) return direct;
    const tokens = raw.split(/[|;,&?]+/).map(token => token.trim()).filter(Boolean);
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (lower.startsWith('days=')) {
        const parsed = this.parseDaysValue(token.slice(token.indexOf('=') + 1));
        if (parsed) return parsed;
      }
      if (lower.startsWith('days:')) {
        const parsed = this.parseDaysValue(token.slice(token.indexOf(':') + 1));
        if (parsed) return parsed;
      }
    }
    return null;
  }

  getSelectedDays() {
    const queryDays = this.parseDaysParameter(this.runtime.queryParameters?.days);
    if (queryDays) return queryDays;
    const widgetDays = this.parseDaysParameter(this.runtime.widgetParameter);
    if (widgetDays) return widgetDays;
    return this.getConfiguredDefaultDays();
  }

  parseBoolean(value) {
    if (value === true || value === false) return value;
    const normalized = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
  }

  getActionFromQuery() {
    const action = this.runtime.queryParameters?.action || null;
    return action ? String(action).trim().toLowerCase() : null;
  }

  getModelFromQuery() {
    const model = this.runtime.queryParameters?.model || null;
    return model ? String(model).trim() : null;
  }

  ensureCacheDir() {
    if (!this.fm.fileExists(this.cacheDir)) {
      this.fm.createDirectory(this.cacheDir, true);
    }
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
      console.log(`PageCacheMaintenance: Logo cache read failed: ${error.message}`);
    }
    try {
      this.ensureCacheDir();
      const request = new Request(LOGO_URL);
      request.timeoutInterval = 15;
      const image = await request.loadImage();
      if (image) {
        this.fm.writeImage(cachePath, image);
      }
      return image;
    } catch (error) {
      console.log(`PageCacheMaintenance: Logo download failed: ${error.message}`);
      return null;
    }
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

  escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  formatTimestamp(value) {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleString();
  }

  formatAgeDays(ageDays) {
    if (!Number.isFinite(ageDays) || ageDays < 0) return 'unknown';
    if (ageDays < 1) return 'today';
    if (ageDays < 2) return '1 day';
    return `${Math.floor(ageDays)} days`;
  }

  formatFileDate(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return 'unknown';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  buildScriptableUrl(scriptName, params) {
    const base = `scriptable:///run?scriptName=${encodeURIComponent(scriptName)}`;
    if (!params || Object.keys(params).length === 0) return base;
    const query = Object.keys(params)
      .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    return query ? `${base}&${query}` : base;
  }

  getSelfScriptName() {
    try {
      if (typeof Script !== 'undefined' && typeof Script.name === 'function') {
        return Script.name();
      }
    } catch (_) {}
    return 'page-cache-maintenance';
  }

  buildSelfUrl(params) {
    return this.buildScriptableUrl(this.getSelfScriptName(), params);
  }

  async listDirectoryEntries(path) {
    if (!this.fm.fileExists(path)) return [];
    try {
      try {
        await this.fm.downloadFileFromiCloud(path);
      } catch (_) {}
      return this.fm.listContents(path) || [];
    } catch (error) {
      console.log(`PageCacheMaintenance: Could not list ${path}: ${error.message}`);
      return [];
    }
  }

  parseOcrCacheFileName(fileName) {
    const match = String(fileName || '').match(/--ocr-([a-z0-9]+)\.json$/);
    if (!match) return null;
    return match[1];
  }

  async readOcrCacheFile(filePath) {
    try {
      await this.fm.downloadFileFromiCloud(filePath);
      const content = this.fm.readString(filePath);
      return JSON.parse(content);
    } catch (_) {
      return null;
    }
  }

  async analyzeHostDirectory(hostName, hostPath, thresholdMs, nowMs, scope = null) {
    const entryNames = await this.listDirectoryEntries(hostPath);
    const files = [];
    let oldFileCount = 0;
    let recentFileCount = 0;
    let oldestDate = null;
    let newestDate = null;

    for (const entryName of entryNames) {
      const entryPath = this.fm.joinPath(hostPath, entryName);
      let isDirectory = false;
      try {
        isDirectory = this.fm.isDirectory(entryPath);
      } catch (_) {
        isDirectory = false;
      }
      if (isDirectory || !String(entryName).toLowerCase().endsWith('.json')) continue;

      let modifiedAt = null;
      try {
        modifiedAt = this.fm.modificationDate(entryPath);
      } catch (_) {
        modifiedAt = null;
      }
      const modifiedMs = modifiedAt && Number.isFinite(modifiedAt.getTime()) ? modifiedAt.getTime() : null;
      const ageMs = modifiedMs ? Math.max(0, nowMs - modifiedMs) : null;
      const ageDays = ageMs === null ? null : ageMs / (24 * 60 * 60 * 1000);
      const isOld = ageMs !== null && ageMs > thresholdMs;

      // Read OCR cache metadata for model info
      let cacheData = null;
      let modelName = null;
      let imageUrl = null;
      if (scope && scope.key === 'ocr') {
        cacheData = await this.readOcrCacheFile(entryPath);
        if (cacheData) {
          modelName = cacheData?.request?.model || 'unknown';
          imageUrl = cacheData?.url || null;
        }
      }

      if (isOld) {
        oldFileCount += 1;
      } else {
        recentFileCount += 1;
      }

      if (modifiedAt && (!oldestDate || modifiedAt.getTime() < oldestDate.getTime())) {
        oldestDate = modifiedAt;
      }
      if (modifiedAt && (!newestDate || modifiedAt.getTime() > newestDate.getTime())) {
        newestDate = modifiedAt;
      }

      files.push({
        name: entryName,
        path: entryPath,
        modifiedAt,
        ageDays,
        isOld,
        modelName,
        imageUrl
      });
    }

    files.sort((left, right) => {
      const leftAge = Number.isFinite(left.ageDays) ? left.ageDays : -1;
      const rightAge = Number.isFinite(right.ageDays) ? right.ageDays : -1;
      if (rightAge !== leftAge) return rightAge - leftAge;
      return String(left.name).localeCompare(String(right.name));
    });

    return {
      scopeKey: scope && scope.key ? scope.key : 'pages',
      scopeLabel: scope && scope.label ? scope.label : 'Page cache',
      hostName,
      hostPath,
      totalFileCount: files.length,
      oldFileCount,
      recentFileCount,
      oldestDate,
      newestDate,
      removableAfterPrune: recentFileCount === 0,
      files
    };
  }

  async analyzeCacheScope(scope, days) {
    const nowMs = Date.now();
    const thresholdMs = days * 24 * 60 * 60 * 1000;
    const rootEntries = await this.listDirectoryEntries(scope.dir);

    const hostPromises = rootEntries.map(async entryName => {
      const entryPath = this.fm.joinPath(scope.dir, entryName);
      let isDirectory = false;
      try {
        isDirectory = this.fm.isDirectory(entryPath);
      } catch (_) {
        isDirectory = false;
      }
      if (!isDirectory) return null;
      return this.analyzeHostDirectory(entryName, entryPath, thresholdMs, nowMs, scope);
    });

    const hosts = (await Promise.all(hostPromises)).filter(Boolean);

    // Filter by model if specified
    const modelFilter = this.getModelFromQuery();
    if (modelFilter) {
      for (const host of hosts) {
        host.files = host.files?.filter(file => file?.modelName === modelFilter);
      }
      hosts.forEach(host => {
        host.totalFileCount = host.files?.length || 0;
        host.oldFileCount = host.files?.filter(f => f?.isOld).length || 0;
        host.recentFileCount = host.files?.filter(f => !f?.isOld).length || 0;
      });
    }

    hosts.sort((left, right) => {
      if (right.oldFileCount !== left.oldFileCount) return right.oldFileCount - left.oldFileCount;
      if (right.totalFileCount !== left.totalFileCount) return right.totalFileCount - left.totalFileCount;
      return String(left.hostName).localeCompare(String(right.hostName));
    });

    return {
      key: scope.key,
      label: scope.label,
      dir: scope.dir,
      exists: this.fm.fileExists(scope.dir),
      hostCount: hosts.length,
      totalFileCount: hosts.reduce((sum, host) => sum + host.totalFileCount, 0),
      oldFileCount: hosts.reduce((sum, host) => sum + host.oldFileCount, 0),
      recentFileCount: hosts.reduce((sum, host) => sum + host.recentFileCount, 0),
      removableHostCount: hosts.filter(host => host.removableAfterPrune).length,
      hosts
    };
  }

  async analyzePageCache(days) {
    const scopePromises = this.cacheScopes.map(scope => this.analyzeCacheScope(scope, days));
    const scopes = await Promise.all(scopePromises);
    const hosts = scopes.reduce((allHosts, scope) => allHosts.concat(scope.hosts), []);
    hosts.sort((left, right) => {
      if (right.oldFileCount !== left.oldFileCount) return right.oldFileCount - left.oldFileCount;
      if (right.totalFileCount !== left.totalFileCount) return right.totalFileCount - left.totalFileCount;
      if (String(left.scopeLabel) !== String(right.scopeLabel)) {
        return String(left.scopeLabel).localeCompare(String(right.scopeLabel));
      }
      return String(left.hostName).localeCompare(String(right.hostName));
    });

    return {
      generatedAt: new Date(),
      days,
      exists: scopes.some(scope => scope.exists),
      cacheScopes: scopes,
      hostCount: hosts.length,
      totalFileCount: hosts.reduce((sum, host) => sum + host.totalFileCount, 0),
      oldFileCount: hosts.reduce((sum, host) => sum + host.oldFileCount, 0),
      recentFileCount: hosts.reduce((sum, host) => sum + host.recentFileCount, 0),
      removableHostCount: hosts.filter(host => host.removableAfterPrune).length,
      hosts
    };
  }

  async confirmPrune(analysis, deleteHosts) {
    const alert = new Alert();
    alert.title = deleteHosts ? 'Delete old files + empty hosts?' : 'Delete old files?';
    const messageLines = [
      `${analysis.oldFileCount} file(s) are older than ${analysis.days} day(s).`
    ];
    if (deleteHosts) {
      messageLines.push(`${analysis.removableHostCount} host folder(s) can be removed if empty after pruning.`);
    }
    messageLines.push('');
    messageLines.push(`This only touches cache files under ${this.getCacheScopeFooterSummary()}.`);
    alert.message = messageLines.join('\n');
    alert.addAction(deleteHosts ? 'Delete files + hosts' : 'Delete files');
    alert.addCancelAction('Cancel');
    const idx = await alert.present();
    return idx === 0;
  }

  pruneFiles(analysis, deleteHosts) {
    const deletedFiles = [];
    const deletedHosts = [];
    const failures = [];

    analysis.hosts.forEach(host => {
      host.files.forEach(file => {
        if (!file.isOld) return;
        try {
          this.fm.remove(file.path);
          deletedFiles.push(file.path);
        } catch (error) {
          failures.push(`File ${file.path}: ${error.message}`);
        }
      });

      if (!deleteHosts) return;
      try {
        const remainingEntries = this.listDirectoryEntries(host.hostPath);
        if (remainingEntries.length === 0) {
          this.fm.remove(host.hostPath);
          deletedHosts.push(host.hostName);
        }
      } catch (error) {
        failures.push(`Host ${host.hostPath}: ${error.message}`);
      }
    });

    return {
      days: analysis.days,
      deleteHosts,
      deletedFileCount: deletedFiles.length,
      deletedHostCount: deletedHosts.length,
      deletedFiles,
      deletedHosts,
      failures,
      generatedAt: new Date()
    };
  }

  async maybeRunAction(days) {
    const action = this.getActionFromQuery();
    if (action !== 'prune') return null;

    const deleteHosts = this.parseBoolean(
      this.runtime.queryParameters?.deleteHosts || this.runtime.queryParameters?.pruneHosts
    );
    const analysis = await this.analyzePageCache(days);
    if (analysis.oldFileCount === 0 && (!deleteHosts || analysis.removableHostCount === 0)) {
      return {
        days,
        deleteHosts,
        deletedFileCount: 0,
        deletedHostCount: 0,
        deletedFiles: [],
        deletedHosts: [],
        failures: [],
        generatedAt: new Date(),
        skipped: true
      };
    }

    const confirmed = await this.confirmPrune(analysis, deleteHosts);
    if (!confirmed) {
      return {
        days,
        deleteHosts,
        cancelled: true,
        deletedFileCount: 0,
        deletedHostCount: 0,
        failures: [],
        generatedAt: new Date()
      };
    }

    return this.pruneFiles(analysis, deleteHosts);
  }

  buildResultMessage(result) {
    if (!result) return '';
    if (result.cancelled) return 'Cleanup cancelled.';
    if (result.skipped) return 'Nothing matched the selected cleanup settings.';
    const parts = [`Deleted ${result.deletedFileCount} old file(s)`];
    if (result.deleteHosts) {
      parts.push(`removed ${result.deletedHostCount} empty host folder(s)`);
    }
    if (Array.isArray(result.failures) && result.failures.length > 0) {
      parts.push(`${result.failures.length} failure(s)`);
    }
    return `${parts.join(', ')}.`;
  }

  renderOcrFilesTable(ocrFiles) {
    if (!ocrFiles || ocrFiles.length === 0) {
      return `<div class="empty-card">No OCR cache files found.</div>`;
    }

    const renderOcrFileRows = (files) => {
      return files.map(file => {
        const modelBadge = file.modelName
          ? `<span class="badge neutral" style="background: rgba(167,176,204,0.20); color: #cfd5e8;">${this.escapeHtml(file.modelName || 'unknown')}</span>`
          : '';
        const imagePreview = file.imageUrl
          ? `<a href="${this.escapeHtml(file.imageUrl)}" target="_blank" style="display:inline-block; width: 60px; height: 60px; border-radius: 8px; overflow: hidden; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);">
              <img src="${this.escapeHtml(file.imageUrl)}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy">
            </a>`
          : '';
        const fileDate = this.formatFileDate(file.modifiedAt);
        const fileAge = this.formatAgeDays(file.ageDays);
        const fileMeta = [
          `Age: ${this.escapeHtml(fileAge)}`,
          `Modified: ${this.escapeHtml(fileDate)}`
        ].join(' • ');
        return `
          <tr>
            <td style="min-width: 200px;">
              <div style="font-weight: 500;">${this.escapeHtml(file.name)}</div>
              <div style="color: var(--muted); font-size: 11px; margin-top: 4px;">${this.escapeHtml(file.imageUrl || 'No image URL')}</div>
            </td>
            <td style="min-width: 100px;">${modelBadge}</td>
            <td style="min-width: 80px;">${imagePreview}</td>
            <td style="color: var(--muted); font-size: 13px;">${this.escapeHtml(fileMeta)}</td>
          </tr>
        `;
      }).join('');
    };

    return `
      <div class="panel">
        <h2>OCR Cache Files</h2>
        <div class="helper">Files stored for image OCR processing. Click image thumbnail to view full size.</div>
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Model</th>
              <th>Preview</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            ${renderOcrFileRows(ocrFiles)}
          </tbody>
        </table>
      </div>
    `;
  }

  async buildAppHtml(analysis, result) {
    const logoImage = await this.loadLogoImage();
    const logoDataUri = this.imageToDataUri(logoImage);
    const resultMessage = this.buildResultMessage(result);
    const days = analysis.days;
    const dayChips = QUICK_DAY_OPTIONS.map(option => {
      const activeClass = option === days ? 'chip active' : 'chip';
      const href = this.escapeHtml(this.buildSelfUrl({ days: option }));
      return `<a class="${activeClass}" href="${href}">${this.escapeHtml(option)}d</a>`;
    }).join('');

    const pruneHref = this.escapeHtml(this.buildSelfUrl({ action: 'prune', days }));
    const pruneHostsHref = this.escapeHtml(this.buildSelfUrl({ action: 'prune', days, deleteHosts: 1 }));
    const refreshHref = this.escapeHtml(this.buildSelfUrl({ days }));

    const hostRows = analysis.hosts
      .filter(host => host.totalFileCount > 0 || host.removableAfterPrune)
      .slice(0, MAX_HOST_ROWS)
      .map(host => {
        const hostStatus = host.oldFileCount > 0
          ? `${this.formatNumber(host.oldFileCount)} old • ${this.formatNumber(host.recentFileCount)} recent`
          : `${this.formatNumber(host.recentFileCount)} recent`;
        const hostMeta = [
          this.escapeHtml(host.scopeLabel),
          `Total ${this.formatNumber(host.totalFileCount)}`,
          `Oldest ${this.escapeHtml(this.formatFileDate(host.oldestDate))}`,
          `Newest ${this.escapeHtml(this.formatFileDate(host.newestDate))}`,
          host.removableAfterPrune ? 'Folder removable after prune' : 'Keeps recent files'
        ].join(' • ');
        return `
          <tr>
            <td>${this.escapeHtml(host.hostName)}<br><span style="color: var(--muted); font-size: 12px;">${this.escapeHtml(host.scopeLabel)}</span></td>
            <td><span class="badge ${host.oldFileCount > 0 ? 'danger' : 'success'}">${this.escapeHtml(hostStatus)}</span></td>
            <td>${hostMeta}</td>
          </tr>
        `;
      }).join('');

    const emptyState = !analysis.exists
      ? `<div class="empty-card">No cache directories exist yet.<br><span>${this.escapeHtml(this.getCacheScopeDirectorySummary())}</span></div>`
      : (analysis.totalFileCount === 0
        ? `<div class="empty-card">No cached files found.<br><span>${this.escapeHtml(this.getCacheScopeDirectorySummary())}</span></div>`
        : '');

    return `<!doctype html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cache Maintenance</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f172a;
      --card: rgba(255,255,255,0.08);
      --card-strong: rgba(255,255,255,0.12);
      --text: ${BRAND.text};
      --muted: ${BRAND.textMuted};
      --primary: ${BRAND.primary};
      --success: ${BRAND.success};
      --warning: ${BRAND.warning};
      --danger: ${BRAND.danger};
      --neutral: ${BRAND.neutral};
      --shadow: 0 18px 50px rgba(15, 23, 42, 0.45);
      --radius: 20px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      background:
        radial-gradient(circle at top right, rgba(102,126,234,0.38), transparent 30%),
        linear-gradient(180deg, #111827 0%, var(--bg) 100%);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif;
    }
    .shell {
      max-width: 980px;
      margin: 0 auto;
      display: grid;
      gap: 18px;
    }
    .hero, .panel, .notice, .empty-card {
      background: var(--card);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      backdrop-filter: blur(14px);
    }
    .hero {
      padding: 22px 24px;
      display: flex;
      gap: 18px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
    }
    .hero-main {
      display: flex;
      gap: 16px;
      align-items: center;
      min-width: 0;
    }
    .logo {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      background: rgba(255,255,255,0.12);
      object-fit: cover;
      flex: 0 0 auto;
    }
    .hero h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.1;
    }
    .subtitle {
      margin-top: 6px;
      color: var(--muted);
      font-size: 15px;
    }
    .meta {
      color: var(--muted);
      font-size: 13px;
      text-align: right;
    }
    .notice {
      padding: 16px 18px;
      border-color: rgba(46, 213, 115, 0.25);
      background: rgba(46, 213, 115, 0.12);
    }
    .notice.warning {
      border-color: rgba(254, 202, 87, 0.25);
      background: rgba(254, 202, 87, 0.14);
    }
    .controls {
      display: grid;
      gap: 14px;
    }
    .chip-row, .button-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .chip, .button {
      text-decoration: none;
      color: var(--text);
      border-radius: 999px;
      padding: 10px 14px;
      font-weight: 600;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.06);
    }
    .chip.active {
      background: rgba(102,126,234,0.28);
      border-color: rgba(102,126,234,0.42);
    }
    .button.primary { background: rgba(102,126,234,0.28); }
    .button.danger { background: rgba(255,107,107,0.22); }
    .button.warning { background: rgba(254,202,87,0.20); color: #fff7da; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 14px;
    }
    .stat {
      padding: 18px;
      background: var(--card-strong);
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .stat-label {
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 8px;
    }
    .stat-value {
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
    }
    .panel {
      padding: 18px;
    }
    .panel h2 {
      margin: 0 0 14px 0;
      font-size: 20px;
    }
    .helper {
      color: var(--muted);
      font-size: 14px;
      margin-top: -6px;
      margin-bottom: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      border-radius: 16px;
    }
    th, td {
      text-align: left;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      vertical-align: top;
      font-size: 14px;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      background: rgba(255,255,255,0.04);
    }
    tr:last-child td { border-bottom: none; }
    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .badge.success { background: rgba(46,213,115,0.16); color: ${BRAND.success}; }
    .badge.danger { background: rgba(255,107,107,0.16); color: ${BRAND.danger}; }
    .empty-card {
      padding: 28px;
      text-align: center;
      color: var(--muted);
      font-size: 16px;
    }
    .empty-card span { display: block; margin-top: 8px; font-size: 13px; }
    .footer {
      color: var(--muted);
      font-size: 12px;
      text-align: center;
      padding-bottom: 6px;
    }
    @media (max-width: 720px) {
      body { padding: 16px; }
      .hero { padding: 18px; }
      .hero h1 { font-size: 24px; }
      .meta { text-align: left; }
      th:nth-child(3), td:nth-child(3) { display: none; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="hero">
      <div class="hero-main">
        ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="Chunky Dad">` : ''}
        <div>
          <h1>Cache Maintenance</h1>
          <div class="subtitle">Review and prune cached files in ${this.escapeHtml(this.getCacheScopeFooterSummary())}.</div>
        </div>
      </div>
      <div class="meta">
        Threshold: <strong>${this.escapeHtml(days)} day(s)</strong><br>
        Updated: ${this.escapeHtml(this.formatTimestamp(analysis.generatedAt))}
      </div>
    </div>

    ${resultMessage ? `<div class="notice ${result?.cancelled || result?.skipped ? 'warning' : ''}">${this.escapeHtml(resultMessage)}</div>` : ''}

    <div class="panel controls">
      <div>
        <h2>Threshold</h2>
        <div class="helper">Tap a quick filter or rerun with <code>days=N</code> for a custom threshold.</div>
        <div class="chip-row">${dayChips}</div>
      </div>
      <div>
        <h2>Actions</h2>
        <div class="helper">Deletion always asks for confirmation first.</div>
        <div class="button-row">
          <a class="button primary" href="${refreshHref}">Refresh</a>
          <a class="button danger" href="${pruneHref}">Delete old files</a>
          <a class="button warning" href="${pruneHostsHref}">Delete old files + empty hosts</a>
        </div>
      </div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-label">Host folders</div>
        <div class="stat-value">${this.formatNumber(analysis.hostCount)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Old files</div>
        <div class="stat-value">${this.formatNumber(analysis.oldFileCount)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Recent files</div>
        <div class="stat-value">${this.formatNumber(analysis.recentFileCount)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Removable hosts</div>
        <div class="stat-value">${this.formatNumber(analysis.removableHostCount)}</div>
      </div>
    </div>

    ${emptyState || `
      <div class="panel">
        <h2>Host breakdown</h2>
        <div class="helper">Folders with no recent files can be removed when you use the combined prune action.</div>
        <table>
          <thead>
            <tr>
              <th>Host</th>
              <th>Status</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            ${hostRows || `<tr><td colspan="3">No host folders need cleanup right now.</td></tr>`}
          </tbody>
        </table>
      </div>
    `}

    ${emptyState || (() => {
  const ocrScope = analysis.cacheScopes.find(s => s.key === 'ocr');
  return this.renderOcrFilesTable(ocrScope?.hosts.flatMap(h => h.files || []) || []);
})()}

    <div class="footer">${this.escapeHtml(this.getCacheScopeDirectorySummary(' • '))}</div>
  </div>
</body>
</html>`;
  }

  async renderApp(analysis, result) {
    const html = await this.buildAppHtml(analysis, result);
    await WebView.loadHTML(html, null, null, true);
  }

  async renderWidget(days) {
    const analysis = await this.analyzePageCache(days);
    const widget = new ListWidget();
    widget.backgroundColor = new Color(BRAND.primary);
    widget.setPadding(12, 12, 12, 12);
    widget.url = this.buildSelfUrl({ days: analysis.days });

    const title = widget.addText('Cache');
    title.font = Font.boldSystemFont(FONT_SIZES.widget.label);
    title.textColor = new Color(BRAND.text);

    widget.addSpacer(4);

    const count = widget.addText(String(analysis.oldFileCount));
    count.font = Font.boldSystemFont(FONT_SIZES.widget.metric);
    count.textColor = new Color(analysis.oldFileCount > 0 ? BRAND.danger : BRAND.success);

    const detail = widget.addText(
      analysis.oldFileCount > 0
        ? `${analysis.oldFileCount} old files > ${analysis.days}d`
        : `No files older than ${analysis.days}d`
    );
    detail.font = Font.systemFont(FONT_SIZES.widget.small);
    detail.textColor = new Color(BRAND.textMuted);
    detail.lineLimit = 2;

    if (analysis.removableHostCount > 0) {
      widget.addSpacer(4);
      const hosts = widget.addText(`${analysis.removableHostCount} host folders removable`);
      hosts.font = Font.systemFont(FONT_SIZES.widget.small);
      hosts.textColor = new Color(BRAND.warning);
      hosts.lineLimit = 1;
    }

    return widget;
  }
}

(async () => {
  if (typeof module !== 'undefined' && module.exports) {
    return;
  }
  try {
    const maintenance = new PageCacheMaintenance();
    const days = maintenance.getSelectedDays();
    const actionResult = maintenance.runtime.runsInWidget ? null : await maintenance.maybeRunAction(days);

    if (maintenance.runtime.runsInWidget) {
      const widget = await maintenance.renderWidget(days);
      Script.setWidget(widget);
    } else {
      const analysis = await maintenance.analyzePageCache(days);
      await maintenance.renderApp(analysis, actionResult);
    }
  } catch (error) {
    console.log(`PageCacheMaintenance: Fatal error: ${error.message}`);
    if (typeof config !== 'undefined' && config.runsInWidget) {
      const widget = new ListWidget();
      widget.backgroundColor = new Color(BRAND.primary);
      widget.setPadding(12, 12, 12, 12);
      const title = widget.addText('Cache');
      title.font = Font.boldSystemFont(FONT_SIZES.widget.label);
      title.textColor = new Color(BRAND.text);
      widget.addSpacer(4);
      const message = widget.addText('Error loading maintenance view');
      message.font = Font.systemFont(FONT_SIZES.widget.small);
      message.textColor = new Color(BRAND.danger);
      Script.setWidget(widget);
    } else {
      const alert = new Alert();
      alert.title = 'Page Cache Maintenance Error';
      alert.message = `${error.message}`;
      alert.addAction('OK');
      await alert.present();
    }
  } finally {
    if (typeof Script !== 'undefined' && typeof Script.complete === 'function') {
      Script.complete();
    }
  }
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PageCacheMaintenance };
}

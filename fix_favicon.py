import re

with open('testing/test-og-event-layouts-calendar.html', 'r') as f:
    content = f.read()

# 1. Modify UI to add Favicon URL input alongside Cover Image input
old_cover_input = """        <div class="form-section">
          <h3 style="font-size: 1rem; margin-bottom: 0.5rem; margin-top: 1rem; color: var(--text-secondary);">🖼️ Cover Image</h3>
          <div class="field-group">
            <label for="coverInput">Image URL (optional - uses event image if available)</label>
            <input id="coverInput" type="url" placeholder="https://example.com/image.jpg">
          </div>
        </div>"""

new_cover_input = """        <div class="form-section">
          <h3 style="font-size: 1rem; margin-bottom: 0.5rem; margin-top: 1rem; color: var(--text-secondary);">🖼️ Imagery</h3>
          <div class="field-row">
            <div class="field-group">
              <label for="coverInput">Cover Image URL (optional - uses event image if available)</label>
              <input id="coverInput" type="url" placeholder="https://example.com/image.jpg">
            </div>
            <div class="field-group">
              <label for="faviconInput">Favicon URL (optional - uses domain favicon if available)</label>
              <input id="faviconInput" type="url" placeholder="https://example.com/favicon.ico">
            </div>
          </div>
        </div>"""
content = content.replace(old_cover_input, new_cover_input)

# 2. Modify loadFaviconColors to fetch `url` in map
old_load_favicon = """                if (entry.slug && entry.faviconBg) {
                  this.eventColorsMap.set(entry.slug, { bg: entry.faviconBg, fg: entry.faviconFg || '#ffffff' });
                }"""
new_load_favicon = """                if (entry.slug && entry.faviconBg) {
                  this.eventColorsMap.set(entry.slug, { bg: entry.faviconBg, fg: entry.faviconFg || '#ffffff', url: entry.url });
                }"""
content = content.replace(old_load_favicon, new_load_favicon)

# 3. Add getFaviconUrl() and attach faviconInput
old_get_colors = """        getFaviconColors() {"""
new_get_colors = """        getFaviconUrl() {
          const ev = this.selectedEvent || {};
          if (ev.slug && this.eventColorsMap.has(ev.slug)) {
            const entry = this.eventColorsMap.get(ev.slug);
            if (entry && entry.url) return entry.url;
          }
          return null;
        }

        getFaviconColors() {"""
content = content.replace(old_get_colors, new_get_colors)

# 4. Modify getPreviewData to include faviconUrl
old_preview_data = """            cover: (coverInput.value || '').trim() || (ev.cover || ev.image || '').trim(),
            faviconColors: this.getFaviconColors()
          };"""
new_preview_data = """            cover: (coverInput.value || '').trim() || (ev.cover || ev.image || '').trim(),
            faviconColors: this.getFaviconColors(),
            faviconUrl: (faviconInput.value || '').trim() || (this.getFaviconUrl() ? new URL('/favicon.ico', this.getFaviconUrl()).href : '') || '../favicons/favicon-96x96.png'
          };"""
content = content.replace(old_preview_data, new_preview_data)

# 5. Bind faviconInput in DOMContentLoaded
old_bind_input = """          coverInput.addEventListener('input', () => this.render());"""
new_bind_input = """          coverInput.addEventListener('input', () => this.render());
          faviconInput.addEventListener('input', () => this.render());"""
content = content.replace(old_bind_input, new_bind_input)

# 6. Add faviconInput to constants at top
old_consts = """      const cssPatternMeta = document.getElementById('cssPatternMeta');
      const coverInput = document.getElementById('coverInput');
      const grid = document.getElementById('variantsGrid');"""
new_consts = """      const cssPatternMeta = document.getElementById('cssPatternMeta');
      const coverInput = document.getElementById('coverInput');
      const faviconInput = document.getElementById('faviconInput');
      const grid = document.getElementById('variantsGrid');"""
content = content.replace(old_consts, new_consts)

# 7. Modify buildVariantCard templates to use ${data.faviconUrl} instead of generic
content = content.replace('<img class="event-image" src="../Rising_Star_Ryan_Head_Compressed.png" alt="chunky.dad" />', '<img class="event-image" src="${data.faviconUrl}" alt="chunky.dad" />')
content = content.replace('<img class="chunky-logo" src="../Rising_Star_Ryan_Head_Compressed.png" alt="chunky.dad" />', '<img class="chunky-logo" src="${data.faviconUrl}" alt="chunky.dad" />')
content = content.replace('<img class="brand-logo" src="../Rising_Star_Ryan_Head_Compressed.png" alt="chunky.dad" />', '<img class="brand-logo" src="${data.faviconUrl}" alt="chunky.dad" />')
content = content.replace('<img class="chunky-avatar" src="../Rising_Star_Ryan_Head_Compressed.png" alt="chunky.dad" />', '<img class="chunky-avatar" src="${data.faviconUrl}" alt="chunky.dad" />')
content = content.replace('<img class="logo-stamp" src="../Rising_Star_Ryan_Head_Compressed.png" alt="chunky.dad" />', '<img class="logo-stamp" src="${data.faviconUrl}" alt="chunky.dad" />')
content = content.replace('<img class="logo-avatar" src="../Rising_Star_Ryan_Head_Compressed.png" alt="chunky.dad" />', '<img class="logo-avatar" src="${data.faviconUrl}" alt="chunky.dad" />')


with open('testing/test-og-event-layouts-calendar.html', 'w') as f:
    f.write(content)

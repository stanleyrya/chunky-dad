import re

with open('testing/test-og-event-layouts-calendar.html', 'r') as f:
    content = f.read()

# Replace existing custom CSS properties and old body styling
old_style_start = r"<style>[\s\S]*?body\s*\{[\s\S]*?\}"
new_style_start = """<style>
    :root {
      color-scheme: dark;
      --page-bg: #0b0d13;
      --panel-bg: #141826;
      --panel-raised: #1c2235;
      --text-primary: #f6f7ff;
      --text-secondary: #c4c8e4;
      --text-muted: #8e94b6;
      --accent: #ffa24a;
      --accent-strong: #ff7b2f;
      --border: rgba(255, 255, 255, 0.08);
      --soft: rgba(255, 162, 74, 0.12);
      --chip: rgba(255, 162, 74, 0.18);
      --sticky-header-offset: 6rem;
    }

    body {
      margin: 0;
      padding: 0;
      font-family: 'Poppins', sans-serif;
      background: radial-gradient(circle at top, #1b2033 0%, #0b0d13 45%, #07090f 100%);
      color: var(--text-primary);
      min-height: 100vh;
      overflow-x: hidden;
    }

    .page-wrapper {
      width: 100%;
      max-width: 1200px;
      margin: 0 auto;
      padding: calc(2.1rem + var(--sticky-header-offset)) 1.25rem 3.2rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .tool-header {
      background: var(--solid-primary);
      border-bottom: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow: 0 12px 26px rgba(0, 0, 0, 0.35);
      height: auto;
    }

    .tool-header nav { width: 100%; }

    .tool-nav {
      gap: 0.6rem 1rem;
      flex-wrap: nowrap;
      height: auto;
      padding: 0.7rem 1rem 0.8rem;
      display: flex;
    }

    .tool-nav .logo h1 {
      font-size: 1.45rem;
      line-height: 1.15;
      margin: 0;
    }
    .tool-nav .logo a {
        text-decoration: none;
        color: white;
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .tool-brand-text {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: nowrap;
    }

    .tool-page-label {
      display: inline-flex;
      align-items: center;
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.85);
      white-space: nowrap;
      padding: 0.15rem 0.45rem;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.12);
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
      gap: 1.5rem;
      align-items: start;
    }

    .panel {
      background: var(--panel-bg);
      border-radius: 16px;
      padding: 1.2rem;
      border: 1px solid var(--border);
      box-shadow: 0 18px 38px rgba(0, 0, 0, 0.35);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.8rem;
      margin-bottom: 0.75rem;
    }

    .panel-header h2 { margin: 0; font-size: 1.15rem; color: var(--text-primary); }
    .panel-subtitle { margin: 0.25rem 0 0; font-size: 0.8rem; color: var(--text-muted); }

    .section-body { display: grid; gap: 0.85rem; margin-top: 0.55rem; }
    .field-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; margin-bottom: 0.75rem; }

    .field-group { display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; }
    .field-group label { font-weight: 600; font-size: 0.85rem; color: var(--text-primary); }

    input[type="text"], input[type="url"], select, textarea {
      font-family: inherit; font-size: 0.85rem; border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 9px; padding: 0.5rem 0.65rem; background: #0d111a; color: var(--text-primary);
    }

    .btn, .ghost-button {
      padding: 0.45rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.24);
      background: rgba(255, 255, 255, 0.08); color: var(--text-primary); cursor: pointer; font-size: 0.8rem;
    }
    .btn:hover, .ghost-button:hover { background: rgba(255, 255, 255, 0.16); }
"""
content = re.sub(old_style_start, new_style_start, content)

# Remove old .controls-panel, .controls-section h3, .controls-grid etc. since we replace them
obsolete_styles = [
    r"\.controls-panel \{[\s\S]*?\}\s*",
    r"\.controls-section \{[\s\S]*?\}\s*",
    r"\.controls-section:last-child \{[\s\S]*?\}\s*",
    r"\.controls-section h3 \{[\s\S]*?\}\s*",
    r"\.controls-grid \{[\s\S]*?\}\s*",
    r"\.control-field \{[\s\S]*?\}\s*",
    r"\.control-field label \{[\s\S]*?\}\s*",
    r"\.control-field input, \.control-field select \{[\s\S]*?\}\s*",
    r"\.control-field input:focus, \.control-field select:focus \{[\s\S]*?\}\s*",
    r"\.control-field\.full \{[\s\S]*?\}\s*",
    r"\.btn \{[\s\S]*?\}\s*",
    r"\.btn:hover \{[\s\S]*?\}\s*",
    r"\.btn\.primary \{[\s\S]*?\}\s*",
    r"\.btn\.primary:hover \{[\s\S]*?\}\s*",
    r"\.button-group \{[\s\S]*?\}\s*",
    r"main \{[\s\S]*?\}\s*",
    r"\.page-title \{[\s\S]*?\}\s*",
    r"\.page-title h2 \{[\s\S]*?\}\s*",
    r"\.subtitle \{[\s\S]*?\}\s*",
    r"header \{[\s\S]*?\}\s*",
    r"nav \{[\s\S]*?\}\s*",
    r"nav \.nav-container \{[\s\S]*?\}\s*",
    r"\.logo h1 \{[\s\S]*?\}\s*",
    r"\.logo a \{[\s\S]*?\}\s*",
    r"\.logo-img \{[\s\S]*?\}\s*"
]

for style in obsolete_styles:
    content = re.sub(style, "", content)

# Replace <main> and layout again if they didn't catch (since I didn't see the exact match above)
# Just to be safe, I will re-apply using more flexible regex
old_header = r"<header>[\s\S]*?</header>"
new_header = """<header class="tool-header">
    <nav>
      <div class="nav-container tool-nav">
        <div class="logo">
          <h1>
            <a href="../index.html" aria-label="chunky.dad home">
              <img src="../favicons/favicon-96x96.png"
                   srcset="../favicons/favicon-96x96.png 1x, ../favicons/favicon-192x192.png 2x, ../favicons/favicon-256x256.png 3x"
                   alt="chunky.dad logo" class="logo-img">
              <span class="tool-brand-text">
                <span class="tool-brand-name">chunky.dad</span>
                <span class="tool-page-label">OG Studio</span>
              </span>
            </a>
          </h1>
        </div>
      </div>
    </nav>
  </header>"""
content = re.sub(old_header, new_header, content)

old_main_start = r"<main>[\s\S]*?<div class=\"container\">[\s\S]*?<div class=\"page-title\">[\s\S]*?</div>[\s\S]*?</div>[\s\S]*?<div class=\"controls-panel\">"
new_main_start = """<div class="page-wrapper">
    <main class="layout">
      <div class="panel form-panel">
        <div class="panel-header">
          <div>
            <h2 id="event-details-heading">🎨 OpenGraph Image Studio</h2>
            <div class="panel-subtitle">Create stunning social media preview images for your events</div>
          </div>
        </div>

        <div class="section-body">"""
content = re.sub(old_main_start, new_main_start, content)

content = content.replace('class="controls-section"', 'class="form-section"')
content = content.replace('<h3>', '<h3 style="font-size: 1rem; margin-bottom: 0.5rem; margin-top: 1rem; color: var(--text-secondary);">')
content = content.replace('class="controls-grid"', 'class="field-row"')
content = content.replace('class="control-field"', 'class="field-group"')
content = content.replace('class="control-field full"', 'class="field-group"')
content = content.replace('style="grid-column: span 2;"', '')
content = content.replace('class="color-picker-field control-field"', 'class="field-group"')
content = content.replace('class="custom-colors" style="margin-top: 16px;"', 'class="field-row" style="margin-top: 16px;"')

content = re.sub(r"</div>\s*<section class=\"variants-grid\" id=\"variantsGrid\"></section>\s*</div>\s*</main>", """      </div>

      <section class="variants-grid" id="variantsGrid"></section>
    </main>
  </div>""", content)


with open('testing/test-og-event-layouts-calendar.html', 'w') as f:
    f.write(content)

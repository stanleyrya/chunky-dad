import re

with open('testing/index.html', 'r') as f:
    html = f.read()

# 1. CSS Injection
css_injection = """
    .logo-wrapper {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .logo-hat {
      position: absolute;
      top: -12px;
      left: 1px;
      font-size: 22px;
      transform: rotate(-15deg);
      animation: wiggle 3s infinite ease-in-out;
      z-index: 2;
    }
    .logo-tool {
      position: absolute;
      bottom: -4px;
      right: -8px;
      font-size: 18px;
      animation: hammer 2s infinite ease-in-out;
      z-index: 2;
    }
    @keyframes wiggle {
      0%, 100% { transform: rotate(-15deg); }
      50% { transform: rotate(5deg); }
    }
    @keyframes hammer {
      0%, 100% { transform: rotate(0deg); }
      20% { transform: rotate(-30deg); }
      40% { transform: rotate(15deg); }
      60% { transform: rotate(0deg); }
    }

    .ascii-art-container {
      font-family: 'SFMono-Regular', ui-monospace, Menlo, Monaco, Consolas, monospace;
      white-space: pre;
      color: var(--accent);
      text-shadow: 0 0 5px var(--accent-strong);
      line-height: 1.15;
      font-size: 12px;
      animation: pulse-glow 2s infinite alternate;
      background: rgba(0,0,0,0.4);
      padding: 1.2rem;
      border-radius: 12px;
      border: 1px dashed var(--accent);
      display: flex;
      justify-content: center;
      align-items: center;
      overflow-x: hidden;
      box-shadow: inset 0 0 15px rgba(255, 162, 74, 0.1);
    }

    .ascii-art-container span.tool-emoji-ascii {
      font-size: 18px;
      vertical-align: middle;
      text-shadow: none;
    }

    @keyframes pulse-glow {
      from { text-shadow: 0 0 4px var(--accent-strong); border-color: rgba(255, 162, 74, 0.4); box-shadow: inset 0 0 10px rgba(255, 162, 74, 0.05); }
      to { text-shadow: 0 0 8px #ffb74d, 0 0 12px #ffb74d; border-color: rgba(255, 162, 74, 0.8); box-shadow: inset 0 0 25px rgba(255, 162, 74, 0.2); }
    }
"""

html = html.replace('</style>', css_injection + '\n  </style>')

# 2. Header Replacement
old_header = """<div class="logo">
          <h1>
            <a href="../index.html" aria-label="chunky.dad home">
              <img src="../chunky-dad-emoji.png" alt="chunky.dad logo" class="logo-img">
              <span class="tool-emoji">🧰</span>
              <span class="tool-brand-text">
                <span class="tool-brand-name">chunky.dad</span>
                <span class="tool-page-label">Tools</span>
              </span>
            </a>
          </h1>
        </div>"""

new_header = """<div class="logo">
          <h1>
            <a href="../index.html" aria-label="chunky.dad home">
              <div class="logo-wrapper">
                <span class="logo-hat">👷‍♂️</span>
                <img src="../favicons/favicon-96x96.png"
                     srcset="../favicons/favicon-96x96.png 1x, ../favicons/favicon-192x192.png 2x, ../favicons/favicon-256x256.png 3x"
                     alt="chunky.dad logo" class="logo-img">
                <span class="logo-tool">🔧</span>
              </div>
              <span class="tool-brand-text" style="margin-left: 0.5rem;">
                <span class="tool-brand-name">chunky.dad</span>
                <span class="tool-page-label">Tools</span>
              </span>
            </a>
          </h1>
        </div>"""

html = html.replace(old_header, new_header)

# 3. Hero Aside Replacement for ASCII art
old_hero_aside = """<div class="hero-aside">
          <div class="hero-badges">
            <span class="hero-badge">Cute</span>
            <span class="hero-badge">Subversive</span>
            <span class="hero-badge">Dad Energy</span>
            <span class="hero-badge">Beta</span>
          </div>
          <div class="hero-note">
            <span class="note-title">Caution: Wet Paint</span>
            <p>Pages here are for testing, debugging, and stressing out the UI. Wear safety goggles.</p>
          </div>
        </div>"""

new_hero_aside = """<div class="hero-aside">
          <div class="hero-badges">
            <span class="hero-badge">Cute</span>
            <span class="hero-badge">Subversive</span>
            <span class="hero-badge">Dad Energy</span>
            <span class="hero-badge">Beta</span>
          </div>
          <div class="ascii-art-container" aria-hidden="true">
      .=""" + '""' + """=.
    / _   _ \\   <span class="tool-emoji-ascii">🔧</span>
   | (o) (o) |
   |   / \\   |
    \\  '-'  /
    /`""""" + '""' + """`\\
   / |  <span class="tool-emoji-ascii">🧰</span> | \\
          </div>
        </div>"""

html = html.replace(old_hero_aside, new_hero_aside)

with open('testing/index.html', 'w') as f:
    f.write(html)

print("Updated HTML with header and ASCII art")

import re

with open('testing/test-og-event-layouts-calendar.html', 'r') as f:
    content = f.read()

# Make css-pattern the first pattern sample
old_variants = """          const VARIANTS = [
            // Simple & Clean Layouts
            { key: 'banner', name: '🎯 Banner', class: 'layout-banner', description: 'Billboard/hero banner style' },

            // Creative Layouts
            { key: 'split', name: 'Split Screen', class: 'layout-split-screen', description: 'Dynamic diagonal composition' },
            { key: 'minimal', name: 'Minimalist Card', class: 'layout-minimal', description: 'Clean modern card design' },
            { key: 'glass', name: 'Glass Card', class: 'layout-glass', description: 'Frosted glass backdrop' },
            { key: 'circle', name: 'Circle Focus', class: 'layout-circle', description: 'Circular image focus' },

            // Speech Bubble Variations
            { key: 'speech', name: 'Speech Bubble', class: 'layout-speech', description: 'Logo speaks about event' },
            { key: 'speech-terminal', name: 'Retro Terminal', class: 'layout-speech-terminal', description: 'Computer terminal style' },
            // Pattern Layouts with Colored Rim
            { key: 'css-pattern', name: '🧩 CSS Pattern.com', class: 'layout-css-pattern', description: 'Downloaded gradient pattern background' },
            ];"""

new_variants = """          const VARIANTS = [
            // Pattern Layouts with Colored Rim
            { key: 'css-pattern', name: '🧩 CSS Pattern.com', class: 'layout-css-pattern', description: 'Downloaded gradient pattern background' },
            { key: 'chunky-pattern', name: '🐻 Chunky Pattern', class: 'layout-chunky-pattern', description: 'Custom paw print and star pattern' },

            // Simple & Clean Layouts
            { key: 'banner', name: '🎯 Banner', class: 'layout-banner', description: 'Billboard/hero banner style' },

            // Creative Layouts
            { key: 'split', name: 'Split Screen', class: 'layout-split-screen', description: 'Dynamic diagonal composition' },
            { key: 'minimal', name: 'Minimalist Card', class: 'layout-minimal', description: 'Clean modern card design' },
            { key: 'glass', name: 'Glass Card', class: 'layout-glass', description: 'Frosted glass backdrop' },
            { key: 'circle', name: 'Circle Focus', class: 'layout-circle', description: 'Circular image focus' },

            // Speech Bubble Variations
            { key: 'speech', name: 'Speech Bubble', class: 'layout-speech', description: 'Logo speaks about event' },
            { key: 'speech-terminal', name: 'Retro Terminal', class: 'layout-speech-terminal', description: 'Computer terminal style' },
            ];"""
content = content.replace(old_variants, new_variants)

# Create layout template
old_layouts = """            'css-pattern': `
              <div class="css-pattern-bg"></div>
              <div class="pattern-vignette"></div>
              <div class="content-box">
                <div class="brand">chunky.dad</div>
                <div class="event-title"></div>
                <div class="event-date"></div>
                <div class="event-venue"></div>
              </div>
            `,"""

new_layouts = """            'css-pattern': `
              <div class="css-pattern-bg"></div>
              <div class="pattern-vignette"></div>
              <div class="content-box">
                <div class="brand">chunky.dad</div>
                <div class="event-title"></div>
                <div class="event-date"></div>
                <div class="event-venue"></div>
              </div>
            `,
            'chunky-pattern': `
              <div class="chunky-pattern-bg"></div>
              <div class="pattern-vignette"></div>
              <div class="content-box">
                <div class="brand">chunky.dad</div>
                <div class="event-title"></div>
                <div class="event-date"></div>
                <div class="event-venue"></div>
              </div>
            `,"""
content = content.replace(old_layouts, new_layouts)

# Add CSS for the new pattern
old_css = """    .artboard.layout-css-pattern { background: #000; position: relative; overflow: hidden; }

    .layout-css-pattern .css-pattern-bg {"""

new_css = """    .artboard.layout-css-pattern,
    .artboard.layout-chunky-pattern { background: #000; position: relative; overflow: hidden; }

    .layout-chunky-pattern .chunky-pattern-bg {
      position: absolute; inset: 0; z-index: 0;
      background-color: #06060a;
      background-image:
        radial-gradient(circle at 25% 25%, var(--pattern-color, rgba(255,255,255,0.15)) 4px, transparent 4px),
        radial-gradient(circle at 75% 75%, var(--pattern-color, rgba(255,255,255,0.15)) 4px, transparent 4px),
        linear-gradient(45deg, transparent 45%, var(--pattern-color, rgba(255,255,255,0.05)) 45%, var(--pattern-color, rgba(255,255,255,0.05)) 55%, transparent 55%),
        linear-gradient(-45deg, transparent 45%, var(--pattern-color, rgba(255,255,255,0.05)) 45%, var(--pattern-color, rgba(255,255,255,0.05)) 55%, transparent 55%);
      background-size: 60px 60px;
    }

    .layout-css-pattern .css-pattern-bg {"""
content = content.replace(old_css, new_css)

old_css2 = """    .layout-css-pattern .pattern-vignette {"""
new_css2 = """    .layout-chunky-pattern .pattern-vignette,
    .layout-css-pattern .pattern-vignette {"""
content = content.replace(old_css2, new_css2)

old_css3 = """    .layout-css-pattern .content-box {"""
new_css3 = """    .layout-chunky-pattern .content-box,
    .layout-css-pattern .content-box {"""
content = content.replace(old_css3, new_css3)

old_css4 = """    .layout-css-pattern .content-box { z-index: 2; }
    .layout-css-pattern .brand {"""
new_css4 = """    .layout-chunky-pattern .content-box { z-index: 2; }
    .layout-css-pattern .content-box { z-index: 2; }
    .layout-chunky-pattern .brand,
    .layout-css-pattern .brand {"""
content = content.replace(old_css4, new_css4)

old_css5 = """    .layout-css-pattern .event-title { font-size: 66px; line-height: 0.95; font-weight: 900; margin-bottom: 20px; }
    .layout-css-pattern .event-date { font-size: 26px; opacity: 0.9; margin-bottom: 8px; }
    .layout-css-pattern .event-venue { font-size: 22px; opacity: 0.8; }"""
new_css5 = """    .layout-chunky-pattern .event-title,
    .layout-css-pattern .event-title { font-size: 66px; line-height: 0.95; font-weight: 900; margin-bottom: 20px; }
    .layout-chunky-pattern .event-date,
    .layout-css-pattern .event-date { font-size: 26px; opacity: 0.9; margin-bottom: 8px; }
    .layout-chunky-pattern .event-venue,
    .layout-css-pattern .event-venue { font-size: 22px; opacity: 0.8; }"""
content = content.replace(old_css5, new_css5)


# Update switch statement to handle the new variant content update
old_switch = """            case 'css-pattern':
            }"""
new_switch = """            case 'css-pattern':
            case 'chunky-pattern': {
              const t = artboard.querySelector('.event-title');
              const d = artboard.querySelector('.event-date');
              const v = artboard.querySelector('.event-venue');
              const bg = artboard.querySelector('.css-pattern-bg');
              if (t) t.textContent = data.event;
              if (d) d.textContent = `${data.date} · ${data.time}`;
              if (v) v.textContent = `@ ${data.venue}`;
              if (bg) this.applyCssPattern(bg);
              break;
            }"""
content = content.replace(old_switch, new_switch)


with open('testing/test-og-event-layouts-calendar.html', 'w') as f:
    f.write(content)

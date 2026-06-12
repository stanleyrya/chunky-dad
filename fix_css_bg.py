import re

with open('testing/test-og-event-layouts-calendar.html', 'r') as f:
    content = f.read()

old_switch = """            case 'css-pattern':
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

new_switch = """            case 'css-pattern':
            case 'chunky-pattern': {
              const t = artboard.querySelector('.event-title');
              const d = artboard.querySelector('.event-date');
              const v = artboard.querySelector('.event-venue');
              const bg = artboard.querySelector('.css-pattern-bg') || artboard.querySelector('.chunky-pattern-bg');
              if (t) t.textContent = data.event;
              if (d) d.textContent = `${data.date} · ${data.time}`;
              if (v) v.textContent = `@ ${data.venue}`;
              if (bg && variant.key === 'css-pattern') this.applyCssPattern(bg);
              break;
            }"""

content = content.replace(old_switch, new_switch)

with open('testing/test-og-event-layouts-calendar.html', 'w') as f:
    f.write(content)

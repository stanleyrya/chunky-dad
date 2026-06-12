import re

with open('testing/test-og-event-layouts-calendar.html', 'r') as f:
    content = f.read()

# I used python replace on multiple braces and it failed. Let's fix the entire switch statement

old_switch_start = "switch(variant.key) {"
old_switch_end = "buildVariantCard(variant, data) {"

# Let's read lines and just manually replace the switch block with a clean version
import sys
lines = content.split('\n')
start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if "switch(variant.key) {" in line:
        start_idx = i
    if "buildVariantCard(variant, data) {" in line:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    new_switch = """          switch(variant.key) {
            case 'split': {
              const t = artboard.querySelector('.event-title');
              const d = artboard.querySelector('.event-date');
              const v = artboard.querySelector('.venue');
              const desc = artboard.querySelector('.description');
              const img = artboard.querySelector('.event-image');
              const leftSide = artboard.querySelector('.left-side');
              if (t) t.textContent = data.event;
              if (d) d.textContent = `${data.date} · ${data.time}`;
              if (v) v.textContent = `@ ${data.venue}`;
              if (desc) desc.textContent = data.description;
              if (img && data.cover) { img.style.backgroundImage = `url('${data.cover}')`; img.style.display = 'block'; }
              if (leftSide) {
                const cover = leftSide.querySelector('.cover');
                if (cover && data.cover) cover.style.backgroundImage = `url('${data.cover}')`;
              }
              break;
            }
            case 'minimal': {
              const t = artboard.querySelector('.event-title');
              const v = artboard.querySelector('.venue');
              const desc = artboard.querySelector('.description');
              const dateBadge = artboard.querySelector('.date-badge');
              const cardHeader = artboard.querySelector('.card-header');
              if (t) t.textContent = data.event;
              if (v) v.textContent = `@ ${data.venue}`;
              if (desc) desc.textContent = data.description;
              if (dateBadge) dateBadge.textContent = data.date;
              if (cardHeader) {
                const cover = cardHeader.querySelector('.cover');
                if (cover && data.cover) cover.style.backgroundImage = `url('${data.cover}')`;
              }
              break;
            }
            case 'glass': {
              const t = artboard.querySelector('.event-title');
              const d = artboard.querySelector('.event-date');
              const v = artboard.querySelector('.venue');
              const desc = artboard.querySelector('.description');
              const cov = artboard.querySelector('.cover');
              if (t) t.textContent = data.event;
              if (d) d.textContent = `${data.date} · ${data.time}`;
              if (v) v.textContent = `@ ${data.venue}`;
              if (desc) desc.textContent = data.description;
              if (cov && data.cover) cov.style.backgroundImage = `url('${data.cover}')`;
              break;
            }
            case 'circle': {
              const t = artboard.querySelector('.event-title');
              const d = artboard.querySelector('.event-date');
              const v = artboard.querySelector('.venue');
              const desc = artboard.querySelector('.description');
              const img = artboard.querySelector('.event-image');
              if (t) t.textContent = data.event;
              if (d) d.textContent = `${data.date} · ${data.time}`;
              if (v) v.textContent = `@ ${data.venue}`;
              if (desc) desc.textContent = data.description;
              if (img && data.cover) { img.style.backgroundImage = `url('${data.cover}')`; img.style.display = 'block'; }
              break;
            }
            case 'speech': {
              const head = artboard.querySelector('.headline');
              const bubble = artboard.querySelector('.speech-bubble');
              const img = artboard.querySelector('.event-image');
              const cov = artboard.querySelector('.cover');
              if (head) head.textContent = data.event;
              if (bubble) bubble.textContent = `${data.date} @ ${data.time} · ${data.venue}`;
              if (img && data.cover) { img.style.backgroundImage = `url('${data.cover}')`; img.style.display = 'block'; }
              if (cov && data.cover) cov.style.backgroundImage = `url('${data.cover}')`;
              break;
            }
            case 'speech-terminal': {
              const content = artboard.querySelector('.terminal-content');
              const img = artboard.querySelector('.event-image');
              if (content) {
                content.innerHTML = `$ cat event_info.txt<br/>
EVENT: ${data.event}<br/>
DATE: ${data.date}<br/>
TIME: ${data.time}<br/>
VENUE: ${data.venue}<br/>
<br/>
$ <span class="cursor">_</span>`;
              }
              if (img && data.cover) img.style.backgroundImage = `url('${data.cover}')`;
              break;
            }
            case 'banner': {
              const title = artboard.querySelector('.event-title');
              const info = artboard.querySelector('.event-info');
              const cta = artboard.querySelector('.event-cta');
              const bg = artboard.querySelector('.banner-bg');
              if (title) title.textContent = data.event;
              if (info) info.textContent = `${data.date} · ${data.time} · ${data.venue}`;
              if (cta) cta.textContent = 'Get Tickets';
              if (bg && data.cover) bg.style.backgroundImage = `url('${data.cover}')`;
              break;
            }
            case 'css-pattern':
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
            }
          }
        }
"""
    new_lines = lines[:start_idx] + new_switch.split('\n') + lines[end_idx:]
    with open('testing/test-og-event-layouts-calendar.html', 'w') as f:
        f.write('\n'.join(new_lines))

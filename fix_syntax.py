import re

with open('testing/test-og-event-layouts-calendar.html', 'r') as f:
    content = f.read()

content = content.replace("""            case 'speech': {
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
            }
            case 'speech-terminal': {""", """            case 'speech': {
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
            case 'speech-terminal': {""")

content = content.replace("""              if (img && data.cover) img.style.backgroundImage = `url('${data.cover}')`;
              break;
            }
            }
            }
            }
            }
            case 'banner': {""", """              if (img && data.cover) img.style.backgroundImage = `url('${data.cover}')`;
              break;
            }
            case 'banner': {""")

with open('testing/test-og-event-layouts-calendar.html', 'w') as f:
    f.write(content)

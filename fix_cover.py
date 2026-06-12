import re

with open('testing/test-og-event-layouts-calendar.html', 'r') as f:
    content = f.read()

content = content.replace(
    "cover: (coverInput.value || '').trim() || (ev.image || '').trim(),",
    "cover: (coverInput.value || '').trim() || (ev.cover || ev.image || '').trim(),"
)

with open('testing/test-og-event-layouts-calendar.html', 'w') as f:
    f.write(content)

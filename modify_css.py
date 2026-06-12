import re

with open('testing/test-og-event-layouts-calendar.html', 'r') as f:
    content = f.read()

# Removing extra CSS
css_blocks_to_remove = [
    r"/\*\s*LAYOUT: Side by Side\s*\*/[\s\S]*?(?=\s*/\*\s*LAYOUT: Polaroid\s*\*/|\s*/\*\s*LAYOUT: Banner\s*\*/|\s*/\*\s*LAYOUT: Glass Card\s*\*/)",
    r"/\*\s*LAYOUT: Polaroid\s*\*/[\s\S]*?(?=\s*/\*\s*LAYOUT: Banner\s*\*/|\s*/\*\s*LAYOUT: Glass Card\s*\*/)",
    r"/\*\s*LAYOUT: Simple Speech Bubble\s*\*/[\s\S]*?(?=\s*/\*\s*LAYOUT: Bold & Centered\s*\*/|\s*/\*\s*LAYOUT: Side by Side\s*\*/|\s*/\*\s*LAYOUT: Photo Frame\s*\*/|\s*/\*\s*LAYOUT: Banner\s*\*/)",
    r"/\*\s*LAYOUT: Bold & Centered\s*\*/[\s\S]*?(?=\s*/\*\s*LAYOUT: Side by Side\s*\*/|\s*/\*\s*LAYOUT: Photo Frame\s*\*/|\s*/\*\s*LAYOUT: Banner\s*\*/)"
]

for block in css_blocks_to_remove:
    content = re.sub(block, '', content)

with open('testing/test-og-event-layouts-calendar.html', 'w') as f:
    f.write(content)

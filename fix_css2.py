import re

with open('testing/test-og-event-layouts-calendar.html', 'r') as f:
    content = f.read()

# Make the page look even closer to event builder by removing .container padding that clashes with .page-wrapper
content = re.sub(r"\.container \{ max-width: 1400px; margin: 0 auto; padding: 20px; \}", "", content)

# Remove the inner <div class="container"> inside main since we replaced it with <div class="page-wrapper">
content = content.replace('<div class="container">', '')
content = content.replace('      </div>\n      \n      <section class="variants-grid" id="variantsGrid"></section>', '      <section class="variants-grid" id="variantsGrid"></section>\n      </div>')

with open('testing/test-og-event-layouts-calendar.html', 'w') as f:
    f.write(content)

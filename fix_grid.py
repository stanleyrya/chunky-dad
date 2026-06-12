import re

with open('testing/test-og-event-layouts-calendar.html', 'r') as f:
    content = f.read()

# Fix variantsGrid placement
old_end = """        </div>
            <section class="variants-grid" id="variantsGrid"></section>
      </div>
    </main>
  </div>"""

new_end = """        </div>
      </div>
      <section class="variants-grid" id="variantsGrid"></section>
    </main>
  </div>"""

content = content.replace(old_end, new_end)

with open('testing/test-og-event-layouts-calendar.html', 'w') as f:
    f.write(content)

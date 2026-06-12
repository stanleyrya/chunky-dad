import re

with open('testing/test-og-event-layouts-calendar.html', 'r') as f:
    content = f.read()

# Fix ReferenceError: data is not defined at createVariantHTML
# The buildVariantCard passes data into createVariantHTML, but createVariantHTML signature was modified/missing data arg
content = content.replace("createVariantHTML(variant) {", "createVariantHTML(variant, data) {")
content = content.replace("this.createVariantHTML(variant)", "this.createVariantHTML(variant, data)")


with open('testing/test-og-event-layouts-calendar.html', 'w') as f:
    f.write(content)

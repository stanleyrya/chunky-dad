import re

with open("testing/test-city-landscapes.html", "r") as f:
    content = f.read()

# Replace all container styles with new dynamic content
# For now, let's just make the grid bigger to accommodate full-width landscapes or large cards
content = re.sub(
    r'\.landscapes-grid \{.*?\}',
    '.landscapes-grid {\n  display: flex;\n  flex-direction: column;\n  gap: 40px;\n  align-items: center;\n}',
    content,
    flags=re.DOTALL
)

content = re.sub(
    r'\.landscape-card \{.*?\}',
    '.landscape-card {\n  background: var(--panel-bg);\n  border: 1px solid var(--border);\n  border-radius: 12px;\n  padding: 20px;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 15px;\n  width: 100%;\n  max-width: 800px;\n  position: relative;\n  overflow: hidden;\n}',
    content,
    flags=re.DOTALL
)

with open("testing/test-city-landscapes.html", "w") as f:
    f.write(content)

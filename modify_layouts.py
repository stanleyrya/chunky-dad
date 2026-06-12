import re

with open('testing/test-og-event-layouts-calendar.html', 'r') as f:
    content = f.read()

# 1. Remove from VARIANTS array
to_remove_variants = [
    r"\{\s*key:\s*'simple-speech'.*?\},?\s*",
    r"\{\s*key:\s*'bold-centered'.*?\},?\s*",
    r"\{\s*key:\s*'side-by-side'.*?\},?\s*",
    r"\{\s*key:\s*'photo-frame'.*?\},?\s*",
    r"\{\s*key:\s*'speech-event'.*?\},?\s*",
    r"\{\s*key:\s*'speech-thought'.*?\},?\s*",
    r"\{\s*key:\s*'speech-messenger'.*?\},?\s*",
    r"\{\s*key:\s*'speech-discord'.*?\},?\s*",
    r"\{\s*key:\s*'speech-story'.*?\},?\s*",
    r"\{\s*key:\s*'pattern-dots'.*?\},?\s*",
    r"\{\s*key:\s*'pattern-stripes'.*?\},?\s*",
    r"\{\s*key:\s*'pattern-grid'.*?\},?\s*",
    r"\{\s*key:\s*'pattern-zigzag'.*?\},?\s*"
]

for pattern in to_remove_variants:
    content = re.sub(pattern, '', content, flags=re.DOTALL)

# 2. Remove HTML templates from buildVariantCard
to_remove_templates = [
    r"'simple-speech':\s*`.*?`,\s*",
    r"'bold-centered':\s*`.*?`,\s*",
    r"'side-by-side':\s*`.*?`,\s*",
    r"'photo-frame':\s*`.*?`,\s*",
    r"'speech-event':\s*`.*?`,\s*",
    r"'speech-story':\s*`.*?`,\s*",
    r"'speech-thought':\s*`.*?`,\s*",
    r"'speech-messenger':\s*`.*?`,\s*",
    r"'speech-discord':\s*`.*?`,\s*",
    r"'pattern-dots':\s*`.*?`,\s*",
    r"'pattern-stripes':\s*`.*?`,\s*",
    r"'pattern-grid':\s*`.*?`,\s*",
    r"'pattern-zigzag':\s*`.*?`,\s*"
]

for pattern in to_remove_templates:
    content = re.sub(pattern, '', content, flags=re.DOTALL)

# 3. Remove update logic for those variants
to_remove_cases = [
    r"case 'simple-speech':[\s\S]*?break;\s*",
    r"case 'bold-centered':[\s\S]*?break;\s*",
    r"case 'side-by-side':[\s\S]*?break;\s*",
    r"case 'photo-frame':[\s\S]*?break;\s*",
    r"case 'speech-event':[\s\S]*?break;\s*",
    r"case 'speech-story':[\s\S]*?break;\s*",
    r"case 'speech-thought':[\s\S]*?break;\s*",
    r"case 'speech-messenger':[\s\S]*?break;\s*",
    r"case 'speech-discord':[\s\S]*?break;\s*",
    r"case 'pattern-dots':[\s\S]*?break;\s*",
    r"case 'pattern-stripes':[\s\S]*?break;\s*",
    r"case 'pattern-grid':[\s\S]*?break;\s*",
    r"case 'pattern-zigzag':[\s\S]*?break;\s*"
]
for pattern in to_remove_cases:
    content = re.sub(pattern, '', content)

# 4. Remove CSS logic
# This requires a bit more care.
content = re.sub(r"/\* === Simple & Clean === \*/[\s\S]*?/\* === Creative === \*/", "/* === Creative === */", content)
content = re.sub(r"/\* Event Image Speaks \*/[\s\S]*?/\* Retro Terminal \*/", "/* Retro Terminal */", content)
content = re.sub(r"/\* Instagram Story \*/[\s\S]*?/\* === Pattern Layouts with Rim Effect === \*/", "/* === Pattern Layouts with Rim Effect === */", content)

content = re.sub(r",\s*\.artboard\.layout-pattern-dots", "", content)
content = re.sub(r",\s*\.artboard\.layout-pattern-stripes", "", content)
content = re.sub(r",\s*\.artboard\.layout-pattern-grid", "", content)
content = re.sub(r",\s*\.artboard\.layout-pattern-zigzag", "", content)

content = re.sub(r"\.layout-pattern-dots \.pattern-bg[\s\S]*?\.layout-pattern-zigzag \.pattern-bg[\s\S]*?\}\s*", "", content)

content = re.sub(r",\s*\.layout-pattern-dots \.content-box", "", content)
content = re.sub(r",\s*\.layout-pattern-stripes \.content-box", "", content)
content = re.sub(r",\s*\.layout-pattern-grid \.content-box", "", content)
content = re.sub(r",\s*\.layout-pattern-zigzag \.content-box", "", content)

content = re.sub(r",\s*\.layout-pattern-dots \.brand", "", content)
content = re.sub(r",\s*\.layout-pattern-stripes \.brand", "", content)
content = re.sub(r",\s*\.layout-pattern-grid \.brand", "", content)
content = re.sub(r",\s*\.layout-pattern-zigzag \.brand", "", content)

content = re.sub(r",\s*\.layout-pattern-dots \.event-title", "", content)
content = re.sub(r",\s*\.layout-pattern-stripes \.event-title", "", content)
content = re.sub(r",\s*\.layout-pattern-grid \.event-title", "", content)
content = re.sub(r",\s*\.layout-pattern-zigzag \.event-title", "", content)

content = re.sub(r",\s*\.layout-pattern-dots \.event-date", "", content)
content = re.sub(r",\s*\.layout-pattern-stripes \.event-date", "", content)
content = re.sub(r",\s*\.layout-pattern-grid \.event-date", "", content)
content = re.sub(r",\s*\.layout-pattern-zigzag \.event-date", "", content)

content = re.sub(r",\s*\.layout-pattern-dots \.event-venue", "", content)
content = re.sub(r",\s*\.layout-pattern-stripes \.event-venue", "", content)
content = re.sub(r",\s*\.layout-pattern-grid \.event-venue", "", content)
content = re.sub(r",\s*\.layout-pattern-zigzag \.event-venue", "", content)


with open('testing/test-og-event-layouts-calendar.html', 'w') as f:
    f.write(content)

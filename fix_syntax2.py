import re

with open('testing/test-og-event-layouts-calendar.html', 'r') as f:
    content = f.read()

# Fix the specific syntax error on line 921 "Unexpected token 'case'"
content = re.sub(r"\}\s*\}\s*case 'speech-terminal':", "}\n            case 'speech-terminal':", content)
content = re.sub(r"\}\s*\}\s*\}\s*\}\s*\}\s*case 'banner':", "}\n            case 'banner':", content)

with open('testing/test-og-event-layouts-calendar.html', 'w') as f:
    f.write(content)

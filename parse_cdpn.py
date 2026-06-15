import re

pens = ["tdoughty", "mr21", "alvaromontoro", "isladjan"]

for user in pens:
    with open(f"{user}_cdpn.html", "r") as f:
        content = f.read()

    # Extract style
    style_match = re.search(r'<style[^>]*>(.*?)</style>', content, re.DOTALL)
    if style_match:
        with open(f"{user}.css", "w") as f:
            f.write(style_match.group(1))

    # Extract body content
    body_match = re.search(r'<body[^>]*>(.*?)<script', content, re.DOTALL)
    if not body_match:
        body_match = re.search(r'<body[^>]*>(.*?)</body>', content, re.DOTALL)

    if body_match:
        html = body_match.group(1).strip()
        with open(f"{user}.html", "w") as f:
            f.write(html)

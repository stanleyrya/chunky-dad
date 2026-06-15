import re
import html

pens = ["tdoughty", "mr21", "alvaromontoro", "isladjan"]

for user in pens:
    with open(f"{user}_cdpn.html", "r") as f:
        content = f.read()

    srcdoc_match = re.search(r'<iframe[^>]*srcdoc="([^"]*)"', content)
    if srcdoc_match:
        iframe_content = html.unescape(srcdoc_match.group(1))

        style_match = re.search(r'<style[^>]*>(.*?)</style>', iframe_content, re.DOTALL)
        if style_match:
            with open(f"{user}.css", "w") as f:
                f.write(style_match.group(1))

        body_match = re.search(r'<body[^>]*>(.*?)</body>', iframe_content, re.DOTALL)
        if body_match:
            # exclude trailing scripts
            body_html = re.sub(r'<script.*?</script>', '', body_match.group(1), flags=re.DOTALL).strip()
            with open(f"{user}.html", "w") as f:
                f.write(body_html)

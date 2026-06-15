import re

def scope_css(css, prefix):
    # Remove comments
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.DOTALL)

    # We want to scope things that aren't @keyframes or @media.
    # A simple approach: split by }
    rules = css.split('}')
    scoped_css = ""
    for rule in rules:
        rule = rule.strip()
        if not rule:
            continue

        parts = rule.split('{')
        if len(parts) != 2:
            scoped_css += rule + "}\n"
            continue

        selectors, body = parts
        selectors = selectors.strip()

        if selectors.startswith('@'):
            scoped_css += rule + "}\n"
            continue

        # Split multiple selectors by comma
        scoped_selectors = []
        for sel in selectors.split(','):
            sel = sel.strip()
            if sel == 'body' or sel == 'html' or sel == ':root':
                scoped_selectors.append(prefix)
            elif sel:
                scoped_selectors.append(f"{prefix} {sel}")

        scoped_css += ",\n".join(scoped_selectors) + " {\n" + body + "\n}\n"

    return scoped_css

pens = ["tdoughty", "mr21", "alvaromontoro", "isladjan"]
for user in pens:
    with open(f"{user}.css", "r") as f:
        css = f.read()
    scoped = scope_css(css, f".style-{user}")
    with open(f"{user}_scoped.css", "w") as f:
        f.write(scoped)

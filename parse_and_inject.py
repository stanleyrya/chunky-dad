import re

def escape_html(html):
    return html.replace('`', '\\`').replace('$', '\\$')

# Read CSS
with open("tdoughty_scoped.css", "r") as f:
    tdoughty_css = f.read()

# Make it larger to fit the card
tdoughty_css += """
.style-tdoughty .container {
    width: 100% !important;
    height: 100% !important;
    border-radius: 12px;
}
.style-tdoughty .mountain .backdrop {
    left: -100px !important;
}
"""

with open("mr21_scoped.css", "r") as f:
    mr21_css = f.read()
# Add absolute positioning to the wrapper so it fills the parent
mr21_css += """
.style-mr21 #retrobg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: 12px;
}
"""

with open("alvaromontoro_scoped.css", "r") as f:
    alvaromontoro_css = f.read()

# Let's adjust Alvaromontoro grid so it fits the card and isn't full viewport
alvaromontoro_css = alvaromontoro_css.replace('width: 100vw;', 'width: 100%;').replace('height: 100vh;', 'height: 100%;').replace('perspective: 1000px;', 'perspective: 600px;')

with open("isladjan_scoped.css", "r") as f:
    isladjan_css = f.read()
# Fix isladjan fixed positioning
isladjan_css = isladjan_css.replace('height: 100vh;', 'height: 100%;').replace('position: fixed;', 'position: absolute;')
isladjan_css += """
.style-isladjan .btn { display: none; }
.style-isladjan svg { width: 100%; height: 100%; border-radius: 12px; }
"""

# Read HTML
with open("tdoughty.html", "r") as f:
    tdoughty_html = escape_html(f.read())
with open("mr21.html", "r") as f:
    mr21_html = escape_html(f.read())
with open("alvaromontoro.html", "r") as f:
    alvaromontoro_html = escape_html(f.read())
with open("isladjan.html", "r") as f:
    isladjan_html = escape_html(f.read())

with open("testing/test-city-landscapes.html", "r") as f:
    content = f.read()

# Remove the initial hardcoded landscapes-grid to prevent weird nesting issues
content = re.sub(r'<div class="landscapes-grid" id="landscapes-grid">\s*<!-- Generated via JS -->\s*</div>', '<div id="landscapes-grid"></div>', content)

# Inject CSS
css_injection = f"""
  <style>
    /* New Scoped Styles */
    {tdoughty_css}
    {mr21_css}
    {alvaromontoro_css}
    {isladjan_css}
  </style>
"""
content = re.sub(r'</head>', css_injection + '</head>', content)

# Inject JS
js_injection = f"""
    const tdoughtyHtml = `{tdoughty_html}`;
    const mr21Html = `{mr21_html}`;
    const alvaromontoroHtml = `{alvaromontoro_html}`;
    const isladjanHtml = `{isladjan_html}`;
"""

new_script = f"""
    const grid = document.getElementById('landscapes-grid');
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "1fr"; // Force single column for large displays
    grid.style.gap = "40px";
    grid.style.width = "100%";
    grid.style.maxWidth = "800px";
    grid.style.margin = "0 auto";

    const landscapes = [
      {{ title: "tdoughty - Mountains", class: "style-tdoughty", html: tdoughtyHtml }},
      {{ title: "mr21 - Retro Synthwave", class: "style-mr21", html: mr21Html }},
      {{ title: "Alvaro Montoro - CSS City", class: "style-alvaromontoro", html: alvaromontoroHtml }},
      {{ title: "Isladjan - Interactive SVG City", class: "style-isladjan", html: isladjanHtml }}
    ];

    landscapes.forEach((l) => {{
      const card = document.createElement('div');
      card.className = 'landscape-card ' + l.class;
      card.style.height = "600px";
      card.style.width = "100%";
      card.style.position = "relative";
      card.style.border = "1px solid var(--border)";
      card.style.borderRadius = "12px";
      card.style.overflow = "hidden";
      card.innerHTML = `<h2 style="position: absolute; top: 10px; left: 10px; z-index: 1000; background: rgba(0,0,0,0.7); padding: 5px 10px; border-radius: 5px; margin: 0; font-size: 1.2rem;">${{l.title}}</h2><div style="position:relative; width:100%; height:100%; overflow:hidden;">${{l.html}}</div>`;
      grid.appendChild(card);
    }});
"""

# Replace the script content exactly
content = re.sub(r'const grid = document\.getElementById\(\'landscapes-grid\'\);.*?</script>', js_injection + new_script + '</script>', content, flags=re.DOTALL)

with open("testing/test-city-landscapes.html", "w") as f:
    f.write(content)

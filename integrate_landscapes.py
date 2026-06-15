import re

def process_css(filename, prefix):
    with open(filename, "r") as f:
        css = f.read()

    # Very basic CSS scoping: replace common root selectors with prefix
    css = re.sub(r'(?m)^body\b', f'{prefix}', css)
    css = re.sub(r'(?m)^html\b', f'{prefix}', css)
    css = re.sub(r':root', f'{prefix}', css)

    # We will scope all rules in the css string by adding prefix to them.
    # This might be tricky with regular expressions, so instead we'll just wrap the HTML in a container
    # But for some codepens, the styling is absolute to the window/body.
    # Let's see the CSS first.
    return css

# Actually it's better to just write a simple CSS parser or use a library,
# but for now let's just do some regex to add the prefix to the start of each selector.

import re

def fix_css(filename):
    with open(filename, "r") as f:
        css = f.read()

    # Fix the animation syntax bug where prefix was inserted into keyframes
    # It replaced "0% {" ... "100% {" with ".style-tdoughty 100% {"

    css = re.sub(r'\.style-[a-zA-Z0-9_-]+ (100% \{)', r'\1', css)
    css = re.sub(r'\.style-[a-zA-Z0-9_-]+ (to \{)', r'\1', css)

    with open(filename, "w") as f:
        f.write(css)

for user in ["tdoughty", "mr21", "alvaromontoro", "isladjan"]:
    fix_css(f"{user}_scoped.css")

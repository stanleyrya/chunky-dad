import urllib.request
import re

pens = [
    ("tdoughty", "bGGZWqg"),
    ("mr21", "ExVMpvK"),
    ("alvaromontoro", "vYGgZmK"),
    ("isladjan", "abdyPBw")
]

for user, pen_id in pens:
    print(f"Downloading {user}...")
    try:
        url = f"https://cdpn.io/{user}/fullembedgrid/{pen_id}?type=embed&animations=run"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        html = urllib.request.urlopen(req).read().decode('utf-8')
        with open(f"{user}_cdpn.html", "w") as f:
            f.write(html)
        print(f"Success for {user}")
    except Exception as e:
        print(f"Error for {user}: {e}")

import urllib.request

try:
    req = urllib.request.Request("https://cdpn.io/tdoughty/fullembedgrid/bGGZWqg", headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req).read().decode('utf-8')
    print(html[:500])
except Exception as e:
    print(e)

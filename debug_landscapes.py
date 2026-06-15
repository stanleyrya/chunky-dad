from playwright.sync_api import sync_playwright

def verify():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("console", lambda msg: print(f"Browser console [{msg.type}]: {msg.text}"))
        page.on("pageerror", lambda err: print(f"Browser pageerror: {err}"))
        page.goto('http://localhost:8000/testing/test-city-landscapes.html', wait_until='networkidle')
        page.wait_for_timeout(2000)
        browser.close()

if __name__ == "__main__":
    verify()

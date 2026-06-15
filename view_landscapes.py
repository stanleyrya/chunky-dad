from playwright.sync_api import sync_playwright

def verify():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto('http://localhost:8000/testing/test-city-landscapes.html', wait_until='networkidle')
        page.screenshot(path='landscapes_new.png', full_page=True)
        browser.close()
        print("Generated landscapes_new.png")

if __name__ == "__main__":
    verify()

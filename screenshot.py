from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto('http://localhost:8000/atlanta/')

    # Wait for the calendar to load (give it 3 seconds)
    page.wait_for_timeout(3000)

    page.screenshot(path='screenshot_atlanta.png', full_page=True)
    browser.close()

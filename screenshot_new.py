from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:8000/testing/test-city-landscapes.html")
    page.wait_for_timeout(3000)
    page.screenshot(path="landscapes_new.png", full_page=True)
    browser.close()

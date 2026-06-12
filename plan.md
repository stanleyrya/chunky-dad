1.  **Remove Unwanted Layouts from `testing/test-og-event-layouts-calendar.html`:**
    *   Find the `VARIANTS` array inside `CreativeCalendarPreview.render()`.
    *   Delete the entries for: Discord (`speech-discord`), Pattern: Dots (`pattern-dots`), Pattern: Stripes (`pattern-stripes`), Pattern: Grid (`pattern-grid`), Pattern: Zigzag (`pattern-zigzag`), Messenger (`speech-messenger`), Instagram (`speech-story`), Thought Cloud (`speech-thought`), Event Speaks (`speech-event`), Photo Frame (`photo-frame`), Simple Speech (`simple-speech`), Bold & Centered (`bold-centered`), Side by Side (`side-by-side`).
    *   Find and remove the corresponding HTML templates in the `buildVariantCard` method.
    *   Find and remove the corresponding CSS styles for these layouts in the `<style>` section.
2.  **Verify Removal:**
    *   Use `cat` to ensure the HTML and CSS syntax remains valid after the deletions in `testing/test-og-event-layouts-calendar.html`.
3.  **Fix Cover Image Loading:**
    *   In `getPreviewData()`, update `cover: (coverInput.value || '').trim() || (ev.image || '').trim()` to `cover: (coverInput.value || '').trim() || (ev.cover || ev.image || '').trim()` to correctly grab cover images from the event data when available.
4.  **UI Improvements:**
    *   Replace the existing header with the `<header class="tool-header">` structure used in `event-builder.html` for consistency.
    *   Update `<main>` to use `.page-wrapper` and `.layout` grid classes like `event-builder.html`.
    *   Reorganize the controls into a tighter layout using CSS classes like `.field-row`, `.field-group`, `.control-field` inside `.panel`.
    *   Copy CSS variables and general styling over from `event-builder.html` (`:root` vars, `.panel`, `.tool-header`, `.ghost-button`, etc.) to match the dark theme and neat appearance.
5.  **Verify UI Improvements:**
    *   Use `cat` to verify the CSS and HTML structures were correctly written to `testing/test-og-event-layouts-calendar.html`.
6.  **Load Favicon of the Event:**
    *   Modify `loadFaviconColors()` in `testing/test-og-event-layouts-calendar.html` to also retrieve the `url` property from the JSON array `../data/event-colors/nyc.json` into the `eventColorsMap`.
    *   Create a `getFaviconUrl()` method that extracts this `url` property from the selected event's map entry.
    *   Add an input for Favicon URL in the UI (e.g. `faviconInput`), and construct `faviconUrl: (faviconInput.value || '').trim() || (this.getFaviconUrl() ? this.getFaviconUrl() + '/favicon.ico' : '') || '../favicons/favicon-96x96.png'` in `getPreviewData()`.
    *   In `buildVariantCard`, replace generic images with `src="${data.faviconUrl}"` for elements representing logos (e.g., `<img class="brand-logo" ...>`).
7.  **Verify Favicon Changes:**
    *   Use `cat` or `grep` to verify the `src` attribute logic was correctly written and that the UI contains the new input.
8.  **Run Tests:**
    *   Run `node --test` to ensure no regressions were introduced.
9.  **Pre-commit:**
    *   Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

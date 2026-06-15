import re

with open('styles.css', 'r') as f:
    css = f.read()

# 1. Update .calendar-day.current
# Remove background, color, and box-shadow that highlights the entire card.
# Keep the top border indicator (.calendar-day.current::before) or remove it if user prefers a clean look?
# The user asked: "Instead of highlighting the full day, could we just put a --var(--primary-color) circle under the day number or something similar to show what day it is?"
# Let's clean up .calendar-day.current first.

css = re.sub(
    r'\.calendar-day\.current\s*\{[^}]*\}',
    r'.calendar-day.current {\n    border-color: var(--primary-color);\n}',
    css
)

css = re.sub(
    r'\.calendar-day\.current::before\s*\{[^}]*\}',
    r'',
    css
)

# 2. Update text colors inside .calendar-day.current
css = re.sub(
    r'\.calendar-day\.current \.day-header h3\s*\{[^}]*\}',
    r'.calendar-day.current .day-header h3 {\n    color: var(--primary-color);\n}',
    css
)

# 3. Create the circular background for .day-date and .day-number
css = re.sub(
    r'\.calendar-day\.current \.day-date\s*\{[^}]*\}',
    r'.calendar-day.current .day-date {\n    background-color: var(--primary-color);\n    color: var(--text-inverse);\n    width: 30px;\n    height: 30px;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    border-radius: 50%;\n}',
    css
)

# Replace .calendar-day.week-view.current .day-date styles with nothing, so it falls back to the above rule
css = re.sub(
    r'\.calendar-day\.week-view\.current \.day-date\s*\{[^}]*\}',
    r'',
    css
)

css = re.sub(
    r'\.calendar-day\.week-view\.current \.day-header\s*\{[^}]*\}',
    r'',
    css
)

css = re.sub(
    r'\.calendar-day\.week-view\.current h3\s*\{[^}]*\}',
    r'',
    css
)


# In .calendar-day.week-view.current, there are !important rules. Let's fix them.
css = re.sub(
    r'/\*\s*Enhanced Today Highlighting for Week View\s*\*/\s*\.calendar-day\.week-view\.current\s*\{[^}]*\}',
    r'/* Enhanced Today Highlighting for Week View */\n.calendar-day.week-view.current {\n    border-color: var(--primary-color) !important;\n}',
    css
)

css = re.sub(
    r'\.calendar-day\.week-view\.current::before\s*\{[^}]*\}',
    r'',
    css
)

css = re.sub(
    r'\.calendar-day\.week-view\.current \.day-indicator\s*\{[^}]*\}',
    r'',
    css
)

css = re.sub(
    r'\.calendar-day\.current \.day-indicator\s*\{[^}]*\}',
    r'',
    css
)

# .calendar-day.month-day.current .day-number rule will be added as well. We'll add it near .calendar-day.current .day-date
css = css.replace(
    '.calendar-day.current .day-date {\n    background-color: var(--primary-color);\n    color: var(--text-inverse);\n    width: 30px;\n    height: 30px;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    border-radius: 50%;\n}',
    '.calendar-day.current .day-date,\n.calendar-day.current .day-number {\n    background-color: var(--primary-color);\n    color: var(--text-inverse) !important;\n    width: 30px;\n    height: 30px;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    border-radius: 50%;\n    margin: 0;\n}'
)


with open('styles.css', 'w') as f:
    f.write(css)

import re

with open('styles.css', 'r') as f:
    css = f.read()

# Make sure we didn't miss removing .calendar-day.week-view.current .event-item.enhanced overrides
css = re.sub(
    r'\.calendar-day\.week-view\.current \.event-item\.enhanced\s*\{[^}]*\}',
    r'',
    css
)

css = re.sub(
    r'\.calendar-day\.week-view\.current \.event-count\s*\{[^}]*\}',
    r'',
    css
)

css = re.sub(
    r'\.calendar-day\.week-view\.current \.event-item\.enhanced:hover\s*\{[^}]*\}',
    r'',
    css
)

css = re.sub(
    r'\.calendar-day\.current \.day-header\s*\{[^}]*\}',
    r'',
    css
)

css = re.sub(
    r'\.calendar-day\.current \.no-events\s*\{[^}]*\}',
    r'',
    css
)

css = re.sub(
    r'\.calendar-day\.current \.event-item\s*\{[^}]*\}',
    r'',
    css
)

css = re.sub(
    r'\.calendar-day\.current \.event-item:hover\s*\{[^}]*\}',
    r'',
    css
)

with open('styles.css', 'w') as f:
    f.write(css)

import re

with open('styles.css', 'r') as f:
    css = f.read()

# Remove the ugly background from .calendar-day-header
css = re.sub(
    r'\.calendar-day-header\s*\{[^}]*\}',
    r'.calendar-day-header {\n    text-align: center;\n    padding: 8px 4px;\n    font-weight: 600;\n    color: var(--text-secondary);\n    border-bottom: 1px solid var(--border-light);\n    background: none;\n}',
    css
)

# And fix text color in the month day header
css = re.sub(
    r'\.calendar-day-header h4\s*\{[^}]*\}',
    r'.calendar-day-header h4 {\n    margin: 0;\n    font-size: 0.8rem;\n    font-weight: 600;\n    text-transform: uppercase;\n    letter-spacing: 0.5px;\n}',
    css
)

# Replace the media query for calendar-day-header padding if it exists
css = re.sub(
    r'@media\s*\(\w+-\w+:\s*768px\)\s*\{\s*\.calendar-day-header\s*\{[^}]*\}\s*\}',
    r'',
    css
)

# Fix the month-day number positioning/padding if needed.
# Let's verify how it looks after removing the block header backgrounds.

with open('styles.css', 'w') as f:
    f.write(css)

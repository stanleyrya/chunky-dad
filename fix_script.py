import re

with open('testing/test-city-landscapes.html', 'r') as f:
    content = f.read()

# Let's clean up testing/test-city-landscapes.html
# It appears there are multiple versions of the injected string due to previous runs.
# To be safe, we'll reset it to its git state (it has uncommitted changes).

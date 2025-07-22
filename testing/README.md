# Simplified Event Name Display System

This directory contains test files for the new simplified event name display logic.

## Overview

We've replaced the complex dynamic size-checking logic with a simple, hardcoded character limit system based on screen breakpoints.

## Character Limits

- **Super Small** (< 375px): 5 characters per line
- **Small** (375-768px): 8 characters per line  
- **Medium** (768-1024px): 12 characters per line
- **Large** (> 1024px): 20 characters per line

## Processing Rules

1. Get the character limit for the current screen size
2. Remove hyphens from shortname (except escaped `\-`)
3. If unhyphenated version fits → use it
4. Else if hyphenated version fits → use it
5. Else truncate hyphenated version with ellipsis (…)

## Test Files

- **simplified-hyphenation-test.html** - Main test file demonstrating the simplified logic
- **breakpoint-test.html** - Interactive tool for testing different screen sizes with iframe
- **multiline-breakpoint-test.html** - Advanced test for multi-line text handling (future enhancement)
- **hyphenation-test.html** - Original complex logic test (for comparison)

## Usage

In calendar data, simply include hyphens in the nickname/shortname field:

```
SUMMARY:Rockstrap Party
DESCRIPTION:Bar: The Bear Den
Nickname: Rock-strap
Cover: $15
```

To force a hyphen to always appear (e.g., in compound words), escape it:

```
SUMMARY:Co-op Bear Night
DESCRIPTION:Bar: The Co-op
Nickname: Co\-op Bears
```

## Benefits

- ✅ Simple, predictable behavior
- ✅ No complex width calculations
- ✅ Easy to test and debug
- ✅ Consistent across all views
- ✅ Respects escaped hyphens
- ✅ Performance improvement (no DOM measurements)
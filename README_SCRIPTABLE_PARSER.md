# Scriptable API Documentation Parser

This repository contains a Python parser that converts Scriptable MHTML documentation files into structured Markdown format for the comprehensive Scriptable API documentation.

## Overview

The goal is to create a complete, well-structured Markdown documentation file (`scriptable-complete-api.md`) covering all 62 Scriptable API classes and modules. This project includes:

1. A comprehensive documentation file with 20 classes already completed
2. A Python parser (`parse_scriptable_mhtml.py`) to process the remaining MHTML files
3. 50 remaining MHTML files ready for processing

## Current Progress

### ✅ Completed Classes (20/62)
The following classes are already documented in `scriptable-complete-api.md`:

1. **CallbackURL** - Open x-callback-url requests
2. **Alert** - Present alerts and dialogs 
3. **Calendar** - Access and modify calendars
4. **CalendarEvent** - Manage calendar events
5. **Color** - Represent colors with various formats
6. **Contact** - Access and modify contacts
7. **ContactsContainer** - Manage contacts containers
8. **ContactsGroup** - Manage contact groups
9. **Data** - Raw data representation (6 static methods, 3 instance methods)
10. **Device** - Device information and screen properties (25 static methods)
11. **FileManager** - Read and write files on disk (comprehensive file operations)
12. **Image** - Manage image data (static creation methods)
13. **Notification** - Schedule and manage notifications (extensive properties and methods)
14. **Request** - Perform HTTP requests (full HTTP client functionality)
15. **WebView** - Present websites and evaluate JavaScript
16. **ListWidget** - Widget showing list of elements (widget creation and management)
17. **DateFormatter** - Convert between dates and strings (comprehensive formatting patterns)
18. **Font** - Represent fonts and text sizes (system font methods)
19. **Timer** - Timer management (scheduling and invalidation)

### 📋 Remaining Classes (42/62)
The following classes still need to be processed from MHTML files:

**Core Classes:**
- DatePicker, Dictation, DocumentPicker, DrawContext
- Keychain, LinearGradient, Location
- Message, Pasteboard, Path, Photos, Point, QuickLook
- Rect, RecurrenceRule, RelativeDateTimeFormatter, Reminder
- Safari, Script, SFSymbol, ShareSheet, Size, Speech
- TextField, UITable, UITableCell, UITableRow, URLScheme
- XMLParser

**Widget Classes:**
- WidgetDate, WidgetImage, WidgetSpacer, WidgetStack, WidgetText

**Utility Modules:**
- args, config, console, importModule, module
- Scriptable Docs (main documentation)

## Parser Usage

### Basic Usage
```bash
# Parse a single MHTML file to stdout
python3 parse_scriptable_mhtml.py "data/Scriptable/Mail - Scriptable Docs.mhtml"

# Parse and save to a specific file
python3 parse_scriptable_mhtml.py "data/Scriptable/Mail - Scriptable Docs.mhtml" mail.md
```

### Example Output Structure
The parser generates structured Markdown following this pattern:

```markdown
## ClassName

Class description here.

### Properties
#### `propertyName: PropertyType`
Property description.
*Read-only.* (if applicable)

### Constructor
#### `new ClassName(param: Type)`
Constructor description.
**Parameters:**
- `param` (Type): Parameter description.

### Static Methods
#### `staticMethod(param: Type): ReturnType`
Method description.
**Parameters:**
- `param` (Type): Parameter description.
**Return value:**
- `ReturnType`: Return description.

### Methods
#### `instanceMethod(param: Type): ReturnType`
Method description.
**Parameters:**
- `param` (Type): Parameter description.
**Return value:**
- `ReturnType`: Return description.
```

## How to Complete the Documentation

### Option 1: Manual Processing
Process each file individually and append to the main documentation:

```bash
# Process a class and append to main documentation
python3 parse_scriptable_mhtml.py "data/Scriptable/DatePicker - Scriptable Docs.mhtml" >> scriptable-complete-api.md
```

### Option 2: Batch Processing Script
Create a script to process all remaining files:

```bash
#!/bin/bash
for file in data/Scriptable/*.mhtml; do
    echo "Processing $file..."
    python3 parse_scriptable_mhtml.py "$file" >> scriptable-complete-api.md
done
```

### Option 3: AI-Assisted Processing
Use an AI assistant to:
1. Run the parser on each MHTML file
2. Review and clean up the output
3. Append to the main documentation file
4. Delete processed MHTML files

## Parser Features

### What the Parser Extracts
- **Class Name**: Main heading from the MHTML
- **Description**: All description paragraphs after the main heading
- **Properties**: Property name, type, description, and read-only status
- **Constructor**: Constructor signature, description, and parameters  
- **Static Methods**: Class-level methods with full signatures
- **Instance Methods**: Object-level methods with full signatures
- **Parameters**: Name, type, and description for all method parameters
- **Return Values**: Return type and description

### Parser Limitations
- Some MHTML encoding issues may require manual cleanup
- Complex HTML structures might not parse perfectly
- Method signatures with special characters may need adjustment

## Quality Standards

Each completed class should include:
- Clear, comprehensive description
- All properties with correct types
- Constructor with parameters (if applicable)
- All static methods with signatures and descriptions
- All instance methods with signatures and descriptions
- Parameter documentation for all methods
- Return value documentation where applicable

## File Organization

```
/
├── scriptable-complete-api.md          # Main documentation (20 classes done)
├── parse_scriptable_mhtml.py           # Python parser script
├── data/
│   ├── Scriptable.zip                  # Original archive
│   └── Scriptable/                     # Extracted MHTML files (50 remaining)
│       ├── DatePicker - Scriptable Docs.mhtml
│       ├── Dictation - Scriptable Docs.mhtml
│       └── ... (48 more files)
├── mail_test.md                        # Parser test output
├── uuid_test.md                        # Parser test output
└── README_SCRIPTABLE_PARSER.md         # This file
```

## Next Steps

1. **Process Remaining Files**: Use the parser to convert all 50 remaining MHTML files
2. **Quality Review**: Ensure each class follows the established documentation pattern
3. **Integration**: Append all processed classes to `scriptable-complete-api.md`
4. **Cleanup**: Remove MHTML files after successful processing
5. **Final Review**: Verify completeness and consistency across all 62 classes

## Contributing

When processing files:
1. Test the parser output for quality
2. Make manual corrections if needed
3. Follow the established documentation structure
4. Delete MHTML files only after successful integration
5. Commit progress regularly

The goal is a comprehensive, professional API reference that developers can use to understand and implement all Scriptable functionality.
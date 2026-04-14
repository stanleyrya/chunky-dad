#!/bin/bash

# Script to set up git hooks for the project

echo "Setting up git hooks..."

# Create the pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash

# Keep shared event schema in sync (scripts/ is source of truth)
if git diff --cached --name-only | grep -Eq "^(scripts|js)/event-schema\.js$"; then
    echo "Event schema changed, syncing js/event-schema.js from scripts/event-schema.js..."
    cp scripts/event-schema.js js/event-schema.js
    git add scripts/event-schema.js js/event-schema.js
    echo "Event schema sync complete."
fi

# Check if any HTML files in testing directory have been modified
if git diff --cached --name-only | grep -Eq "^testing/.*\.html$"; then
    echo "Testing directory HTML files modified, updating manifest..."
    
    # Generate the manifest (check if node is available)
    if command -v node >/dev/null 2>&1; then
        cd testing && node generate-manifest.js
        cd ..
        echo "Manifest generated using Node.js"
    else
        echo "Node.js not available - skipping manifest generation"
        echo "Run 'npm run update-test-manifest' manually when Node.js is available"
    fi
    
    # Add the updated manifest to the commit
    git add testing/manifest.json
    
    echo "Manifest updated and added to commit."
fi

exit 0
EOF

# Make the hook executable
chmod +x .git/hooks/pre-commit

echo "Git hooks set up successfully!"
echo "The manifest.json will now be automatically updated when you commit changes to HTML files in the testing directory."
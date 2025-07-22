#!/bin/bash

# Script to set up git hooks for the project

echo "Setting up git hooks..."

# Create the pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash

# Check if any HTML files in testing directory have been modified
if git diff --cached --name-only | grep -q "^testing/.*\.html$"; then
    echo "Testing directory HTML files modified, updating manifest..."
    
    # Generate the manifest
    cd testing && node generate-manifest.js
    cd ..
    
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
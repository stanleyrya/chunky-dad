#!/usr/bin/env python3
import os
import json
import glob
from pathlib import Path

def get_html_files():
    """Get all HTML files in the current directory"""
    files = []
    current_dir = Path(__file__).parent
    
    for html_file in current_dir.glob('*.html'):
        stat = html_file.stat()
        files.append({
            'name': html_file.name,
            'size': stat.st_size,
            'modified': int(stat.st_mtime)
        })
    
    # Sort by name
    files.sort(key=lambda x: x['name'].lower())
    
    return files

if __name__ == '__main__':
    # Output headers for CGI
    print("Content-Type: application/json")
    print("Access-Control-Allow-Origin: *")
    print()
    
    # Get files and output JSON
    files = get_html_files()
    print(json.dumps({
        'success': True,
        'files': files
    }, indent=2))
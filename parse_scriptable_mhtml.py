#!/usr/bin/env python3
"""
Scriptable MHTML to Markdown Parser

This script parses Scriptable documentation MHTML files and converts them
to structured Markdown format following the established pattern.

Usage:
    python3 parse_scriptable_mhtml.py <input_mhtml_file> [output_md_file]
    
If no output file is specified, it will print to stdout.

Example:
    python3 parse_scriptable_mhtml.py "Alert - Scriptable Docs.mhtml" alert.md
"""

import sys
import re
import html
from pathlib import Path


class ScriptableMHTMLParser:
    def __init__(self, mhtml_content):
        self.content = mhtml_content
        self.class_name = ""
        self.description = ""
        self.properties = []
        self.constructor = None
        self.methods = []
        self.static_methods = []
        
    def extract_class_name(self):
        """Extract the class name from the MHTML content."""
        # Look for the main heading like <h1 id="alert">Alert</h1>
        match = re.search(r'<h1 id=3D"[^"]*">([^<]+)<', self.content)
        if match:
            self.class_name = html.unescape(match.group(1)).strip()
        return self.class_name
    
    def extract_description(self):
        """Extract the class description."""
        # Find the description paragraph after the main heading
        class_pattern = rf'<h1 id=3D"[^"]*">{re.escape(self.class_name)}<.*?</h1>(.*?)(?=<h2|$)'
        match = re.search(class_pattern, self.content, re.DOTALL)
        if match:
            section = match.group(1)
            # Extract all <p> tags from the section
            p_matches = re.findall(r'<p>([^<]+)</p>', section)
            if p_matches:
                descriptions = [html.unescape(p).strip() for p in p_matches]
                self.description = "\n\n".join(descriptions)
            
        return self.description
    
    def extract_properties(self):
        """Extract properties from the MHTML content."""
        # Look for property sections (h2 elements that aren't methods)
        property_pattern = r'<h2 id=3D"([^"]*)"[^>]*>([^<]+)<.*?</h2>(.*?)(?=<h2|<hr>|$)'
        matches = re.findall(property_pattern, self.content, re.DOTALL)
        
        for prop_id, prop_name, prop_content in matches:
            # Clean up property name
            prop_name = html.unescape(prop_name).strip()
            prop_name = re.sub(r'¶$', '', prop_name)  # Remove paragraph symbol
            
            # Skip if it's a method (contains parentheses or starts with +/-)
            if '(' in prop_name or prop_name.startswith(('+', '-')):
                continue
                
            # Extract property type from code block - more flexible pattern
            prop_type = ""
            # Try different patterns for type extraction
            type_patterns = [
                r'<span class=3D"nx">([^<]+)</span><span class=3D"o">:</span>.*?<span class=3D"nx">([^<]+)</span>',
                r'<code[^>]*>.*?<span[^>]*>([^<:]+)</span><span[^>]*>:</span>.*?<span[^>]*>([^<]+)</span>',
                r'<code[^>]*>(.*?)</code>'
            ]
            
            for pattern in type_patterns:
                type_match = re.search(pattern, prop_content, re.DOTALL)
                if type_match:
                    if len(type_match.groups()) >= 2:
                        prop_type = html.unescape(type_match.group(2)).strip()
                    else:
                        # Extract type from full code block
                        code_content = type_match.group(1)
                        code_clean = re.sub(r'<[^>]+>', '', code_content)
                        code_parts = html.unescape(code_clean).split(':')
                        if len(code_parts) >= 2:
                            prop_type = code_parts[1].strip()
                    break
            
            # Extract description - look for paragraphs after the code block
            prop_desc = ""
            desc_patterns = [
                r'</div>\s*<p>([^<]+)</p>',
                r'</code></pre></div>\s*<p>([^<]+)</p>',
                r'<p>([^<]+)</p>'
            ]
            
            for pattern in desc_patterns:
                desc_match = re.search(pattern, prop_content)
                if desc_match:
                    prop_desc = html.unescape(desc_match.group(1)).strip()
                    break
            
            # Check for read-only
            is_readonly = '<em>Read-only.</em>' in prop_content
            
            self.properties.append({
                'name': prop_name,
                'type': prop_type,
                'description': prop_desc,
                'readonly': is_readonly
            })
        
        return self.properties
    
    def extract_methods(self):
        """Extract methods and static methods."""
        # Look for method sections (h2 elements that contain parentheses or +/-)
        method_pattern = r'<h2 id=3D"[^"]*"[^>]*>([^<]+)<.*?</h2>(.*?)(?=<h2|$)'
        matches = re.findall(method_pattern, self.content, re.DOTALL)
        
        for method_name, method_content in matches:
            method_name = html.unescape(method_name).strip()
            method_name = re.sub(r'¶$', '', method_name)  # Remove paragraph symbol
            
            # Skip if not a method
            if not ('(' in method_name or method_name.startswith(('+', '-'))):
                continue
            
            # Determine if static method
            is_static = method_name.startswith('+')
            is_constructor = method_name.startswith('-new ')
            
            # Clean method name
            clean_name = method_name
            if method_name.startswith(('+', '-')):
                clean_name = method_name[1:]
            
            # Extract method signature from code block - improved extraction
            signature = ""
            sig_patterns = [
                r'<div class=3D"codehilite">.*?<code[^>]*>(.*?)</code>',
                r'<pre><span></span><code>(.*?)</code></pre>'
            ]
            
            for pattern in sig_patterns:
                sig_match = re.search(pattern, method_content, re.DOTALL)
                if sig_match:
                    sig_html = sig_match.group(1)
                    # Clean up HTML tags and decode
                    sig_clean = re.sub(r'<[^>]+>', '', sig_html)
                    signature = html.unescape(sig_clean).strip()
                    # Remove line breaks and extra spaces
                    signature = ' '.join(signature.split())
                    break
            
            # Extract description - look for first paragraph after code block
            method_desc = ""
            desc_patterns = [
                r'</div>\s*<p>([^<]+)</p>',
                r'</pre></div>\s*<p>([^<]+)</p>',
                r'<p>([^<]+)</p>'
            ]
            
            for pattern in desc_patterns:
                desc_match = re.search(pattern, method_content)
                if desc_match:
                    method_desc = html.unescape(desc_match.group(1)).strip()
                    break
            
            # Extract parameters
            parameters = []
            param_section = re.search(r'<h3[^>]*>Parameters<.*?</h3>(.*?)(?=<h3|<hr>|$)', method_content, re.DOTALL)
            if param_section:
                param_matches = re.findall(r'<p><strong>([^<]+)</strong><br>\s*<em>([^<]+)</em><br>\s*([^<]+)</p>', param_section.group(1))
                for param_name, param_type, param_desc in param_matches:
                    parameters.append({
                        'name': html.unescape(param_name).strip(),
                        'type': html.unescape(param_type).strip(),
                        'description': html.unescape(param_desc).strip()
                    })
            
            # Extract return value
            return_value = ""
            return_section = re.search(r'<h3[^>]*>Return value<.*?</h3>(.*?)(?=<h3|<hr>|$)', method_content, re.DOTALL)
            if return_section:
                return_match = re.search(r'<p><em>([^<]+)</em><br>\s*([^<]+)</p>', return_section.group(1))
                if return_match:
                    return_type = html.unescape(return_match.group(1)).strip()
                    return_desc = html.unescape(return_match.group(2)).strip()
                    return_value = f"{return_type}: {return_desc}"
            
            method_info = {
                'name': clean_name,
                'signature': signature,
                'description': method_desc,
                'parameters': parameters,
                'return_value': return_value
            }
            
            if is_constructor:
                self.constructor = method_info
            elif is_static:
                self.static_methods.append(method_info)
            else:
                self.methods.append(method_info)
        
        return self.methods, self.static_methods
    
    def parse(self):
        """Parse the MHTML content and extract all information."""
        self.extract_class_name()
        self.extract_description()
        self.extract_properties()
        self.extract_methods()
        return self
    
    def to_markdown(self):
        """Convert the parsed information to Markdown format."""
        md_lines = []
        
        # Class name and description
        md_lines.append(f"## {self.class_name}")
        md_lines.append("")
        if self.description:
            md_lines.append(self.description)
            md_lines.append("")
        
        # Properties
        if self.properties:
            md_lines.append("### Properties")
            md_lines.append("")
            for prop in self.properties:
                type_str = f": {prop['type']}" if prop['type'] else ""
                md_lines.append(f"#### `{prop['name']}{type_str}`")
                md_lines.append("")
                if prop['description']:
                    md_lines.append(prop['description'])
                    md_lines.append("")
                if prop['readonly']:
                    md_lines.append("*Read-only.*")
                    md_lines.append("")
        
        # Constructor
        if self.constructor and self.constructor['signature']:
            md_lines.append("### Constructor")
            md_lines.append("")
            md_lines.append(f"#### `{self.constructor['signature']}`")
            md_lines.append("")
            if self.constructor['description']:
                md_lines.append(self.constructor['description'])
                md_lines.append("")
            
            if self.constructor['parameters']:
                md_lines.append("**Parameters:**")
                for param in self.constructor['parameters']:
                    md_lines.append(f"- `{param['name']}` ({param['type']}): {param['description']}")
                md_lines.append("")
            
            if self.constructor['return_value']:
                md_lines.append("**Return value:**")
                md_lines.append(f"- `{self.constructor['return_value']}`")
                md_lines.append("")
        
        # Static Methods
        if self.static_methods:
            md_lines.append("### Static Methods")
            md_lines.append("")
            for method in self.static_methods:
                if method['signature']:
                    md_lines.append(f"#### `{method['signature']}`")
                    md_lines.append("")
                    if method['description']:
                        md_lines.append(method['description'])
                        md_lines.append("")
                    
                    if method['parameters']:
                        md_lines.append("**Parameters:**")
                        for param in method['parameters']:
                            md_lines.append(f"- `{param['name']}` ({param['type']}): {param['description']}")
                        md_lines.append("")
                    
                    if method['return_value']:
                        md_lines.append("**Return value:**")
                        md_lines.append(f"- `{method['return_value']}`")
                        md_lines.append("")
        
        # Instance Methods
        if self.methods:
            md_lines.append("### Methods")
            md_lines.append("")
            for method in self.methods:
                if method['signature']:
                    md_lines.append(f"#### `{method['signature']}`")
                    md_lines.append("")
                    if method['description']:
                        md_lines.append(method['description'])
                        md_lines.append("")
                    
                    if method['parameters']:
                        md_lines.append("**Parameters:**")
                        for param in method['parameters']:
                            md_lines.append(f"- `{param['name']}` ({param['type']}): {param['description']}")
                        md_lines.append("")
                    
                    if method['return_value']:
                        md_lines.append("**Return value:**")
                        md_lines.append(f"- `{method['return_value']}`")
                        md_lines.append("")
        
        md_lines.append("---")
        md_lines.append("")
        
        return "\n".join(md_lines)


def parse_mhtml_file(input_file, output_file=None):
    """Parse an MHTML file and convert to Markdown."""
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            content = f.read()
    except UnicodeDecodeError:
        # Try with different encoding
        with open(input_file, 'r', encoding='latin-1') as f:
            content = f.read()
    
    parser = ScriptableMHTMLParser(content)
    parser.parse()
    markdown = parser.to_markdown()
    
    if output_file:
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(markdown)
        print(f"Converted {input_file} -> {output_file}")
    else:
        print(markdown)
    
    return markdown


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 parse_scriptable_mhtml.py <input_mhtml_file> [output_md_file]")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None
    
    if not Path(input_file).exists():
        print(f"Error: Input file '{input_file}' not found")
        sys.exit(1)
    
    parse_mhtml_file(input_file, output_file)


if __name__ == "__main__":
    main()
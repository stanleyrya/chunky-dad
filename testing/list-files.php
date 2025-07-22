<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$files = [];
$dir = __DIR__;

// Scan directory for HTML files
if ($handle = opendir($dir)) {
    while (false !== ($entry = readdir($handle))) {
        if ($entry != "." && $entry != ".." && pathinfo($entry, PATHINFO_EXTENSION) === 'html') {
            $filepath = $dir . '/' . $entry;
            $files[] = [
                'name' => $entry,
                'size' => filesize($filepath),
                'modified' => filemtime($filepath)
            ];
        }
    }
    closedir($handle);
}

// Sort by name
usort($files, function($a, $b) {
    return strcasecmp($a['name'], $b['name']);
});

echo json_encode([
    'success' => true,
    'files' => $files
]);
?>
console.log('Testing address extraction patterns...');

const testCases = [
    {
        title: 'Trade venue test',
        html: '<div>Trade</div><div>1439 W Colfax Ave, Denver, CO 80204</div>',
        expected: '1439 W Colfax Ave, Denver, CO 80204'
    },
    {
        title: 'TBA venue test', 
        html: '<div>TBA</div><div>West Hollywood, CA</div>',
        expected: 'West Hollywood, CA'
    }
];

const patterns = [
    /TBA[^>]*<\/div>[^<]*<div[^>]*>([^<]+)<\/div>/i,
    /(?:Trade|Falcon North)[^>]*<\/div>[^<]*<div[^>]*>([^<]+)<\/div>/i,
];

testCases.forEach((test, i) => {
    console.log(`\nTest ${i + 1}: ${test.title}`);
    console.log(`HTML: ${test.html}`);
    
    let found = false;
    patterns.forEach((pattern, j) => {
        const match = test.html.match(pattern);
        if (match && match[1]) {
            console.log(`Pattern ${j + 1} found: "${match[1]}"`);
            if (match[1] === test.expected) {
                console.log('✅ PASS');
                found = true;
            }
        }
    });
    
    if (!found) {
        console.log('❌ FAIL - No pattern matched');
    }
});

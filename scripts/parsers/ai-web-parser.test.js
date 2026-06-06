const test = require('node:test');
const assert = require('node:assert/strict');

const { AiWebParser } = require('./ai-web-parser');

function normalizeUrl(url, baseUrl = 'https://furball.example/events') {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value, baseUrl || 'https://furball.example/events').toString();
  } catch (_) {
    return '';
  }
}

function createParser(dependencies = {}) {
  return new AiWebParser({ normalizeUrl }, dependencies);
}

test('pairs nearby row-split event images to the matching multi-event segments', () => {
  const parser = createParser();
  const sourceUrl = 'https://furball.example/events';
  const html = `
    <html>
      <body>
        <section class="page-hero">
          <img src="/images/hero-banner.jpg" alt="Hero banner" />
        </section>

        <section class="events-grid">
          <div class="event-card-image"><img src="/images/event-1.jpg" alt="Furball Blackout flyer" /></div>
          <div class="event-card-image"><img src="/images/event-2.jpg" alt="Furball Pool Party flyer" /></div>
        </section>

        <article class="event-card-copy">
          <p>July 10, 2026</p>
          <h3>FURBALL BLACKOUT</h3>
          <p>3 Dollar Bill</p>
        </article>
        <article class="event-card-copy">
          <p>July 24, 2026</p>
          <h3>FURBALL POOL PARTY</h3>
          <p>Elsewhere Rooftop</p>
        </article>

        <article class="event-card">
          <div class="event-card-image"><img src="/images/event-3.jpg" alt="Furball Summer Bash flyer" /></div>
          <div class="event-card-copy">
            <p>August 14, 2026</p>
            <h3>FURBALL SUMMER BASH</h3>
            <p>Knockdown Center</p>
          </div>
        </article>

        <article class="event-card">
          <div class="event-card-image"><img src="/images/event-4.jpg" alt="Furball Labor Day flyer" /></div>
          <div class="event-card-copy">
            <p>September 4, 2026</p>
            <h3>FURBALL LABOR DAY</h3>
            <p>House of Yes</p>
          </div>
        </article>
      </body>
    </html>
  `;

  const segments = parser.buildMultiEventSegments(html, sourceUrl);
  assert.equal(segments.length, 4);

  const pairedImages = segments.map(segment => {
    const diagnostics = parser.describeMultiEventSegment(segment, sourceUrl);
    return diagnostics.imageUrls[0] || '';
  });

  assert.deepEqual(pairedImages, [
    'https://furball.example/images/event-1.jpg',
    'https://furball.example/images/event-2.jpg',
    'https://furball.example/images/event-3.jpg',
    'https://furball.example/images/event-4.jpg'
  ]);
  assert.ok(!pairedImages.includes('https://furball.example/images/hero-banner.jpg'));
  assert.deepEqual(segments.slice(0, 2).map(segment => segment.imageHintUrls), [
    ['https://furball.example/images/event-1.jpg'],
    ['https://furball.example/images/event-2.jpg']
  ]);
  assert.deepEqual(segments.slice(2).map(segment => segment.imageHintUrls || null), [null, null]);
});

test('reuses bulk OCR summary results to select the best recovery image', async () => {
  let runOcrOnAllImagesCalls = 0;
  let singleImageOcrCalls = 0;
  let receivedSnippets = [];

  const parser = createParser({
    runOcrOnAllImages: async source => {
      runOcrOnAllImagesCalls += 1;
      assert.equal(source.url, 'https://furball.example/events');
      assert.deepEqual(source.imageUrls, [
        'https://furball.example/images/hero.jpg',
        'https://furball.example/images/event-poster.jpg'
      ]);
      return [
        {
          src: 'https://furball.example/images/hero.jpg',
          text: 'Welcome to Furball',
          classification: 'background image',
          confidence: 0.95
        },
        {
          src: 'https://furball.example/images/event-poster.jpg',
          text: 'FURBALL BLACKOUT July 10 2026 3 Dollar Bill',
          classification: 'event promotional art',
          confidence: 0.88,
          cached: true
        }
      ];
    }
  });

  parser.getOcrTextForImage = async () => {
    singleImageOcrCalls += 1;
    throw new Error('single-image OCR should not run when summary results already exist');
  };
  parser.extractFieldsAcrossSnippets = async (htmlData, aiConfig, cityConfig, parserConfig, promptFields, snippets) => {
    receivedSnippets = snippets;
    return { description: 'Recovered from OCR summary' };
  };
  parser.mergeAiEventFields = (existing, partial) => ({ ...existing, ...partial });

  const result = await parser.recoverMissingFieldsFromImages(
    {
      html: `
        <img src="/images/hero.jpg" alt="Hero" />
        <img src="/images/event-poster.jpg" alt="Poster" />
      `,
      url: 'https://furball.example/events'
    },
    { endpoint: 'http://localhost:11434/api/generate', model: 'qwen3.5:4b' },
    {},
    {
      ai: {
        ocr: {
          enabled: true,
          endpoint: 'http://localhost:11434/api/generate',
          model: 'qwen2.5vl:3b',
          cache: true
        }
      }
    },
    ['description'],
    {
      title: 'FURBALL BLACKOUT',
      startDate: '2026-07-10T20:00:00-04:00'
    },
    { validatedFields: new Set() },
    null
  );

  assert.equal(runOcrOnAllImagesCalls, 1);
  assert.equal(singleImageOcrCalls, 0);
  assert.equal(result.merged.description, 'Recovered from OCR summary');
  assert.equal(result.diagnostics.selectionSource, 'summary');
  assert.equal(result.diagnostics.candidateImageCount, 2);
  assert.equal(result.diagnostics.summaryImageCount, 2);
  assert.equal(result.diagnostics.processedImageCount, 1);
  assert.equal(result.diagnostics.cacheHits, 1);
  assert.deepEqual(result.diagnostics.recoveredFields, ['description']);
  assert.equal(receivedSnippets.length, 1);
  assert.match(receivedSnippets[0], /OCR_IMAGE_URL: https:\/\/furball\.example\/images\/event-poster\.jpg/);
});

test('uses segment hinted image URLs directly for OCR recovery', async () => {
  let runOcrOnAllImagesCalls = 0;
  const singleImageOcrCalls = [];
  let receivedSnippets = [];

  const parser = createParser({
    runOcrOnAllImages: async () => {
      runOcrOnAllImagesCalls += 1;
      return [];
    }
  });

  parser.getOcrTextForImage = async imageUrl => {
    singleImageOcrCalls.push(imageUrl);
    return {
      imageUrl,
      text: 'FURBALL POOL PARTY July 24 2026 Elsewhere Rooftop',
      classification: 'event promotional art',
      confidence: 0.92,
      cached: true
    };
  };
  parser.extractFieldsAcrossSnippets = async (htmlData, aiConfig, cityConfig, parserConfig, promptFields, snippets) => {
    receivedSnippets = snippets;
    return { description: 'Recovered from segment OCR' };
  };
  parser.mergeAiEventFields = (existing, partial) => ({ ...existing, ...partial });

  const result = await parser.recoverMissingFieldsFromImages(
    {
      html: `
        SEGMENT_INDEX: 2/4
        SEGMENT_IMAGE_HINT_URL: https://furball.example/images/event-2.jpg
        <article class="event-card-copy">
          <p>July 24, 2026</p>
          <h3>FURBALL POOL PARTY</h3>
        </article>
      `,
      url: 'https://furball.example/events'
    },
    { endpoint: 'http://localhost:11434/api/generate', model: 'qwen3.5:4b' },
    {},
    {
      ai: {
        ocr: {
          enabled: true,
          endpoint: 'http://localhost:11434/api/generate',
          model: 'qwen2.5vl:3b'
        }
      }
    },
    ['description'],
    {
      title: 'FURBALL POOL PARTY',
      startDate: '2026-07-24T20:00:00-04:00'
    },
    { validatedFields: new Set() },
    null
  );

  assert.equal(runOcrOnAllImagesCalls, 0);
  assert.deepEqual(singleImageOcrCalls, ['https://furball.example/images/event-2.jpg']);
  assert.equal(result.merged.description, 'Recovered from segment OCR');
  assert.equal(result.diagnostics.selectionSource, 'segment-image-hints');
  assert.equal(result.diagnostics.candidateImageCount, 1);
  assert.equal(result.diagnostics.summaryImageCount, 0);
  assert.equal(result.diagnostics.processedImageCount, 1);
  assert.equal(result.diagnostics.cacheHits, 1);
  assert.equal(receivedSnippets.length, 1);
  assert.match(receivedSnippets[0], /OCR_IMAGE_URL: https:\/\/furball\.example\/images\/event-2\.jpg/);
});

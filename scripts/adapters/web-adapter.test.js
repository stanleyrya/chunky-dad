const test = require('node:test');
const assert = require('node:assert/strict');

const { WebAdapter } = require('./web-adapter');

test('runOcrOnAllImages uses the source URL as the OCR summary cache key', async () => {
  const adapter = new WebAdapter();
  let summaryKey = null;

  adapter.readCachedOcrSummary = async key => {
    summaryKey = key;
    return {
      successful: 1,
      imageCount: 1,
      results: [
        {
          src: 'https://furball.example/images/event-poster.jpg',
          text: 'FURBALL BLACKOUT July 10 2026'
        }
      ]
    };
  };

  const results = await adapter.runOcrOnAllImages(
    {
      html: '<img src="/images/event-poster.jpg" alt="Poster" />',
      url: 'https://furball.example/events',
      imageUrls: ['/images/event-poster.jpg']
    },
    { cacheEnabled: true }
  );

  assert.equal(summaryKey, 'https://furball.example/events');
  assert.deepEqual(results, [
    {
      src: 'https://furball.example/images/event-poster.jpg',
      text: 'FURBALL BLACKOUT July 10 2026'
    }
  ]);
});

// Preload for CI test runs (NODE_OPTIONS=--require ./scripts/test-quiet-console.js).
//
// The scraper modules log heavily via console.log, and node --test streams every
// child-process stdout byte through the test runner's IPC socket. At CI volume
// that intermittently corrupts the stream and kills the run with "Unable to
// deserialize cloned data due to invalid or unsupported version" — a runner bug,
// not a test failure. Silencing info-level noise removes the trigger.
//
// warn/error stay visible; tests that assert on console output install their own
// spies and are unaffected. Set VERBOSE_TESTS=1 to disable the silencing.
if (!process.env.VERBOSE_TESTS) {
    const noop = () => {};
    console.log = noop;
    console.info = noop;
    console.debug = noop;
}

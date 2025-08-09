// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: book-open;

// Display Saved Bear Event Scraper Run
// Loads previously saved run JSON from iCloud and renders via ScriptableAdapter
// 
// MODES:
// - Widget/Read-Only (readOnly: true): Safe viewing only, no calendar operations
// - Manual Run (readOnly: false): Allows calendar updates for saved run data

try {
  const { ScriptableAdapter } = importModule('adapters/scriptable-adapter');
  const adapter = new ScriptableAdapter();

  // Options: change these to control behavior
  const OPTIONS = {
    last: false,           // set true to auto-load most recent
    runId: null,           // or set to a specific runId like "20250101-120000"
    presentHistory: true,  // default: present a picker
    readOnly: true         // WIDGET SAFE: set false to allow calendar updates when running manually
  };

  await adapter.displaySavedRun(OPTIONS);
} catch (e) {
  console.error(`Display Saved Run failed: ${e.message}`);
  const alert = new Alert();
  alert.title = 'Display Saved Run Error';
  alert.message = `${e.message}`;
  alert.addAction('OK');
  await alert.present();
}
const { SharedCore } = require('./scripts/shared-core.js');

const core = new SharedCore();

const existing = {
  title: 'Megawoof: DURO',
  startDate: '2025-08-17T05:00:00.000Z',
  endDate: '2025-08-17T09:00:00.000Z',
  notes: 'Tea: Location TBA, but likely in a dark DTLA warehouse 😈 Be sure to follow them on IG for location, updates, and more!\nInstagram: https://www.instagram.com/megawoof_america?igsh=MWg3dHltdmpwYjZzaQ=='
};

const newEvent = {
  title: 'MEGAWOOF',
  startDate: '2025-08-17T05:00:00.000Z',
  endDate: '2025-08-17T10:00:00.000Z',
  url: 'https://www.eventbrite.com/e/duro-summer-night-foam-edition-tickets-1446957562019',
  venue: 'TBA',
  image: 'https://img.evbuc.com/https%3A%2F%2Fcdn.evbuc.com%2Fimages%2F1074412243%2F185013722403%2F1%2Foriginal.20250716-002220?crop=focalpoint&fit=crop&h=230&w=460&auto=format%2Ccompress&q=75&sharp=10&fp-x=0.5&fp-y=0.5&s=59b8e3f4c9f6ab9142960372a78ee67d',
  shortTitle: 'MEGA-WOOF',
  instagram: 'https://www.instagram.com/megawoof_america',
  key: 'megawoof|2025-08-17|tba|eventbrite',
  _fieldMergeStrategies: {
    title: 'clobber',
    shortTitle: 'upsert',
    instagram: 'clobber',
    description: 'preserve',
    venue: 'clobber',
    startDate: 'clobber',
    endDate: 'clobber',
    website: 'upsert',
    gmaps: 'upsert'
  }
};

const final = core.createFinalEventObject(existing, newEvent);
console.log('--- FINAL NOTES ---');
console.log(final.notes);
console.log('--- PARSED FIELDS ---');
console.log(core.parseNotesIntoFields(final.notes));
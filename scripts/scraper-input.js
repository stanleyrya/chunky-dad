// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: purple; icon-glyph: magic;
// Bear Event Scraper Configuration
// This file contains the runtime configuration for the bear event scraper system.
//
// USAGE RESTRICTIONS:
// - This is a pure JavaScript configuration file
// - Must export a default configuration object
// - Can be imported in both Scriptable and web environments
// - Keep this file environment-agnostic (no Scriptable or DOM APIs)

const scraperConfig = {
  // ───────────────────────────────────────────────────────────────────────
  // PARSERS FIRST — the list you actually browse on the phone. Run settings
  // (config) moved below the parser list; nothing else changed.
  // ───────────────────────────────────────────────────────────────────────
  parsers: [
    // NOTE: Promoter identity (shortName/socials/matchKey) and bear trust
    // (bearAffinity) live in data/promoters.json now — the enforce-mode
    // promoter registry stamps them on matched events. Parser entries here
    // are pure SOURCES (name/urls/crawl knobs); only VENUE parsers still
    // carry a metadata block (venue facts, not promoter identity).
    {
      name: "Megawoof America",
      urls: ["https://www.eventbrite.com/o/megawoof-america-18118978189"],
    },
    {
      name: "Coach After Dark",
      urls: ["https://www.eventbrite.com/o/bear-happy-hour-87043830313"],
    },
    {
      name: "Bearracuda Events",
      urls: [
        "https://bearracuda.com/",
        "https://www.eventbrite.com/o/bearracuda-21867032189",
      ],
    },
    {
      name: "CHUNK",
      urls: ["https://www.chunk-party.com"],
      // Deliberate exclusions only — /shop, /contact, /_api/ are blocked built-in
      discoveryBlockedPatterns: [
        "chunk-party.com/chunkbearandcubsocial",
        "chunk-party.com/chunk",
      ],
    },
    {
      name: "Furball",
      urls: ["https://www.furball.nyc"],
      urlDiscoveryDepth: 0,
    },
    {
      name: "Cubhouse",
      urls: ["https://linktr.ee/cubhouse"],
      discoveryBlockedPatterns: ["www.eventbrite.com/o/", "linktr.ee"],
    },
    {
      name: "Goldiloxx",
      // Homeless promoter — events scatter across ticketing platforms (links
      // rotate in their Instagram bio). Stable doors: the RedEye JSON API
      // search (self-refreshing; JSON-API pathway extracts it structurally)
      // and Sickening's own server-side search, scoped to the promoter.
      urls: [
        "https://api.redeyetickets.com/api/v1/events/search?q=goldiloxx&per_page=25",
        // `?q=` is Sickening's real search input (`<input name="q">` on the
        // events page, GET to the same path) and it filters SERVER-side —
        // verified 2026-08-04: unfiltered = 1,227,723 bytes / 453 distinct
        // /e/ links, `?q=goldiloxx` = 61,756 bytes / 2 links (both
        // goldiloxx), `?q=<nonsense>` = 0 links. Same 2 events either way,
        // 20x less page, and segmentation drops from 485 segments to ~2.
        // JSON-LD and the visible date strings both survive the filter.
        "https://sickening.events/events?q=goldiloxx",
      ],
      // Kept as a safety net for the RedEye door and any followed link. NOTE:
      // now that the sickening URL itself contains the pattern, the allowlist
      // treats that page as the promoter's own and stops filtering it — which
      // is correct (the page IS scoped to goldiloxx) but means the net is only
      // as tight as Sickening's search. Verified non-fuzzy: q=goldiloxx
      // returns goldiloxx links only. Note also that sickening JSON-LD
      // "organizer" is the VENUE, and the site soft-404s (every URL returns
      // 200 with an empty shell), so "no events" and "site broken" look alike.
      discoveryAllowedPatterns: ["goldiloxx"],
    },
    {
      name: "3 Dollar Bill",
      // Brooklyn queer venue (260 Meserole St; second space The Yard @ 270
      // Meserole Ave — per-event JSON-LD location is authoritative).
      // Squarespace, server-rendered listing, JSON-LD Event on event pages.
      // Heavy queer programming, bear events (Bear Tea) are a subset —
      // bear check filters, not alwaysBear.
      urls: ["https://www.3dollarbillbk.com/rsvp"],
      alwaysBear: false,
      metadata: {
        website: { value: "https://www.3dollarbillbk.com" },
        instagram: { value: "https://www.instagram.com/3dollarbillbk" },
      },
    },
    {
      name: "Rockbar",
      // West Village leather/rock bar (185 Christopher St) with heavy bear
      // programming (Gorditos, Underbear, Bears Night Out, Rockstrap). The
      // venue's own site is the identity source: Squarespace, one page per
      // party (/events/<slug>, each with a ?format=ical link).
      //
      // /calendar, NOT /events. The Squarespace /events collection has been
      // frozen since Aug 2024 (its own feed reports 0 upcoming, 7 past) and the
      // bar moved its programming to the Elfsight calendar widget the site's
      // nav actually links — 146 events with exact times, an IANA timezone and
      // real recurrence, read via collectElfsightCalendarEvents. Live dates no
      // longer depend on the Thotyssey aggregator entry below merging in.
      // Kink/pup nights are on the same calendar — bear check filters, not
      // alwaysBear.
      urls: ["https://www.rockbarnyc.com/calendar"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: {
        website: { value: "https://www.rockbarnyc.com" },
        instagram: { value: "https://www.instagram.com/rockbarnyc" },
      },
    },
    {
      name: "Twisted Bear",
      // discoveryOnly: true,
      urls: [
        "https://www.eventbrite.com/o/nab-events-llc-51471535173",
        "https://www.eventbrite.com/o/121474797695",
      ],
    },
    {
      name: "Dallas Eagle",
      // Venue-site repoint (2026-08-02, same shape as the Eagle LA fix in
      // #1609): the Eventbrite org page /o/77139864473 is structurally dry —
      // it lists nothing while the real events (dated "Start from:/End at:"
      // listings plus "Every Wednesday" weeklies) live on the venue's own
      // /events/ page, whose links the org-page crawl rejected as cross-host.
      // The "End at:" start-time trap is covered by #1540's end-marker gate;
      // dateless weeklies flow into the #1616 ICS-only recurrence path.
      urls: ["https://www.thedallaseagle.com/events/"],
      metadata: {
        website: { value: "https://www.thedallaseagle.com" },
        facebook: { value: "https://www.facebook.com/lonestareagle" },
        instagram: { value: "https://www.instagram.com/thedallaseagle/" },
        mastodon: { value: "https://mastodon.social/@dallaseagle" },
      },
    },
    { name: "massive.club", urls: ["https://www.massive.club"], alwaysBear: false },
    // ── Festival-week schedules 2026-07-28 (recon-verified) ─────────────
    {
      name: "Bears Sitges Week",
      // Official Bears Sitges Club programme — one long WordPress page,
      // ~45 timed activities Sept 3-13 with venues inline. Spanish text;
      // day headers carry day-of-month only (month/year stated once).
      urls: ["https://bearssitges.org/bears-sitges-week/"],
      urlDiscoveryDepth: 0, // everything on one page; discovery wanders into store/news
      ai: { classifyPages: false }, // heuristic multi-event-page is CORRECT here; the AI
      // second opinion sees "one overarching event" (festival-programme trap) and
      // reroutes to single-event extraction, whose payload window misses the schedule
    },
    {
      name: "Spooky Bear",
      // Northeast Ursamen's Provincetown Halloween weekend. 2026 schedule
      // publishes on THIS url ~Sept/Oct (2025 precedent: full text schedule,
      // venues inline, weekday-only headers — dates anchor to the announced
      // range). Idles harmlessly until then.
      urls: ["https://www.ursamen.org/spookybear"],
      urlDiscoveryDepth: 1, // follow Zeffy/ThunderTix ticket links
      discoveryBlockedPatterns: ["ursamen.org/about", "ursamen.org/contact", "ursamen.org/the-board", "ursamen.org/our-sponsors", "ursamen.org/general-events", "coming-soon", "zeffy.com/donation-form"],
    },
    // ── Onboarding batch 2026-07-27 (recon-verified) — run each one alone
    // via the parser picker and review before including it in bigger runs. ──
    {
      name: "The Lumberyard",
      urls: ["https://www.thelumberyardbar.com/events"],
      // Seattle bear-friendly bar (9630 16th Ave SW) with general weekly
      // programming — bear check filters, not alwaysBear.
      alwaysBear: false,
      metadata: {
        website: { value: "https://www.thelumberyardbar.com" },
      },
    },
    {
      name: "Eagle LA",
      // Venue parser, not a promoter one: eaglela.com is Eagle LA's own site
      // (The Events Calendar, JSON-LD) and it hosts many bear parties, not
      // just CubScout. This used to point at the single event page
      // /events/cub-scout-3/, which meant (a) every other Eagle LA night was
      // invisible — the archive lists BEAR HAPPY HOUR, SUNDAY BEER BUST, MEAT
      // RACK, ONYX, CUBSCOUT and more in August 2026 alone — and (b) the slug
      // was a hardcoded guess: a renamed series (cub-scout-4) would 404 and
      // the parser would go quiet without failing. The listing archive is the
      // stable entry point; the crawler reaches each occurrence from there.
      //
      // "Eagle LA" is a curated bar (data/bars/la.json), so the venue-site
      // identity path resolves the site to the venue and events keep their own
      // party names (CUBSCOUT, ONYX, …) with bar="Eagle LA" — the brand
      // prefixer is a no-op on venue-role sites. The CubScout LA PROMOTER
      // entry in scraper-promoters.js is unchanged and still claims the
      // CUBSCOUT title alias.
      //
      // /calendar/ is the MEC month grid — it lists MORE of the month than
      // the /events/ archive (25 vs 12 in Aug 2026) and is where the
      // month-feed lookahead fetches next month's grid from.
      //
      // NOT alwaysBear (owner call, 2026-08-11): the venue hosts many
      // non-bear nights, so trusted-source keep-everything would flood the
      // review pile. The bear check does over-drop flagship parties here
      // (run 20260811-132948 dropped MEAT RACK, ONYX, SUNDAY BEER BUST as
      // "no bear-specific vocabulary") — the intended remedy is persistent
      // manual bear verdicts, not alwaysBear.
      urls: ["https://eaglela.com/events/", "https://eaglela.com/calendar/"],
    },
    {
      name: "BEEFMINCE",
      // Multi-city UK (London/Brighton/Manchester/Birmingham + Sitges);
      // per-event city comes from event text; tickets link out to dice.fm.
      urls: ["https://beefmince.com/events"],
    },
    {
      name: "BeefDip",
      // Puerto Vallarta bear week; single schedule page, venues appear as
      // Google Maps links (maps-link address harvesting applies).
      urls: ["https://beefdip.com/planned-events/"],
    },
    {
      name: "Bear it MTL",
      // Montreal (Sugar Bear Weekend organizer); The Events Calendar with
      // JSON-LD + Offers; also lists Toronto/Paris events — city per event.
      urls: ["https://www.bearitmtl.com/events/"],
    },
    {
      name: "Club Chub",
      // Touring chub/chaser series; Eventbrite links sit in the site's own
      // static HTML. Do NOT use the Eventbrite org page — it's CCBC Resort's
      // venue account and would pull non-Club-Chub events.
      urls: ["https://www.clubchubusa.com/event-list"],
    },
    {
      name: "The Bear Calendar",
      // Automation switched on 2026-09-19: the hand runs of that day showed
      // the first-run verification below holding (12 aggregator dupes
      // merged by ticket-url identity, websites the original hosts).
      // Aggregator (Astro, server-rendered). The listing links /feed.ics and
      // serves /feed.json — the crawler finds that door itself (🚪 MACHINE
      // DOOR) and reads the whole upcoming set in one request: title, venue,
      // city/country, ticket_url (the original ticketing/promoter link),
      // website_url, image, rrule. The feed labels local wall-clock times
      // "UTC"; the JSON-API reader verifies that against the site's own
      // event page and reads them as local time (🕒 FEED CLOCK).
      // First-run verification: Megawoof/Twisted Bear dupes must dedup via
      // ticket-url identity; websites must be original URLs, never this host.
      urls: ["https://thebearcalendar.com/events/"],
      alwaysBear: true,
      urlDiscoveryDepth: 1,
      maxAdditionalUrls: 60,
    },
    {
      name: "Thotyssey",
      // Aggregator (NYC nightlife calendar, hosted on Tockify). The
      // bear-tagged JSON feed replays browser-free: title, epoch-millis
      // times with tzid, venue name (`place`) and full address per row, so
      // venues (Rockbar, Eagle NYC, 3 Dollar Bill …) are attributed without
      // any venue role here. Rows are pre-expanded occurrences; the feed
      // serves 100 per request (server-capped; metaData.hasNext signals
      // more), ≈3–4 weeks for this tag, refreshed every run — startms=
      // paging exists if a longer horizon is ever wanted. Editorial tag, so
      // the bear check still decides, not alwaysBear. Run selection belongs
      // to the picker (no static automationEnabled flag here).
      urls: ["https://tockify.com/api/ngevent?max=100&calname=thotyssey&tags=bears"],
      alwaysBear: false,
    },
    // ── Added 2026-09-12 from promoter discovery (organizers behind events
    // the aggregators already carried). Each is read through a door the
    // crawler finds itself — no per-site code.
    {
      name: "Mass Bears and Cubs",
      // Boston bear club (Squarespace). /events?format=json is the whole
      // collection: Bear Tea 3rd Sun, Alley Bears 4th Sat, Trivia 3rd Thu,
      // Belly Party. A bear club: everything it lists is a bear event.
      urls: ["https://www.massbearsandcubs.org/events"],
      alwaysBear: true,
      metadata: { website: { value: "https://www.massbearsandcubs.org" } },
    },
    {
      name: "Powerhouse Bar",
      // SF leather/cruise bar (WordPress + The Events Calendar). The Tribe
      // REST door answers the whole calendar (57 rows / 2 pages); Chub Rub
      // 3rd Sat is the bear night, the rest goes through the bear check.
      urls: ["https://powerhousebar.com/events/"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://powerhousebar.com" } },
    },
    {
      name: "Eagle Wilton Manors",
      // Fort Lauderdale leather bar (WordPress + Tribe; weekday series
      // pre-expanded: 550 rows / 11 pages, read to the 90-day horizon).
      // HONEY POT 3rd Wed is the bear night; kink/pup nights dominate.
      urls: ["https://eaglebarwm.com/calendar2/"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://eaglebarwm.com" } },
    },
    {
      name: "C'mon Everybody",
      // Brooklyn venue (Squarespace shell + DICE widget; the partner key is
      // origin-scoped, so the feed is fetched with the site's own Origin).
      // Bear Belly and GRUNT are the bear nights among ~30 shows a month.
      urls: ["https://www.cmoneverybody.com/events"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://www.cmoneverybody.com" } },
    },
    {
      name: "Eagle London",
      // Wix Events: the homepage warmup blob lists every upcoming night
      // (Bear Bash 2nd Fri, Horse Meat Disco, 3310).
      urls: ["https://www.eaglelondon.com/"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://www.eaglelondon.com" } },
    },
    {
      name: "Eagle Manchester",
      // Wix Events (/eventlist warmup blob, first page of the widget —
      // Manbears Social 2nd Sat, Beareoke weekly).
      urls: ["https://www.eaglemanchester.com/eventlist"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://www.eaglemanchester.com" } },
    },
    // ── Sources added 2026-09-19 (one cached probe per site, see the
    // data/source-expectations stubs for the doors found) ──
    {
      name: "Eagle Portland",
      // 835 N Lombard, Portland. Next.js + Sanity CMS, rendered server-side:
      // the /events listing is static HTML carrying every dated occurrence
      // (14 recurring nights, ~90 dated links a quarter, each linking its own
      // /events/<slug>?date= page). No widget, no feed.
      urls: ["https://www.eagleportland.com/events"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://www.eagleportland.com" } },
    },
    {
      name: "Jackhammer",
      // Rogers Park leather/bear bar (2Bears Tavern Group). The Squarespace
      // /events page only mounts the TicketSauce widget
      // (sickening.events/js/events/widget.js — TsEventWidget.fetchEvents with
      // the site's pid/oid); the widget's own JSON door, replayed with its
      // default arguments, lists every upcoming event with local times, IANA
      // timezone, address, coordinates, artwork and the sickening.events page.
      // Rows are an id-keyed map of { Event, Logo, Organization } envelopes —
      // the JSON-API reader unwraps both shapes generically. The feed is the
      // complete statement, so the event pages are not crawled.
      urls: ["https://events.ticketsauce.com/events/events_by_organization/60a71c30-a1e8-48e8-a5b0-1f640ad1e030/69c6fe8a-a974-4c8f-b95a-61830a1e61fc/0/0/0/false/false/true/true/0"],
      alwaysBear: false,
      siteRole: "venue",
      urlDiscoveryDepth: 0,
      metadata: { website: { value: "https://jackhammerchicago.com" } },
    },
    {
      name: "The SoFo Tap",
      // Andersonville's bear bar (2Bears Tavern Group): Bearaoke, Nerd Bear
      // Trivia, GRRR, Doggy Days. Same TicketSauce widget door as Jackhammer,
      // this organization's oid.
      urls: ["https://events.ticketsauce.com/events/events_by_organization/60a71c30-a1e8-48e8-a5b0-1f640ad1e030/69c6fe24-2598-420b-a938-7cae0a1e635e/0/0/0/false/false/true/true/0"],
      alwaysBear: false,
      siteRole: "venue",
      urlDiscoveryDepth: 0,
      metadata: { website: { value: "https://thesofotap.com" } },
    },
    {
      name: "Meeting House Tavern",
      // Andersonville LGBTQIA+ tavern (2Bears Tavern Group): free weekly
      // socials, karaoke, bingo. Same TicketSauce widget door, this
      // organization's oid — the bear check decides what is ours.
      urls: ["https://events.ticketsauce.com/events/events_by_organization/60a71c30-a1e8-48e8-a5b0-1f640ad1e030/69c6fe50-50d4-48fb-9a04-12a60a1e618f/0/0/0/false/false/true/true/0"],
      alwaysBear: false,
      siteRole: "venue",
      urlDiscoveryDepth: 0,
      metadata: { website: { value: "https://meetinghousetavern.com" } },
    },
    {
      name: "GRUNT",
      // "BIG Beats. BIG GUYS. BIG Sleaze." — SF (The Stud) and Brooklyn
      // parties. Squarespace, static: the home page states the next Folsom
      // date, venue and ticket link; /brooklyn the New York edition.
      urls: ["https://gruntparty.monster/", "https://gruntparty.monster/brooklyn"],
    },
    {
      name: "CCBC Resort Hotel",
      // Cathedral City men's resort (68300 Gay Resort Dr): pool parties and
      // the Palm Springs editions of touring parties, all ticketed through
      // its Eventbrite organizer page (the same __NEXT_DATA__ door the other
      // Eventbrite organizers use). Club Chub's own site stays the Club
      // Chub source; a night listed on both dedups by ticket identity.
      urls: ["https://www.eventbrite.com/o/ccbc-resort-hotel-30560403776"],
      alwaysBear: false,
      siteRole: "venue",
    },
    {
      name: "Lodge NY",
      // NYC sex parties for bears, cubs, daddies and friends (The Bear
      // Party, Dads 'n' Lads, Workman's Lunch, Blow Buddies …). lodgeny.com
      // is a JavaScript shell whose only calendar is an embedded public
      // Google Calendar (src=info@lodgeny.com); its iCalendar export is the
      // door — read as a feed (weekly RRULEs expand into dated nights, the
      // archive of ended series is dropped). Titles carry the venue's
      // street address; the address-tail rule strips it at final build.
      // Not every party on the calendar is a bear party — bear check decides.
      urls: ["https://calendar.google.com/calendar/ical/info%40lodgeny.com/public/basic.ics"],
      alwaysBear: false,
      metadata: { website: { value: "https://lodgeny.com" } },
    },
    {
      name: "Eagle NYC",
      // 554 W 28th St. WordPress + The Events Calendar: the listing page links
      // its Tribe REST route (wp-json/tribe/events/v1/events), which the crawler
      // adopts itself (🚪 MACHINE DOOR) — 453 upcoming rows on 2026-09-19, the
      // bar posts every DJ night. Read to the feed horizon.
      urls: ["https://eagle-ny.com/calendarofevents/"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://eagle-ny.com" } },
    },
    {
      name: "SF Eagle",
      // 398 12th St. WordPress, static: /events/ lists every dated night with
      // times and a /events/<slug>/ page each (60 on 2026-09-19), plus a Google
      // Calendar / .ics link the crawler can adopt.
      urls: ["https://www.sf-eagle.com/events/"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://www.sf-eagle.com" } },
    },
    {
      name: "Lone Star Saloon",
      // 1354 Harrison St — the SF bear bar. Squarespace events collection
      // (/new-events-1/<yyyy>/<m>/<d>/<slug>, 44 dated pages on 2026-09-19,
      // each with Google Calendar / ICS links); the collection's ?format=json
      // twin is the structured door.
      urls: ["https://www.lonestarsf.com/new-events-1"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://www.lonestarsf.com" } },
    },
    {
      name: "The Cuff Complex",
      // 1533 13th Ave, Seattle. Squarespace events collection (/events/<slug>,
      // 42 dated pages on 2026-09-19) — same door shape as Lone Star.
      urls: ["https://cuffcomplex.com/events"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://cuffcomplex.com" } },
    },
    {
      name: "Akbar",
      // 4356 Sunset Blvd, Silver Lake. WordPress: /upcoming-events/ lists the
      // month's parties with an /event/<slug>/ page each (18 on 2026-09-19,
      // Bears in Space's lot parties among them).
      urls: ["https://akbarsilverlake.com/upcoming-events/"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://akbarsilverlake.com" } },
    },
    {
      name: "Atlanta Eagle",
      // 1492 Piedmont Ave NE. WordPress: /events/ lists dated nights with full
      // start/end times and an /event/<slug>/ page each (16 on 2026-09-19).
      urls: ["https://atlantaeagle.com/events/"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://atlantaeagle.com" } },
    },
    {
      name: "The Heretic",
      // 2069 Cheshire Bridge Rd NE, Atlanta. WordPress, static: /events/ is a
      // weekly schedule (Pup Night, Thursday Country …) plus the month's dated
      // specials with ticket links.
      urls: ["https://hereticatlanta.com/events/"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://hereticatlanta.com" } },
    },
    {
      name: "Black Eagle Toronto",
      // 457 Church St. Squarespace one-pager whose EVENTS section is an
      // Elfsight calendar widget (elfsight-app-e5a158fb-…), read by
      // collectElfsightCalendarEvents like Rockbar's.
      urls: ["https://www.blackeagletoronto.com/"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://www.blackeagletoronto.com" } },
    },
    {
      name: "Camp Out Poconos",
      // LGBTQ+ campground, East Stroudsburg PA: theme weekends on an Elfsight
      // calendar widget at /calendar/.
      urls: ["https://campoutpoconos.com/calendar/"],
      alwaysBear: false,
      siteRole: "venue",
      metadata: { website: { value: "https://campoutpoconos.com" } },
    },
    {
      name: "South Seattle Bear Social",
      // Seattle bear social (GLOW, Bear Pride, drag trivia brunch) — all
      // ticketed on TicketLeap. The organization page is a JavaScript shell;
      // its bundle reads this JSON door (…/api/organization-listing/<org>/
      // upcoming → { listings: [...], hasMore }). Rows name the event
      // `listing_title`, state local start/end, venue_name/venue_city and a
      // protocol-relative image — all read generically by the JSON-API
      // reader. Empty between parties (0 upcoming on 2026-09-20; five past
      // listings through 2026-07-31 on the /past twin).
      urls: ["https://events.ticketleap.com/api/organization-listing/southseattlebearsocial/upcoming"],
      urlDiscoveryDepth: 0,
    },
    {
      name: "XL Bears",
      // Seattle social group for bears and admirers ("usually doing something
      // every week": game night, spa day, XL Bear Bust, hikes). xlbears.org's
      // calendar page embeds — and publishes the address of — its public
      // Google Calendar; the iCalendar export is the door, read as a feed
      // (RRULEs become dated nights, the archive is dropped), exactly like
      // Lodge NY. Socials, not ticketed parties: no ticket links, no flyers.
      urls: ["https://calendar.google.com/calendar/ical/xl.bears.seattle%40gmail.com/public/basic.ics"],
      alwaysBear: true,
      metadata: { website: { value: "https://xlbears.org" } },
    },
    {
      name: "Gathr",
      // Aggregator for bear-week crowds (Provincetown Bear Week, Fire Island
      // Bear Weekend, Dore Alley, Folsom, plus NYC regulars). A React app with
      // no feed and no API: the whole event list is written into its script
      // bundle as object literals. The crawler reads the shell, finds no
      // endpoint, and reads the bundle's own data instead (🚪 SPA DOOR …
      // "ships its events inside its own bundle") — two requests per run.
      // Dates print without a year ("Sep 19"); the reader anchors them to the
      // season the rest of the list states. Links are the original
      // ticket/promoter pages — this host must never become a website.
      urls: ["https://gathrparty.com/"],
      alwaysBear: true,
      urlDiscoveryDepth: 0,
    },
    {
      // ── New Site Template ─────────────────────────────────────────────
      // Copy this entry, fill in the live fields, and you're done — depth,
      // URL blocking, AI/OCR settings, and field merging are all automatic.
      // Tip: run once with discoveryOnly: true and the scraper prints a
      // 📋 SUGGESTED CONFIG block (with harvested instagram/facebook/website)
      // you can paste right back here.
      name: "New Site Template",
      // template: documentation-only entry. The parser picker, parser-name
      // matching, and scheduled automation runs all skip entries carrying
      // template: true — remove the marker (or copy the entry) to go live.
      template: true,
      urls: ["https://example.com/events"],
      alwaysBear: false, // set true for trusted bear promoters (AI trust context)
      metadata: {
        shortName: { value: "NEW-SITE" }, // use a soft hyphen (\u00ad) where it may line-break; it stays invisible until needed
        instagram: { value: "https://www.instagram.com/example" },
      },
      // ── Optional fields — exhaustive reference (defaults noted) ────────
      //
      // Crawl & discovery:
      // discoveryOnly: true, // First-run mapping: crawl + print/save the 📋 SUGGESTED CONFIG block, extract no events (default: false)
      // urlDiscoveryDepth: 2, // Omit → adaptive crawling (each page's type decides what gets followed); set a number to pin exact depth, 0 = never crawl (default: adaptive)
      // maxAdditionalUrls: 15, // Budget of discovered URLs followed per page (default: 15)
      // discoveryBlockedPatterns: ["example.com/members-only"], // Deliberate exclusions only — generic junk is blocked built-in and dead ends are learned + auto-retried (default: none)
      // discoveryAllowedPatterns: ["promoter-name"], // When set, ONLY follow discovered links matching an entry (string substring or RegExp) — for promoter searches on big platform listings; start URLs unaffected; blocks win over allows (default: none)
      // discoveryBlockedHosts: ["example.com"], // Suppress ALL discovered links to these hostnames (default: none)
      //
      // Extraction steering:
      // siteRole: "venue", // "venue" | "organizer" — who this SITE is (top precedence over page-derived detection). "venue": events on the page happen AT this venue — its own name may be returned as bar, and the KNOWN VENUE extraction context is injected. "organizer": promoter/brand site — the site name is never the bar. Omit → derived from page facts (JSON-LD types, observed addresses); undetermined changes nothing.
      //
      // Run behavior:
      // dryRun: true, // Preview this parser's events without writing to the calendar (default: false — global config.dryRun also applies)
      // automationEnabled: false, // Skip this parser in scheduled automation runs (default: true)
      // daysToLookAhead: 90, // Only keep events starting within N days (default: global config.daysToLookAhead, null = no limit)
      // allowPastEvents: true, // Keep events whose start date already passed (default: false)
      // calendarSearchRangeDays: 40, // ± days searched for wildcard matchKey calendar matches (default: unset)
      //
      // AI extraction override — merged key-wise over the global `ai` block.
      // Normally omit entirely: the built-in default is the local rybook text
      // server. Shown exhaustively for reference:
      // ai: {
      //   enabled: true,
      //   provider: "openai", // "openai" (OpenAI-compatible, e.g. rapid-mlx/LM Studio/hosted) or "ollama"
      //   endpoint: "http://rybook.taila7523c.ts.net:8000/v1/chat/completions",
      //   model: "lmstudio-community/Qwen3-Coder-Next-MLX-6bit",
      //   // Hosted OpenAI variant:
      //   // provider: "openai", endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o", openai: { responseFormat: "json_object" },
      //   // Ollama variant:
      //   // provider: "ollama", endpoint: "http://desktop.taila7523c.ts.net:11434/api/generate", model: "qwen3.5:4b",
      //   payloadMode: "best", // "best" | "html" | "text" — what gets sent to the model
      //   maxHtmlChars: 6000,
      //   numCtx: 2048,
      //   numPredict: 2000,
      //   temperature: 0,
      //   think: false,
      //   timeoutSeconds: 120,
      //   keepAlive: "5m",
      //   cache: true, // AI response cache — key is model+prompt+options; set false to disable
      //   classifyPages: true, // AI second opinion when URL rules/JSON-LD can't classify a page (default: true)
      //   // OCR override lives INSIDE `ai` (canonical spot: ai.ocr). Default is
      //   // the rybook VISION server on :8001 — text models reject images.
      //   ocr: {
      //     enabled: true,
      //     provider: "openai",
      //     endpoint: "http://rybook.taila7523c.ts.net:8001/v1/chat/completions",
      //     model: "mlx-community/Qwen3-VL-4B-Instruct-4bit", // OCR requires a VISION model
      //     // Ollama vision variant:
      //     // provider: "ollama", endpoint: "http://desktop.taila7523c.ts.net:11434/api/generate", model: "qwen3-vl:4b-instruct",
      //     timeoutSeconds: 120,
      //     numCtx: 8192,
      //     numPredict: 2000,
      //     temperature: 0,
      //     think: false,
      //     keepAlive: "5m",
      //     maxImages: 2, // Per-page OCR budget on single-event pages (multi-event pages use 10 + segment top-up)
      //     concurrency: 1, // Concurrent OCR requests; keep 1 for a single local GPU
      //     maxTextChars: 4000,
      //     cache: true, // OCR result cache (key is `cache`, not `cacheEnabled`)
      //     cacheRetentionDays: 90,
      //     requireMissingFields: true, // Only OCR when fields are still missing
      //   },
      // },
      //
      // Merging & identity:
      // fieldPriorities: { title: { priority: ["ai-web", "static"], merge: "clobber" }, shortName: { priority: ["static"], merge: "upsert" } }, // Per-field override (default: every field ai-web + AI arbitration; metadata keys auto-static)
      //
      // Metadata extras (all static-upserted into events automatically):
      // metadata: {
      //   shortName: { value: "MAIN", conditionalValues: [{ keywords: ["subbrand"], value: "SUB-BRAND" }] }, // sub-brands sharing one parser
      //   shorterName: { value: "MN" }, // ultra-compact display name
      //   website: { value: "https://example.com" }, // `url` is an alias — website and url are ONE field
      //   facebook: { value: "https://www.facebook.com/example" },
      //   favicon: { value: "https://linktr.ee/example" }, // icon-source override, resolved dynamically by the website
      //   matchKey: { value: "example*|${year}-${month}-*|*" }, // wildcard calendar-dedup key (pair with calendarSearchRangeDays)
      // },
    },
  ],
  config: {
    daysToLookAhead: null,
    // Keep events whose start date already passed instead of dropping them at
    // scrape time — the website reads fuller with history on it. Applies to
    // every parser; flip to false (or remove) to go back to future-only.
    allowPastEvents: true,
    // Companion knob (owner 2026-08-20): keep WRITING updates to past events
    // up to a year back, so recent-past cards with script-format diffs write
    // once instead of re-showing the same diff forever. Only spans that ended
    // MORE than this many days ago are withheld from calendar writes
    // (span-fully-past). Remove to fall back to the 30-day default.
    sanity: { pastSpanWithholdDays: 365 },
    // dryRun: true, // Preview mode: analyze + display without writing to the calendar (default: false)
    // Parser picker at run start OWNS run selection (default: false).
    // Manual Scriptable runs only; the selection is session-scoped and never
    // edits this file. It pre-selects the previous run's confirmed picks
    // (persisted in picker-state.json); dismissing the picker CANCELS the run.
    // ⚠️ Parser entries carry NO static enabled flags anymore: with this set
    // to false — or on manual runs outside Scriptable (web/server) — a manual
    // run executes ALL parsers. Scheduled automation is unaffected (no picker;
    // per-parser automationEnabled governs what automation runs).
    pickParsers: true,
    pageCache: {
      enabled: true,
      ttlDays: 3,
    },
    // How the scraper behaves on other people's sites. Only LIVE requests
    // pass through this — a page served from the cache above costs the site
    // nothing and is never paced or counted. The run log ends with one
    // "🚦 POLITE:" line (requests per host, pacing spent, parked hosts).
    politeness: {
      // Minimum gap between two live requests to the same host, one at a
      // time. A site's own robots.txt Crawl-delay raises this (capped at 15s).
      minHostGapMs: 2000,
      // A host that answers 429 — or 403 before serving anything — is parked
      // for the rest of the run and never retried. This is the ceiling on
      // live requests to one host per run; past it the host is skipped and
      // named in the run log.
      maxRequestsPerHost: 120,
      // robots.txt (read once per host, through the page cache):
      //   "report"  — log every path it disallows, request it anyway
      //   "enforce" — never request a disallowed path
      //   "off"     — do not read robots.txt at all
      // Report-only first: some ticket platforms disallow the very listing
      // pages we read, so see what it would cut before switching it on.
      robots: "report",
      // exemptHosts: ["example.org"], // never paced/parked (chunky.dad, localhost and the tailnet always are)
    },
    // deadEndRetryDays: 30, // Learned dead-end URLs (fetched fine but yielded nothing) are skipped for this many days, then retried once; 0 disables the store (default: 30)
    geocodeVerification: { mode: "enforce" }, // verify geocoded pins: grade-gate + Apple reverse cross-check. "report" (default) flags suspects in logs, "enforce" refuses suspect pins, "off" skips extra checks. Generic city-level pins are always refused.
    promoterRegistry: { mode: "enforce" }, // Curated promoter identity matching — see data/promoters.json; enforce stamps matched metadata + bearAffinity (flipped 2026-07-28: verification battery — 37 matches, 0 false positives, 100% precision)
    // NOTE: Eventbrite /e/ confidence defaults (JSON-LD cover/image/ticketUrl,
    // meta location) are built into shared-core now — an aiConfidenceDefaults
    // block here is only needed to extend or override them.
    // Global AI extraction defaults — inherited by EVERY parser (extraction +
    // merge arbitration). The effective per-parser block is a deep merge of this
    // block with the parser's own `ai`, so per-parser keys override key-wise.
    // Keys mirror what SharedCore.resolveAiConfig reads.
    ai: {
      enabled: true,
      endpoint: "http://rybook.taila7523c.ts.net:8000/v1/chat/completions",
      provider: "openai",
      openai: {
        responseFormat: "json_object",
      },
      model: "lmstudio-community/Qwen3-Coder-Next-MLX-6bit",
      payloadMode: "best",
      maxHtmlChars: 6000,
      numCtx: 2048,
      numPredict: 2000,
      temperature: 0,
      think: false,
      timeoutSeconds: 120,
      keepAlive: "5m",
      cache: true, // AI response cache — key is model+prompt+options; set false to disable
      // AI merge arbitration (default: true). When two records of the same event
      // genuinely conflict on a field (both non-empty, different), the AI picks the
      // better value — accepted only when its answer is a VERBATIM copy of one of
      // the candidates; anything else falls back to the deterministic strategy
      // (scraped clobbers). This global block also serves events from non-AI
      // parsers; per-parser ai.arbitrateMerges overrides. Set false to disable.
      arbitrateMerges: true,
      // Calendar stickiness (default: false = REPORT-ONLY). The merge arbiter is
      // position-biased — in run 20260801-172321 the enrich path picked `incoming`
      // 72% of the time while the calendar path picked `calendar` 66% of the time,
      // and the identical value pair was arbitrated twice 11 seconds apart with
      // opposite verdicts. The result is the same events being rewritten every run
      // ("BEEFMINCE x RVT" clobbered 21×). With this false, every field where an
      // AI-ONLY decision would overwrite a non-empty saved calendar value is logged
      // (`🧊 STICKY:`) and the change is still applied. Set true to actually keep
      // the saved value. Date/time fields and empty/TBA calendar values are always
      // exempt — a rescheduled event must still move.
      calendarStickinessEnforced: false,
      // Calendar-merge arbitration (owner decision 2026-09-12). "deterministic":
      // source authority decides every field — equivalent values are no change,
      // the event's own page/feed/ticket page updates the calendar, a promoter's
      // Instagram beats a venue's, websites rank by what they are, text that
      // extends the stored value replaces it, anything else keeps the calendar
      // and is recorded as contested; only `description` between two
      // third-party copies still reaches the AI. "ai": the old position-biased
      // arbiter for every field — the one-line revert.
      merge: { arbitration: "deterministic" },
      bearCheck: { mode: "enforce" }, // Bear-check cascade: keywords → AI verdict with promoter context. "report" logs decisions without changing behavior; "enforce" flags/rescues/drops; "off" = legacy alwaysBear/keyword behavior. (Also accepted as a top-level config.bearCheck, like geocodeVerification; canonical location is here under ai.)
      // Overlong-field trim pipeline: one AI call per event batches every
      // overlong scraped field (title/description/shortName); answers are
      // accepted only as VERBATIM contiguous substrings of the original.
      // "report" logs would-trim decisions without changing values;
      // "enforce" replaces; "off" disables. Calendar-sourced values are never
      // AI-trimmed — they are only flagged in the event evidence panel.
      // Enforce since battery run 20260728: every proposal was clean and the
      // verbatim gate correctly rejected non-substring description trims.
      trim: {
        mode: "enforce", // "report" | "enforce" | "off"
        titleMaxChars: 60, // data: title p95=48, p99=72, max=74
        descriptionMaxChars: 600, // data: description p95=491, max=846
        shortNameMaxChars: 30, // data: shortName max=20
      },
      // extraContext (override-only): free-form text appended VERBATIM to the
      // context of every AI extraction prompt. Organizer/brand context is
      // normally derived automatically from each page's own metadata (JSON-LD
      // Organization/WebSite nodes and og:site_name) — set this only when a
      // page's markup declares nothing useful and the model needs a hint.
      // Per-parser ai.extraContext overrides this global value ("" opts out).
      // Default: "" (no extra context).
      // extraContext: "",
      // Full AI prompt/response payloads normally go to the debug channel only:
      // captured into the run log file (logs/<runId>.log) but hidden from the
      // visible console. Set true to also mirror them to the live console while
      // actively debugging. Default: false.
      verboseConsoleLogs: false,
    },
    // Global OCR defaults — inherited by EVERY parser the same way as `ai`
    // (a parser's own `ai.ocr` — or top-level `ocr` — block overrides key-wise).
    // rapid-mlx (OpenAI-compatible, Apple Silicon) serving a VISION model on its
    // own port, alongside the text/extraction server on :8000.
    ocr: {
      enabled: true,
      provider: "openai",
      endpoint: "http://rybook.taila7523c.ts.net:8001/v1/chat/completions",
      model: "mlx-community/Qwen3-VL-4B-Instruct-4bit", // OCR requires a VISION model
      timeoutSeconds: 120,
      numCtx: 8192,
      numPredict: 2000,
      temperature: 0,
      think: false,
      keepAlive: "5m",
      maxImages: 2, // Per-page OCR budget on single-event pages (multi-event pages use 10 + segment top-up)
      concurrency: 1, // Concurrent OCR requests; keep 1 for a single local GPU
      maxTextChars: 4000,
      cache: true, // OCR result cache (key is `cache`, not `cacheEnabled`)
      // End-of-run auto-prune: cached OCR results unused for this many days
      // are deleted (cache hits refresh an entry's last-use marker, so
      // recurring flyers are kept indefinitely). Default: 90.
      cacheRetentionDays: 90,
      requireMissingFields: true,
    },
    // NOTE: Generic junk URLs (/shop, /cart, /contact, /_api/, ?p=<digits>
    // shortlinks, /privacy, /terms, ...) are blocked built-in now, and pages
    // that fetch fine but yield nothing are learned as dead ends and skipped
    // automatically. A discoveryBlockedPatterns list (global here, or
    // per-parser) is only for deliberate exclusions — "never fetch, not even
    // once". String entries are case-insensitive URL substrings; RegExp
    // entries test against the lowercased URL, which allows anchoring.
    // URL pattern rules for page classification. Checked in order — first match wins.
    // More specific patterns (e.g. /events/:slug) must come before broader ones (e.g. domain root).
    // Built-in platform rules apply automatically BENEATH these (config wins):
    // eventbrite.com/e/ → event-page, eventbrite.com/o/ → multi-event-page,
    // linktr.ee → link-aggregator. Only site-specific rules belong here.
    pageClassificationRules: [
      { pattern: /furball\.nyc/i, classification: "multi-event-page" },
      {
        pattern: /bearracuda\.com\/events\/[^/?&#\s]+/i,
        classification: "event-page",
      },
      { pattern: /bearracuda\.com/i, classification: "link-aggregator" },
      {
        pattern: /thebearcalendar\.com\/events\/[^/?&#\s]+/i,
        classification: "event-page",
      },
      // The listing host is a link hub, never a venue site.
      { pattern: /thebearcalendar\.com/i, classification: "link-aggregator" },
    ],
  },
};

// Export for different environments
// Scriptable environment
if (typeof module !== "undefined" && module.exports) {
  module.exports = scraperConfig;
}

// ES6 module environment
if (typeof window === "undefined" && typeof importModule !== "undefined") {
  // Scriptable environment - make available for importModule
  scraperConfig;
} else if (typeof window !== "undefined") {
  // Browser environment - attach to window
  window.scraperConfig = scraperConfig;
}

// Default export for ES6 modules
scraperConfig;

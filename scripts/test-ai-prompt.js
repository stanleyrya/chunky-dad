// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: teal; icon-glyph: hamsa;

const aiConfig = {
    // OpenAI provider format (e.g. rybook, openai, etc.)
    provider: 'openai',
    endpoint: 'http://rybook.taila7523c.ts.net:8000/v1/chat/completions',
    model: 'qwen2.5-coder:7b',

    // Ollama provider format example:
    // provider: 'ollama',
    // endpoint: 'http://desktop.taila7523c.ts.net:11434/api/generate',
    // model: 'qwen2.5-coder:7b',

    temperature: 0,
    numPredict: 2000,
    numCtx: 8192,
    keepAlive: '5m',
    think: false,

    openai: {
        responseFormat: 'json_object' // or 'none'
    }
};

const prompt = `
You are a structured data extraction assistant. Extract event details from the provided source material and return them as a single valid JSON object.

STRICT RULES:
- Output ONLY a raw JSON object. No markdown, no code fences, no explanation.
- Omit any key where the value is not explicitly present in the source material.
- Never infer, estimate, or hallucinate values. If unsure, omit.
- All date values: ISO 8601 format (YYYY-MM-DD). All time values: 24h format (HH:MM).

SOURCE MATERIAL:


<ocr_image_url>
https://static.wixstatic.com/media/238fae_d905041dad444ad79591fdc4448a871a~mv2.jpg/v1/fill/w_296,h_419,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/238fae_d905041dad444ad79591fdc4448a871a~mv2.jpg
</ocr_image_url>
<ocr_image_text>
SATURDAY 15 • AUG 2026
MAD.BEAR
AQUA EMPORIO
HOUSE ROOM
SCRUFF
JOE FIORE PRESENTS
FURBALL
WWW.FURBALL.NYC
NYC
TICKETS & PACKS
WWW.MADBEAR.ORG
POP ROOM MAD.POP
MADBEAR BEACH TORREMOLINOS 7-18 AUG 2026
OPEN 01H TO CLOSING • AQUA EMPORIO • LA NOGALERA
</ocr_image_text>
<ocr_image_summary>
Furball NYC is a bear-themed event at Aqua Emporio in Torremolinos, featuring Mad Bear and Scruff as headliners during the MadBear Beach weekend (Aug 7-18, 2026), catering to the gay bear community with inclusive party vibes.
</ocr_image_summary>
<page_text>
https://madbear.org/
FURBALL MAD.BEAR
@ MAD.BEAR Beach
August 15, 2026
Torremolinos, Spain
Get Your Tickets Today!
</page_text>

EXTRACT THE FOLLOWING KEYS (omit if not explicitly in source):
- description: Event description or tagline, verbatim or closely paraphrased from source.
- bar: Venue or bar name exactly as stated in source. Do not derive from address.
- address: Street address exactly as stated. Do not derive from venue name or coordinates.
- startDate: Event start date (YYYY-MM-DD). Ignore festival or weekend umbrella dates (e.g. "festival runs Aug 7-18") unless the event itself spans multiple days. A party with a start time is almost always a single-night event.
- endDate: Event end date (YYYY-MM-DD), only if distinct from startDate. Ignore festival or weekend umbrella dates (e.g. "festival runs Aug 7-18") unless the event itself spans multiple days. A party with a start time is almost always a single-night event.
- startTime: Event start time (HH:MM, 24h). Source may use formats like "01H", "10PM", "3:30 AM".
- endTime: Event end time (HH:MM, 24h). Same format handling as startTime.
- location: Lat/lng coordinates only if explicitly present as a coordinate pair (e.g. "40.7128,-74.0060"). Do not derive from address or venue.
- ticketUrl: Ticket purchase URL, only if explicitly present.
- image: Promotional image URL exactly as shown.
- cover: Admission price text exactly as stated (e.g. "$20", "$20-$30", "$20, $30 VIP"). Omit if not present.
- city: Lowercase city name only (e.g. "new york", "los angeles"). Use the city where the event physically takes place.
`;

let payload;
if (aiConfig.provider === 'ollama') {
    payload = {
        model: aiConfig.model,
        prompt: prompt,
        format: "json",
        stream: false,
        think: aiConfig.think,
        keep_alive: aiConfig.keepAlive,
        options: {
            num_ctx: aiConfig.numCtx,
            num_predict: aiConfig.numPredict,
            temperature: aiConfig.temperature
        }
    };
} else if (aiConfig.provider === 'openai') {
    payload = {
        model: aiConfig.model,
        messages: [
            { role: "user", content: prompt }
        ],
        temperature: aiConfig.temperature,
        max_tokens: Math.floor(aiConfig.numPredict)
    };

    if (aiConfig.openai && aiConfig.openai.responseFormat !== 'none') {
        payload.response_format = { type: aiConfig.openai.responseFormat || "json_object" };
    }
} else {
    throw new Error("Unsupported AI provider: " + aiConfig.provider);
}

const req = new Request(aiConfig.endpoint);
req.method = "POST";
req.timeoutInterval = 300;
req.headers = {
    "Content-Type": "application/json"
};
req.body = JSON.stringify(payload);

console.log("Sending request to " + aiConfig.endpoint + " with provider " + aiConfig.provider + "...");

try {
    const raw = await req.loadString();

    const response = JSON.parse(raw);
    let resultString = null;
    let isDone = null;
    let doneReason = null;

    if (aiConfig.provider === 'ollama') {
        resultString = response.response;
        isDone = response.done;
        doneReason = response.done_reason;
    } else if (aiConfig.provider === 'openai') {
        resultString = response.choices && response.choices[0] && response.choices[0].message ? response.choices[0].message.content : null;
        isDone = true; // OpenAI doesn't return done in the same way
        doneReason = response.choices && response.choices[0] ? response.choices[0].finish_reason : null;
    }

    console.log("Done?: " + isDone + ", Reason: " + doneReason);

    if (resultString) {
        try {
            const parsedResult = JSON.parse(resultString);
            console.log(JSON.stringify(parsedResult, null, "\t"));
        } catch (e) {
            console.log("Failed to parse JSON result:");
            console.log(resultString);
        }
    } else {
        console.log("No result string extracted.");
        console.log(JSON.stringify(response, null, "\t"));
    }

} catch (e) {
    console.error(e);
}

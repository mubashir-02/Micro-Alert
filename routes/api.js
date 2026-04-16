const express = require('express');
const router = express.Router();
const { Risk, Hazard } = require('../models');
const { Op, fn, col, literal } = require('sequelize');
const axios = require('axios');

// ─── LLM Helper ────────────────────────────────────────────────────────────────
async function callLLM(systemPrompt, userPrompt) {
  const provider = process.env.LLM_PROVIDER || 'nvidia';

  if (provider === 'groq') {
    const resp = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'mixtral-8x7b-32768',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 200,
        temperature: 0.4
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return resp.data.choices[0].message.content.trim();
  }

  if (provider === 'nvidia') {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({
      apiKey: process.env.NVIDIA_API_KEY,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    });
    const completion = await openai.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 512,
      temperature: 0.4,
      top_p: 1,
      stream: true
    });

    let result = '';
    for await (const chunk of completion) {
      const content = chunk.choices[0]?.delta?.content || '';
      result += content;
    }
    return result.trim();
  }

  // Default: OpenAI
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 200,
    temperature: 0.4
  });
  return completion.choices[0].message.content.trim();
}

// ─── Helper: distance in km between two lat/lng points ──────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── GET /api/risks ─ All risks ────────────────────────────────────────────────
router.get('/risks', async (req, res) => {
  try {
    const risks = await Risk.findAll({
      order: [['severity', 'DESC']],
      raw: true
    });
    // Map to match old MongoDB format for frontend compatibility
    const mapped = risks.map(r => ({
      ...r,
      _id: r.id,
      location: {
        type: 'Point',
        coordinates: [r.lng, r.lat]
      }
    }));
    res.json({ success: true, data: mapped });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/risks/nearby ─────────────────────────────────────────────────────
router.get('/risks/nearby', async (req, res) => {
  try {
    const { lng, lat, radius = 500 } = req.query;
    if (!lng || !lat) {
      return res.status(400).json({ success: false, error: 'lng and lat are required' });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const radiusKm = parseInt(radius) / 1000;

    // Approximate bounding box
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos(userLat * Math.PI / 180));

    const risks = await Risk.findAll({
      where: {
        lat: { [Op.between]: [userLat - latDelta, userLat + latDelta] },
        lng: { [Op.between]: [userLng - lngDelta, userLng + lngDelta] }
      },
      raw: true
    });

    // Filter by actual distance
    const nearby = risks.filter(r =>
      haversine(userLat, userLng, r.lat, r.lng) <= radiusKm
    );

    // Return as GeoJSON FeatureCollection
    const geojson = {
      type: 'FeatureCollection',
      features: nearby.map(r => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [r.lng, r.lat]
        },
        properties: {
          _id: r.id,
          type: r.type,
          severity: r.severity,
          description: r.description,
          timeOfDay: r.timeOfDay,
          weather: r.weather,
          roadName: r.roadName,
          landmark: r.landmark,
          verified: r.verified,
          timestamp: r.createdAt
        }
      }))
    };

    res.json({ success: true, data: geojson });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/risks/along-route ────────────────────────────────────────────────
router.get('/risks/along-route', async (req, res) => {
  try {
    const { startLat, startLng, endLat, endLng } = req.query;
    if (!startLat || !startLng || !endLat || !endLng) {
      return res.status(400).json({ success: false, error: 'startLat, startLng, endLat, endLng are required' });
    }

    const sLat = parseFloat(startLat);
    const sLng = parseFloat(startLng);
    const eLat = parseFloat(endLat);
    const eLng = parseFloat(endLng);

    // Build bounding box with corridor buffer
    const buffer = 0.01; // ~1.1km
    const minLat = Math.min(sLat, eLat) - buffer;
    const maxLat = Math.max(sLat, eLat) + buffer;
    const minLng = Math.min(sLng, eLng) - buffer;
    const maxLng = Math.max(sLng, eLng) + buffer;

    const risks = await Risk.findAll({
      where: {
        lat: { [Op.between]: [minLat, maxLat] },
        lng: { [Op.between]: [minLng, maxLng] }
      },
      order: [['severity', 'DESC']],
      raw: true
    });

    // Filter by distance to the route line (within 800m corridor)
    const corridorKm = 0.8;
    const uniqueRisks = risks.filter(r => {
      // Check distance to any of 10 intermediate points along route
      for (let i = 0; i <= 10; i++) {
        const f = i / 10;
        const lat = sLat + f * (eLat - sLat);
        const lng = sLng + f * (eLng - sLng);
        if (haversine(lat, lng, r.lat, r.lng) <= corridorKm) return true;
      }
      return false;
    });

    const mapped = uniqueRisks.map(r => ({
      ...r,
      _id: r.id,
      location: { type: 'Point', coordinates: [r.lng, r.lat] }
    }));

    res.json({ success: true, data: mapped });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/llm/summarize ───────────────────────────────────────────────────
router.post('/llm/summarize', async (req, res) => {
  try {
    const { risks, question } = req.body;
    if (!risks || !question) {
      return res.status(400).json({ success: false, error: 'risks and question are required' });
    }

    const riskSummaries = risks.map(r =>
      `- ${r.type} on ${r.roadName}${r.landmark ? ' near ' + r.landmark : ''}: severity ${r.severity}/5. ${r.description}. Time: ${r.timeOfDay}, Weather: ${r.weather}.`
    ).join('\n');

    const systemPrompt = `You are a road-safety analyst for Chennai, India. Given micro-risk data for a specific area, answer the user's question in a clear paragraph. Be specific about road names and risk patterns. Do not use bullet points.

IMPORTANT: After your analysis text, add a newline and then output a JSON block listing every specific location/road/junction/landmark you mentioned, in this exact format:
|||LOCATIONS|||
[{"name":"Kathipara Junction"},{"name":"GST Road"},{"name":"Inner Ring Road"}]
|||END|||

Include ALL specific place names, roads, junctions, and landmarks from your analysis.`;

    const userPrompt = `Road risk data:\n${riskSummaries}\n\nUser question: ${question}`;

    const rawAnswer = await callLLM(systemPrompt, userPrompt);

    // Parse out locations JSON from the response — try multiple patterns
    let answer = rawAnswer;
    let mentionedLocations = [];

    // Pattern 1: |||LOCATIONS|||...|||END|||
    let locMatch = rawAnswer.match(/\|\|\|LOCATIONS\|\|\|\s*([\s\S]*?)\s*\|\|\|END\|\|\|/);
    if (locMatch) {
      answer = rawAnswer.replace(/\|\|\|LOCATIONS\|\|\|[\s\S]*?\|\|\|END\|\|\|/, '').trim();
      try { mentionedLocations = JSON.parse(locMatch[1].trim()); } catch (e) {}
    }

    // Pattern 2: |||LOCATIONS||| followed by JSON (no END delimiter — LLM cut off)
    if (mentionedLocations.length === 0) {
      locMatch = rawAnswer.match(/\|\|\|LOCATIONS\|\|\|\s*(\[[\s\S]*)/);
      if (locMatch) {
        answer = rawAnswer.replace(/\|\|\|LOCATIONS\|\|\|[\s\S]*$/, '').trim();
        let jsonStr = locMatch[1].trim();
        // Try to fix incomplete JSON — find last complete object
        if (!jsonStr.endsWith(']')) {
          const lastBrace = jsonStr.lastIndexOf('}');
          if (lastBrace > 0) jsonStr = jsonStr.substring(0, lastBrace + 1) + ']';
        }
        try { mentionedLocations = JSON.parse(jsonStr); } catch (e) {}
      }
    }

    // Pattern 3: Trailing JSON array even without |||LOCATIONS|||
    if (mentionedLocations.length === 0) {
      const trailingJson = rawAnswer.match(/(\[\s*\{"name"\s*:\s*"[^"]+"\}[\s\S]*$)/);
      if (trailingJson) {
        answer = rawAnswer.replace(trailingJson[0], '').trim();
        let jsonStr = trailingJson[1].trim();
        if (!jsonStr.endsWith(']')) {
          const lastBrace = jsonStr.lastIndexOf('}');
          if (lastBrace > 0) jsonStr = jsonStr.substring(0, lastBrace + 1) + ']';
        }
        try { mentionedLocations = JSON.parse(jsonStr); } catch (e) {}
      }
    }

    // Final cleanup of any remaining markers
    answer = answer.replace(/\|\|\|LOCATIONS\|\|\|/g, '').replace(/\|\|\|END\|\|\|/g, '').trim();

    // Also extract coordinates from the source risk data for matching
    const riskLocations = risks.map(r => ({
      name: r.roadName,
      landmark: r.landmark || '',
      lat: r.lat,
      lng: r.lng,
      type: r.type,
      severity: r.severity
    })).filter(r => r.lat && r.lng);

    res.json({ success: true, answer, mentionedLocations, riskLocations });
  } catch (err) {
    console.error('LLM Summarize error:', err.message);
    res.status(500).json({ success: false, error: 'LLM service unavailable. ' + err.message });
  }
});

// ─── POST /api/llm/condensed-alert ─────────────────────────────────────────────
router.post('/llm/condensed-alert', async (req, res) => {
  try {
    const { risks } = req.body;
    if (!risks || risks.length === 0) {
      return res.status(400).json({ success: false, error: 'risks array is required' });
    }

    const riskSummaries = risks.slice(0, 8).map(r =>
      `${r.type} on ${r.roadName}${r.landmark ? ' near ' + r.landmark : ''}, severity ${r.severity}/5, ${r.timeOfDay}, ${r.weather}`
    ).join('\n');

    const systemPrompt = `You are a concise road-safety alert system for Chennai commuters. You must produce a SINGLE short alert of MAXIMUM 20 words that highlights the top 2-3 most urgent risks from the provided data. Focus on actionable information. Do not use bullet points or lists. Just one sentence.`;

    const userPrompt = `Route risks:\n${riskSummaries}\n\nGenerate a condensed alert (max 20 words):`;

    const answer = await callLLM(systemPrompt, userPrompt);
    res.json({ success: true, alert: answer });
  } catch (err) {
    console.error('LLM Condensed Alert error:', err.message);
    res.status(500).json({ success: false, error: 'LLM service unavailable. ' + err.message });
  }
});

// ─── POST /api/risks/report ────────────────────────────────────────────────────
router.post('/risks/report', async (req, res) => {
  try {
    const { type, description, lat, lng, roadName, landmark, severity, timeOfDay, weather, photoUrl } = req.body;

    if (!type || !description || !lat || !lng) {
      return res.status(400).json({ success: false, error: 'type, description, lat, and lng are required' });
    }

    const risk = await Risk.create({
      type,
      description,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      severity: parseInt(severity) || 3,
      timeOfDay: timeOfDay || 'afternoon',
      weather: weather || 'clear',
      roadName: roadName || 'Unknown Road',
      landmark: landmark || '',
      verified: false,
      photoUrl: photoUrl || null
    });

    // Map to frontend format
    const mapped = {
      ...risk.toJSON(),
      _id: risk.id,
      location: { type: 'Point', coordinates: [risk.lng, risk.lat] }
    };

    // Broadcast via Socket.io
    const io = req.app.get('io');
    if (io) io.emit('new-risk', mapped);

    res.json({ success: true, data: mapped });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/llm/voice-navigate ──────────────────────────────────────────────
router.post('/llm/voice-navigate', async (req, res) => {
  try {
    const { command, lat, lng, speed, destination, nearbyRisks, language } = req.body;
    if (!command) {
      return res.status(400).json({ success: false, error: 'command is required' });
    }

    const langInstructions = {
      'en': 'Respond in English.',
      'hi': 'Respond in Hindi (Devanagari script). Use simple Hindi.',
      'te': 'Respond in Telugu (Telugu script). Use simple Telugu.',
      'ta': 'Respond in Tamil (Tamil script). Use simple Tamil.'
    };

    const langInstruction = langInstructions[language] || langInstructions['en'];

    const riskContext = (nearbyRisks && nearbyRisks.length > 0)
      ? nearbyRisks.slice(0, 5).map(r =>
          `- ${r.type} on ${r.roadName}${r.landmark ? ' near ' + r.landmark : ''}: severity ${r.severity}/5. ${r.description}`
        ).join('\n')
      : 'No nearby risks detected.';

    const systemPrompt = `You are MicroAlert Voice Navigator — an AI driving assistant for road safety in India.
You help drivers by:
1. Providing turn-by-turn navigation guidance when asked
2. Warning about nearby hazards and how to avoid them
3. Suggesting safer alternative routes
4. Giving real-time safety tips based on speed, weather, and time of day
5. Responding to emergency situations quickly

Context:
- User's current location: lat ${lat || 'unknown'}, lng ${lng || 'unknown'}
- Current speed: ${speed || 0} km/h
- Destination: ${destination || 'not set'}
- Nearby risks:\n${riskContext}

Rules:
- Keep responses concise (2-3 sentences max) since they will be spoken aloud
- Be proactive about safety warnings
- If the user is speeding (>60 km/h in urban), warn them
- ${langInstruction}`;

    const answer = await callLLM(systemPrompt, command);
    res.json({ success: true, answer });
  } catch (err) {
    console.error('Voice Navigate error:', err.message);
    res.status(500).json({ success: false, error: 'Voice navigation service unavailable.' });
  }
});

// ─── POST /api/llm/journey-update ──────────────────────────────────────────────
router.post('/llm/journey-update', async (req, res) => {
  try {
    const { lat, lng, speed, destination, nearbyRisks, weather, timeOfDay, language } = req.body;

    const langInstructions = {
      'en': 'Respond in English.',
      'hi': 'Respond in Hindi (Devanagari script).',
      'te': 'Respond in Telugu (Telugu script).',
      'ta': 'Respond in Tamil (Tamil script).'
    };

    const langInstruction = langInstructions[language] || langInstructions['en'];

    const riskContext = (nearbyRisks && nearbyRisks.length > 0)
      ? nearbyRisks.slice(0, 5).map(r =>
          `- ${r.type} on ${r.roadName}: severity ${r.severity}/5. ${r.description}`
        ).join('\n')
      : 'No immediate risks detected.';

    const systemPrompt = `You are MicroAlert Journey Assistant. Generate a brief, spoken safety update for a driver currently on the road.

Context:
- Location: lat ${lat}, lng ${lng}
- Speed: ${speed || 0} km/h
- Destination: ${destination || 'not known'}
- Weather: ${weather || 'clear'}
- Time: ${timeOfDay || 'afternoon'}
- Nearby risks:\n${riskContext}

Rules:
- Produce EXACTLY ONE sentence — a short, actionable safety update
- Mention the most important nearby hazard if any
- If speed is too high, warn about it
- Be encouraging but alert
- ${langInstruction}`;

    const answer = await callLLM(systemPrompt, 'Generate a journey safety update now.');
    res.json({ success: true, update: answer });
  } catch (err) {
    console.error('Journey Update error:', err.message);
    res.status(500).json({ success: false, error: 'Journey update failed.' });
  }
});

// ─── POST /api/llm/nlp-process — Full NLP Voice Pipeline ───────────────────────
router.post('/llm/nlp-process', async (req, res) => {
  try {
    const {
      rawInput,
      conversationHistory,   // last 5 turns [{role, content}]
      lat, lng, speed,
      destination,
      nearbyRisks,
      language,
      sessionContext         // {lastMentionedLocation, lastIntent, pendingSlots}
    } = req.body;

    if (!rawInput) {
      return res.status(400).json({ success: false, error: 'rawInput is required' });
    }

    const langInstructions = {
      'en': 'Respond in English.',
      'hi': 'Respond in Hindi (Devanagari script). Use simple conversational Hindi.',
      'te': 'Respond in Telugu (Telugu script). Use simple conversational Telugu.',
      'ta': 'Respond in Tamil (Tamil script). Use simple conversational Tamil.'
    };
    const langInstruction = langInstructions[language] || langInstructions['en'];

    const riskContext = (nearbyRisks && nearbyRisks.length > 0)
      ? nearbyRisks.slice(0, 8).map(r =>
          `- ${r.type} on ${r.roadName}${r.landmark ? ' near ' + r.landmark : ''}: severity ${r.severity}/5. ${r.description}. Time: ${r.timeOfDay || 'unknown'}, Weather: ${r.weather || 'unknown'}`
        ).join('\n')
      : 'No nearby risks in database.';

    const sessionCtx = sessionContext || {};
    const lastLoc = sessionCtx.lastMentionedLocation || null;
    const lastIntent = sessionCtx.lastIntent || null;
    const pendingSlots = sessionCtx.pendingSlots || null;

    // Build conversation context string
    let convContext = '';
    if (conversationHistory && conversationHistory.length > 0) {
      convContext = '\n\nRecent conversation:\n' + conversationHistory.slice(-5).map(h =>
        `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`
      ).join('\n');
    }

    const systemPrompt = `You are an intelligent NLP engine embedded in MicroAlert — a road safety platform for Indian commuters. You process raw voice input (often noisy, incomplete, with filler words and regional accents from speech-to-text) and produce a structured JSON response.

## YOUR JOB
Analyze the user's voice input and produce ONLY a valid JSON object (no markdown, no backticks, just raw JSON).

## INTENT CLASSIFICATION — classify into exactly one:
- "REPORT_RISK" — user wants to report a hazard (e.g., "there's a blind turn near station road", "pothole on MG road")
- "QUERY_RISK" — user wants to know about risks near a location (e.g., "is it safe near marina?", "any dangers ahead?")
- "NAVIGATE" — user wants route guidance avoiding risks (e.g., "take me to airport avoiding danger", "safest route to T Nagar")
- "ALERT_STATUS" — user wants current alerts/notifications (e.g., "any new warnings?", "what's the latest?")
- "EMERGENCY" — user needs emergency dispatch (ambulance, police, fire, roadside help)
- "JOURNEY_START" — user wants to begin a monitored journey (e.g., "start journey to Marina Beach")
- "JOURNEY_STOP" — user wants to end a journey
- "CAMERA" — user wants to take a hazard photo
- "SPEED_CHECK" — user asks about their driving/speed rating
- "LANGUAGE_SWITCH" — user wants to change language
- "CONFIRM" — yes/okay/sure/correct
- "CANCEL" — stop/go back/cancel
- "HELP" — confused or asking how to use
- "UNKNOWN" — cannot determine; ask for clarification

## ENTITY EXTRACTION — extract from input:
- "location": street names, landmarks, areas, cities, relative positions ("near", "before", "after"). If user says "that spot" or "same place" or "there", use last_mentioned_location from context: "${lastLoc || 'none'}"
- "risk_type": one of [sudden_braking, blind_turn, pothole, habitual_violation, flooding, poor_lighting, overspeeding, accident, road_damage, congestion] or null
- "time_context": morning/evening/rush_hour/night/today/yesterday/always/recurring or null
- "severity": mild/moderate/dangerous/very_dangerous (infer from urgency words if not explicit) or null
- "emergency_type": ambulance/police/fire/roadside or null (only for EMERGENCY intent)
- "destination": extracted destination for NAVIGATE/JOURNEY_START or null
- "target_language": en/hi/te/ta or null (only for LANGUAGE_SWITCH)

## NOISE TOLERANCE rules:
- Strip filler words: "um", "uh", "like", "you know", "actually", "basically"
- Handle partial sentences: "near the school... pothole" → REPORT_RISK at school with pothole
- Fix STT errors: "blink turn" → "blind turn", "breaking zone" → "braking zone", "accidents own" → "accident zone"
- Deduplicate repetition: "the turn the turn near mall" → one entity
- Handle Hinglish: "gaadi rokti hai" = sudden braking, "mod" = turn, "sadak" = road, "khatarnak" = dangerous

## CONTEXT from previous turns:
- Last mentioned location: "${lastLoc || 'none'}"
- Last intent: "${lastIntent || 'none'}"
- Pending slots needing fill: ${pendingSlots ? JSON.stringify(pendingSlots) : 'none'}
${convContext}

## NEARBY RISK DATA:
${riskContext}

## USER CONTEXT:
- Location: lat ${lat || 'unknown'}, lng ${lng || 'unknown'}
- Speed: ${speed || 0} km/h
- Current destination: ${destination || 'none'}

## RESPONSE FORMAT — output ONLY this JSON:
{
  "intent": "<classified intent>",
  "entities": {
    "location": "<extracted or null>",
    "risk_type": "<extracted or null>",
    "time_context": "<extracted or null>",
    "severity": "<inferred or null>",
    "emergency_type": "<ambulance|police|fire|roadside or null>",
    "destination": "<for NAVIGATE/JOURNEY_START or null>",
    "target_language": "<en|hi|te|ta or null>"
  },
  "response_text": "<short conversational reply, max 2 sentences, to speak back>",
  "follow_up_question": "<single clarifying question if key slots are missing, else null>",
  "action": "<platform action: show_map | report_risk | get_alerts | navigate | start_journey | stop_journey | dispatch_emergency | open_camera | check_speed | switch_language | analyze_risk | scan_route | clarify | help | none>",
  "context_update": {
    "lastMentionedLocation": "<location from this turn to remember, or null>",
    "lastIntent": "<this turn's intent>"
  }
}

## RESPONSE TONE:
- Max 2 sentences — users are driving
- Be direct and reassuring: "Got it, marking that blind turn near Station Road."
- Don't say "I don't understand" — say "Can you say that differently? I'm here to help with road risks."
- ${langInstruction}`;

    const answer = await callLLM(systemPrompt, `Voice input: "${rawInput}"`);

    // Parse the LLM's JSON response
    let parsed = null;
    try {
      // Try to extract JSON from the response (LLM might wrap in backticks)
      let jsonStr = answer;
      // Remove markdown code fences if present
      jsonStr = jsonStr.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      // Find the JSON object
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      console.warn('NLP JSON parse failed, raw output:', answer);
    }

    if (parsed && parsed.intent) {
      res.json({ success: true, data: parsed });
    } else {
      // Fallback: return a basic UNKNOWN response
      res.json({
        success: true,
        data: {
          intent: 'UNKNOWN',
          entities: { location: null, risk_type: null, time_context: null, severity: null, emergency_type: null, destination: null, target_language: null },
          response_text: "Can you say that differently? I'm here to help with road safety, navigation, and hazard reporting.",
          follow_up_question: null,
          action: 'clarify',
          context_update: { lastMentionedLocation: null, lastIntent: 'UNKNOWN' }
        }
      });
    }
  } catch (err) {
    console.error('NLP Process error:', err.message);
    res.status(500).json({ success: false, error: 'NLP processing failed: ' + err.message });
  }
});

// ─── GET /api/hazards ─ All active hazards ─────────────────────────────────────
router.get('/hazards', async (req, res) => {
  try {
    const hazards = await Hazard.findAll({
      where: { active: true },
      order: [['severity', 'DESC']],
      raw: true
    });
    res.json({ success: true, data: hazards });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

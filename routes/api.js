const express = require('express');
const router = express.Router();
const Risk = require('../models/Risk');
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
    // NVIDIA NIM API via OpenAI SDK
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

    // Collect streamed response into a single string
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

// ─── GET /api/risks ─ All risks ────────────────────────────────────────────────
router.get('/risks', async (req, res) => {
  try {
    const risks = await Risk.find().sort({ severity: -1 }).lean();
    res.json({ success: true, data: risks });
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

    const risks = await Risk.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: parseInt(radius)
        }
      }
    }).lean();

    // Return as GeoJSON FeatureCollection
    const geojson = {
      type: 'FeatureCollection',
      features: risks.map(r => ({
        type: 'Feature',
        geometry: r.location,
        properties: {
          _id: r._id,
          type: r.type,
          severity: r.severity,
          description: r.description,
          timeOfDay: r.timeOfDay,
          weather: r.weather,
          roadName: r.roadName,
          landmark: r.landmark,
          verified: r.verified,
          timestamp: r.timestamp
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

    // Generate intermediate points along the route for better coverage
    const numPoints = 10;
    const searchPromises = [];
    for (let i = 0; i <= numPoints; i++) {
      const fraction = i / numPoints;
      const lat = sLat + fraction * (eLat - sLat);
      const lng = sLng + fraction * (eLng - sLng);
      searchPromises.push(
        Risk.find({
          location: {
            $near: {
              $geometry: { type: 'Point', coordinates: [lng, lat] },
              $maxDistance: 800 // 800m corridor around route
            }
          }
        }).lean()
      );
    }

    const results = await Promise.all(searchPromises);
    const seen = new Set();
    const uniqueRisks = [];
    for (const batch of results) {
      for (const risk of batch) {
        const id = risk._id.toString();
        if (!seen.has(id)) {
          seen.add(id);
          uniqueRisks.push(risk);
        }
      }
    }

    // Sort by severity descending
    uniqueRisks.sort((a, b) => b.severity - a.severity);

    res.json({ success: true, data: uniqueRisks });
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

    const systemPrompt = `You are a road-safety analyst for Chennai, India. Given micro-risk data for a specific area, answer the user's question in exactly 2 clear sentences. Be specific about road names and risk patterns. Do not use bullet points.`;

    const userPrompt = `Road risk data:\n${riskSummaries}\n\nUser question: ${question}`;

    const answer = await callLLM(systemPrompt, userPrompt);
    res.json({ success: true, answer });
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
    const { type, description, lat, lng, roadName, landmark, severity, timeOfDay, weather } = req.body;

    if (!type || !description || !lat || !lng) {
      return res.status(400).json({ success: false, error: 'type, description, lat, and lng are required' });
    }

    const risk = await Risk.create({
      type,
      description,
      location: {
        type: 'Point',
        coordinates: [parseFloat(lng), parseFloat(lat)]
      },
      severity: parseInt(severity) || 3,
      timeOfDay: timeOfDay || 'afternoon',
      weather: weather || 'clear',
      roadName: roadName || 'Unknown Road',
      landmark: landmark || '',
      verified: false
    });

    res.json({ success: true, data: risk });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/emergency ─ Mock emergency services ──────────────────────────────
router.get('/emergency', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    // Mock emergency services data for Chennai
    const emergencyServices = [
      {
        type: 'hospital',
        name: 'Apollo Hospital, Greams Road',
        address: '21, Greams Lane, Off Greams Road, Chennai',
        phone: '044-2829-3333',
        lat: 13.0604,
        lng: 80.2522,
        icon: '🏥'
      },
      {
        type: 'hospital',
        name: 'MIOT International Hospital',
        address: '4/112, Mount Poonamallee Road, Manapakkam',
        phone: '044-4200-0000',
        lat: 13.0285,
        lng: 80.1694,
        icon: '🏥'
      },
      {
        type: 'hospital',
        name: 'Government General Hospital',
        address: 'Park Town, Chennai',
        phone: '044-2530-5000',
        lat: 13.0878,
        lng: 80.2785,
        icon: '🏥'
      },
      {
        type: 'hospital',
        name: 'Fortis Malar Hospital',
        address: '52, 1st Main Road, Adyar, Chennai',
        phone: '044-4289-2222',
        lat: 13.0067,
        lng: 80.2565,
        icon: '🏥'
      },
      {
        type: 'police',
        name: 'T. Nagar Police Station',
        address: 'South Usman Road, T. Nagar',
        phone: '044-2434-1212',
        lat: 13.0418,
        lng: 80.2341,
        icon: '🚔'
      },
      {
        type: 'police',
        name: 'Adyar Traffic Police',
        address: 'Adyar, Chennai',
        phone: '044-2440-1818',
        lat: 13.0063,
        lng: 80.2574,
        icon: '🚔'
      },
      {
        type: 'police',
        name: 'Anna Nagar Police Station',
        address: '2nd Avenue, Anna Nagar',
        phone: '044-2628-5555',
        lat: 13.0850,
        lng: 80.2101,
        icon: '🚔'
      },
      {
        type: 'police',
        name: 'Guindy Traffic Police',
        address: 'Guindy, Chennai',
        phone: '044-2234-0000',
        lat: 13.0067,
        lng: 80.2206,
        icon: '🚔'
      }
    ];

    // Sort by distance to user if coordinates provided
    if (lat && lng) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      emergencyServices.forEach(s => {
        const dLat = s.lat - userLat;
        const dLng = s.lng - userLng;
        s.distance = Math.sqrt(dLat * dLat + dLng * dLng) * 111; // rough km
      });
      emergencyServices.sort((a, b) => a.distance - b.distance);
    }

    res.json({ success: true, data: emergencyServices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

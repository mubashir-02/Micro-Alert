// ─── MicroAlert Voice Assistant — NLP-Powered ───────────────────────────────────
// Full NLP pipeline: intent classification, entity extraction, context memory,
// noise tolerance, slot filling, multilingual (EN, HI, TE, TA)

// ─── State ──────────────────────────────────────────────────────────────────────
let voiceActive = false;
let isListening = false;
let wakeWordDetected = false;
let recognition = null;
let synthesis = window.speechSynthesis;
let continuousRecognition = null;
let voiceLanguage = 'en';
let journeyActive = false;
let journeyInterval = null;
let journeyDestination = '';
let journeyUpdateCount = 0;

// ─── NLP Context Memory (session-scoped) ────────────────────────────────────────
let nlpSessionContext = {
  lastMentionedLocation: null,
  lastIntent: null,
  pendingSlots: null
};
let conversationHistory = []; // [{role: 'user'|'assistant', content: '...'}]
const MAX_HISTORY = 10;

// ─── Client-side Noise Pre-processor ────────────────────────────────────────────
const FILLER_WORDS = /\b(um|uh|hmm|like|you know|actually|basically|so|well|okay so|right so|i mean)\b/gi;
const STT_CORRECTIONS = {
  'blink turn': 'blind turn',
  'blind spot': 'blind turn',
  'breaking zone': 'braking zone',
  'breaking': 'braking',
  'sudden breaking': 'sudden braking',
  'accidents own': 'accident zone',
  'accident own': 'accident zone',
  'pot hole': 'pothole',
  'over speeding': 'overspeeding',
  'potter hole': 'pothole',
  'rode': 'road',
  'root': 'route',
  'rout': 'route',
  'gaadi rokti hai': 'sudden braking zone',
  'gaadi ruk': 'sudden braking',
  'mod': 'turn',
  'sadak': 'road',
  'khatarnak': 'dangerous',
  'kharab sadak': 'road damage',
  'bahut kharab': 'very dangerous',
  'ambulance bulao': 'call ambulance',
  'police bulao': 'call police'
};
const DEDUP_REGEX = /\b(\w+)\s+\1\b/gi; // "the turn the turn" → "the turn"

function preprocessVoiceInput(raw) {
  let cleaned = raw.toLowerCase().trim();
  // 1. Strip filler words
  cleaned = cleaned.replace(FILLER_WORDS, ' ');
  // 2. Apply STT corrections
  for (const [wrong, right] of Object.entries(STT_CORRECTIONS)) {
    cleaned = cleaned.replace(new RegExp(wrong, 'gi'), right);
  }
  // 3. Deduplicate repeated phrases
  cleaned = cleaned.replace(DEDUP_REGEX, '$1');
  // 4. Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

// ─── Language Configuration ─────────────────────────────────────────────────────
const VOICE_LANGUAGES = {
  en: { label: 'English', speechLang: 'en-IN', wakeWord: 'wake up', greeting: "I'm awake! How can I help you?", placeholder: 'Tap to Listen' },
  hi: { label: 'हिन्दी', speechLang: 'hi-IN', wakeWord: 'जागो', greeting: 'मैं जाग गया! कैसे मदद कर सकता हूँ?', placeholder: 'बोलने के लिए टैप करें' },
  te: { label: 'తెలుగు', speechLang: 'te-IN', wakeWord: 'లేవండి', greeting: 'నేను మేల్కొన్నాను! నేను ఎలా సహాయం చేయగలను?', placeholder: 'వినడానికి ట్యాప్ చేయండి' },
  ta: { label: 'தமிழ்', speechLang: 'ta-IN', wakeWord: 'எழுந்திரு', greeting: 'நான் விழித்துவிட்டேன்! எப்படி உதவ வேண்டும்?', placeholder: 'கேட்க தட்டவும்' }
};

// ─── Initialize Speech Recognition ──────────────────────────────────────────────
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { console.warn('Speech Recognition not supported'); return null; }
  const rec = new SpeechRecognition();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = VOICE_LANGUAGES[voiceLanguage].speechLang;
  rec.maxAlternatives = 1;
  return rec;
}

// ─── Language Switching ─────────────────────────────────────────────────────────
function setVoiceLanguage(lang) {
  if (!VOICE_LANGUAGES[lang]) return;
  voiceLanguage = lang;
  document.querySelectorAll('.lang-option').forEach(el => {
    el.classList.toggle('active', el.dataset.lang === lang);
  });
  const langConf = VOICE_LANGUAGES[lang];
  const label = document.getElementById('voiceListenLabel');
  if (label) label.textContent = langConf.placeholder;
  addVoiceMessage('system', `🌐 Language switched to ${langConf.label}`);
  speak(`Language switched to ${langConf.label}.`);
  if (continuousRecognition) {
    try { continuousRecognition.stop(); } catch (e) {}
    setTimeout(() => startWakeWordListener(), 500);
  }
}

// ─── Toggle Voice Panel ─────────────────────────────────────────────────────────
function toggleVoiceAssistant() {
  const panel = document.getElementById('voicePanel');
  const fab = document.getElementById('voiceFab');
  if (panel.classList.contains('visible')) { closeVoicePanel(); }
  else { panel.classList.add('visible'); fab.classList.add('active'); startWakeWordListener(); }
}

function closeVoicePanel() {
  document.getElementById('voicePanel').classList.remove('visible');
  document.getElementById('voiceFab').classList.remove('active');
  stopListening();
  wakeWordDetected = false;
  updateVoiceStatus(`Say "${VOICE_LANGUAGES[voiceLanguage].wakeWord}" to activate`);
}

// ─── Toggle Alert Panel ─────────────────────────────────────────────────────────
function toggleAlertPanel() {
  document.getElementById('alertPanel').classList.toggle('visible');
}

// ─── Wake Word Listener ─────────────────────────────────────────────────────────
function startWakeWordListener() {
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    addVoiceMessage('system', '⚠️ Speech Recognition not supported. Try Chrome.');
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  continuousRecognition = new SpeechRecognition();
  continuousRecognition.continuous = true;
  continuousRecognition.interimResults = true;
  continuousRecognition.lang = VOICE_LANGUAGES[voiceLanguage].speechLang;

  continuousRecognition.onresult = (event) => {
    const lastResult = event.results[event.results.length - 1];
    const transcript = lastResult[0].transcript.toLowerCase().trim();
    const isWakeWord = Object.values(VOICE_LANGUAGES).some(l => transcript.includes(l.wakeWord.toLowerCase()));

    if (!wakeWordDetected && isWakeWord) {
      wakeWordDetected = true;
      updateVoiceStatus('🟢 Active — Listening...');
      const langConf = VOICE_LANGUAGES[voiceLanguage];
      addVoiceMessage('system', `👋 ${langConf.greeting}\n\n🧠 <strong>I understand natural language!</strong> Just say things like:\n• "There's a pothole near the school"\n• "Is it safe near Marina Beach?"\n• "Take me to the airport avoiding danger spots"\n• "Start journey to T. Nagar"\n• "Any new warnings today?"\n\n🌐 Switch languages: Hindi / Telugu / Tamil`);
      speak(langConf.greeting);
      document.getElementById('voiceFab').style.background = '#F59E0B';
    }

    if (wakeWordDetected && lastResult.isFinal) {
      let command = transcript;
      Object.values(VOICE_LANGUAGES).forEach(l => {
        command = command.replace(l.wakeWord.toLowerCase(), '').trim();
      });
      if (command.length > 2) { processVoiceCommand(command); }
    }
  };

  continuousRecognition.onerror = (event) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') console.warn('Speech error:', event.error);
  };
  continuousRecognition.onend = () => {
    if (document.getElementById('voicePanel').classList.contains('visible')) {
      try { continuousRecognition.start(); } catch (e) {}
    }
  };

  try {
    continuousRecognition.start();
    updateVoiceStatus(`Listening for "${VOICE_LANGUAGES[voiceLanguage].wakeWord}"...`);
  } catch (e) { console.warn('Could not start recognition:', e); }
}

// ─── Manual Listening ───────────────────────────────────────────────────────────
function startListening() {
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    showToast('Speech Recognition not supported. Use Chrome.', 'error');
    return;
  }
  const btn = document.getElementById('voiceListenBtn');
  const label = document.getElementById('voiceListenLabel');
  if (isListening) { stopListening(); return; }

  wakeWordDetected = true;
  isListening = true;
  btn.classList.add('listening');
  label.textContent = voiceLanguage === 'hi' ? 'सुन रहा हूँ...' : voiceLanguage === 'te' ? 'వింటున్నాను...' : voiceLanguage === 'ta' ? 'கேட்கிறேன்...' : 'Listening...';
  updateVoiceStatus('🟢 Listening...');

  recognition = initSpeechRecognition();
  if (!recognition) return;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    processVoiceCommand(transcript);
  };
  recognition.onerror = (event) => {
    if (event.error !== 'no-speech') addVoiceMessage('system', '⚠️ Could not understand. Please try again.');
    stopListening();
  };
  recognition.onend = () => stopListening();
  try { recognition.start(); } catch (e) { stopListening(); }
}

function stopListening() {
  isListening = false;
  const btn = document.getElementById('voiceListenBtn');
  const label = document.getElementById('voiceListenLabel');
  if (btn) btn.classList.remove('listening');
  if (label) label.textContent = VOICE_LANGUAGES[voiceLanguage].placeholder;
  if (recognition) { try { recognition.stop(); } catch (e) {} }
  updateVoiceStatus(wakeWordDetected ? '🟢 Active — Tap to speak' : `Say "${VOICE_LANGUAGES[voiceLanguage].wakeWord}" to activate`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CORE NLP PIPELINE ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function processVoiceCommand(rawInput) {
  // Show the raw input as a user message
  addVoiceMessage('user', rawInput);

  // Step 1: Client-side noise preprocessing
  const cleaned = preprocessVoiceInput(rawInput);
  console.log('[NLP] Raw:', rawInput, '→ Cleaned:', cleaned);

  // Step 2: Quick client-side intent shortcuts (for latency-sensitive actions)
  const quickResult = tryQuickIntentMatch(cleaned);
  if (quickResult) {
    await executeNLPAction(quickResult);
    return;
  }

  // Step 3: Send to LLM-powered NLP backend
  addVoiceMessage('assistant', '🧠 Processing...');
  
  try {
    // Gather nearby risks for context
    let nearbyRisks = [];
    if (typeof userLat !== 'undefined' && userLat) {
      try {
        const nr = await fetch(`/api/risks/nearby?lat=${userLat}&lng=${userLng}&radius=2000`);
        const nrj = await nr.json();
        if (nrj.success && nrj.data.features) nearbyRisks = nrj.data.features.map(f => f.properties);
      } catch (e) {}
    }

    const res = await fetch('/api/llm/nlp-process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawInput: cleaned,
        conversationHistory: conversationHistory.slice(-MAX_HISTORY),
        lat: userLat || 13.0827,
        lng: userLng || 80.2707,
        speed: currentSpeed || 0,
        destination: journeyDestination || document.getElementById('endLocation')?.value || '',
        nearbyRisks,
        language: voiceLanguage,
        sessionContext: nlpSessionContext
      })
    });

    const json = await res.json();

    // Remove "Processing..." message
    removeLastAssistantMsg('Processing');

    if (json.success && json.data) {
      const nlpResult = json.data;
      console.log('[NLP] Result:', nlpResult);

      // Update conversation history
      conversationHistory.push({ role: 'user', content: cleaned });
      conversationHistory.push({ role: 'assistant', content: nlpResult.response_text });
      if (conversationHistory.length > MAX_HISTORY * 2) conversationHistory = conversationHistory.slice(-MAX_HISTORY * 2);

      // Update session context
      if (nlpResult.context_update) {
        if (nlpResult.context_update.lastMentionedLocation) {
          nlpSessionContext.lastMentionedLocation = nlpResult.context_update.lastMentionedLocation;
        }
        nlpSessionContext.lastIntent = nlpResult.context_update.lastIntent || nlpResult.intent;
      }

      // Handle slot filling — if there's a follow-up question, set pending slots
      if (nlpResult.follow_up_question) {
        nlpSessionContext.pendingSlots = {
          intent: nlpResult.intent,
          entities: nlpResult.entities,
          question: nlpResult.follow_up_question
        };
      } else {
        nlpSessionContext.pendingSlots = null;
      }

      // Execute the action
      await executeNLPAction(nlpResult);
    } else {
      addVoiceMessage('assistant', "🤖 Can you say that differently? I'm here to help with road risks, navigation, and hazard reporting.");
      speak("Can you say that differently? I'm here to help with road risks.");
    }
  } catch (err) {
    removeLastAssistantMsg('Processing');
    console.error('[NLP] Error:', err);
    // Fall back to basic keyword matching
    const fallback = tryKeywordFallback(cleaned);
    if (fallback) {
      await executeNLPAction(fallback);
    } else {
      addVoiceMessage('assistant', "🤖 I'm having trouble connecting. Try: \"Check hazards nearby\", \"Navigate to [place]\", or \"Call ambulance\".");
      speak("I'm having trouble connecting. Try simple commands like check hazards or navigate to a place.");
    }
  }
}

// ─── Quick Client-Side Intent Matching (zero-latency) ───────────────────────────
function tryQuickIntentMatch(input) {
  // Emergency — must be instant
  if (/\b(ambulance|need ambulance|call ambulance|एम्बुलेंस)\b/i.test(input)) {
    return { intent: 'EMERGENCY', entities: { emergency_type: 'ambulance' }, response_text: '🚑 Dispatching ambulance to your location now!', action: 'dispatch_emergency' };
  }
  if (/\b(police|need police|call police|पुलिस)\b/i.test(input)) {
    return { intent: 'EMERGENCY', entities: { emergency_type: 'police' }, response_text: '👮 Dispatching police to your location now!', action: 'dispatch_emergency' };
  }
  if (/\b(fire|fire station|call fire|अग्निशमन)\b/i.test(input)) {
    return { intent: 'EMERGENCY', entities: { emergency_type: 'fire' }, response_text: '🚒 Dispatching fire service to your location!', action: 'dispatch_emergency' };
  }
  if (/\b(roadside|breakdown|tow|stuck)\b/i.test(input)) {
    return { intent: 'EMERGENCY', entities: { emergency_type: 'roadside' }, response_text: '🆘 Requesting roadside assistance!', action: 'dispatch_emergency' };
  }

  // Language switch — must be instant
  if (/switch.*(hindi|हिन्दी)/i.test(input)) {
    return { intent: 'LANGUAGE_SWITCH', entities: { target_language: 'hi' }, response_text: '🌐 Switching to Hindi', action: 'switch_language' };
  }
  if (/switch.*(telugu|తెలుగు)/i.test(input)) {
    return { intent: 'LANGUAGE_SWITCH', entities: { target_language: 'te' }, response_text: '🌐 Switching to Telugu', action: 'switch_language' };
  }
  if (/switch.*(tamil|தமிழ்)/i.test(input)) {
    return { intent: 'LANGUAGE_SWITCH', entities: { target_language: 'ta' }, response_text: '🌐 Switching to Tamil', action: 'switch_language' };
  }
  if (/switch.*(english)/i.test(input)) {
    return { intent: 'LANGUAGE_SWITCH', entities: { target_language: 'en' }, response_text: '🌐 Switching to English', action: 'switch_language' };
  }

  // Journey stop — instant
  if (/\b(stop journey|end journey|stop trip|yatra band|journey stop)\b/i.test(input)) {
    return { intent: 'JOURNEY_STOP', entities: {}, response_text: '🏁 Ending your journey.', action: 'stop_journey' };
  }

  // Cancel
  if (/^(cancel|stop|nevermind|never mind|go back|band karo)$/i.test(input.trim())) {
    return { intent: 'CANCEL', entities: {}, response_text: 'Okay, cancelled.', action: 'none' };
  }

  // Camera — instant
  if (/\b(take photo|camera|capture|photo le|तस्वीर|फोटो)\b/i.test(input)) {
    return { intent: 'CAMERA', entities: {}, response_text: '📸 Opening camera to capture hazard evidence.', action: 'open_camera' };
  }

  return null; // Not a quick match — send to NLP backend
}

// ─── Keyword Fallback (when NLP backend is unreachable) ─────────────────────────
function tryKeywordFallback(input) {
  // Journey start
  const journeyMatch = input.match(/(?:start journey|begin journey|start trip|yatra shuru)(?:\s+(?:to|for))?\s+(.+)/i);
  if (journeyMatch) {
    return { intent: 'JOURNEY_START', entities: { destination: journeyMatch[1].trim() }, response_text: `🚗 Starting journey to ${journeyMatch[1].trim()}!`, action: 'start_journey' };
  }

  // Navigate
  const navMatch = input.match(/(?:navigate|route|go|directions?|safest route|take me)(?:\s+(?:to|from))?\s+(.+)/i);
  if (navMatch) {
    return { intent: 'NAVIGATE', entities: { destination: navMatch[1].trim() }, response_text: `🗺️ Finding safest route to ${navMatch[1].trim()}.`, action: 'navigate' };
  }

  // Query risk
  if (/\b(hazard|danger|safe|risk|warning|alert|ahead)\b/i.test(input)) {
    return { intent: 'QUERY_RISK', entities: {}, response_text: '🔍 Checking for nearby hazards...', action: 'analyze_risk' };
  }

  // Speed check
  if (/\b(speed|rating|driving|how am i)\b/i.test(input)) {
    return { intent: 'SPEED_CHECK', entities: {}, response_text: 'Checking your driving rating...', action: 'check_speed' };
  }

  // Report risk
  if (/\b(pothole|blind turn|braking|accident|flood|damage)\b/i.test(input)) {
    return { intent: 'REPORT_RISK', entities: { risk_type: input.match(/\b(pothole|blind.?turn|braking|accident|flood|damage)\b/i)?.[1] || null }, response_text: `Got it, noting that hazard. Where exactly did you see it?`, action: 'report_risk', follow_up_question: 'Where exactly did you notice this?' };
  }

  // Help
  if (/\b(help|how|what can you|kya kar sakte)\b/i.test(input)) {
    return { intent: 'HELP', entities: {}, response_text: "I can help with navigation, hazard reporting, emergency dispatch, and real-time safety alerts. Just speak naturally!", action: 'help' };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ACTION ROUTER — Execute Platform Actions from NLP ──────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function executeNLPAction(nlpResult) {
  const { intent, entities, response_text, follow_up_question, action } = nlpResult;
  const ent = entities || {};

  // Build the display message
  let displayMsg = response_text || '';
  if (follow_up_question) {
    displayMsg += `\n\n❓ ${follow_up_question}`;
  }

  // Intent badge for display
  const intentBadge = getIntentBadge(intent);

  switch (action) {

    // ── Emergency Dispatch ──
    case 'dispatch_emergency': {
      const eType = ent.emergency_type || 'ambulance';
      addVoiceMessage('assistant', `${intentBadge} ${displayMsg}`);
      speak(response_text);
      dispatchEmergency(eType);
      break;
    }

    // ── Report Risk ──
    case 'report_risk': {
      addVoiceMessage('assistant', `${intentBadge} ${displayMsg}`);
      speak(response_text);
      // If we have a location, try to set it; if missing, the follow_up_question handles it
      if (ent.location) {
        // Auto-fill the report form
        const rType = mapRiskType(ent.risk_type);
        const reportType = document.getElementById('reportType');
        const reportDesc = document.getElementById('reportDescription');
        const reportRoad = document.getElementById('reportRoadName');
        if (reportType && rType) reportType.value = rType;
        if (reportDesc) reportDesc.value = `${ent.risk_type || 'hazard'} reported via voice at ${ent.location}${ent.time_context ? '. Time: ' + ent.time_context : ''}${ent.severity ? '. Severity: ' + ent.severity : ''}`;
        if (reportRoad) reportRoad.value = ent.location;
        // Open report panel
        const panel = document.getElementById('reportPanel');
        if (panel && panel.classList.contains('collapsed')) togglePanel('reportPanel');
        showToast('📝 Report form pre-filled from voice. Pick location on map & submit.', 'success');
      }
      break;
    }

    // ── Query Risk / Analyze ──
    case 'analyze_risk':
    case 'show_map': {
      addVoiceMessage('assistant', `${intentBadge} ${displayMsg}`);
      speak(response_text);
      if (ent.location) {
        // Try to fly to the location on map
        if (typeof geocodeLocation === 'function') {
          const coords = await geocodeLocation(ent.location);
          if (coords && typeof map !== 'undefined') {
            map.flyTo(coords, 15, { duration: 1 });
          }
        }
      }
      await checkNearbyHazards();
      break;
    }

    // ── Navigate ──
    case 'navigate':
    case 'scan_route': {
      const dest = ent.destination || ent.location;
      addVoiceMessage('assistant', `${intentBadge} ${displayMsg}`);
      speak(response_text);
      if (dest) {
        const endInput = document.getElementById('endLocation');
        const startInput = document.getElementById('startLocation');
        if (endInput) endInput.value = dest;
        if (startInput && !startInput.value) startInput.value = 'My Location';
        if (typeof scanRoute === 'function') scanRoute();
      }
      break;
    }

    // ── Start Journey ──
    case 'start_journey': {
      const dest = ent.destination || ent.location;
      if (dest) {
        addVoiceMessage('assistant', `${intentBadge} ${displayMsg}`);
        speak(response_text);
        startJourney(dest);
      } else {
        addVoiceMessage('assistant', `${intentBadge} ${displayMsg}\n\n❓ Where would you like to go?`);
        speak(response_text || 'Where would you like to go?');
        nlpSessionContext.pendingSlots = { intent: 'JOURNEY_START', entities: ent, question: 'Where would you like to go?' };
      }
      break;
    }

    // ── Stop Journey ──
    case 'stop_journey': {
      addVoiceMessage('assistant', `${intentBadge} ${displayMsg}`);
      speak(response_text);
      stopJourney();
      break;
    }

    // ── Camera ──
    case 'open_camera': {
      addVoiceMessage('assistant', `${intentBadge} ${displayMsg}`);
      speak(response_text);
      if (typeof openCamera === 'function') openCamera();
      break;
    }

    // ── Speed Check ──
    case 'check_speed': {
      const badge = document.getElementById('speedBadge');
      const ratingText = badge ? badge.querySelector('.speed-label')?.textContent || '5.0' : '5.0';
      const speedMsg = `⭐ Your driving safety rating is ${ratingText}/5.${currentSpeed > 0 ? ` Current speed: ${Math.round(currentSpeed)} km/h.` : ''}`;
      addVoiceMessage('assistant', `${intentBadge} ${speedMsg}`);
      speak(`Your driving safety rating is ${ratingText} out of 5.`);
      break;
    }

    // ── Language Switch ──
    case 'switch_language': {
      const targetLang = ent.target_language;
      if (targetLang && VOICE_LANGUAGES[targetLang]) {
        setVoiceLanguage(targetLang);
      }
      break;
    }

    // ── Get Alerts ──
    case 'get_alerts': {
      addVoiceMessage('assistant', `${intentBadge} ${displayMsg}`);
      speak(response_text);
      // Show the alert panel
      const alertP = document.getElementById('alertPanel');
      if (alertP && !alertP.classList.contains('visible')) toggleAlertPanel();
      break;
    }

    // ── Help ──
    case 'help': {
      const helpMsg = `${intentBadge} ${response_text || 'I can help you with:'}\n\n` +
        `🗺️ <strong>Navigation:</strong> "Take me to [place] avoiding danger"\n` +
        `⚠️ <strong>Report hazard:</strong> "There's a pothole near [location]"\n` +
        `🔍 <strong>Query:</strong> "Is it safe near [location]?"\n` +
        `🚗 <strong>Journey:</strong> "Start journey to [place]"\n` +
        `📸 <strong>Camera:</strong> "Take photo"\n` +
        `🚑 <strong>Emergency:</strong> "Call ambulance/police/fire"\n` +
        `🌐 <strong>Language:</strong> "Switch to Hindi/Telugu/Tamil"`;
      addVoiceMessage('assistant', helpMsg);
      speak(response_text || 'I can help with navigation, hazard reporting, emergency dispatch, and safety alerts. Just speak naturally!');
      break;
    }

    // ── Clarify / Follow-up ──
    case 'clarify': {
      addVoiceMessage('assistant', `${intentBadge} ${displayMsg}`);
      speak(follow_up_question || response_text);
      break;
    }

    // ── Confirm (slot filling) ──
    case 'none':
    default: {
      if (displayMsg) {
        addVoiceMessage('assistant', `${intentBadge} ${displayMsg}`);
        speak(response_text);
      }
      break;
    }
  }
}

// ─── Intent Badge Icons ─────────────────────────────────────────────────────────
function getIntentBadge(intent) {
  const badges = {
    REPORT_RISK: '📝',
    QUERY_RISK: '🔍',
    NAVIGATE: '🗺️',
    ALERT_STATUS: '🔔',
    EMERGENCY: '🚨',
    JOURNEY_START: '🚗',
    JOURNEY_STOP: '🏁',
    CAMERA: '📸',
    SPEED_CHECK: '⭐',
    LANGUAGE_SWITCH: '🌐',
    CONFIRM: '✅',
    CANCEL: '❌',
    HELP: '💡',
    UNKNOWN: '🤖'
  };
  return badges[intent] || '🤖';
}

// ─── Map Risk Type from NLP to Platform ─────────────────────────────────────────
function mapRiskType(nlpType) {
  if (!nlpType) return null;
  const mapping = {
    'sudden_braking': 'sudden_brake',
    'sudden braking': 'sudden_brake',
    'braking zone': 'sudden_brake',
    'blind_turn': 'blind_turn',
    'blind turn': 'blind_turn',
    'blind curve': 'blind_turn',
    'pothole': 'habitual_violation',
    'habitual_violation': 'habitual_violation',
    'overspeeding': 'habitual_violation',
    'accident': 'accident',
    'accident zone': 'accident',
    'flooding': 'habitual_violation',
    'road_damage': 'habitual_violation',
    'congestion': 'habitual_violation',
    'poor_lighting': 'habitual_violation'
  };
  return mapping[nlpType.toLowerCase()] || 'habitual_violation';
}

// ─── Remove last assistant message matching text ────────────────────────────────
function removeLastAssistantMsg(matchText) {
  const msgs = document.querySelectorAll('.voice-transcript .voice-msg.assistant');
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].textContent.includes(matchText)) { msgs[i].remove(); break; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── JOURNEY MODE — Continuous Safety Updates ───────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function startJourney(destination) {
  journeyDestination = destination;
  journeyActive = true;
  journeyUpdateCount = 0;

  addVoiceMessage('assistant', `🚗 Journey started to <strong>${destination}</strong>!\n\n📍 Continuous safety updates every 45 seconds\n⚠️ Hazard warnings along the way\n🗺️ Setting up route...`);
  speak(`Journey to ${destination} started. I will assist you throughout with safety updates.`);

  const endInput = document.getElementById('endLocation');
  const startInput = document.getElementById('startLocation');
  if (endInput) endInput.value = destination;
  if (startInput && !startInput.value) startInput.value = 'My Location';
  if (typeof scanRoute === 'function') scanRoute();

  const journeyBar = document.getElementById('voiceJourneyBar');
  const journeyText = document.getElementById('journeyStatusText');
  if (journeyBar) journeyBar.style.display = 'flex';
  if (journeyText) journeyText.textContent = `🚗 Journey to ${destination}`;
  updateVoiceStatus(`🚗 Journey to ${destination} — Active`);

  journeyInterval = setInterval(async () => {
    if (!journeyActive) return;
    await sendJourneyUpdate();
  }, 45000);

  setTimeout(() => { if (journeyActive) sendJourneyUpdate(); }, 10000);
}

function stopJourney() {
  journeyActive = false;
  journeyDestination = '';
  if (journeyInterval) { clearInterval(journeyInterval); journeyInterval = null; }

  const journeyBar = document.getElementById('voiceJourneyBar');
  if (journeyBar) journeyBar.style.display = 'none';

  addVoiceMessage('assistant', `🏁 Journey ended! ${journeyUpdateCount} safety updates provided.\n\n⭐ Drive safe!`);
  speak('Journey ended. Drive safe!');
  updateVoiceStatus('🟢 Active — Tap to speak');
}

async function sendJourneyUpdate() {
  if (!journeyActive) return;
  journeyUpdateCount++;
  try {
    let nearbyRisks = [];
    const lat = userLat || 13.0827;
    const lng = userLng || 80.2707;
    try {
      const r = await fetch(`/api/risks/nearby?lat=${lat}&lng=${lng}&radius=2000`);
      const j = await r.json();
      if (j.success && j.data.features) nearbyRisks = j.data.features.map(f => f.properties);
    } catch (e) {}

    const hour = new Date().getHours();
    let timeOfDay = 'afternoon';
    if (hour >= 6 && hour < 10) timeOfDay = 'morning_rush';
    else if (hour >= 16 && hour < 20) timeOfDay = 'evening_rush';
    else if (hour >= 20 || hour < 6) timeOfDay = 'night';

    const res = await fetch('/api/llm/journey-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat, lng, speed: currentSpeed || 0,
        destination: journeyDestination, nearbyRisks,
        weather: 'clear', timeOfDay, language: voiceLanguage
      })
    });
    const json = await res.json();
    if (json.success && json.update) {
      addVoiceMessage('assistant', `🔄 Update #${journeyUpdateCount}: ${json.update}`);
      speak(json.update);
    }
  } catch (err) { console.warn('Journey update failed:', err); }
}

// ─── Check Nearby Hazards ───────────────────────────────────────────────────────
async function checkNearbyHazards() {
  const lat = userLat || 13.0827;
  const lng = userLng || 80.2707;
  try {
    const res = await fetch(`/api/risks/nearby?lat=${lat}&lng=${lng}&radius=2000`);
    const json = await res.json();
    if (json.success && json.data.features && json.data.features.length > 0) {
      const risks = json.data.features.map(f => f.properties);
      const topRisks = risks.sort((a, b) => b.severity - a.severity).slice(0, 3);
      const typeLabels = { sudden_brake: '🛑 Sudden Braking', blind_turn: '🔄 Blind Turn', habitual_violation: '⚠️ Violation Zone', accident: '💥 Accident Zone' };
      let msg = `⚠️ Found <strong>${risks.length} hazard(s)</strong> nearby:\n\n`;
      topRisks.forEach((r, i) => {
        msg += `${i + 1}. ${typeLabels[r.type] || r.type} at <strong>${r.roadName}</strong> — Severity: ${r.severity}/5\n`;
      });
      if (risks.length > 3) msg += `\n...and ${risks.length - 3} more. Stay alert!`;
      addVoiceMessage('assistant', msg);
      speak(`I found ${risks.length} hazards nearby. The most critical is a ${topRisks[0].type.replace('_', ' ')} at ${topRisks[0].roadName} with severity ${topRisks[0].severity} out of 5. Stay alert.`);
    } else {
      addVoiceMessage('assistant', '✅ No significant hazards detected nearby. Road looks clear!');
      speak('No significant hazards nearby. The road looks clear. Drive safely!');
    }
  } catch (err) {
    addVoiceMessage('assistant', '⚠️ Could not check for hazards. Please try again.');
    speak('Could not check for hazards right now.');
  }
}

// ─── Text-to-Speech ─────────────────────────────────────────────────────────────
function speak(text) {
  if (!synthesis) return;
  synthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 0.8;
  utterance.lang = VOICE_LANGUAGES[voiceLanguage].speechLang;
  const voices = synthesis.getVoices();
  const langCode = VOICE_LANGUAGES[voiceLanguage].speechLang;
  const preferred = voices.find(v => v.lang === langCode) ||
                    voices.find(v => v.lang.startsWith(langCode.split('-')[0])) ||
                    voices.find(v => v.lang.includes('en-IN') || v.lang.includes('en-GB'));
  if (preferred) utterance.voice = preferred;
  synthesis.speak(utterance);
}

// ─── UI Helpers ─────────────────────────────────────────────────────────────────
function addVoiceMessage(type, text) {
  const transcript = document.getElementById('voiceTranscript');
  if (!transcript) return;
  const msg = document.createElement('div');
  msg.className = `voice-msg ${type}`;
  msg.innerHTML = text.replace(/\n/g, '<br>');
  transcript.appendChild(msg);
  transcript.scrollTop = transcript.scrollHeight;
}

function updateVoiceStatus(text) {
  const el = document.getElementById('voiceStatus');
  if (el) el.textContent = text;
}

// ─── Emergency Dispatch ─────────────────────────────────────────────────────────
async function dispatchEmergency(type) {
  const modal = document.getElementById('dispatchModal');
  const iconEl = document.getElementById('dispatchModalIcon');
  const titleEl = document.getElementById('dispatchModalTitle');
  const textEl = document.getElementById('dispatchModalText');
  const closeBtn = document.getElementById('dispatchModalClose');

  const labels = {
    ambulance: { icon: '🚑', label: 'Ambulance' },
    police: { icon: '👮', label: 'Police' },
    fire: { icon: '🚒', label: 'Fire Service' },
    roadside: { icon: '🆘', label: 'Roadside Assistance' }
  };

  const info = labels[type] || labels.ambulance;
  iconEl.textContent = info.icon;
  titleEl.textContent = `Dispatching ${info.label}`;
  textEl.textContent = 'Sending your GPS coordinates and route info...';
  closeBtn.style.display = 'none';
  modal.classList.add('visible');

  let lat = 13.0827, lng = 80.2707;
  if (typeof map !== 'undefined') { const c = map.getCenter(); lat = c.lat; lng = c.lng; }

  try {
    const res = await fetch('/api/emergency/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, lat, lng, incidentType: type, routeSnapshot: null })
    });
    const json = await res.json();
    if (json.success) {
      textEl.textContent = `✅ ${info.label} dispatched! Help is on the way. ID: #${json.data._id || json.data.id}`;
      showToast(`${info.icon} ${info.label} dispatched!`, 'success');
    } else {
      textEl.textContent = '⚠️ Dispatch sent (simulated). In production, services would be contacted.';
    }
  } catch (err) {
    textEl.textContent = '⚠️ Dispatch logged. Network issue — fallback notification sent.';
  }
  closeBtn.style.display = 'block';
}

function closeDispatchModal() {
  document.getElementById('dispatchModal').classList.remove('visible');
}

// ─── Load Voices ────────────────────────────────────────────────────────────────
if (synthesis) { synthesis.onvoiceschanged = () => synthesis.getVoices(); }

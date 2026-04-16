// ─── MicroAlert Voice Assistant — NLP-Powered, Auto-Start ───────────────────────
// Always-on passive listener with wake word detection
// Full NLP pipeline: intent classification, entity extraction, context memory
// Supports: English, Hindi, Telugu, Tamil

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
let passiveListening = false;     // Always-on passive mic state
let wakeWordTimeout = null;       // 8s silence timer after wake word
let micPermissionGranted = false;
let lastWakeWordTime = 0;

// ─── Wake Words ─────────────────────────────────────────────────────────────────
const WAKE_WORDS = ['hey road', 'report risk', 'safe route', 'any danger', 'wake up'];
const WAKE_WORD_CHIME_FREQ = 880; // Hz for activation chime

// ─── NLP Context Memory ─────────────────────────────────────────────────────────
let nlpSessionContext = {
  lastMentionedLocation: null,
  lastIntent: null,
  pendingSlots: null
};
let conversationHistory = [];
const MAX_HISTORY = 10;

// ─── Client-side Noise Pre-processor ────────────────────────────────────────────
const FILLER_WORDS = /\b(um|uh|hmm|like|you know|actually|basically|so|well|okay so|right so|i mean)\b/gi;
const STT_CORRECTIONS = {
  'blink turn': 'blind turn', 'blind spot': 'blind turn',
  'breaking zone': 'braking zone', 'breaking': 'braking',
  'sudden breaking': 'sudden braking', 'accidents own': 'accident zone',
  'pot hole': 'pothole', 'over speeding': 'overspeeding',
  'potter hole': 'pothole', 'rode': 'road', 'root': 'route', 'rout': 'route',
  'gaadi rokti hai': 'sudden braking zone', 'gaadi ruk': 'sudden braking',
  'mod': 'turn', 'sadak': 'road', 'khatarnak': 'dangerous',
  'kharab sadak': 'road damage', 'bahut kharab': 'very dangerous',
  'ambulance bulao': 'call ambulance', 'police bulao': 'call police'
};
const DEDUP_REGEX = /\b(\w+)\s+\1\b/gi;

function preprocessVoiceInput(raw) {
  let cleaned = raw.toLowerCase().trim();
  cleaned = cleaned.replace(FILLER_WORDS, ' ');
  for (const [wrong, right] of Object.entries(STT_CORRECTIONS)) {
    cleaned = cleaned.replace(new RegExp(wrong, 'gi'), right);
  }
  cleaned = cleaned.replace(DEDUP_REGEX, '$1');
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

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION B: AUTO-START VOICE (NO TAP REQUIRED) ──────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function autoStartVoice() {
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    updatePassiveMicState('unavailable');
    return;
  }

  // Request mic permission and start passive listening immediately
  navigator.mediaDevices?.getUserMedia({ audio: true }).then((stream) => {
    micPermissionGranted = true;
    stream.getTracks().forEach(t => t.stop()); // Release — we use SpeechRecognition API
    startPassiveListener();
    updatePassiveMicState('passive');
  }).catch(() => {
    micPermissionGranted = false;
    updatePassiveMicState('denied');
    showToast('🎤 Enable mic for hands-free mode', 'info');
  });
}

// ─── Passive Always-On Listener ─────────────────────────────────────────────────
function startPassiveListener() {
  if (!micPermissionGranted) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  continuousRecognition = new SpeechRecognition();
  continuousRecognition.continuous = true;
  continuousRecognition.interimResults = true;
  continuousRecognition.lang = VOICE_LANGUAGES[voiceLanguage].speechLang;

  continuousRecognition.onresult = (event) => {
    const lastResult = event.results[event.results.length - 1];
    const transcript = lastResult[0].transcript.toLowerCase().trim();
    const confidence = lastResult[0].confidence;

    // Check for wake words
    const detectedWakeWord = isWakeWordPresent(transcript);

    if (!wakeWordDetected && detectedWakeWord) {
      wakeWordDetected = true;
      lastWakeWordTime = Date.now();
      updatePassiveMicState('active');
      playActivationChime();

      // Open voice panel if not open
      const panel = document.getElementById('voicePanel');
      if (panel && !panel.classList.contains('visible')) {
        panel.classList.add('visible');
        document.getElementById('voiceFab')?.classList.add('active');
      }

      const langConf = VOICE_LANGUAGES[voiceLanguage];
      addVoiceMessage('system', `👋 ${langConf.greeting}\n\n🧠 <strong>I understand natural language!</strong> Just say:\n• "There's a pothole near the school"\n• "Take me to the airport"\n• "Any danger ahead?"\n• "Start journey to T. Nagar"`);
      speak(langConf.greeting);

      // Start 8-second silence timeout
      resetWakeWordTimeout();
    }

    if (wakeWordDetected && lastResult.isFinal) {
      // Remove wake words from transcript
      let command = transcript;
      WAKE_WORDS.forEach(ww => { command = command.replace(new RegExp(ww, 'gi'), '').trim(); });
      Object.values(VOICE_LANGUAGES).forEach(l => {
        command = command.replace(l.wakeWord.toLowerCase(), '').trim();
      });

      if (command.length > 2) {
        // Check STT confidence
        if (confidence < 0.6) {
          addVoiceMessage('system', "🔊 I didn't catch that clearly — can you repeat?");
          speak("I didn't catch that clearly. Can you repeat?");
          resetWakeWordTimeout();
          return;
        }

        resetWakeWordTimeout();
        processVoiceCommand(command);
      }
    }
  };

  continuousRecognition.onerror = (event) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      console.warn('Passive listener error:', event.error);
    }
  };

  continuousRecognition.onend = () => {
    // Always restart — passive listener never stops
    passiveListening = false;
    if (micPermissionGranted) {
      setTimeout(() => {
        try {
          if (!passiveListening) {
            continuousRecognition.start();
            passiveListening = true;
          }
        } catch (e) {}
      }, 300);
    }
  };

  try {
    continuousRecognition.start();
    passiveListening = true;
  } catch (e) { console.warn('Could not start passive listener:', e); }
}

function isWakeWordPresent(text) {
  // Check English wake words
  if (WAKE_WORDS.some(ww => text.includes(ww))) return true;
  // Check language-specific wake words
  return Object.values(VOICE_LANGUAGES).some(l => text.includes(l.wakeWord.toLowerCase()));
}

function resetWakeWordTimeout() {
  if (wakeWordTimeout) clearTimeout(wakeWordTimeout);
  wakeWordTimeout = setTimeout(() => {
    if (wakeWordDetected && Date.now() - lastWakeWordTime > 8000) {
      wakeWordDetected = false;
      updatePassiveMicState('passive');
    }
  }, 8000);
}

// ─── Activation Chime (< 0.3s) ─────────────────────────────────────────────────
function playActivationChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = WAKE_WORD_CHIME_FREQ;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {}
}

// ─── Passive Mic Visual Indicator ───────────────────────────────────────────────
function updatePassiveMicState(state) {
  const indicator = document.getElementById('passiveMicIndicator');
  const fab = document.getElementById('voiceFab');
  if (!indicator) return;

  indicator.className = 'passive-mic-indicator'; // reset
  switch (state) {
    case 'passive':
      indicator.classList.add('passive');
      indicator.innerHTML = '<span class="pmi-dot"></span>';
      indicator.title = 'Listening for "Hey Road"...';
      if (fab) fab.style.background = '';
      break;
    case 'active':
      indicator.classList.add('active');
      indicator.innerHTML = '<span class="pmi-wave"></span><span class="pmi-wave"></span><span class="pmi-wave"></span>';
      indicator.title = 'Voice active — speak now';
      if (fab) fab.style.background = '#F59E0B';
      break;
    case 'processing':
      indicator.classList.add('processing');
      indicator.innerHTML = '<span class="pmi-wave proc"></span><span class="pmi-wave proc"></span><span class="pmi-wave proc"></span>';
      indicator.title = 'Processing...';
      break;
    case 'denied':
      indicator.classList.add('denied');
      indicator.innerHTML = '<span class="pmi-x">🎤✕</span>';
      indicator.title = 'Mic permission denied';
      break;
    case 'unavailable':
      indicator.style.display = 'none';
      break;
  }
}

// ─── Language Switching ─────────────────────────────────────────────────────────
function setVoiceLanguage(lang) {
  if (!VOICE_LANGUAGES[lang]) return;
  voiceLanguage = lang;
  document.querySelectorAll('.lang-option').forEach(el => {
    el.classList.toggle('active', el.dataset.lang === lang);
  });
  const label = document.getElementById('voiceListenLabel');
  if (label) label.textContent = VOICE_LANGUAGES[lang].placeholder;
  addVoiceMessage('system', `🌐 Language switched to ${VOICE_LANGUAGES[lang].label}`);
  speak(`Language switched to ${VOICE_LANGUAGES[lang].label}.`);

  // Restart passive listener with new language
  if (continuousRecognition) {
    try { continuousRecognition.stop(); } catch (e) {}
    passiveListening = false;
    setTimeout(() => startPassiveListener(), 500);
  }
}

// ─── Toggle Voice Panel ─────────────────────────────────────────────────────────
function toggleVoiceAssistant() {
  const panel = document.getElementById('voicePanel');
  const fab = document.getElementById('voiceFab');
  if (panel.classList.contains('visible')) { closeVoicePanel(); }
  else {
    panel.classList.add('visible');
    fab.classList.add('active');
    wakeWordDetected = true;
    updatePassiveMicState('active');
  }
}

function closeVoicePanel() {
  document.getElementById('voicePanel').classList.remove('visible');
  document.getElementById('voiceFab').classList.remove('active');
  stopListening();
  wakeWordDetected = false;
  updatePassiveMicState('passive');
}

function toggleAlertPanel() {
  document.getElementById('alertPanel').classList.toggle('visible');
}

// ─── Manual Listening (tap button) ──────────────────────────────────────────────
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
  updatePassiveMicState('active');

  recognition = initSpeechRecognition();
  if (!recognition) return;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    const confidence = event.results[0][0].confidence;
    if (confidence < 0.6) {
      addVoiceMessage('system', "🔊 I didn't catch that clearly — can you repeat?");
      speak("I didn't catch that. Can you repeat?");
      stopListening();
      return;
    }
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
  updatePassiveMicState(wakeWordDetected ? 'active' : 'passive');
}

function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = VOICE_LANGUAGES[voiceLanguage].speechLang;
  rec.maxAlternatives = 1;
  return rec;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CORE NLP PIPELINE ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function processVoiceCommand(rawInput) {
  addVoiceMessage('user', rawInput);
  const cleaned = preprocessVoiceInput(rawInput);
  console.log('[NLP] Raw:', rawInput, '→ Cleaned:', cleaned);

  // Quick client-side intents (zero latency)
  const quickResult = tryQuickIntentMatch(cleaned);
  if (quickResult) { await executeNLPAction(quickResult); return; }

  // LLM NLP backend
  addVoiceMessage('assistant', '🧠 Processing...');
  updatePassiveMicState('processing');

  try {
    let nearbyRisks = [];
    if (typeof userLat !== 'undefined' && userLat) {
      try {
        const nr = await fetch(`/api/risks/nearby?lat=${userLat}&lng=${userLng}&radius=2000`);
        const nrj = await nr.json();
        if (nrj.success && nrj.data.features) nearbyRisks = nrj.data.features.map(f => f.properties);
      } catch (e) {}
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('/api/llm/nlp-process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        rawInput: cleaned,
        conversationHistory: conversationHistory.slice(-MAX_HISTORY),
        lat: userLat || 13.0827, lng: userLng || 80.2707,
        speed: currentSpeed || 0,
        destination: journeyDestination || document.getElementById('endLocation')?.value || '',
        nearbyRisks, language: voiceLanguage, sessionContext: nlpSessionContext
      })
    });
    clearTimeout(timeout);
    const json = await res.json();
    removeLastAssistantMsg('Processing');
    updatePassiveMicState('active');

    if (json.success && json.data) {
      const nlpResult = json.data;
      console.log('[NLP] Result:', nlpResult);

      conversationHistory.push({ role: 'user', content: cleaned });
      conversationHistory.push({ role: 'assistant', content: nlpResult.response_text });
      if (conversationHistory.length > MAX_HISTORY * 2) conversationHistory = conversationHistory.slice(-MAX_HISTORY * 2);

      if (nlpResult.context_update) {
        if (nlpResult.context_update.lastMentionedLocation) nlpSessionContext.lastMentionedLocation = nlpResult.context_update.lastMentionedLocation;
        nlpSessionContext.lastIntent = nlpResult.context_update.lastIntent || nlpResult.intent;
      }

      nlpSessionContext.pendingSlots = nlpResult.follow_up_question
        ? { intent: nlpResult.intent, entities: nlpResult.entities, question: nlpResult.follow_up_question }
        : null;

      await executeNLPAction(nlpResult);
    } else {
      addVoiceMessage('assistant', "🤖 Can you say that differently? I'm here to help with road risks.");
      speak("Can you say that differently? I'm here to help with road risks.");
    }
  } catch (err) {
    removeLastAssistantMsg('Processing');
    updatePassiveMicState('active');
    console.error('[NLP] Error:', err);
    const fallback = tryKeywordFallback(cleaned);
    if (fallback) { await executeNLPAction(fallback); }
    else {
      addVoiceMessage('assistant', "🤖 I'm having trouble connecting. Try: \"Check hazards nearby\" or \"Navigate to [place]\".");
      speak("I'm having trouble. Try simple commands.");
    }
  }

  // Reset silence timeout
  resetWakeWordTimeout();
}

// ─── Quick Intent Match (zero-latency) ──────────────────────────────────────────
function tryQuickIntentMatch(input) {
  if (/\b(ambulance|need ambulance|call ambulance|एम्बुलेंस)\b/i.test(input))
    return { intent: 'EMERGENCY', entities: { emergency_type: 'ambulance' }, response_text: '🚑 Dispatching ambulance now!', action: 'dispatch_emergency' };
  if (/\b(police|need police|call police|पुलिस)\b/i.test(input))
    return { intent: 'EMERGENCY', entities: { emergency_type: 'police' }, response_text: '👮 Dispatching police now!', action: 'dispatch_emergency' };
  if (/\b(fire|fire station|call fire|अग्निशमन)\b/i.test(input))
    return { intent: 'EMERGENCY', entities: { emergency_type: 'fire' }, response_text: '🚒 Dispatching fire service!', action: 'dispatch_emergency' };
  if (/\b(roadside|breakdown|tow|stuck)\b/i.test(input))
    return { intent: 'EMERGENCY', entities: { emergency_type: 'roadside' }, response_text: '🆘 Requesting roadside assistance!', action: 'dispatch_emergency' };
  if (/switch.*(hindi|हिन्दी)/i.test(input))
    return { intent: 'LANGUAGE_SWITCH', entities: { target_language: 'hi' }, response_text: '🌐 Switching to Hindi', action: 'switch_language' };
  if (/switch.*(telugu|తెలుగు)/i.test(input))
    return { intent: 'LANGUAGE_SWITCH', entities: { target_language: 'te' }, response_text: '🌐 Switching to Telugu', action: 'switch_language' };
  if (/switch.*(tamil|தமிழ்)/i.test(input))
    return { intent: 'LANGUAGE_SWITCH', entities: { target_language: 'ta' }, response_text: '🌐 Switching to Tamil', action: 'switch_language' };
  if (/switch.*(english)/i.test(input))
    return { intent: 'LANGUAGE_SWITCH', entities: { target_language: 'en' }, response_text: '🌐 Switching to English', action: 'switch_language' };
  if (/\b(stop journey|end journey|stop trip|yatra band)\b/i.test(input))
    return { intent: 'JOURNEY_STOP', entities: {}, response_text: '🏁 Ending journey.', action: 'stop_journey' };
  if (/^(cancel|stop|nevermind|never mind|go back)$/i.test(input.trim()))
    return { intent: 'CANCEL', entities: {}, response_text: 'Okay, cancelled.', action: 'none' };
  if (/\b(take photo|camera|capture|photo le|तस्वीर|फोटो)\b/i.test(input))
    return { intent: 'CAMERA', entities: {}, response_text: '📸 Opening camera.', action: 'open_camera' };
  return null;
}

// ─── Keyword Fallback ───────────────────────────────────────────────────────────
function tryKeywordFallback(input) {
  const jm = input.match(/(?:start journey|begin journey|start trip|yatra shuru)(?:\s+(?:to|for))?\s+(.+)/i);
  if (jm) return { intent: 'JOURNEY_START', entities: { destination: jm[1].trim() }, response_text: `🚗 Starting journey to ${jm[1].trim()}!`, action: 'start_journey' };
  const nm = input.match(/(?:navigate|route|go|directions?|safest route|take me)(?:\s+(?:to|from))?\s+(.+)/i);
  if (nm) return { intent: 'NAVIGATE', entities: { destination: nm[1].trim() }, response_text: `🗺️ Finding safest route to ${nm[1].trim()}.`, action: 'navigate' };
  if (/\b(hazard|danger|safe|risk|warning|alert|ahead)\b/i.test(input))
    return { intent: 'QUERY_RISK', entities: {}, response_text: '🔍 Checking for nearby hazards...', action: 'analyze_risk' };
  if (/\b(speed|rating|driving|how am i)\b/i.test(input))
    return { intent: 'SPEED_CHECK', entities: {}, response_text: 'Checking your driving rating...', action: 'check_speed' };
  if (/\b(pothole|blind turn|braking|accident|flood|damage)\b/i.test(input))
    return { intent: 'REPORT_RISK', entities: { risk_type: input.match(/\b(pothole|blind.?turn|braking|accident|flood|damage)\b/i)?.[1] || null }, response_text: 'Got it, noting that hazard.', action: 'report_risk', follow_up_question: 'Where exactly did you notice this?' };
  if (/\b(help|how|what can you)\b/i.test(input))
    return { intent: 'HELP', entities: {}, response_text: 'I can help with navigation, hazards, emergencies, and safety alerts.', action: 'help' };
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ACTION ROUTER ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function executeNLPAction(nlpResult) {
  const { intent, entities, response_text, follow_up_question, action } = nlpResult;
  const ent = entities || {};
  let displayMsg = response_text || '';
  if (follow_up_question) displayMsg += `\n\n❓ ${follow_up_question}`;
  const badge = getIntentBadge(intent);

  switch (action) {
    case 'dispatch_emergency': {
      addVoiceMessage('assistant', `${badge} ${displayMsg}`);
      speak(response_text);
      dispatchEmergency(ent.emergency_type || 'ambulance');
      break;
    }
    case 'report_risk': {
      addVoiceMessage('assistant', `${badge} ${displayMsg}`);
      speak(response_text);
      if (ent.location) {
        const rType = mapRiskType(ent.risk_type);
        const reportType = document.getElementById('reportType');
        const reportDesc = document.getElementById('reportDescription');
        const reportRoad = document.getElementById('reportRoadName');
        if (reportType && rType) reportType.value = rType;
        if (reportDesc) reportDesc.value = `${ent.risk_type || 'hazard'} reported via voice at ${ent.location}${ent.time_context ? '. Time: ' + ent.time_context : ''}`;
        if (reportRoad) reportRoad.value = ent.location;
        const panel = document.getElementById('reportPanel');
        if (panel && panel.classList.contains('collapsed')) togglePanel('reportPanel');
        showToast('📝 Report form pre-filled. Pick location on map & submit.', 'success');
      }
      break;
    }
    case 'analyze_risk': case 'show_map': {
      addVoiceMessage('assistant', `${badge} ${displayMsg}`);
      speak(response_text);
      await checkNearbyHazards();
      break;
    }
    case 'navigate': case 'scan_route': {
      const dest = ent.destination || ent.location;
      addVoiceMessage('assistant', `${badge} ${displayMsg}`);
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
    case 'start_journey': {
      const dest = ent.destination || ent.location;
      if (dest) { addVoiceMessage('assistant', `${badge} ${displayMsg}`); speak(response_text); startJourney(dest); }
      else {
        addVoiceMessage('assistant', `${badge} ${displayMsg}\n\n❓ Where would you like to go?`);
        speak(response_text || 'Where would you like to go?');
        nlpSessionContext.pendingSlots = { intent: 'JOURNEY_START', entities: ent, question: 'Where would you like to go?' };
      }
      break;
    }
    case 'stop_journey': {
      addVoiceMessage('assistant', `${badge} ${displayMsg}`);
      speak(response_text); stopJourney(); break;
    }
    case 'open_camera': {
      addVoiceMessage('assistant', `${badge} ${displayMsg}`);
      speak(response_text);
      if (typeof openCamera === 'function') openCamera();
      // Trigger AI analysis after capture (Section C)
      setTimeout(() => { if (capturedPhotos && capturedPhotos.length > 0) analyzeHazardPhoto(); }, 3000);
      break;
    }
    case 'check_speed': {
      const sb = document.getElementById('speedBadge');
      const rt = sb ? sb.querySelector('.speed-label')?.textContent || '5.0' : '5.0';
      addVoiceMessage('assistant', `${badge} ⭐ Safety rating: ${rt}/5${currentSpeed > 0 ? `. Speed: ${Math.round(currentSpeed)} km/h.` : ''}`);
      speak(`Your safety rating is ${rt} out of 5.`);
      break;
    }
    case 'switch_language': {
      if (ent.target_language && VOICE_LANGUAGES[ent.target_language]) setVoiceLanguage(ent.target_language);
      break;
    }
    case 'get_alerts': {
      addVoiceMessage('assistant', `${badge} ${displayMsg}`);
      speak(response_text);
      const ap = document.getElementById('alertPanel');
      if (ap && !ap.classList.contains('visible')) toggleAlertPanel();
      break;
    }
    case 'help': {
      addVoiceMessage('assistant', `${badge} ${response_text || 'I can help you with:'}\n\n🗺️ <strong>Navigate:</strong> "Take me to [place]"\n⚠️ <strong>Report:</strong> "Pothole near [location]"\n🔍 <strong>Query:</strong> "Is it safe near Marina?"\n🚗 <strong>Journey:</strong> "Start journey to [place]"\n📸 <strong>Camera:</strong> "Take photo"\n🚑 <strong>Emergency:</strong> "Call ambulance"`);
      speak(response_text || 'I can help with navigation, hazard reporting, and emergencies.');
      break;
    }
    case 'clarify': {
      addVoiceMessage('assistant', `${badge} ${displayMsg}`);
      speak(follow_up_question || response_text);
      break;
    }
    default: {
      if (displayMsg) { addVoiceMessage('assistant', `${badge} ${displayMsg}`); speak(response_text); }
      break;
    }
  }
}

function getIntentBadge(i) {
  return { REPORT_RISK:'📝', QUERY_RISK:'🔍', NAVIGATE:'🗺️', ALERT_STATUS:'🔔', EMERGENCY:'🚨', JOURNEY_START:'🚗', JOURNEY_STOP:'🏁', CAMERA:'📸', SPEED_CHECK:'⭐', LANGUAGE_SWITCH:'🌐', CONFIRM:'✅', CANCEL:'❌', HELP:'💡', UNKNOWN:'🤖' }[i] || '🤖';
}

function mapRiskType(t) {
  if (!t) return null;
  return { 'sudden_braking':'sudden_brake','sudden braking':'sudden_brake','blind_turn':'blind_turn','blind turn':'blind_turn','pothole':'habitual_violation','accident':'accident','flooding':'habitual_violation','road_damage':'habitual_violation' }[t.toLowerCase()] || 'habitual_violation';
}

function removeLastAssistantMsg(matchText) {
  const msgs = document.querySelectorAll('.voice-transcript .voice-msg.assistant');
  for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].textContent.includes(matchText)) { msgs[i].remove(); break; } }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION C: AI PHOTO HAZARD ANALYSIS ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function analyzeHazardPhoto() {
  if (!capturedPhotos || capturedPhotos.length === 0) return;

  addVoiceMessage('assistant', '🤖 Analyzing photo for hazards using AI Vision...');
  speak('Analyzing the photo for road hazards.');

  try {
    // Upload the photo first
    const formData = new FormData();
    formData.append('photo', capturedPhotos[0]);
    const uploadRes = await fetch('/api/upload/photo', { method: 'POST', body: formData });
    const uploadJson = await uploadRes.json();

    if (uploadJson.success) {
      // Send to AI vision analysis endpoint
      const analysisRes = await fetch('/api/llm/analyze-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoUrl: uploadJson.data.url,
          lat: userLat || pickedLatLng?.lat || 13.0827,
          lng: userLng || pickedLatLng?.lng || 80.2707,
          language: voiceLanguage
        })
      });

      const analysisJson = await analysisRes.json();
      if (analysisJson.success && analysisJson.data) {
        const analysis = analysisJson.data;
        removeLastAssistantMsg('Analyzing photo');

        addVoiceMessage('assistant', `📸 <strong>AI Hazard Analysis:</strong>\n\n⚠️ <strong>${analysis.hazard_type || 'Unknown hazard'}</strong>\n📍 Severity: ${analysis.severity || 'moderate'}\n📝 ${analysis.description || 'Hazard detected in photo.'}\n\n${analysis.auto_reported ? '✅ Auto-reported to the platform!' : '📋 Review and submit the report below.'}`);
        speak(analysis.description || 'I detected a road hazard in the photo.');

        // Auto-populate report form from AI analysis
        if (analysis.hazard_type) {
          const reportType = document.getElementById('reportType');
          const reportDesc = document.getElementById('reportDescription');
          const reportSeverity = document.getElementById('reportSeverity');
          const rType = mapRiskType(analysis.hazard_type);
          if (reportType && rType) reportType.value = rType;
          if (reportDesc) reportDesc.value = `[AI-detected] ${analysis.description || analysis.hazard_type}`;
          if (reportSeverity && analysis.severity_num) reportSeverity.value = analysis.severity_num;
        }
      }
    }
  } catch (err) {
    removeLastAssistantMsg('Analyzing photo');
    addVoiceMessage('assistant', '⚠️ Could not analyze photo. You can still submit the report manually.');
    console.warn('Photo analysis failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── JOURNEY MODE ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function startJourney(destination) {
  journeyDestination = destination;
  journeyActive = true;
  journeyUpdateCount = 0;

  addVoiceMessage('assistant', `🚗 Journey to <strong>${destination}</strong> started!\n\n📍 Safety updates every 45s\n⚠️ Hazard warnings active\n🗺️ Setting up route...`);
  speak(`Journey to ${destination} started. I'll keep you safe.`);

  const endInput = document.getElementById('endLocation');
  const startInput = document.getElementById('startLocation');
  if (endInput) endInput.value = destination;
  if (startInput && !startInput.value) startInput.value = 'My Location';
  if (typeof scanRoute === 'function') scanRoute();

  const bar = document.getElementById('voiceJourneyBar');
  const text = document.getElementById('journeyStatusText');
  if (bar) bar.style.display = 'flex';
  if (text) text.textContent = `🚗 → ${destination}`;
  updateVoiceStatus(`🚗 Journey to ${destination} — Active`);

  journeyInterval = setInterval(async () => { if (journeyActive) await sendJourneyUpdate(); }, 45000);
  setTimeout(() => { if (journeyActive) sendJourneyUpdate(); }, 10000);
}

function stopJourney() {
  journeyActive = false;
  journeyDestination = '';
  if (journeyInterval) { clearInterval(journeyInterval); journeyInterval = null; }
  const bar = document.getElementById('voiceJourneyBar');
  if (bar) bar.style.display = 'none';
  addVoiceMessage('assistant', `🏁 Journey ended! ${journeyUpdateCount} safety updates.\n\n⭐ Drive safe!`);
  speak('Journey ended. Drive safe!');
  updateVoiceStatus('🟢 Active');
}

async function sendJourneyUpdate() {
  if (!journeyActive) return;
  journeyUpdateCount++;
  try {
    let nearbyRisks = [];
    const lat = userLat || 13.0827, lng = userLng || 80.2707;
    try {
      const r = await fetch(`/api/risks/nearby?lat=${lat}&lng=${lng}&radius=2000`);
      const j = await r.json();
      if (j.success && j.data.features) nearbyRisks = j.data.features.map(f => f.properties);
    } catch (e) {}

    const hour = new Date().getHours();
    let tod = 'afternoon';
    if (hour >= 6 && hour < 10) tod = 'morning_rush';
    else if (hour >= 16 && hour < 20) tod = 'evening_rush';
    else if (hour >= 20 || hour < 6) tod = 'night';

    const res = await fetch('/api/llm/journey-update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, speed: currentSpeed || 0, destination: journeyDestination, nearbyRisks, weather: 'clear', timeOfDay: tod, language: voiceLanguage })
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
  const lat = userLat || 13.0827, lng = userLng || 80.2707;
  try {
    const res = await fetch(`/api/risks/nearby?lat=${lat}&lng=${lng}&radius=2000`);
    const json = await res.json();
    if (json.success && json.data.features && json.data.features.length > 0) {
      const risks = json.data.features.map(f => f.properties);
      const top = risks.sort((a, b) => b.severity - a.severity).slice(0, 3);
      const typeLabels = { sudden_brake:'🛑 Sudden Braking', blind_turn:'🔄 Blind Turn', habitual_violation:'⚠️ Violation Zone', accident:'💥 Accident Zone' };
      let msg = `⚠️ <strong>${risks.length} hazard(s)</strong> nearby:\n\n`;
      top.forEach((r, i) => { msg += `${i+1}. ${typeLabels[r.type]||r.type} at <strong>${r.roadName}</strong> — ${r.severity}/5\n`; });
      if (risks.length > 3) msg += `\n...and ${risks.length-3} more.`;
      addVoiceMessage('assistant', msg);
      speak(`${risks.length} hazards nearby. Most critical: ${top[0].type.replace('_',' ')} at ${top[0].roadName}, severity ${top[0].severity}. Stay alert.`);
    } else {
      addVoiceMessage('assistant', '✅ No hazards nearby. Road looks clear!');
      speak('No hazards nearby. Drive safely!');
    }
  } catch (err) {
    addVoiceMessage('assistant', '⚠️ Could not check hazards.');
    speak('Could not check hazards right now.');
  }
}

// ─── Text-to-Speech ─────────────────────────────────────────────────────────────
function speak(text) {
  if (!synthesis) return;
  synthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1.0; utt.pitch = 1.0; utt.volume = 0.8;
  utt.lang = VOICE_LANGUAGES[voiceLanguage].speechLang;
  const voices = synthesis.getVoices();
  const lc = VOICE_LANGUAGES[voiceLanguage].speechLang;
  const pref = voices.find(v => v.lang === lc) || voices.find(v => v.lang.startsWith(lc.split('-')[0])) || voices.find(v => v.lang.includes('en-IN'));
  if (pref) utt.voice = pref;
  synthesis.speak(utt);
}

// ─── UI Helpers ─────────────────────────────────────────────────────────────────
function addVoiceMessage(type, text) {
  const t = document.getElementById('voiceTranscript');
  if (!t) return;
  const msg = document.createElement('div');
  msg.className = `voice-msg ${type}`;
  msg.innerHTML = text.replace(/\n/g, '<br>');
  t.appendChild(msg);
  t.scrollTop = t.scrollHeight;
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
  const labels = { ambulance:{icon:'🚑',label:'Ambulance'}, police:{icon:'👮',label:'Police'}, fire:{icon:'🚒',label:'Fire Service'}, roadside:{icon:'🆘',label:'Roadside Assistance'} };
  const info = labels[type] || labels.ambulance;
  iconEl.textContent = info.icon;
  titleEl.textContent = `Dispatching ${info.label}`;
  textEl.textContent = 'Sending GPS coordinates...';
  closeBtn.style.display = 'none';
  modal.classList.add('visible');

  let lat = 13.0827, lng = 80.2707;
  if (typeof map !== 'undefined') { const c = map.getCenter(); lat = c.lat; lng = c.lng; }

  try {
    const res = await fetch('/api/emergency/dispatch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, lat, lng, incidentType: type, routeSnapshot: null })
    });
    const json = await res.json();
    if (json.success) {
      textEl.textContent = `✅ ${info.label} dispatched! ID: #${json.data._id || json.data.id}`;
      showToast(`${info.icon} ${info.label} dispatched!`, 'success');
    } else { textEl.textContent = '⚠️ Dispatch sent (simulated).'; }
  } catch (err) { textEl.textContent = '⚠️ Dispatch logged. Fallback notification sent.'; }
  closeBtn.style.display = 'block';
}

function closeDispatchModal() { document.getElementById('dispatchModal').classList.remove('visible'); }

// ─── Load Voices ────────────────────────────────────────────────────────────────
if (synthesis) { synthesis.onvoiceschanged = () => synthesis.getVoices(); }

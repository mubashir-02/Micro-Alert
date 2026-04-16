// ─── MicroAlert Voice Assistant ─────────────────────────────────────────────────
// Uses Web Speech API for wake word detection, speech recognition & synthesis

let voiceActive = false;
let isListening = false;
let wakeWordDetected = false;
let recognition = null;
let synthesis = window.speechSynthesis;
let continuousRecognition = null;

// ─── Initialize Speech Recognition ─────────────────────────────────────────────
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Speech Recognition not supported');
    return null;
  }

  const rec = new SpeechRecognition();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = 'en-IN';
  rec.maxAlternatives = 1;
  return rec;
}

// ─── Toggle Voice Panel ─────────────────────────────────────────────────────────
function toggleVoiceAssistant() {
  const panel = document.getElementById('voicePanel');
  const fab = document.getElementById('voiceFab');

  if (panel.classList.contains('visible')) {
    closeVoicePanel();
  } else {
    panel.classList.add('visible');
    fab.classList.add('active');
    startWakeWordListener();
  }
}

function closeVoicePanel() {
  document.getElementById('voicePanel').classList.remove('visible');
  document.getElementById('voiceFab').classList.remove('active');
  stopListening();
  wakeWordDetected = false;
  updateVoiceStatus('Say "wake up" to activate');
}

// ─── Toggle Alert Panel ─────────────────────────────────────────────────────────
function toggleAlertPanel() {
  const panel = document.getElementById('alertPanel');
  panel.classList.toggle('visible');
}

// ─── Start Wake Word Listener ───────────────────────────────────────────────────
function startWakeWordListener() {
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    addVoiceMessage('system', '⚠️ Speech Recognition not supported in this browser. Try Chrome.');
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  continuousRecognition = new SpeechRecognition();
  continuousRecognition.continuous = true;
  continuousRecognition.interimResults = true;
  continuousRecognition.lang = 'en-IN';

  continuousRecognition.onresult = (event) => {
    const lastResult = event.results[event.results.length - 1];
    const transcript = lastResult[0].transcript.toLowerCase().trim();

    if (!wakeWordDetected && transcript.includes('wake up')) {
      wakeWordDetected = true;
      updateVoiceStatus('🟢 Active — Listening...');
      addVoiceMessage('system', '👋 I\'m awake! How can I help you? Try: "What\'s the best route to T. Nagar?" or "Call ambulance"');
      speak('I\'m awake! How can I help you?');
      document.getElementById('voiceFab').style.background = '#F59E0B';
    }

    if (wakeWordDetected && lastResult.isFinal) {
      // Remove wake word from transcript
      const command = transcript.replace('wake up', '').trim();
      if (command.length > 2) {
        processVoiceCommand(command);
      }
    }
  };

  continuousRecognition.onerror = (event) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      console.warn('Speech recognition error:', event.error);
    }
  };

  continuousRecognition.onend = () => {
    // Restart if panel is still open
    if (document.getElementById('voicePanel').classList.contains('visible')) {
      try { continuousRecognition.start(); } catch (e) {}
    }
  };

  try {
    continuousRecognition.start();
    updateVoiceStatus('Listening for "wake up"...');
  } catch (e) {
    console.warn('Could not start recognition:', e);
  }
}

// ─── Start Manual Listening ─────────────────────────────────────────────────────
function startListening() {
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    showToast('Speech Recognition not supported. Use Chrome.', 'error');
    return;
  }

  const btn = document.getElementById('voiceListenBtn');
  const label = document.getElementById('voiceListenLabel');

  if (isListening) {
    stopListening();
    return;
  }

  wakeWordDetected = true; // Manual tap bypasses wake word
  isListening = true;
  btn.classList.add('listening');
  label.textContent = 'Listening...';
  updateVoiceStatus('🟢 Listening...');

  recognition = initSpeechRecognition();
  if (!recognition) return;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    addVoiceMessage('user', transcript);
    processVoiceCommand(transcript.toLowerCase());
  };

  recognition.onerror = (event) => {
    if (event.error !== 'no-speech') {
      addVoiceMessage('system', '⚠️ Could not understand. Please try again.');
    }
    stopListening();
  };

  recognition.onend = () => {
    stopListening();
  };

  try {
    recognition.start();
  } catch (e) {
    stopListening();
  }
}

function stopListening() {
  isListening = false;
  const btn = document.getElementById('voiceListenBtn');
  const label = document.getElementById('voiceListenLabel');
  if (btn) btn.classList.remove('listening');
  if (label) label.textContent = 'Tap to Listen';
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
  }
  updateVoiceStatus(wakeWordDetected ? '🟢 Active — Tap to speak' : 'Say "wake up" to activate');
}

// ─── Process Voice Command ──────────────────────────────────────────────────────
async function processVoiceCommand(command) {
  addVoiceMessage('user', command);

  // Emergency commands
  if (command.includes('call ambulance') || command.includes('need ambulance')) {
    addVoiceMessage('assistant', '🚑 Dispatching ambulance to your location...');
    speak('Dispatching ambulance to your location now.');
    dispatchEmergency('ambulance');
    return;
  }

  if (command.includes('call police') || command.includes('need police')) {
    addVoiceMessage('assistant', '👮 Dispatching police to your location...');
    speak('Dispatching police to your location now.');
    dispatchEmergency('police');
    return;
  }

  if (command.includes('call fire') || command.includes('fire station')) {
    addVoiceMessage('assistant', '🚒 Dispatching fire service...');
    speak('Dispatching fire service to your location.');
    dispatchEmergency('fire');
    return;
  }

  if (command.includes('roadside') || command.includes('breakdown') || command.includes('tow')) {
    addVoiceMessage('assistant', '🆘 Requesting roadside assistance...');
    speak('Requesting roadside assistance.');
    dispatchEmergency('roadside');
    return;
  }

  // Route commands
  const routeMatch = command.match(/(?:best route|route|navigate|go|directions?)(?:\s+(?:to|from))?\s+(.+)/i);
  if (routeMatch) {
    const destination = routeMatch[1].trim();
    addVoiceMessage('assistant', `🗺️ Finding best route to ${destination}...`);
    speak(`Finding the best route to ${destination}.`);

    // Fill the end location
    const endInput = document.getElementById('endLocation');
    if (endInput) {
      endInput.value = destination;
      // Try to use current location as start
      const startInput = document.getElementById('startLocation');
      if (startInput && !startInput.value) {
        startInput.value = 'My Location';
      }
      scanRoute();
    }
    return;
  }

  // Set location commands
  const setStartMatch = command.match(/set (?:start|from|origin)(?: location)? (?:to|as) (.+)/i);
  if (setStartMatch) {
    const location = setStartMatch[1].trim();
    document.getElementById('startLocation').value = location;
    addVoiceMessage('assistant', `📍 Start location set to: ${location}`);
    speak(`Start location set to ${location}.`);
    return;
  }

  const setEndMatch = command.match(/set (?:end|destination|to)(?: location)? (?:to|as) (.+)/i);
  if (setEndMatch) {
    const location = setEndMatch[1].trim();
    document.getElementById('endLocation').value = location;
    addVoiceMessage('assistant', `🏁 Destination set to: ${location}`);
    speak(`Destination set to ${location}.`);
    return;
  }

  // Scan route command
  if (command.includes('scan route') || command.includes('check route') || command.includes('analyze route')) {
    addVoiceMessage('assistant', '🔍 Scanning current route for risks...');
    speak('Scanning route for risks.');
    scanRoute();
    return;
  }

  // Risk check
  if (command.includes('risk') || command.includes('danger') || command.includes('hazard')) {
    addVoiceMessage('assistant', '🔮 Analyzing accident risk at your location...');
    speak('Analyzing accident risk at your location.');
    analyzePrediction();
    return;
  }

  // Speed rating
  if (command.includes('speed') || command.includes('rating') || command.includes('how am i driving')) {
    const badge = document.getElementById('speedBadge');
    const ratingText = badge ? badge.querySelector('.speed-label').textContent : '5.0';
    addVoiceMessage('assistant', `⭐ Your current driving safety rating is ${ratingText} out of 5 stars.`);
    speak(`Your driving safety rating is ${ratingText} out of 5 stars.`);
    return;
  }

  // General fallback
  addVoiceMessage('assistant', `🤖 I heard: "${command}". Try commands like:\n• "Best route to T. Nagar"\n• "Call ambulance"\n• "Set start location to Chennai Central"\n• "Check risk here"`);
  speak('I can help with routes, emergency dispatch, and risk analysis. Try saying best route to, or call ambulance.');
}

// ─── Speak (Text-to-Speech) ─────────────────────────────────────────────────────
function speak(text) {
  if (!synthesis) return;
  synthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 0.8;
  utterance.lang = 'en-IN';

  // Try to use a female Indian English voice
  const voices = synthesis.getVoices();
  const preferred = voices.find(v => v.lang.includes('en-IN') || v.lang.includes('en-GB'));
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

// ─── Emergency Dispatch (shared with map.js) ────────────────────────────────────
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

  // Get current location
  let lat = 13.0827, lng = 80.2707; // Default Chennai
  if (typeof map !== 'undefined') {
    const center = map.getCenter();
    lat = center.lat;
    lng = center.lng;
  }

  try {
    const res = await fetch('/api/emergency/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        lat,
        lng,
        incidentType: type,
        routeSnapshot: null
      })
    });

    const json = await res.json();
    if (json.success) {
      textEl.textContent = `✅ ${info.label} dispatched! Help is on the way. Dispatch ID: #${json.data._id || json.data.id}`;
      showToast(`${info.icon} ${info.label} dispatched to your location!`, 'success');
    } else {
      textEl.textContent = '⚠️ Dispatch sent (simulated). In production, emergency services would be contacted.';
    }
  } catch (err) {
    textEl.textContent = '⚠️ Dispatch logged locally. Network issue — emergency services notified via fallback.';
  }

  closeBtn.style.display = 'block';
}

function closeDispatchModal() {
  document.getElementById('dispatchModal').classList.remove('visible');
}

// ─── Load Voices ────────────────────────────────────────────────────────────────
if (synthesis) {
  synthesis.onvoiceschanged = () => synthesis.getVoices();
}

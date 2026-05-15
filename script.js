/* =========================================================
   KIYARI AI — Voice Assistant (script.js)
   Particle Sphere + Speech Recognition + Groq AI via backend
   ========================================================= */

// ─── DOM ELEMENTS ────────────────────────────────────────
const orbMicBtn     = document.getElementById("orbMicBtn");
const orbMicIcon    = document.getElementById("orbMicIcon");
const orbStopIcon   = document.getElementById("orbStopIcon");
const orbFloorGlow  = document.getElementById("orbFloorGlow");
const speakBtn      = document.getElementById("speakBtn");
const speakBtnLabel = document.getElementById("speakBtnLabel");
const pdot          = document.getElementById("pdot");
const feedbackArea  = document.getElementById("feedbackArea");
const transcriptBox = document.getElementById("transcriptBox");
const errorBox      = document.getElementById("errorBox");
const voiceWaveContainer = document.getElementById("voiceWaveContainer");
const voiceWaveGif = document.getElementById("voiceWaveGif");

// ─── STATE ───────────────────────────────────────────────
let voiceState  = "idle"; // idle | listening | thinking | speaking
let transcript  = "";
let reply       = "";
let history     = [];
let recognition = null;
let lastFinal   = "";

// ─── WEB AUDIO API FOR REAL-TIME WAVE MOTION ─────────────
let audioCtx  = null;
let analyser  = null;
let dataArray = null;
let micVolume = 0;
let speakVolume = 0;
let micStream = null;
let micSource = null;

// ─── HANDS-FREE WAKE WORD DETECTION ─────────────────────
let wakeWordRecognition = null;
let isWakeEnabled       = false;

async function initAudioContext() {
  if (audioCtx) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    function updateVolume() {
      if (voiceState === "listening" && analyser) {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        micVolume = avg / 255.0; // scale 0.0 -> 1.0
      } else {
        micVolume = 0;
      }
      requestAnimationFrame(updateVolume);
    }
    updateVolume();
  } catch (e) { console.warn("AudioContext failed:", e); }
}

async function startMicCapture() {
  await initAudioContext();
  if (!audioCtx || !analyser) return;
  if (micStream) return; // Already capturing, prevent redundant streams
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micStream = stream;
    micSource = audioCtx.createMediaStreamSource(stream);
    micSource.connect(analyser);
    if (audioCtx.state === "suspended") await audioCtx.resume();
  } catch (e) { console.error("Mic capture error:", e); }
}

function stopMicCapture() {
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
    console.log("🎙️ Persistent visualizer mic stream released.");
  }
  if (micSource) {
    try { micSource.disconnect(); } catch (_) {}
    micSource = null;
  }
}

const STATUS_MAP = {
  idle:      "Say 'hey krishi' to wake up",
  listening: "Listening…",
  thinking:  "Thinking…",
  speaking:  "Speaking…",
};

// ─── GAME STATE (shared with AI for context) ─────────────
const gameState = {
  round: 0,
  currentPlayer: "",
  phase: "",
  playerCards: [],
};




// ═══════════════════════════════════════════════════════════
//  UI STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════
function setVoiceState(newState) {
  voiceState = newState;

  // Toggle visual wave overlay based on activity
  if (voiceWaveContainer) {
    voiceWaveContainer.className = "voice-wave-container " + newState;
    if (newState !== "idle") {
      voiceWaveContainer.classList.add("active");
    }
  }

  // If transitioning away from idle, disable passive listener to prevent overlap
  if (newState !== "idle" && wakeWordRecognition) {
    try { wakeWordRecognition.stop(); } catch (_) {}
    isWakeEnabled = false;
  }

  // Update CTA button
  speakBtnLabel.textContent = STATUS_MAP[newState];
  speakBtn.className = "speak-btn " + newState;
  pdot.className     = "pdot " + newState;

  // Auto-restart wake word detection upon returning to idle state
  if (newState === "idle") {
    if (!isWakeEnabled) {
      setTimeout(() => {
        if (voiceState === "idle") startWakeWordDetection();
      }, 600);
    }
  }

  // Update orb mic button (if present)
  if (orbMicBtn) {
    orbMicBtn.className = "orb-mic-btn " + newState;

    // Toggle mic icon / stop icon
    if (newState === "thinking" || newState === "speaking") {
      if (orbMicIcon) orbMicIcon.style.display  = "none";
      if (orbStopIcon) orbStopIcon.style.display = "block";
    } else {
      if (orbMicIcon) orbMicIcon.style.display  = "block";
      if (orbStopIcon) orbStopIcon.style.display = "none";
    }
  }

  // Floor glow (if present)
  if (orbFloorGlow) {
    orbFloorGlow.className = "orb-floor-glow " + newState;
  }
}


// ═══════════════════════════════════════════════════════════
//  FEEDBACK UI HELPERS
// ═══════════════════════════════════════════════════════════
function showTranscript(text) {
  feedbackArea.style.display = "block";
  errorBox.style.display     = "none";
  transcriptBox.innerHTML    =
    `<span class="transcript-label transcript-you">YOU</span>` +
    `<p style="color:rgba(103,232,249,0.9);margin:0">${text}</p>`;
}

function showReply(text) {
  feedbackArea.style.display = "block";
  errorBox.style.display     = "none";
  transcriptBox.innerHTML    =
    `<span class="transcript-label transcript-ai">KIYARI AI</span>` +
    `<p style="color:rgba(220,230,255,0.88);margin:0">${text}</p>`;
}

function showError(msg) {
  feedbackArea.style.display = "none";
  errorBox.style.display     = "block";
  errorBox.textContent       = msg;
}

function clearFeedback() {
  feedbackArea.style.display = "none";
  errorBox.style.display     = "none";
}


// ═══════════════════════════════════════════════════════════
//  BROWSER TTS (Web Speech API — no external service)
// ═══════════════════════════════════════════════════════════
const synth = window.speechSynthesis;

// Pre-load voices to ensure they are ready
let availableVoices = [];
synth.onvoiceschanged = () => {
  availableVoices = synth.getVoices();
};

function speakText(text) {
  synth.cancel();
  setVoiceState("speaking");

  // Normalize phonetic output: Convert all-caps 'KIYARI' to 'Kiyari' 
  // so the TTS engine pronounces it as a single word instead of spelling out the letters.
  const spokenText = text.replace(/\bKIYARI\b/g, "Kiyari");

  const utter = new SpeechSynthesisUtterance(spokenText);
  utter.lang   = "en-US";
  utter.rate   = 1.2;
  utter.pitch  = 1.0;
  utter.volume = 1.0;

  // Voice selection priority
  const voices = availableVoices.length ? availableVoices : synth.getVoices();
  
  const voicePriority = [
    "Google US English",
    "Microsoft David",
    "Microsoft Zira",
    "en-US"
  ];

  let selectedVoice = null;
  for (const name of voicePriority) {
    selectedVoice = voices.find(v => v.name.includes(name));
    if (selectedVoice) break;
  }

  // Fallback to first available en-US or any en voice
  if (!selectedVoice) {
    selectedVoice = voices.find(v => v.lang === "en-US") || voices.find(v => v.lang.startsWith("en")) || voices[0];
  }

  if (selectedVoice) {
    utter.voice = selectedVoice;
  }

  // Map real-time spoken boundaries to physical volumetric spikes (syllable impulse injection)
  utter.onboundary = (event) => {
    if (event.name === "word") {
      speakVolume = 0.85 + Math.random() * 0.25;
    }
  };

  utter.onend   = () => { setVoiceState("idle"); speakVolume = 0; };
  utter.onerror = () => { setVoiceState("idle"); speakVolume = 0; };
  synth.speak(utter);
}


// ═══════════════════════════════════════════════════════════
//  GROQ AI (via your Express backend for API key safety)
// ═══════════════════════════════════════════════════════════
async function askAI(userText) {
  history.push({ role: "user", content: userText });
  // Keep history lean — last 6 messages
  if (history.length > 6) history = history.slice(-6);
  setVoiceState("thinking");

  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userText, history, gameState }),
    });

    if (!res.ok) throw new Error(`Server error ${res.status}`);

    // Read the SSE stream token-by-token
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullReply = "";
    setVoiceState("speaking");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter(l => l.startsWith("data: "));

      for (const line of lines) {
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") break;
        try {
          const { token } = JSON.parse(payload);
          if (token) {
            fullReply += token;
            showReply(fullReply);
          }
        } catch (_) { /* skip */ }
      }
    }

    reply = fullReply.trim();
    history.push({ role: "assistant", content: reply });
    showReply(reply);
    speakText(reply);
  } catch (err) {
    showError(err.message);
    setVoiceState("idle");
  }
}


// ═══════════════════════════════════════════════════════════
//  HANDS-FREE WAKE WORD LISTENER
// ═══════════════════════════════════════════════════════════
function startWakeWordDetection() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;

  // Clear out any stale instances
  if (wakeWordRecognition) {
    try { wakeWordRecognition.stop(); } catch (_) {}
  }

  isWakeEnabled = true;
  const wr = new SR();
  wr.lang = "en-IN";
  // Enable continuous mode to maintain ambient persistent listening and prevent server-throttling resets
  wr.continuous = true; 
  wr.interimResults = true;
  wakeWordRecognition = wr;

  wr.onresult = (e) => {
    if (voiceState !== "idle") return;
    
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const phrase = e.results[i][0].transcript.toLowerCase().trim();
      console.log("[Hands-Free Watchdog]: heard -> '" + phrase + "'");

      // Live UI Telemetry: Show exactly what the microphone hears in real-time on the button
      speakBtnLabel.innerHTML = `<span style="opacity:0.7">Heard:</span> "${phrase}"`;

      // Reset telemetry back to prompt after 2 seconds of inactivity
      clearTimeout(window.wakeFeedbackTimer);
      window.wakeFeedbackTimer = setTimeout(() => {
        if (voiceState === "idle") {
          speakBtnLabel.textContent = STATUS_MAP.idle;
        }
      }, 2000);

      // High-sensitivity phonetic triggers targeting 'hey krishi' (primary) and all variations
      const triggerTerms = [
        "krishi", "hey krishi", "krushi", "rishi", "krishna", "krish", "kishi", "christie", "chrissy", "christi",
        "hey rishi", "hey krish", "crishi", "krisi", "grishi", "hey krisi",
        "kiyari", "hey kiyari", "hey kyari", "kyari", "kiari", "hey kiari", "kyare", "kiare", "khari", "cari", 
        "tiari", "kiara", "kieri", "kiary", "carry", "cherry", "query", "keary", "kiri", "kya re", "hey carry", 
        "hey cherry", "giri", "tiara", "hi kiyari", "he kiyari"
      ];

      // High-sensitivity detection matrix
      const matched = triggerTerms.some(term => phrase.includes(term));

      if (matched) {
        console.log("🚀 [WAKE ACTIVATED]: Trigger matched on '" + phrase + "'");
        wr.stop();
        isWakeEnabled = false;
        
        // Transition to Thinking to show immediate visual response
        setVoiceState("thinking");
        setTimeout(() => {
          startListening();
        }, 350);
        break;
      }
    }
  };

  wr.onerror = (e) => {
    // Suppress passive "no-speech" logs to prevent terminal clutter
    if (e.error !== "no-speech" && e.error !== "aborted") {
      console.warn("[Wake Watchdog Warning]:", e.error);
    }
    if (e.error === "not-allowed") {
      isWakeEnabled = false;
    }
  };

  wr.onend = () => {
    // Auto-cycle loop with a safe restart buffer to bypass browser-shell throttles
    if (isWakeEnabled && voiceState === "idle") {
      setTimeout(() => {
        try {
          if (isWakeEnabled && voiceState === "idle") wr.start();
        } catch (_) {}
      }, 250);
    }
  };

  try {
    wr.start();
    console.log("%c🎙️ [Hands-Free Active]: Listening silently for 'hey krishi'...", "color: #2563eb; font-weight: bold; font-size: 12px;");
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
//  VOICE ASSISTANT ENGINE LAUNCHER
// ═══════════════════════════════════════════════════════════
// Specialized voiceAssistant orchestrator that handles transient user gestures robustly.
let hasAssistantStarted = false;
async function voiceAssistant(isFromGesture = false) {
  // If it's an interactive trigger and already initialized, skip
  if (isFromGesture && hasAssistantStarted) return;

  if (!isFromGesture) {
    // Passive bootstrap attempt (fails safely if permissions not cached)
    try {
      initAudioContext();
      if (voiceState === "idle") startWakeWordDetection();
    } catch (_) {}
    return;
  }

  // A real user gesture occurred! Boot the engine fully.
  hasAssistantStarted = true;
  console.log("🎙️ User interaction detected: Unlocking microphone and engine...");

  try {
    // 1. Touch AudioContext SYNCHRONOUSLY to inherit user gesture activation instantly
    initAudioContext();
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    
    // 2. Bootstrap Wake Word SYNCHRONOUSLY to fully capture direct gesture token without microtask splits
    if (voiceState === "idle") {
      isWakeEnabled = true; // Override prior passive 'not-allowed' state
      startWakeWordDetection();
    }

    // 3. Warm-up and maintain active getUserMedia track to lock 'Red Dot' high-priority tab context, preventing Speech suspension
    startMicCapture().catch(e => console.warn("Persistent mic lock failed:", e));
  } catch (e) {
    console.warn("Failed to fully initialize on gesture:", e);
  }
}

// Attempt passive boot on window load
window.addEventListener("load", () => voiceAssistant(false));
// Establish robust active fallback on the very first document click to guarantee permissions prompt
document.addEventListener("click", () => voiceAssistant(true), { once: true });
// Immediate passive attempt
voiceAssistant(false);


// ═══════════════════════════════════════════════════════════
//  WEB SPEECH RECOGNITION (Interactive Session)
// ═══════════════════════════════════════════════════════════
async function startListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showError("Speech recognition not supported in this browser."); return; }

  // Initialize Web Audio stream to feed visual wave reactivity
  await startMicCapture();

  synth.cancel();
  clearFeedback();
  transcript = "";
  reply      = "";

  // Intelligent Silence/Inactivity timer
  let silenceTimer = null;

  const rec = new SR();
  rec.lang            = "en-IN";
  // Enable continuous listening to bypass aggressive browser session timeout defaults
  rec.continuous      = true; 
  rec.interimResults  = true;
  rec.maxAlternatives = 1;
  recognition         = rec;

  rec.onstart = () => {
    setVoiceState("listening");
    // Initial silence guard: Reset to idle if user stays silent for 7 seconds
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      console.log("⏱️ Initial silence timeout reached. Resetting to idle.");
      rec.stop();
    }, 7000);
  };

  rec.onerror = (e) => {
    clearTimeout(silenceTimer);
    // Suppress 'no-speech' and 'aborted' as they are normal silent lifecycle events, not actual hardware errors
    if (e.error === "no-speech" || e.error === "aborted") {
      setVoiceState("idle");
      return;
    }
    showError("Mic error: " + e.error);
    setVoiceState("idle");
  };

  rec.onresult = (e) => {
    // Clear timeout immediately upon voice activity
    clearTimeout(silenceTimer);

    let accumulated = "";
    for (let i = 0; i < e.results.length; i++) {
      accumulated += e.results[i][0].transcript;
    }
    transcript = accumulated;
    showTranscript(transcript);

    // Smart Inactivity Reset: Wait 3.0 seconds of silence after any speech before submitting to AI
    silenceTimer = setTimeout(() => {
      console.log("⏱️ Pause detected. Submitting final query to AI...");
      rec.stop();
    }, 3000); // Generous 3-second tolerance
  };

  rec.onend = () => {
    clearTimeout(silenceTimer);
    const final = transcript.trim();
    if (final) {
      askAI(final);
    } else {
      setVoiceState("idle");
    }
  };

  rec.start();
}


// ═══════════════════════════════════════════════════════════
//  CLICK HANDLERS
// ═══════════════════════════════════════════════════════════
function handleMicClick() {
  if (voiceState === "idle") {
    startListening();
    return;
  }
  if (voiceState === "listening") {
    if (recognition) recognition.stop();
    return;
  }
  if (voiceState === "speaking") {
    synth.cancel();
    setVoiceState("idle");
  }
}

// Wire all clickable elements
if (orbMicBtn) {
  orbMicBtn.addEventListener("click", () => { console.log("orbMicBtn clicked, state:", voiceState); handleMicClick(); });
}
speakBtn.addEventListener("click", () => { console.log("speakBtn clicked, state:", voiceState); handleMicClick(); });

// ─── Text Input Fallback ─────────────────────────────────
const textInput = document.getElementById("textInput");
const btnSend   = document.getElementById("btnSend");

if (btnSend && textInput) {
  btnSend.addEventListener("click", () => {
    const text = textInput.value.trim();
    if (!text || voiceState === "thinking" || voiceState === "speaking") return;
    showTranscript(text);
    textInput.value = "";
    askAI(text);
  });

  textInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") btnSend.click();
  });
}

// ═══════════════════════════════════════════════════════════
//  IMMERSIVE FLUID DYNAMIC DNA WAVEFORM ENGINE (V3 CINEMATIC)
// ═══════════════════════════════════════════════════════════
(function initHorizontalWaveform() {
  const canvas = document.getElementById("horizontalWaveform");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const dpr = window.devicePixelRatio || 1;
  let width = window.innerWidth;
  let height = window.innerHeight;

  // ─── Interactive Mic Interface Capture ───
  const orbMicBtn = document.getElementById("orbMicBtn");

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    initParticles();
  }

  // ─── Ambient Stardust (Subtle Atmospheric Particles) ───
  let particles = [];
  function initParticles() {
    particles = [];
    const count = Math.min(35, Math.max(15, Math.floor(width * 0.02)));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 1.5 + 0.6,
        speedX: (Math.random() - 0.5) * 0.18,
        speedY: (Math.random() - 0.5) * 0.18,
        alpha: Math.random() * 0.35 + 0.05,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  resize();

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  // V3 Atmospheric configurations (Refined Green-Tech Nature Harmonies)
  const states = {
    idle: {
      amp: 15, freq: 0.0012, spd: 0.0020, op: 0.68, thickness: 9.5,
      c1: [102, 187, 106], c2: [174, 213, 129] // Soft Sprout Green to Warm Yellow-Green
    },
    listening: {
      amp: 30, freq: 0.0028, spd: 0.0050, op: 0.88, thickness: 14.5,
      c1: [76, 175, 80], c2: [0, 229, 255] // Attentive Bright Green to Fresh Cyan Highlights
    },
    thinking: {
      amp: 20, freq: 0.0015, spd: 0.0030, op: 0.75, thickness: 12.5,
      c1: [139, 195, 74], c2: [255, 193, 7] // Computational Olive Green to Earthy Gold
    },
    speaking: {
      amp: 40, freq: 0.0024, spd: 0.0040, op: 0.95, thickness: 17.0,
      c1: [198, 255, 0], c2: [255, 213, 79] // Conversational Luminous Lime to Golden Amber Burst
    }
  };

  // Kinetic easing system parameters
  let cur = {
    amp: 15, freq: 0.0012, spd: 0.0020, op: 0.68, thickness: 9.5,
    c1: [102, 187, 106], c2: [174, 213, 129]
  };

  let time = 0;
  let smoothAudioBoost = 0;

  function draw(t) {
    ctx.clearRect(0, 0, width, height);

    // 1. Dynamic Kinetic Interpolation
    const target = states[voiceState] || states.idle;
    const ease = 0.055; // slower ease for "heavier", more intentional shifts
    
    cur.amp       += (target.amp - cur.amp) * ease;
    cur.freq      += (target.freq - cur.freq) * ease;
    cur.spd       += (target.spd - cur.spd) * ease;
    cur.op        += (target.op - cur.op) * ease;
    cur.thickness += (target.thickness - cur.thickness) * ease;
    
    for (let i = 0; i < 3; i++) {
      cur.c1[i] += (target.c1[i] - cur.c1[i]) * ease;
      cur.c2[i] += (target.c2[i] - cur.c2[i]) * ease;
    }

    // Dynamic viscous breathing envelope for thinking state
    if (voiceState === "thinking") {
      cur.amp += (Math.sin(t * 0.025) * 0.35); 
    }

    // 2. Real-Time Volume Modulations
    let audioBoost = 0;
    if (voiceState === "listening") {
      // Applied dynamic noise-gate & exponential expansion for crisp organic mic reactivity
      const expansion = Math.pow(micVolume, 1.25) * 3.8;
      audioBoost = Math.min(1.7, expansion);
    } else if (voiceState === "speaking") {
      // Decay the physical syllable impulse exponentially over time
      speakVolume *= 0.88; 
      // Blend minimum atmospheric oscillation + the real-time physical word-boundary spikes!
      audioBoost = (0.15 + Math.abs(Math.sin(t * 0.035) * 0.15)) + speakVolume;
    }
    smoothAudioBoost += (audioBoost - smoothAudioBoost) * 0.10;

    // ─── Mic Button Pulse (Bound to DNA cadence) ───
    if (orbMicBtn) {
      const micPulse = 1 + smoothAudioBoost * 0.15;
      orbMicBtn.style.transform = `translate(-50%, -50%) scale(${micPulse})`;
      
      if (voiceState === "listening") {
        const shadowBlur = 25 + smoothAudioBoost * 30;
        orbMicBtn.style.boxShadow = `0 0 ${shadowBlur}px rgba(0, 200, 255, ${0.35 + smoothAudioBoost * 0.5})`;
      } else if (voiceState === "speaking") {
        const shadowBlur = 25 + smoothAudioBoost * 30;
        orbMicBtn.style.boxShadow = `0 0 ${shadowBlur}px rgba(0, 240, 120, ${0.35 + smoothAudioBoost * 0.5})`;
      } else if (voiceState === "thinking") {
        orbMicBtn.style.boxShadow = `0 0 24px rgba(140, 80, 255, 0.35)`;
      } else {
        orbMicBtn.style.boxShadow = "";
      }
    }

    // 3. Setup Multi-Pass standard compositing (source-over required for contrast on light BG)
    ctx.globalCompositeOperation = "source-over";
    const cy = height / 2;

    // 4. Ambient Particles
    particles.forEach((p) => {
      p.x += p.speedX;
      p.y += p.speedY + Math.sin(t * 0.001 + p.phase) * 0.05;
      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      const pAlpha = p.alpha * (0.4 + Math.sin(t * 0.008 + p.phase) * 0.2) * cur.op;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${Math.round(cur.c1[0])}, ${Math.round(cur.c1[1])}, ${Math.round(cur.c1[2])}, ${pAlpha})`;
      ctx.fill();
    });

    // 5. Layered Intertwining Strands (DNA Strands A & B + Central Flow)
    const strands = [
      { phase: 0, freqMult: 1.0, ampMult: 1.0, drift: 0 },
      { phase: Math.PI, freqMult: 1.0, ampMult: 1.0, drift: Math.PI * 0.25 },
      { phase: Math.PI * 0.5, freqMult: 1.4, ampMult: 0.35, drift: Math.PI * 0.5 }
    ];

    strands.forEach((strand) => {
      // 3D Depth Simulation for Holographic DNA cylindrical helix winding (Z-axis depth mapping)
      const zAngle = (t * cur.spd * 0.65) + strand.phase;
      const zDepth = Math.cos(zAngle); // Oscillates between -1 (behind) and +1 (in front)
      
      // Center filament has stable depth; outer DNA strands scale and fade to model cylindrical rotation
      const isCoreStrand = (strand.ampMult < 0.5);
      const depthScale = isCoreStrand ? 0.85 : (1.0 + (zDepth * 0.22)); 
      const depthAlpha = isCoreStrand ? 0.70 : (1.0 + (zDepth * 0.25));

      // Trace multi-harmonic geometry for fluid motion
      const points = [];
      const step = 8;
      for (let x = 0; x <= width; x += step) {
        const envelope = Math.pow(Math.sin((x / width) * Math.PI), 2.2); 
        
        // Complex non-repeating triple-harmonic sinusoidal interference for fluid dynamics
        let wave = Math.sin((x * cur.freq * strand.freqMult) + t * cur.spd + strand.phase);
        wave += Math.sin((x * cur.freq * 0.65) + t * (cur.spd * 0.55) - strand.phase * 0.8) * 0.38;
        wave += Math.sin((x * cur.freq * 1.35) - t * (cur.spd * 0.75) + strand.phase * 1.5) * 0.16;
        
        // Subtle vertical axial drift that shifts strands relative to each other over time
        const slowDrift = Math.sin(t * 0.001 + strand.drift) * 6 * envelope;
        
        // Prevent vertical overshoot on constrained mobile viewports
        const responsiveAmpScalar = width < 600 ? Math.max(0.65, width / 600) : 1.0;
        const dynamicAmp = (cur.amp + (smoothAudioBoost * 32)) * strand.ampMult * responsiveAmpScalar;
        const y = cy + (wave * dynamicAmp * envelope) + slowDrift;
        
        points.push({ x, y });
      }

      // Generate dynamic gradients
      const strandGrad = ctx.createLinearGradient(0, 0, width, 0);
      const opBase = cur.op;
      const r1 = Math.round(cur.c1[0]), g1 = Math.round(cur.c1[1]), b1 = Math.round(cur.c1[2]);
      const r2 = Math.round(cur.c2[0]), g2 = Math.round(cur.c2[1]), b2 = Math.round(cur.c2[2]);

      strandGrad.addColorStop(0, `rgba(${r1}, ${g1}, ${b1}, 0)`);
      strandGrad.addColorStop(0.25, `rgba(${r1}, ${g1}, ${b1}, ${opBase})`);
      strandGrad.addColorStop(0.75, `rgba(${r2}, ${g2}, ${b2}, ${opBase})`);
      strandGrad.addColorStop(1, `rgba(${r2}, ${g2}, ${b2}, 0)`);

      // Core luminous filament tint gradient (Softened 85% White mix)
      const coreGrad = ctx.createLinearGradient(0, 0, width, 0);
      coreGrad.addColorStop(0, "rgba(255,255,255,0)");
      coreGrad.addColorStop(0.3, `rgba(${Math.round(r1*0.35+255*0.65)}, ${Math.round(g1*0.35+255*0.65)}, ${Math.round(b1*0.35+255*0.65)}, ${opBase * 0.9})`);
      coreGrad.addColorStop(0.7, `rgba(${Math.round(r2*0.35+255*0.65)}, ${Math.round(g2*0.35+255*0.65)}, ${Math.round(b2*0.35+255*0.65)}, ${opBase * 0.9})`);
      coreGrad.addColorStop(1, "rgba(255,255,255,0)");

      // Helper to draw a continuous quadratic bezier spline path through sampled points
      function drawPath() {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 1; i++) {
          const xc = (points[i].x + points[i + 1].x) / 2;
          const yc = (points[i].y + points[i + 1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      }

      // V3 QUAD-PASS LAYERED VOLUMETRIC RENDER SHADER
      
      // PASS 1: Ultra-Wide Volumetric Bloom Glow
      drawPath();
      ctx.lineWidth = (cur.thickness * 2.4 + (smoothAudioBoost * 6.0)) * depthScale;
      ctx.shadowBlur = 45 * (cur.op + smoothAudioBoost * 0.25) * depthAlpha;
      ctx.shadowColor = `rgb(${r1}, ${g1}, ${b1})`;
      ctx.strokeStyle = strandGrad;
      ctx.globalAlpha = 0.16 * depthAlpha;
      ctx.stroke();

      // PASS 2: Thick Fluid Sheath
      drawPath();
      ctx.lineWidth = (cur.thickness * 1.2 + (smoothAudioBoost * 3.0)) * depthScale;
      ctx.shadowBlur = 25 * depthScale;
      ctx.shadowColor = `rgb(${r2}, ${g2}, ${b2})`;
      ctx.globalAlpha = 0.35 * depthAlpha;
      ctx.stroke();

      // PASS 3: Main Energy Body
      drawPath();
      ctx.lineWidth = (cur.thickness * 0.6 + (smoothAudioBoost * 1.5)) * depthScale;
      ctx.shadowBlur = 12 * depthScale;
      ctx.globalAlpha = 0.65 * depthAlpha;
      ctx.stroke();

      // PASS 4: Softened Holographic Core Inner Filament
      drawPath();
      ctx.lineWidth = (1.5 + (smoothAudioBoost * 0.5)) * depthScale;
      ctx.shadowBlur = 6 * depthScale;
      ctx.shadowColor = "#ffffff";
      ctx.strokeStyle = coreGrad;
      ctx.globalAlpha = 0.85 * cur.op * depthAlpha;
      ctx.stroke();

      // Reset system alpha
      ctx.globalAlpha = 1.0;
    });
  }

  function animate() {
    time += 1.0;
    draw(time);
    requestAnimationFrame(animate);
  }
  animate();
})();


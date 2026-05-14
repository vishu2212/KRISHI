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
const navTryBtn     = document.getElementById("navTryBtn");
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
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    if (audioCtx.state === "suspended") await audioCtx.resume();
  } catch (e) { console.error("Mic capture error:", e); }
}

const STATUS_MAP = {
  idle:      "Speak with KIYARI AI",
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
//  PARTICLE SPHERE — 3D orb rendered to <canvas>
// ═══════════════════════════════════════════════════════════
(function initAudioWaveform() {
  const canvas = document.getElementById("particleSphere");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const wrapper = canvas.parentElement;
  function getOrbSize() {
    return wrapper ? wrapper.clientWidth : 280;
  }

  let SIZE = getOrbSize();
  const dpr  = window.devicePixelRatio || 1;

  function resizeCanvas() {
    SIZE = getOrbSize();
    canvas.width  = SIZE * dpr;
    canvas.height = SIZE * dpr;
    canvas.style.width  = SIZE + "px";
    canvas.style.height = SIZE + "px";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }
  resizeCanvas();

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 150);
  });

  // State visual parameters (speeds, scales, aesthetics)
  const layers = [
    { color: "rgba(37, 99, 235, 0.65)", shadow: "rgba(37, 99, 235, 0.4)", rot: 0, spd: 0.015, freq: 4, phase: 0.3 },
    { color: "rgba(6, 182, 212, 0.75)", shadow: "rgba(6, 182, 212, 0.5)", rot: 0, spd: -0.02,  freq: 6, phase: 0.7 },
    { color: "rgba(139, 92, 246, 0.6)", shadow: "rgba(139, 92, 246, 0.35)", rot: 0, spd: 0.01,  freq: 5, phase: 1.1 }
  ];

  let time = 0;
  let smoothVol = 0;
  const orbMicBtn = document.getElementById("orbMicBtn");

  function draw(t) {
    const cx = SIZE / 2, cy = SIZE / 2;
    const baseR = SIZE * 0.28;
    
    ctx.clearRect(0, 0, SIZE, SIZE);
    
    // Calculate unified volume from state + analyser
    let targetVol = 0;
    if (voiceState === "listening") {
      targetVol = micVolume; // real live mic volume
    } else if (voiceState === "speaking") {
      // Procedural voice metrics for speaking mode
      const ts = Date.now() / 100;
      targetVol = 0.25 + Math.abs(Math.sin(ts * 0.8) * 0.4 + Math.sin(ts * 1.5) * 0.25) * 0.5;
    } else if (voiceState === "thinking") {
      targetVol = 0.1 + Math.sin(Date.now() / 200) * 0.03;
    } else {
      // Serene breathing ambient rhythm for idle
      targetVol = 0.02 + Math.sin(Date.now() / 1500) * 0.01;
    }
    
    // Fast attack, slow release interpolation for buttery-smooth kinetics
    smoothVol += (targetVol - smoothVol) * 0.18;

    // Force dynamic safe scale & holographic glow on the central mic button based on audio intensity
    if (orbMicBtn) {
      const micPulse = 1 + smoothVol * 0.18;
      orbMicBtn.style.transform = `translate(-50%, -50%) scale(${micPulse})`;
      
      if (voiceState === "listening") {
        const shadowBlur = 20 + smoothVol * 35;
        orbMicBtn.style.boxShadow = `0 0 ${shadowBlur}px rgba(0, 200, 255, ${0.4 + smoothVol * 0.5})`;
      } else if (voiceState === "speaking") {
        const shadowBlur = 20 + smoothVol * 35;
        orbMicBtn.style.boxShadow = `0 0 ${shadowBlur}px rgba(0, 240, 120, ${0.4 + smoothVol * 0.5})`;
      } else {
        orbMicBtn.style.boxShadow = ""; // default
      }
    }

    // Set composition to Screen for premium holographic blending
    ctx.globalCompositeOperation = "lighter";

    // Extract live frequency bin data for wave morphing if available
    let spectrum = [];
    if (voiceState === "listening" && analyser && dataArray) {
      analyser.getByteFrequencyData(dataArray);
      // Map frequency array bins down to a dense sample array for performance
      for (let i = 0; i < 60; i++) {
        spectrum.push((dataArray[i] || 0) / 255.0);
      }
    }

    // Draw the procedural morphing ribbon layers
    layers.forEach((layer, layerIdx) => {
      layer.rot += layer.spd * (1 + smoothVol * 1.5);
      
      ctx.beginPath();
      ctx.lineWidth = 1.6 + (smoothVol * 1.2);
      ctx.strokeStyle = layer.color;
      
      // Add deep luminous neon glows
      ctx.shadowColor = layer.shadow;
      ctx.shadowBlur = 12 + (smoothVol * 25);

      const totalPoints = 120;
      for (let i = 0; i <= totalPoints; i++) {
        const theta = (i / totalPoints) * Math.PI * 2;
        const currentAngle = theta + layer.rot;

        // Calculate organic wave height using layers of sine interference
        let waveFactor = Math.sin(theta * layer.freq + t * 2.5 + layer.phase) * 0.35;
        waveFactor += Math.cos(theta * (layer.freq + 2) - t * 1.8) * 0.2;
        
        // Inject real frequency data if actively listening
        let localAudio = 0;
        if (voiceState === "listening" && spectrum.length > 0) {
          const specIdx = Math.floor((theta / (Math.PI * 2)) * spectrum.length) % spectrum.length;
          localAudio = spectrum[specIdx] * 0.85;
        }
        
        // Sum up dynamic radius (base + ambient oscillations + raw audio amplitude)
        const waveHeight = 14 + (baseR * 0.3) * smoothVol;
        const dynamicR = baseR + (waveFactor * waveHeight) + (localAudio * baseR * 0.4);

        const x = cx + Math.cos(currentAngle) * dynamicR;
        const y = cy + Math.sin(currentAngle) * dynamicR;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.stroke();
    });

    // Draw the core radiant nexus glow
    ctx.shadowBlur = 0; // reset shadow for core
    const gradR = baseR * 0.8;
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, gradR);
    const baseColor = voiceState === "speaking" ? "rgba(0, 240, 120," : "rgba(0, 200, 255,";
    cg.addColorStop(0, baseColor + (0.15 + smoothVol * 0.25) + ")");
    cg.addColorStop(0.5, baseColor + (0.05 + smoothVol * 0.1) + ")");
    cg.addColorStop(1, "rgba(0,0,0,0)");
    
    ctx.beginPath();
    ctx.arc(cx, cy, gradR, 0, Math.PI * 2);
    ctx.fillStyle = cg;
    ctx.fill();
  }

  function animate() {
    time += 0.015;
    draw(time);
    requestAnimationFrame(animate);
  }

  animate();
})();


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
  if (newState === "idle" && !isWakeEnabled) {
    setTimeout(() => {
      if (voiceState === "idle") startWakeWordDetection();
    }, 600);
  }

  // Update orb mic button
  orbMicBtn.className = "orb-mic-btn " + newState;

  // Toggle mic icon / stop icon
  if (newState === "thinking" || newState === "speaking") {
    orbMicIcon.style.display  = "none";
    orbStopIcon.style.display = "block";
  } else {
    orbMicIcon.style.display  = "block";
    orbStopIcon.style.display = "none";
  }

  // Floor glow
  orbFloorGlow.className = "orb-floor-glow " + newState;
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

  const utter = new SpeechSynthesisUtterance(text);
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

  utter.onend   = () => setVoiceState("idle");
  utter.onerror = () => setVoiceState("idle");
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
  // Set continuous false for low-latency phrase capturing & pristine memory usage
  wr.continuous = false; 
  wr.interimResults = true;
  wakeWordRecognition = wr;

  wr.onresult = (e) => {
    if (voiceState !== "idle") return;
    
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const phrase = e.results[i][0].transcript.toLowerCase().trim();
      console.log("[Hands-Free Watchdog]: heard -> '" + phrase + "'");

      // Dynamic phonetic triggers targeting 'Krishi' and 'Kiyari' variant interpretations
      const triggerTerms = [
        "krishi", "krushi", "rishi", "krishna", "krish", "kishi", "christie", "chrissy", "christi",
        "kiyari", "kyari", "kiari", "kyare", "kiare", "khari", "cari", "tiari", "kiara", "kieri"
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
    console.log("%c🎙️ [Hands-Free Active]: Listening silently for 'Hey Krishi' / 'Hey Kiyari'...", "color: #2563eb; font-weight: bold; font-size: 12px;");
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
//  VOICE ASSISTANT ENGINE LAUNCHER
// ═══════════════════════════════════════════════════════════
// Added specialized voiceAssistant wrapper mapping wake word detection to click interaction compliance.
function voiceAssistant() {
  initAudioContext();
  if (voiceState === "idle") {
    startWakeWordDetection();
  }
}
document.addEventListener("click", voiceAssistant, { once: true });


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
  lastFinal  = "";

  const rec = new SR();
  rec.lang            = "en-IN";
  rec.interimResults  = true;
  rec.maxAlternatives = 1;
  recognition         = rec;

  rec.onstart = () => setVoiceState("listening");

  rec.onerror = (e) => {
    // Suppress 'no-speech' and 'aborted' as they are normal silent lifecycle events, not actual hardware errors
    if (e.error === "no-speech" || e.error === "aborted") {
      setVoiceState("idle");
      return;
    }
    showError("Mic error: " + e.error);
    setVoiceState("idle");
  };

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) lastFinal += t;
      else interim += t;
    }
    transcript = lastFinal + interim;
    showTranscript(transcript);
  };

  rec.onend = () => {
    const final = lastFinal.trim();
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
orbMicBtn.addEventListener("click", () => { console.log("orbMicBtn clicked, state:", voiceState); handleMicClick(); });
speakBtn.addEventListener("click", () => { console.log("speakBtn clicked, state:", voiceState); handleMicClick(); });
navTryBtn.addEventListener("click", () => { console.log("navTryBtn clicked, state:", voiceState); handleMicClick(); });

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
//  IMMERSIVE FULL-WIDTH HORIZONTAL PROCEDURAL WAVEFORM ENGINE
// ═══════════════════════════════════════════════════════════
(function initHorizontalWaveform() {
  const canvas = document.getElementById("horizontalWaveform");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const dpr = window.devicePixelRatio || 1;
  let width = window.innerWidth;
  let height = window.innerHeight;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }
  resize();

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  // State configuration mapping
  const states = {
    idle: {
      amp: 15, freq: 0.002, spd: 0.012, op: 0.28,
      c1: [37, 99, 235],  // Deep Blue
      c2: [139, 92, 246] // Soft Violet
    },
    listening: {
      amp: 35, freq: 0.006, spd: 0.045, op: 0.65,
      c1: [6, 182, 212], // Electric Cyan
      c2: [37, 99, 235]  // Electric Blue
    },
    thinking: {
      amp: 22, freq: 0.0035, spd: 0.02, op: 0.45,
      c1: [168, 85, 247], // Purple
      c2: [236, 72, 153]  // Magenta
    },
    speaking: {
      amp: 45, freq: 0.005, spd: 0.035, op: 0.75,
      c1: [6, 182, 212],  // Cyan highlights
      c2: [139, 92, 246] // Blue+Purple gradient
    }
  };

  // Kinetic variables for physics interpolation
  let cur = {
    amp: 15, freq: 0.002, spd: 0.012, op: 0.25,
    c1: [37, 99, 235], c2: [139, 92, 246]
  };

  let time = 0;
  let smoothAudioBoost = 0;

  function draw(t) {
    ctx.clearRect(0, 0, width, height);

    // 1. Interpolate configurations smoothly based on the active AI state
    const target = states[voiceState] || states.idle;
    const ease = 0.08; // butter-smooth transitions
    
    cur.amp  += (target.amp - cur.amp) * ease;
    cur.freq += (target.freq - cur.freq) * ease;
    cur.spd  += (target.spd - cur.spd) * ease;
    cur.op   += (target.op - cur.op) * ease;
    
    // Interpolate colors in RGB space
    for (let i = 0; i < 3; i++) {
      cur.c1[i] += (target.c1[i] - cur.c1[i]) * ease;
      cur.c2[i] += (target.c2[i] - cur.c2[i]) * ease;
    }

    // 2. Unified Audio Reactivity Logic
    let audioBoost = 0;
    if (voiceState === "listening") {
      audioBoost = micVolume * 2.5; // direct microphone scaling
    } else if (voiceState === "speaking") {
      // Synthetic spoken-cadence physics for TTS response
      const speakT = Date.now() / 90;
      audioBoost = (0.3 + Math.abs(Math.sin(speakT * 0.8) * 0.45 + Math.sin(speakT * 1.6) * 0.25)) * 1.2;
    }
    smoothAudioBoost += (audioBoost - smoothAudioBoost) * 0.18;

    // 3. Setup screen compositing and bloom glow
    ctx.globalCompositeOperation = "screen";
    const colorL = `rgb(${Math.round(cur.c1[0])}, ${Math.round(cur.c1[1])}, ${Math.round(cur.c1[2])})`;
    const colorR = `rgb(${Math.round(cur.c2[0])}, ${Math.round(cur.c2[1])}, ${Math.round(cur.c2[2])})`;
    
    ctx.shadowColor = colorL;
    ctx.shadowBlur = 25 * (cur.op + smoothAudioBoost * 0.3);

    // Render 4 overlapping, offset sinusoidal ribbon ribbons
    const layers = 4;
    const cy = height / 2;

    for (let j = 0; j < layers; j++) {
      ctx.beginPath();
      
      const opacityScale = (1 - (j * 0.15)) * cur.op;
      const layerGrad = ctx.createLinearGradient(0, 0, width, 0);
      layerGrad.addColorStop(0, `rgba(${Math.round(cur.c1[0])}, ${Math.round(cur.c1[1])}, ${Math.round(cur.c1[2])}, 0)`);
      layerGrad.addColorStop(0.3, `rgba(${Math.round(cur.c1[0])}, ${Math.round(cur.c1[1])}, ${Math.round(cur.c1[2])}, ${opacityScale})`);
      layerGrad.addColorStop(0.7, `rgba(${Math.round(cur.c2[0])}, ${Math.round(cur.c2[1])}, ${Math.round(cur.c2[2])}, ${opacityScale})`);
      layerGrad.addColorStop(1, `rgba(${Math.round(cur.c2[0])}, ${Math.round(cur.c2[1])}, ${Math.round(cur.c2[2])}, 0)`);

      ctx.strokeStyle = layerGrad;
      ctx.lineWidth = 1.5 + (j * 0.5) + (smoothAudioBoost * 1.5);

      // Offsets that decouple standard movement speeds to make motion cinematic
      const phaseOffset = j * (Math.PI * 0.5);
      const layerSpeedMultiplier = 1 + j * 0.15;
      const layerFreqMultiplier = 1 - j * 0.12;

      // Trace dynamic sine wave across width
      const step = 6; // step size in pixels for precision + perf
      for (let x = 0; x <= width; x += step) {
        // Sine Envelope: tapers deflection to 0 at exact edges so container boundary is invisible
        const envelope = Math.pow(Math.sin((x / width) * Math.PI), 1.8);
        
        // Standard Sinusoidal wave formula
        let waveDeflect = Math.sin((x * cur.freq * layerFreqMultiplier) + t * (cur.spd * layerSpeedMultiplier) + phaseOffset);
        
        // Introduce second harmonic to break geometric monotony
        waveDeflect += Math.sin((x * cur.freq * 1.8) - t * (cur.spd * 0.9) + phaseOffset * 2) * 0.35;

        // Incorporate total amplitude (base state + live audio boosts)
        const finalAmp = (cur.amp + (smoothAudioBoost * 45)) * (1 - j * 0.15);
        
        const y = cy + (waveDeflect * finalAmp * envelope);

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function animate() {
    time += 1.0;
    draw(time);
    requestAnimationFrame(animate);
  }
  animate();
})();


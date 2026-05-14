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
//  IMMERSIVE DNA-STYLE FULL-WIDTH PROCEDURAL WAVEFORM ENGINE
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
    
    // Re-seed particles if width changes dramatically
    initParticles();
  }

  // ─── Floating Energy Particles (Cosmic Depth) ───
  let particles = [];
  function initParticles() {
    particles = [];
    const particleCount = Math.floor(width * 0.03); // responsive count
    for (let i = 0; i < Math.min(40, Math.max(15, particleCount)); i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 1.8 + 0.8,
        speedX: (Math.random() - 0.5) * 0.25,
        speedY: (Math.random() - 0.5) * 0.25,
        alpha: Math.random() * 0.4 + 0.1,
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

  // Atmospheric configurations (Slower speeds, deeper frequencies, thick volumetric scaling)
  const states = {
    idle: {
      amp: 12, freq: 0.0018, spd: 0.003, op: 0.32, thickness: 7.0,
      c1: [37, 99, 235],  // Deep Blue
      c2: [139, 92, 246] // Soft Violet
    },
    listening: {
      amp: 30, freq: 0.0045, spd: 0.008, op: 0.75, thickness: 9.5,
      c1: [6, 182, 212], // Electric Cyan
      c2: [37, 99, 235]  // Electric Blue
    },
    thinking: {
      amp: 20, freq: 0.0025, spd: 0.004, op: 0.55, thickness: 8.0,
      c1: [168, 85, 247], // Purple
      c2: [236, 72, 153]  // Magenta
    },
    speaking: {
      amp: 42, freq: 0.0038, spd: 0.006, op: 0.85, thickness: 10.0,
      c1: [6, 182, 212],  // Cyan highlights
      c2: [139, 92, 246] // Blue-Purple gradient
    }
  };

  // Kinetic physics variables
  let cur = {
    amp: 12, freq: 0.0018, spd: 0.003, op: 0.3, thickness: 7.0,
    c1: [37, 99, 235], c2: [139, 92, 246]
  };

  let time = 0;
  let smoothAudioBoost = 0;

  function draw(t) {
    ctx.clearRect(0, 0, width, height);

    // 1. Smooth Parameter Easing Loop
    const target = states[voiceState] || states.idle;
    const ease = 0.065; // extremely smooth transitions for calm intelligence
    
    cur.amp       += (target.amp - cur.amp) * ease;
    cur.freq      += (target.freq - cur.freq) * ease;
    cur.spd       += (target.spd - cur.spd) * ease;
    cur.op        += (target.op - cur.op) * ease;
    cur.thickness += (target.thickness - cur.thickness) * ease;
    
    for (let i = 0; i < 3; i++) {
      cur.c1[i] += (target.c1[i] - cur.c1[i]) * ease;
      cur.c2[i] += (target.c2[i] - cur.c2[i]) * ease;
    }

    // 2. Real-Time Web Audio Calculation
    let audioBoost = 0;
    if (voiceState === "listening") {
      audioBoost = micVolume * 2.8;
    } else if (voiceState === "speaking") {
      const speakT = Date.now() / 110; // slower voice osc envelope
      audioBoost = (0.25 + Math.abs(Math.sin(speakT * 0.7) * 0.4 + Math.sin(speakT * 1.3) * 0.25)) * 1.1;
    }
    smoothAudioBoost += (audioBoost - smoothAudioBoost) * 0.12; // slower decay for inertia

    // ─── Central Interactive Mic Button Pulse ───
    if (orbMicBtn) {
      const micPulse = 1 + smoothAudioBoost * 0.18;
      orbMicBtn.style.transform = `translate(-50%, -50%) scale(${micPulse})`;
      
      if (voiceState === "listening") {
        const shadowBlur = 20 + smoothAudioBoost * 35;
        orbMicBtn.style.boxShadow = `0 0 ${shadowBlur}px rgba(0, 200, 255, ${0.4 + smoothAudioBoost * 0.5})`;
      } else if (voiceState === "speaking") {
        const shadowBlur = 20 + smoothAudioBoost * 35;
        orbMicBtn.style.boxShadow = `0 0 ${shadowBlur}px rgba(0, 240, 120, ${0.4 + smoothAudioBoost * 0.5})`;
      } else if (voiceState === "thinking") {
        orbMicBtn.style.boxShadow = `0 0 24px rgba(140, 80, 255, 0.4)`;
      } else {
        orbMicBtn.style.boxShadow = "";
      }
    }

    // 3. Layered Blending Setup
    ctx.globalCompositeOperation = "screen";
    const baseColor1 = `rgb(${Math.round(cur.c1[0])}, ${Math.round(cur.c1[1])}, ${Math.round(cur.c1[2])})`;
    
    const cy = height / 2;

    // 4. Draw Floating Energy Particles (Background Layer)
    particles.forEach((p) => {
      p.x += p.speedX;
      p.y += p.speedY + Math.sin(t * 0.002 + p.phase) * 0.08;
      
      // Re-wrap screens
      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      // Pulse opacity gently
      const finalAlpha = p.alpha * (0.3 + Math.sin(t * 0.01 + p.phase) * 0.2) * cur.op;
      
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${Math.round(cur.c1[0])}, ${Math.round(cur.c1[1])}, ${Math.round(cur.c1[2])}, ${finalAlpha})`;
      ctx.fill();
    });

    // 5. DNA Double Helix Strand Rendering
    // We render 2 major intertwining anti-phase strands + 1 core energy strand.
    // Rendering in a dual-pass loop creates volumetric tubes (wide glow pass + sharp core pass).
    
    const strands = [
      { phase: 0, freqMult: 1.0, ampMult: 1.0 },                 // Strand A
      { phase: Math.PI, freqMult: 1.0, ampMult: 1.0 },           // Strand B (Intertwining DNA)
      { phase: Math.PI * 0.5, freqMult: 1.5, ampMult: 0.45 }     // Core connective ribbon
    ];

    strands.forEach((strand) => {
      // Trace geometry once
      const points = [];
      const step = 6;
      for (let x = 0; x <= width; x += step) {
        const envelope = Math.pow(Math.sin((x / width) * Math.PI), 2.0); // Sinusoidal tapering
        
        let wave = Math.sin((x * cur.freq * strand.freqMult) + t * cur.spd + strand.phase);
        wave += Math.sin((x * cur.freq * 1.8) - t * (cur.spd * 0.7) + strand.phase * 1.4) * 0.22;
        
        const dynamicAmp = (cur.amp + (smoothAudioBoost * 40)) * strand.ampMult;
        const y = cy + (wave * dynamicAmp * envelope);
        points.push({ x, y });
      }

      // Create gradient for this strand
      const strandGrad = ctx.createLinearGradient(0, 0, width, 0);
      const opBase = cur.op;
      strandGrad.addColorStop(0, `rgba(${Math.round(cur.c1[0])}, ${Math.round(cur.c1[1])}, ${Math.round(cur.c1[2])}, 0)`);
      strandGrad.addColorStop(0.3, `rgba(${Math.round(cur.c1[0])}, ${Math.round(cur.c1[1])}, ${Math.round(cur.c1[2])}, ${opBase})`);
      strandGrad.addColorStop(0.7, `rgba(${Math.round(cur.c2[0])}, ${Math.round(cur.c2[1])}, ${Math.round(cur.c2[2])}, ${opBase})`);
      strandGrad.addColorStop(1, `rgba(${Math.round(cur.c2[0])}, ${Math.round(cur.c2[1])}, ${Math.round(cur.c2[2])}, 0)`);

      // PASS 1: Wide Volumetric Glow Pass
      ctx.beginPath();
      points.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.strokeStyle = strandGrad;
      ctx.lineWidth = cur.thickness + (smoothAudioBoost * 5.0);
      ctx.shadowBlur = 35 * (cur.op + smoothAudioBoost * 0.3);
      ctx.shadowColor = baseColor1;
      ctx.globalAlpha = 0.3; // Soft luminous presence
      ctx.stroke();

      // PASS 2: Sharp Luminous Nucleus Core Pass
      ctx.beginPath();
      points.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.lineWidth = 2.5 + (smoothAudioBoost * 0.8);
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#ffffff";
      ctx.strokeStyle = "#ffffff"; // bright nucleus
      ctx.globalAlpha = 0.75 * cur.op;
      ctx.stroke();
      
      // Reset alpha
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


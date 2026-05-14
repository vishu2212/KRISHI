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
(function initParticleSphere() {
  const canvas = document.getElementById("particleSphere");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // Dynamically get size from CSS-styled wrapper
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
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
    ctx.scale(dpr, dpr);
  }
  resizeCanvas();

  // Re-init on resize (debounced)
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 150);
  });

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  // Generate 320 Fibonacci sphere points
  const points = Array.from({ length: 320 }, (_, i) => {
    const y = 1 - (i / 319) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = goldenAngle * i;
    return { x: Math.cos(t) * r, y, z: Math.sin(t) * r, s: Math.random() * 1.2 + 0.5 };
  });

  // Generate wireframe mesh lines (latitude + longitude)
  const meshLines = [];
  for (let la = 0; la < 8; la++) {
    const phi = (Math.PI / 8) * la;
    meshLines.push(Array.from({ length: 61 }, (_, i) => {
      const t = (2 * Math.PI * i) / 60;
      return { x: Math.sin(phi)*Math.cos(t), y: Math.cos(phi), z: Math.sin(phi)*Math.sin(t) };
    }));
  }
  for (let lo = 0; lo < 10; lo++) {
    const t = (2 * Math.PI * lo) / 10;
    meshLines.push(Array.from({ length: 41 }, (_, i) => {
      const phi = (Math.PI * i) / 40;
      return { x: Math.sin(phi)*Math.cos(t), y: Math.cos(phi), z: Math.sin(phi)*Math.sin(t) };
    }));
  }

  // 3D → 2D projection with rotation (uses live SIZE)
  function project(px, py, pz, rot) {
    const cx = SIZE / 2, cy = SIZE / 2, R = SIZE * 0.38;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const rx = px*cosR + pz*sinR, ry = py, rz = -px*sinR + pz*cosR;
    const cosT = Math.cos(0.2), sinT = Math.sin(0.2);
    return { x: rx*R + cx, y: (ry*cosT - rz*sinT)*R + cy, z: ry*sinT + rz*cosT };
  }

  // Per-state visual params
  function stateParams(st, t) {
    const map = {
      idle:      { spd: 0.003, mA: 0.09,  cR:100, cG:180, cB:255, glow:0.06 },
      listening: { spd: 0.009, mA: 0.14,  cR:80,  cG:200, cB:255, glow:0.14 + Math.sin(t*4)*0.08 },
      thinking:  { spd: 0.005, mA: 0.08,  cR:140, cG:100, cB:255, glow:0.10 + Math.sin(t*2)*0.05 },
      speaking:  { spd: 0.012, mA: 0.18,  cR:120, cG:220, cB:255, glow:0.18 + Math.sin(t*6)*0.10 },
    };
    return map[st] || map.idle;
  }

  let rot = 0, time = 0;

  function draw(t) {
    const R = SIZE * 0.38;
    const cx = SIZE / 2, cy = SIZE / 2;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const st = voiceState;
    const p  = stateParams(st, t);

    // Draw wireframe mesh
    meshLines.forEach(line => {
      ctx.beginPath();
      line.forEach((pt, i) => {
        const q = project(pt.x, pt.y, pt.z, rot);
        i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
      });
      ctx.strokeStyle = `rgba(${p.cR},${p.cG},${p.cB},${p.mA})`;
      ctx.lineWidth = 0.4;
      ctx.stroke();
    });

    // Draw depth-sorted particles
    const projected = points.map(pt => ({ ...project(pt.x, pt.y, pt.z, rot), s: pt.s }));
    projected.sort((a, b) => a.z - b.z);

    // Calculate reactive amplitude for listening animation
    const audioBoost = (st === "listening") ? micVolume * 2.2 : 0;

    projected.forEach(q => {
      const depth = (q.z + 1) / 2;
      const alpha = 0.12 + depth * 0.78;
      const ds    = q.s * (0.35 + depth * 0.95);
      
      // Wave motion formula combining sine ripples with voice amplitude
      const boost = st === "speaking" 
        ? 1 + Math.sin(t*8 + q.x*10) * 0.3 
        : 1 + audioBoost * (1 + Math.sin(t*6 + q.x*8) * 0.3);

      ctx.beginPath();
      if (depth > 0.72) {
        const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, ds*2.8);
        g.addColorStop(0, `rgba(${p.cR+60},${p.cG+20},255,${alpha})`);
        g.addColorStop(1, `rgba(${p.cR},${p.cG},255,0)`);
        ctx.fillStyle = g;
        ctx.arc(q.x, q.y, ds * 2.8 * boost, 0, Math.PI * 2);
      } else {
        const b = Math.floor(140 + depth * 115);
        ctx.fillStyle = `rgba(${b},${b+20},255,${alpha})`;
        ctx.arc(q.x, q.y, ds * boost, 0, Math.PI * 2);
      }
      ctx.fill();
    });

    // Centre glow
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.65);
    cg.addColorStop(0, `rgba(${p.cR},${p.cG},255,${p.glow})`);
    cg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.65, 0, Math.PI * 2);
    ctx.fillStyle = cg;
    ctx.fill();
  }

  function animate() {
    const p = stateParams(voiceState, time);
    rot  += p.spd;
    time += 0.016;
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
//  FULLSCREEN WAVE VISUAL REACTIVITY SYSTEM
// ═══════════════════════════════════════════════════════════
function updateVoiceWaveAnimation() {
  if (!voiceWaveGif) {
    requestAnimationFrame(updateVoiceWaveAnimation);
    return;
  }

  let currentVolume = 0; // 0.0 to 1.0 normalized range for reactive scale

  if (voiceState === "listening") {
    // Read live normalized volume from the active mic capture
    currentVolume = micVolume;
  } else if (voiceState === "speaking") {
    // Synthesize premium procedural speaker physics for TTS audio
    // Uses sine wave interference logic (mimicking real spoken cadence)
    const t = Date.now() / 100;
    let proceduralOsc = Math.sin(t * 0.75) * 0.4 + Math.sin(t * 1.4) * 0.35 + Math.sin(t * 2.2) * 0.25;
    // Map to a nice positive amplitude bound
    currentVolume = 0.25 + Math.abs(proceduralOsc) * 0.5;
  } else if (voiceState === "thinking") {
    // Medium frequency ripple for processing cycles
    currentVolume = 0.08 + Math.sin(Date.now() / 200) * 0.03;
  } else {
    // Slow, ambient breathing cycle while idle
    currentVolume = Math.sin(Date.now() / 2000) * 0.015;
  }

  // Prevent excessive negative scaling or boundaries
  currentVolume = Math.max(0, Math.min(1.0, currentVolume));

  // Apply fluid transform logic (scale & subtle rotation oscillation)
  let scaleBase = 1.0;
  let brightnessMult = 1.0;
  
  if (voiceState === "speaking" || voiceState === "listening") {
    // Fluid bounce & pop reactive mapping
    scaleBase = 1.02 + (currentVolume * 0.08);
    brightnessMult = 0.9 + (currentVolume * 0.7); // Go brighter based on volume
    
    const angleOsc = Math.sin(Date.now() / 1000) * 0.4; // slow rotation wobble
    voiceWaveGif.style.transform = `scale(${scaleBase}) rotate(${angleOsc}deg)`;
    
    // Smooth dynamic color/shadow modulation for premium presence
    const glowRadius = 15 + (currentVolume * 35);
    const themeColor = voiceState === "listening" ? "0, 200, 255" : "0, 240, 120";
    voiceWaveGif.style.filter = `brightness(${brightnessMult}) contrast(1.3) drop-shadow(0 0 ${glowRadius}px rgba(${themeColor}, 0.5)) saturate(1.15)`;
    voiceWaveGif.style.transition = "none"; // raw frame speed for instant response
  } else if (voiceState === "thinking") {
    scaleBase = 1.01 + (currentVolume * 0.03);
    voiceWaveGif.style.transform = `scale(${scaleBase})`;
    voiceWaveGif.style.filter = "brightness(0.65) contrast(1.15) blur(1px) saturate(0.9)";
    voiceWaveGif.style.transition = "transform 0.5s ease, filter 0.5s ease";
  } else {
    // Idle baseline state
    scaleBase = 0.99 + currentVolume; // very minimal drift
    voiceWaveGif.style.transform = `scale(${scaleBase})`;
    voiceWaveGif.style.filter = "brightness(0.4) contrast(1.05) saturate(0.85)";
    voiceWaveGif.style.transition = "transform 1.5s ease, filter 1.5s ease";
  }

  requestAnimationFrame(updateVoiceWaveAnimation);
}

// Initialize the rendering loop immediately
requestAnimationFrame(updateVoiceWaveAnimation);


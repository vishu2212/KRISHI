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


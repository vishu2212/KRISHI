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

// ─── STATE ───────────────────────────────────────────────
let voiceState  = "idle"; // idle | listening | thinking | speaking
let transcript  = "";
let reply       = "";
let history     = [];
let recognition = null;
let lastFinal   = "";

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
  const SIZE = 280;
  const dpr  = window.devicePixelRatio || 1;
  canvas.width  = SIZE * dpr;
  canvas.height = SIZE * dpr;
  ctx.scale(dpr, dpr);

  const cx = SIZE / 2, cy = SIZE / 2, R = SIZE * 0.38;
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

  // 3D → 2D projection with rotation
  function project(px, py, pz, rot) {
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
    projected.forEach(q => {
      const depth = (q.z + 1) / 2;
      const alpha = 0.12 + depth * 0.78;
      const ds    = q.s * (0.35 + depth * 0.95);
      const boost = st === "speaking" ? 1 + Math.sin(t*8 + q.x*10) * 0.3 : 1;
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

  // Update CTA button
  speakBtnLabel.textContent = STATUS_MAP[newState];
  speakBtn.className = "speak-btn " + newState;
  pdot.className     = "pdot " + newState;

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
  utter.lang   = "en-IN";
  utter.rate   = 1.2;
  utter.pitch  = 1.0;
  utter.volume = 1.0;

  // Voice selection priority
  const voices = availableVoices.length ? availableVoices : synth.getVoices();
  
  const voicePriority = [
    "Microsoft Heera",
    "Microsoft Ravi",
    "Google हिन्दी",
    "Google UK English Female"
  ];

  let selectedVoice = null;
  for (const name of voicePriority) {
    selectedVoice = voices.find(v => v.name.includes(name));
    if (selectedVoice) break;
  }

  // Fallback to first available en-IN or any en voice
  if (!selectedVoice) {
    selectedVoice = voices.find(v => v.lang === "en-IN") || voices.find(v => v.lang.startsWith("en")) || voices[0];
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
    const res = await fetch("/ai", {
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
//  WEB SPEECH RECOGNITION
// ═══════════════════════════════════════════════════════════
function startListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showError("Speech recognition not supported in this browser."); return; }

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

/* ========================================================================
   Atom, voice engine for the Socrates spoken tutor.

   Three jobs:

   1. LISTEN continuously. The microphone stays open; a Web Audio analyser
      watches the signal and decides when you have started and stopped
      speaking, so there is no button to press. Only the speech itself gets
      recorded and sent, not the silence around it.

   2. TRANSCRIBE with Whisper (via /api/stt). Far better than the browser's
      SpeechRecognition at academic vocabulary and noisy rooms, and it comes
      back punctuated. If the endpoint is unavailable we fall back to the
      browser's recogniser so the feature still works.

   3. SPEAK with PlayAI (via /api/tts), which sounds like a person. If that
      endpoint is not enabled we fall back to speechSynthesis, picking the
      best available voice.

   Everything is event-driven; the UI layer (js/socrates.js) subscribes and
   never touches the audio graph itself.
   ======================================================================== */

(function () {
  // Tuning. These are the numbers that decide how it *feels* to talk to.
  const CFG = {
    // Above this RMS counts as speech. Recalibrated against room noise.
    speechThreshold: 0.022,
    // How far above the measured noise floor speech has to sit.
    noiseMargin: 2.4,
    // Silence needed before we treat an utterance as finished (ms).
    silenceHold: 900,
    // Ignore blips shorter than this, e.g. a cough or a door (ms).
    minUtterance: 380,
    // Hard stop so one clip can't grow unbounded (ms).
    maxUtterance: 45000,
    // Speech this much louder than the floor interrupts playback (barge-in).
    fftSize: 1024,
  };

  function pickMime() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    if (typeof MediaRecorder === "undefined") return "";
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  }

  function AtomVoice(options = {}) {
    const apiBase = (options.apiBase || "").replace(/\/$/, "");
    const listeners = {};

    let stream = null;
    let audioCtx = null;
    let analyser = null;
    let source = null;
    let recorder = null;
    let chunks = [];
    let raf = 0;

    let listening = false;     // mic open and watching
    let capturing = false;     // currently inside an utterance
    let speaking = false;      // Socrates is talking
    let busy = false;          // transcription/answer in flight
    let suspended = false;     // paused by the UI

    let noiseFloor = 0.006;
    let level = 0;
    let voiceStart = 0;
    let lastVoice = 0;

    let currentAudio = null;
    let ttsAvailable = true;   // flips false once the endpoint proves missing
    /* How we turn speech into text.
         "server"  -> record clips and send to Whisper (/api/stt). Best.
         "browser" -> the built-in SpeechRecognition. Worse, but needs no
                      backend, so voice still works before the Worker is
                      deployed or if the route is unreachable. */
    let sttMode = "server";
    let recognition = null;
    let recogRestart = null;

    const emit = (name, payload) => {
      (listeners[name] || []).forEach((fn) => {
        try { fn(payload); } catch (err) { console.error(err); }
      });
    };

    const api = {
      on(name, fn) {
        (listeners[name] = listeners[name] || []).push(fn);
        return api;
      },
      get isListening() { return listening; },
      get isSpeaking() { return speaking; },
      get level() { return level; },
    };

    /* ---------------- microphone ---------------- */
    api.start = async function start() {
      if (listening) return true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        emit("error", { kind: "unsupported", message: "This browser can't record audio." });
        return false;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,   // stops it hearing its own voice
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (err) {
        emit("error", {
          kind: "permission",
          message: err && err.name === "NotAllowedError"
            ? "Microphone access was blocked. Allow it to talk to Socrates."
            : "Could not open the microphone.",
        });
        return false;
      }

      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
      if (audioCtx.state === "suspended") { try { await audioCtx.resume(); } catch {} }
      source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = CFG.fftSize;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);

      listening = true;
      emit("listening", true);
      watch();
      // If a previous utterance already proved the endpoint missing, come
      // straight back up in browser mode instead of re-discovering it.
      if (sttMode === "browser") startRecognition();
      return true;
    };

    api.stop = function stop() {
      listening = false;
      capturing = false;
      stopRecognition();
      cancelAnimationFrame(raf);
      if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch {} }
      recorder = null;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
      if (audioCtx) { try { audioCtx.close(); } catch {} }
      audioCtx = null;
      analyser = null;
      api.stopSpeaking();
      emit("listening", false);
    };

    // Pause capture without dropping the mic (used while Socrates talks and
    // while we're waiting on an answer).
    api.suspend = function suspend() { suspended = true; };
    api.resume = function resume() { suspended = false; lastVoice = performance.now(); };

    /* ---------------- level metering + endpointing ---------------- */
    function watch() {
      if (!analyser) return;
      const buf = new Float32Array(analyser.fftSize);

      const tick = () => {
        if (!listening || !analyser) return;
        analyser.getFloatTimeDomainData(buf);

        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        level = rms;
        emit("level", rms);

        const now = performance.now();
        const gate = Math.max(CFG.speechThreshold, noiseFloor * CFG.noiseMargin);
        const isVoice = rms > gate;

        // Track the quiet baseline so a noisy room raises the bar instead of
        // triggering constantly. Only adapt while not capturing.
        if (!capturing && !isVoice) {
          noiseFloor = noiseFloor * 0.95 + rms * 0.05;
        }

        // Clip recording only applies to server transcription. In browser
        // mode SpeechRecognition does its own endpointing, but the analyser
        // keeps running so the orb still reacts to your voice.
        if (sttMode === "server" && !suspended && !busy) {
          if (isVoice) {
            lastVoice = now;
            if (!capturing) beginUtterance(now);
          } else if (capturing && now - lastVoice > CFG.silenceHold) {
            endUtterance(now);
          }
          if (capturing && now - voiceStart > CFG.maxUtterance) endUtterance(now);
        }
        if (sttMode === "browser") {
          if (isVoice) emit("capture", true);
        }

        // Barge-in: talking over Socrates stops the playback so you can
        // interrupt the way you would with a person.
        if (speaking && isVoice && rms > gate * 1.5) {
          api.stopSpeaking();
          emit("bargein", true);
        }

        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    function beginUtterance(now) {
      if (!stream) return;
      capturing = true;
      voiceStart = now;
      lastVoice = now;
      chunks = [];
      const mimeType = pickMime();
      try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch {
        capturing = false;
        emit("error", { kind: "recorder", message: "Could not start recording." });
        return;
      }
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.start();
      emit("capture", true);
    }

    function endUtterance(now) {
      capturing = false;
      emit("capture", false);
      const spoken = now - voiceStart;
      const rec = recorder;
      recorder = null;
      if (!rec || rec.state === "inactive") return;

      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        chunks = [];
        // Too short to be a real sentence: almost always a cough or a knock.
        if (spoken < CFG.minUtterance || blob.size < 1200) return;
        await transcribe(blob);
      };
      try { rec.stop(); } catch {}
    }

    /* ---------------- transcription ---------------- */

    // A missing route means the backend hasn't been deployed (or is an older
    // build). Retrying every utterance would just spam the console with 404s,
    // so we switch to the browser recogniser once and stay there.
    function routeMissing(status) {
      return status === 404 || status === 405 || status === 501;
    }

    async function transcribe(blob) {
      busy = true;
      emit("thinking", true);
      try {
        const form = new FormData();
        form.append("file", blob, "clip.webm");
        const res = await fetch(`${apiBase}/api/stt`, {
          method: "POST",
          body: form,
          credentials: "include",
        });

        if (routeMissing(res.status)) {
          busy = false;
          switchToBrowserStt("The transcription service isn't deployed yet");
          return;
        }
        if (!res.ok) throw new Error(`stt ${res.status}`);

        const data = await res.json();
        const text = String((data && data.text) || "").trim();
        if (text && !isNoise(text)) emit("transcript", text);
        else emit("thinking", false);
      } catch (err) {
        emit("error", { kind: "stt", message: "Could not make out that clip. Try again." });
        emit("thinking", false);
      } finally {
        busy = false;
      }
    }

    /* ---------------- browser speech recognition (fallback) ---------------- */
    function browserSttSupported() {
      return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
    }

    function switchToBrowserStt(reason) {
      if (sttMode === "browser") return;
      sttMode = "browser";
      // Abandon any half-recorded clip from the server path.
      capturing = false;
      if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch {} }
      recorder = null;
      chunks = [];

      if (!browserSttSupported()) {
        emit("error", {
          kind: "stt-unavailable",
          message: "Voice input isn't available yet. You can type instead.",
        });
        emit("thinking", false);
        return;
      }
      emit("degraded", { kind: "stt", reason: reason || "" });
      emit("thinking", false);
      startRecognition();
    }

    function startRecognition() {
      if (!listening || recognition) return;
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return;
      recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (e) => {
        if (suspended || busy) return;
        let finalText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        }
        finalText = finalText.trim();
        if (finalText && !isNoise(finalText)) {
          emit("capture", false);
          emit("transcript", finalText);
        }
      };
      // The engine stops itself periodically; restart while we still want it.
      recognition.onend = () => {
        recognition = null;
        if (listening && sttMode === "browser") {
          clearTimeout(recogRestart);
          recogRestart = setTimeout(startRecognition, 260);
        }
      };
      recognition.onerror = (ev) => {
        if (ev && (ev.error === "not-allowed" || ev.error === "service-not-allowed")) {
          emit("error", { kind: "permission", message: "Microphone access was blocked." });
          sttMode = "server"; // don't loop on a permission failure
        }
      };
      try { recognition.start(); } catch {}
    }

    function stopRecognition() {
      clearTimeout(recogRestart);
      if (recognition) {
        const r = recognition;
        recognition = null;
        try { r.onend = null; r.stop(); } catch {}
      }
    }

    // Whisper emits these for silence or background noise. Filtering them
    // stops Socrates answering a door slam.
    function isNoise(text) {
      const t = text.toLowerCase().replace(/[^a-z ]/g, "").trim();
      if (t.length < 2) return true;
      return /^(you|thank you|thanks for watching|bye|uh|um|hmm|mm|ah|oh|okay|so|the|a)$/.test(t);
    }

    /* ---------------- speech out ---------------- */
    api.speak = async function speak(text, opts = {}) {
      const clean = String(text || "").trim();
      if (!clean) return;
      api.stopSpeaking();
      speaking = true;
      emit("speaking", true);
      api.suspend();

      const done = () => {
        speaking = false;
        currentAudio = null;
        emit("speaking", false);
        // Small gap before listening again so the tail of the sentence
        // doesn't get captured as the user talking.
        setTimeout(() => { if (listening) api.resume(); }, 220);
      };

      if (ttsAvailable) {
        try {
          const res = await fetch(`${apiBase}/api/tts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input: clean, voice: opts.voice }),
            credentials: "include",
          });
          // 503 = playai-tts terms not accepted yet.
          // 404/405/501 = the route isn't deployed.
          // Either way there is no point asking again this session, and
          // retrying would 404 on every single reply.
          if (res.status === 503 || routeMissing(res.status)) {
            ttsAvailable = false;
            emit("degraded", {
              kind: "tts",
              reason: routeMissing(res.status) ? "not deployed" : "terms not accepted",
            });
            throw new Error("tts unavailable");
          }
          if (!res.ok) throw new Error(`tts ${res.status}`);
          const type = res.headers.get("content-type") || "";
          if (!type.startsWith("audio/")) throw new Error("tts non-audio");

          const buf = await res.arrayBuffer();
          const url = URL.createObjectURL(new Blob([buf], { type: type || "audio/wav" }));
          const audio = new Audio(url);
          currentAudio = audio;
          audio.onended = () => { URL.revokeObjectURL(url); done(); };
          audio.onerror = () => { URL.revokeObjectURL(url); done(); };
          await audio.play();
          return;
        } catch {
          // fall through to browser speech
        }
      }
      browserSpeak(clean, done);
    };

    /* Fallback voice. Not as good as PlayAI, but it means Socrates is never
       mute, and it should still be recognisably the same character: male and
       a little deep. Browsers default to a female voice on most platforms,
       so gender has to be selected for explicitly. */
    function browserSpeak(text, done) {
      // speechSynthesis and SpeechSynthesisUtterance are separate globals;
      // both are required. If anything here throws we must still call done(),
      // otherwise `speaking` stays true and the microphone never resumes.
      if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== "function") {
        done();
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const u = new window.SpeechSynthesisUtterance(text);
        const v = bestVoice();
        if (v) u.voice = v;
        u.rate = 0.98;
        u.pitch = 0.85;   // a touch below default for depth
        u.onend = done;
        u.onerror = done;
        window.speechSynthesis.speak(u);
      } catch {
        done();
      }
    }

    // Male voices that actually exist across macOS, iOS, Windows and Chrome,
    // best first. Matched loosely because vendors suffix them differently
    // ("Daniel", "Daniel (Enhanced)", "Microsoft Guy Online (Natural)").
    const MALE_VOICES = [
      "microsoft guy", "microsoft davis", "microsoft andrew", "microsoft brian",
      "microsoft christopher", "microsoft eric", "microsoft roger", "microsoft steffan",
      "google uk english male", "daniel", "alex", "oliver", "arthur", "gordon",
      "rishi", "tom", "fred", "aaron", "reed", "microsoft david", "microsoft mark",
    ];
    // Common female voices, so we can actively avoid them.
    const FEMALE_HINT = /(samantha|victoria|karen|moira|tessa|fiona|serena|allison|ava|susan|zoe|kate|catherine|zira|hazel|aria|jenny|michelle|emma|amber|ana|female|woman)/;

    let cachedVoice = null;
    function bestVoice() {
      if (cachedVoice) return cachedVoice;
      if (!window.speechSynthesis) return null;
      const voices = window.speechSynthesis.getVoices() || [];
      if (!voices.length) return null;

      const english = voices.filter((v) => /^en/i.test(v.lang || ""));
      if (!english.length) return null;

      const score = (v) => {
        const n = (v.name || "").toLowerCase();
        let s = 0;
        // Gender dominates: a robotic male voice is more in character than a
        // pristine female one, since Socrates is written as a man.
        const maleRank = MALE_VOICES.findIndex((m) => n.includes(m));
        if (maleRank !== -1) s += 40 - maleRank;
        else if (FEMALE_HINT.test(n)) s -= 30;
        if (/\bmale\b/.test(n)) s += 12;
        // Then quality.
        if (/natural|neural/.test(n)) s += 6;
        if (/premium|enhanced/.test(n)) s += 5;
        if (/google|microsoft/.test(n)) s += 3;
        if (v.localService === false) s += 2;
        if (/en[-_]us|en[-_]gb/i.test(v.lang || "")) s += 2;
        if (/compact|espeak/.test(n)) s -= 5;
        return s;
      };

      cachedVoice = english.slice().sort((a, b) => score(b) - score(a))[0] || null;
      return cachedVoice;
    }

    // Voices load asynchronously in Chrome; clear the cache when they arrive
    // so the first utterance isn't stuck with whatever was available at boot.
    if (window.speechSynthesis && "onvoiceschanged" in window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => { cachedVoice = null; };
    }

    api.stopSpeaking = function stopSpeaking() {
      if (currentAudio) {
        try { currentAudio.pause(); currentAudio.currentTime = 0; } catch {}
        currentAudio = null;
      }
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
      if (speaking) {
        speaking = false;
        emit("speaking", false);
        if (listening) api.resume();
      }
    };

    // Let the UI tell us an answer is being generated, so the mic doesn't
    // start capturing the user's own thinking-out-loud mid-request.
    api.setBusy = function setBusy(v) {
      busy = !!v;
      if (!busy) lastVoice = performance.now();
    };

    return api;
  }

  window.AtomVoice = AtomVoice;
})();

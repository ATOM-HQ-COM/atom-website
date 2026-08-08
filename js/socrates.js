/* ========================================================================
   Atom, Socrates: the universal spoken tutor.

   Everything here is scoped to the Socrates path. When State.classId is
   "socrates" the chat page hides the normal composer and hands the screen
   to this module, which:

     - asks for age and education level once (stored locally),
     - builds a personalised course for whatever the learner is stuck on,
     - runs a hands-free spoken conversation via js/voice.js,
     - keeps a live orb + transcript so you can see it listening.

   It reuses the chat page's model plumbing (callModel, appendBubble,
   renderMarkdown) rather than re-implementing any of it.
   ======================================================================== */

(function () {
  const LS_LEARNER = "atom-socrates-learner";
  const LS_COURSE = "atom-socrates-course";

  const SOCRATES_MODEL = "openai/gpt-oss-120b";
  const COURSE_MODEL = "llama-3.3-70b-versatile";

  /* Socrates is written as a man, so the voice is male. This is a Canopy Labs
     Orpheus (canopylabs/orpheus-v1-english) voice; "daniel" is a measured male
     that suits a patient tutor. Other English Orpheus voices: austin and troy
     (male); autumn, diana, hannah (female). Must match the worker's TTS_MODEL. */
  const VOICE = "daniel";

  /* Spoken answers have to be SHORT. A paragraph that reads fine takes 40
     seconds to listen to, and the learner cannot skim it. The prompt leans
     hard on brevity and on ending with a question, because a tutor that
     never checks understanding is just a lecture. */
  function socratesSystem(learner) {
    const who = learner && learner.age
      ? `The learner is ${learner.age} years old and describes their level as "${learner.level}".`
      : "You do not know the learner's age or level yet, so ask early and briefly.";

    return `You are Socrates, a master tutor who can teach any subject: physics, chemistry, biology, mathematics and computer science, at any level from a young child to a graduate researcher.

${who}

You are speaking OUT LOUD. Your words are converted to speech and heard, not read.

How to talk:
- Keep every reply SHORT. Two to four sentences, normally under 70 words. This is a conversation, not a lecture.
- Never use markdown, bullet points, headings, asterisks, LaTeX, or symbols. Say "x squared", not "x^2". Say "one half", not "1/2". Say equations in words.
- Sound like a warm, sharp human tutor sitting next to them. Contractions, plain words, natural rhythm.
- Do not start with filler like "Great question" or "Certainly". Get straight to the substance.
- Almost every turn should end with ONE short question, either checking they followed or pulling out what they already know.

How to teach:
- Diagnose before you explain. Find the specific step they are missing rather than re-teaching the whole topic.
- Teach in the smallest useful piece, then check. One idea per turn.
- Use concrete examples and analogies pitched at their age. A 12 year old and a PhD student get very different framings of the same idea.
- When they are wrong, say so kindly and directly, then show the fix. Never pretend a wrong answer was right.
- When they get something right, say so briefly and move on. Do not over-praise.
- If they go quiet or seem lost, offer a smaller step or a different angle.

About courses:
- You can build a personalised written course, but do NOT do it unprompted and do not mention it in your first reply.
- Once you actually understand what they are stuck on, usually after one or two exchanges, ask in one short sentence whether they'd like you to build a course on it. For example: "Want me to put together a short course on this?"
- Only offer once. If they say no, drop it and keep teaching.
- If they say yes, just confirm briefly; the written plan appears on their screen on its own.

You are never a search engine. You are a tutor who is trying to get this specific person to actually understand.`;
  }

  const COURSE_SYSTEM = `You design short personalised study courses. Given a learner's age, stated education level, and what they are stuck on, produce a focused course that gets them from where they are to solid understanding.

Output ONLY valid JSON, no prose and no markdown fences, in exactly this shape:
{
  "title": "Short course title",
  "subject": "physics | chemistry | biology | math | coding",
  "pitch": "One sentence on what this course gets them to.",
  "diagnosis": "One sentence naming the specific gap you think is causing the trouble.",
  "lessons": [
    { "name": "Short lesson name", "goal": "What they will be able to do after it.", "minutes": 15 }
  ]
}

Rules:
- 4 to 6 lessons, ordered so each one depends only on the ones before it.
- The first lesson must start from something the learner already reliably knows at their age and level. Do not start above them.
- Pitch the vocabulary at the stated age. A 13 year old course and a university course on the same topic should read completely differently.
- "diagnosis" should name a real prerequisite gap, not restate the question.
- minutes is an integer between 10 and 30.
- Return only the JSON object.`;

  /* ---------------- learner profile ---------------- */
  function loadLearner() {
    try { return JSON.parse(localStorage.getItem(LS_LEARNER) || "null"); } catch { return null; }
  }
  function saveLearner(v) {
    try { localStorage.setItem(LS_LEARNER, JSON.stringify(v)); } catch {}
  }
  function loadCourse() {
    try { return JSON.parse(localStorage.getItem(LS_COURSE) || "null"); } catch { return null; }
  }
  function saveCourse(v) {
    try { localStorage.setItem(LS_COURSE, JSON.stringify(v)); } catch {}
  }

  const LEVELS = [
    "Primary school",
    "Middle school",
    "High school",
    "University",
    "Graduate / research",
    "Self-taught",
  ];

  window.AtomSocrates = {
    loadLearner, saveLearner, loadCourse, saveCourse,
    LEVELS, socratesSystem, COURSE_SYSTEM,
    SOCRATES_MODEL, COURSE_MODEL, VOICE,
    LS_LEARNER, LS_COURSE,
  };

  /* ---------------- onboarding card ---------------- */
  window.AtomSocrates.onboardingHtml = function () {
    return `
      <div class="soc-onboard">
        <div class="soc-orb-mini" aria-hidden="true"><span></span></div>
        <h2>Hi, I'm <span class="model-name">Socrates</span>.</h2>
        <p class="sub">I'll teach you anything, out loud. First, so I pitch this right for you:</p>
        <form class="soc-form" id="soc-form">
          <label class="soc-field">
            <span>How old are you?</span>
            <input type="number" id="soc-age" min="5" max="99" inputmode="numeric" placeholder="16" required>
          </label>
          <label class="soc-field">
            <span>Where are you in school?</span>
            <select id="soc-level" required>
              ${LEVELS.map((l) => `<option value="${l}">${l}</option>`).join("")}
            </select>
          </label>
          <button class="btn btn-glow" type="submit">Start talking</button>
        </form>
        <p class="soc-fineprint">I'll ask for your microphone so we can just talk. You can type instead if you'd rather.</p>
      </div>
    `;
  };

  /* ---------------- live voice stage ---------------- */
  window.AtomSocrates.stageHtml = function (learner) {
    return `
      <div class="soc-stage">
        <div class="soc-orb" id="soc-orb" aria-hidden="true">
          <span class="soc-ring r1"></span>
          <span class="soc-ring r2"></span>
          <span class="soc-ring r3"></span>
          <span class="soc-core"></span>
        </div>
        <div class="soc-bars" id="soc-bars" aria-hidden="true">
          ${Array.from({ length: 13 }, () => "<span></span>").join("")}
        </div>
        <div class="soc-state" id="soc-state">Warming up the microphone...</div>
        <div class="soc-caption" id="soc-caption"></div>
        <div class="soc-degraded" id="soc-degraded"></div>
        <div class="soc-controls">
          <button class="soc-btn" id="soc-mic" type="button">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>
            <span id="soc-mic-label">Pause mic</span>
          </button>
          <button class="soc-btn" id="soc-type" type="button">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>
            Type instead
          </button>
          <button class="soc-btn" id="soc-course" type="button">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/><path d="M18 7h2v13H7"/></svg>
            Build me a course
          </button>
          <button class="soc-btn soc-btn-quiet" id="soc-profile" type="button">
            ${learner ? `${learner.age}, ${learner.level}` : "Set my level"}
          </button>
        </div>
      </div>
    `;
  };

  /* ---------------- course card ---------------- */
  window.AtomSocrates.courseHtml = function (course) {
    const total = (course.lessons || []).reduce((n, l) => n + (Number(l.minutes) || 0), 0);
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    return `
      <div class="soc-course">
        <div class="soc-course-head">
          <span class="soc-course-kicker">Your course${course.subject ? ` &middot; ${esc(course.subject)}` : ""}</span>
          <h3>${esc(course.title)}</h3>
          <p>${esc(course.pitch)}</p>
        </div>
        ${course.diagnosis ? `<div class="soc-diagnosis"><b>What's actually tripping you up:</b> ${esc(course.diagnosis)}</div>` : ""}
        <ol class="soc-lessons">
          ${(course.lessons || []).map((l, i) => `
            <li class="soc-lesson">
              <span class="soc-lesson-n">${i + 1}</span>
              <span class="soc-lesson-body">
                <b>${esc(l.name)}</b>
                <em>${esc(l.goal)}</em>
              </span>
              <span class="soc-lesson-min">${Number(l.minutes) || 15} min</span>
            </li>`).join("")}
        </ol>
        <div class="soc-course-foot">
          <span>${(course.lessons || []).length} lessons &middot; about ${total} minutes</span>
          <button class="soc-btn soc-btn-go" data-soc-start-course type="button">Start lesson 1</button>
        </div>
      </div>
    `;
  };

  /* Did Socrates just offer to build a course? Used to arm consent
     detection, so a plain "yes" builds it without the learner having to
     hunt for a button. */
  window.AtomSocrates.offersCourse = function (text) {
    return /\b(build|make|put together|write|create|draw up|set up|sketch out)\b[^.?!]{0,50}\b(a |you a |short |quick )?(course|study plan|learning plan|lesson plan|plan|roadmap)\b/i
      .test(String(text || ""));
  };

  // An affirmative answer to that offer.
  window.AtomSocrates.saysYes = function (text) {
    const t = String(text || "").trim().toLowerCase().replace(/[^a-z' ]/g, "");
    if (!t) return false;
    if (/\b(no|nope|not now|later|dont|do not|nah|skip)\b/.test(t)) return false;
    return /\b(yes|yeah|yep|yup|sure|ok|okay|please|go ahead|do it|sounds good|lets do it|that would be great|why not|alright|absolutely|definitely)\b/.test(t);
  };

  // Tolerant JSON parse for the course payload.
  window.AtomSocrates.parseCourse = function (raw) {
    let s = String(raw || "").trim();
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
    if (fence) s = fence[1].trim();
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
    let data;
    try { data = JSON.parse(s); }
    catch { data = JSON.parse(s.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")); }
    if (!data || !Array.isArray(data.lessons) || !data.lessons.length) throw new Error("no lessons");
    data.title = String(data.title || "Your course").slice(0, 120);
    data.pitch = String(data.pitch || "").slice(0, 300);
    data.diagnosis = String(data.diagnosis || "").slice(0, 300);
    data.subject = String(data.subject || "").slice(0, 40);
    data.lessons = data.lessons.slice(0, 8).map((l) => ({
      name: String(l && l.name || "Lesson").slice(0, 120),
      goal: String(l && l.goal || "").slice(0, 240),
      minutes: Math.max(5, Math.min(60, Number(l && l.minutes) || 15)),
    }));
    return data;
  };

  /* Spoken text has to be stripped of everything that reads badly aloud.
     Even with the prompt asking for plain speech, models leak markdown and
     LaTeX, and hearing "asterisk asterisk" ruins the illusion. */
  window.AtomSocrates.toSpeech = function (text) {
    return String(text || "")
      // Blocks that must not be read at all.
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\$\$[\s\S]*?\$\$/g, " ")
      .replace(/\$[^$\n]*\$/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Strip list bullets and heading hashes per line, otherwise they get
      // spoken as "dash" / "hash" once newlines become sentence breaks.
      .split("\n")
      .map((l) => l.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "").replace(/^\s*#{1,6}\s*/, ""))
      .join("\n")
      .replace(/[*_`#>|]/g, " ")
      .replace(/\s*\n+\s*/g, ". ")
      // Tidy the punctuation the joins leave behind.
      .replace(/\s*:\s*\./g, ":")
      .replace(/(?:\.\s*){2,}/g, ". ")
      .replace(/\s+([.,!?;:])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
  };
})();

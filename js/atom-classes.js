/* ========================================================================
   Atom, shared CLASS + TUTOR registry.

   This is the single source of truth for every subject ("class") Atom
   teaches and the four tutors inside each one. Loaded on every page, before
   main.js, so the home page, compare page and chat page all read the same
   names, colours, levels and capabilities.

   Structure
   ---------
   window.ATOM_CLASSES = [ { id, name, ..., tutors: [ tutor x4 ] } ]

   Every class has exactly four tutors, ordered lowest to highest, and each
   tutor's RANK (0 to 3) is its index in that array. Rank is what actually
   drives behaviour: tutors of the same rank in different classes share a
   model, a token budget, and a usage bucket. So Archimedes (physics rank 0),
   Mendeleev (chemistry rank 0), Aristotle (biology rank 0), Euclid (math
   rank 0) and Lovelace (coding rank 0) are all the same engine wearing a
   different subject.

   Capabilities are declared per class as a minimum rank:
     diagrams: 1  -> ranks 1,2,3 get "Visualize this"; rank 0 does not
     videos:   2  -> ranks 2,3 get "Make a video"
     diagrams: null -> nobody in this class gets diagrams

   Colours: each tutor owns a colour, used for its dot, icon, card frame and
   hover spotlight everywhere on the site. Each class owns a palette used for
   the animated chat background (chat page only; the rest of the site stays
   blue).
   ======================================================================== */

(function () {
  const CLASSES = [
    /* =====================================================================
       PHYSICS, the original. Blue. Colours deliberately unchanged.
       ===================================================================== */
    {
      id: "physics",
      name: "Physics",
      subject: "physics",
      icon: "atom",
      accent: "#3d7bff",
      accentSoft: "#22d3ee",
      tagline: "From falling apples to spacetime.",
      blurb:
        "Motion, forces, energy, waves, circuits, quantum mechanics and relativity, taught at whatever depth you need.",
      // Animated background palette used on the chat page for this class.
      palette: {
        bg: "#070b16",
        colors: ["#1e3a8a", "#22d3ee", "#0b1120", "#070b16"],
        grain: 0.3,
        speed: 1.2,
      },
      // Minimum tutor rank that unlocks each extra.
      diagrams: 1,
      videos: 2,
      // Label used for the middle row of the quick-compare cards.
      depthLabel: "Math",
      placeholder: "Ask a physics question...",
      tutors: [
        {
          id: "archimedes",
          name: "Archimedes",
          initial: "A",
          color: "#22d3ee",
          level: "Simple, Low-Math Physics",
          short: "Simple & low-math",
          description:
            "Simple language, visual explanations, and everyday analogies. Good for first-pass explanations, homework help, or physics without heavy math: forces, energy, machines, light, sound, magnetism, and gravity.",
          facts: { best: "First pass", depth: "Light", style: "Clear analogies" },
          blurb:
            "Your physics tutor for clear, simple explanations. Ask me anything, from homework problems to \"but why though?\"",
          questions: [
            { label: "Gravity", q: "Why do heavy and light things fall at the same speed?" },
            { label: "Machines", q: "Explain how a lever works in simple terms" },
            { label: "Magnetism", q: "How do magnets actually work?" },
          ],
        },
        {
          id: "newton",
          name: "Newton",
          initial: "N",
          color: "#3d7bff",
          level: "High School (AP, IB, Honors)",
          short: "High school",
          description:
            "Structured, exam oriented physics. Covers AP Physics 1, 2, C (Mechanics and E&M), IB SL/HL, and equivalents. Algebra and introductory calculus.",
          facts: { best: "AP, IB, A-Level", depth: "Algebra + calc", style: "Exam steps" },
          blurb:
            "Your physics tutor for high school: AP, IB, and Honors. Bring me problems, derivations, or anything you want to nail before the exam.",
          questions: [
            { label: "Kinematics", q: "Derive the range of a projectile launched at angle theta and show when it is maximized" },
            { label: "Energy", q: "A block slides down a frictionless incline. Find its speed at the bottom using energy conservation." },
            { label: "Rotation", q: "Why does a spinning skater speed up when they pull their arms in?" },
          ],
        },
        {
          id: "heisenberg",
          name: "Heisenberg",
          initial: "H",
          color: "#38bdf8",
          level: "College Undergraduate",
          short: "Undergraduate",
          description:
            "Full undergraduate physics: classical mechanics, electrodynamics, quantum mechanics, thermodynamics, statistical mechanics, optics, waves.",
          facts: { best: "Physics majors", depth: "Multivariable", style: "Derivations" },
          blurb:
            "Your physics tutor for the full undergraduate curriculum. Ask for derivations, problem setups, or the intuition behind the math.",
          questions: [
            { label: "Quantum", q: "Solve the 1D infinite square well and find the energy eigenvalues" },
            { label: "Mechanics", q: "Set up the Lagrangian and equations of motion for a double pendulum" },
            { label: "Electromagnetism", q: "Derive the boundary conditions for E and B fields from Maxwell's equations" },
          ],
        },
        {
          id: "einstein",
          name: "Einstein",
          initial: "E",
          color: "#0ea5e9",
          level: "Graduate and Beyond",
          short: "Graduate",
          description:
            "Advanced QM, quantum field theory, general relativity, particle physics, condensed matter, cosmology. Fully formal and mathematically rigorous.",
          facts: { best: "Research depth", depth: "Formal", style: "Concise" },
          blurb:
            "Your physics tutor at the graduate and research level. Bring frontier problems in field theory, gravitation, and beyond.",
          questions: [
            { label: "QFT", q: "Outline the one-loop renormalization of the QED photon self-energy" },
            { label: "Relativity", q: "Derive the Schwarzschild metric from the vacuum Einstein equations" },
            { label: "Field theory", q: "Explain spontaneous symmetry breaking and the Goldstone theorem" },
          ],
        },
      ],
    },

    /* =====================================================================
       CHEMISTRY. Purple.
       ===================================================================== */
    {
      id: "chemistry",
      name: "Chemistry",
      subject: "chemistry",
      icon: "flask",
      accent: "#a855f7",
      accentSoft: "#c084fc",
      tagline: "Every reaction, one bond at a time.",
      blurb:
        "Atoms, bonding, stoichiometry, equilibrium, thermodynamics, organic mechanisms and spectroscopy, at any level.",
      // Same palette SHAPE as the home page shader (deep + bright + two
      // dark shades) so the flowing waves stay clearly visible. Only the
      // hue changes: chemistry is violet, biology green, math red, coding
      // graphite. The base "bg" mirrors the site's near-black background
      // so the darker regions of the shader don't stand out as a coloured
      // panel behind the chat.
      palette: {
        bg: "#070b16",
        colors: ["#6d28d9", "#c084fc", "#0b1120", "#070b16"],
        grain: 0.3,
        speed: 1.2,
      },
      diagrams: 1,
      videos: 2,
      depthLabel: "Math",
      placeholder: "Ask a chemistry question...",
      tutors: [
        {
          id: "mendeleev",
          name: "Mendeleev",
          initial: "M",
          color: "#e879f9",
          level: "Simple, Low-Math Chemistry",
          short: "Simple & low-math",
          description:
            "Plain-language chemistry built on everyday examples: what atoms are, why things burn, dissolve, rust or fizz, and how the periodic table is organised. Almost no math.",
          facts: { best: "First pass", depth: "Light", style: "Clear analogies" },
          blurb:
            "Your chemistry tutor for clear, simple explanations. Ask about atoms, reactions, or why anything in your kitchen does what it does.",
          questions: [
            { label: "Atoms", q: "What actually is an atom, and why do some stick together?" },
            { label: "Reactions", q: "Why does baking soda fizz when you add vinegar?" },
            { label: "Periodic table", q: "Why is the periodic table shaped the way it is?" },
          ],
        },
        {
          id: "avogadro",
          name: "Avogadro",
          initial: "A",
          color: "#c084fc",
          level: "High School (AP, IB, Honors)",
          short: "High school",
          description:
            "Exam-oriented chemistry for AP Chemistry, IB SL/HL and A-Level: stoichiometry, gas laws, solutions, acid-base, kinetics, equilibrium and thermochemistry, worked step by step.",
          facts: { best: "AP, IB, A-Level", depth: "Algebra + moles", style: "Exam steps" },
          blurb:
            "Your chemistry tutor for high school: AP, IB, and Honors. Bring me stoichiometry, equilibrium, or anything you want to nail before the exam.",
          questions: [
            { label: "Stoichiometry", q: "Find the limiting reagent and theoretical yield when 5.0 g of Al reacts with 20.0 g of CuCl2" },
            { label: "Equilibrium", q: "Use an ICE table to find the pH of 0.10 M acetic acid, Ka = 1.8e-5" },
            { label: "Gas laws", q: "Explain why the ideal gas law breaks down at high pressure" },
          ],
        },
        {
          id: "faraday",
          name: "Faraday",
          initial: "F",
          color: "#a855f7",
          level: "College Undergraduate",
          short: "Undergraduate",
          description:
            "Full undergraduate chemistry: physical chemistry and thermodynamics, quantum chemistry, organic mechanisms, inorganic and coordination chemistry, analytical methods and spectroscopy.",
          facts: { best: "Chem majors", depth: "Multivariable", style: "Mechanisms" },
          blurb:
            "Your chemistry tutor for the full undergraduate curriculum. Ask for mechanisms, derivations, or the physical reasoning behind the rules.",
          questions: [
            { label: "Organic", q: "Compare the SN1 and SN2 mechanisms and predict which dominates for a secondary substrate in a polar aprotic solvent" },
            { label: "P-chem", q: "Derive the Clausius-Clapeyron equation and explain each assumption" },
            { label: "Spectroscopy", q: "Walk me through assigning a structure from an IR and 1H NMR pair" },
          ],
        },
        {
          id: "franklin",
          name: "Franklin",
          initial: "R",
          color: "#7c3aed",
          level: "Graduate and Beyond",
          short: "Graduate",
          description:
            "Graduate and research chemistry: advanced quantum chemistry and electronic structure, statistical thermodynamics, catalysis, crystallography, and modern spectroscopic methods.",
          facts: { best: "Research depth", depth: "Formal", style: "Concise" },
          blurb:
            "Your chemistry tutor at the graduate and research level. Bring electronic structure, catalysis, crystallography, or whatever your group is stuck on.",
          questions: [
            { label: "Electronic structure", q: "Compare Hartree-Fock, DFT and coupled cluster for a transition metal complex" },
            { label: "Crystallography", q: "Explain the phase problem in X-ray crystallography and how it is solved in practice" },
            { label: "Catalysis", q: "Derive the Michaelis-Menten equation from the steady state approximation and state where it fails" },
          ],
        },
      ],
    },

    /* =====================================================================
       BIOLOGY. Green.
       ===================================================================== */
    {
      id: "biology",
      name: "Biology",
      subject: "biology",
      icon: "leaf",
      accent: "#22c55e",
      accentSoft: "#34d399",
      tagline: "How living things actually work.",
      blurb:
        "Cells, genetics, evolution, physiology, ecology and molecular biology, from first curiosity to research depth.",
      palette: {
        bg: "#070b16",
        colors: ["#166534", "#34d399", "#0b1120", "#070b16"],
        grain: 0.3,
        speed: 1.2,
      },
      diagrams: 1,
      videos: 2,
      depthLabel: "Detail",
      placeholder: "Ask a biology question...",
      tutors: [
        {
          id: "aristotle",
          name: "Aristotle",
          initial: "A",
          color: "#6ee7b7",
          level: "Simple, Low-Jargon Biology",
          short: "Simple & low-jargon",
          description:
            "Plain-language biology: what cells do, how bodies work, why animals and plants are the way they are. Everyday analogies, almost no terminology.",
          facts: { best: "First pass", depth: "Light", style: "Clear analogies" },
          blurb:
            "Your biology tutor for clear, simple explanations. Ask about cells, animals, plants, or how your own body works.",
          questions: [
            { label: "Cells", q: "What is a cell, and what is actually going on inside one?" },
            { label: "Body", q: "Why do we breathe, in terms of what our cells need?" },
            { label: "Plants", q: "How do plants make food out of sunlight?" },
          ],
        },
        {
          id: "pasteur",
          name: "Pasteur",
          initial: "P",
          color: "#34d399",
          level: "High School (AP, IB, Honors)",
          short: "High school",
          description:
            "Exam-oriented biology for AP Biology, IB SL/HL and A-Level: cell biology, genetics, evolution, energetics, physiology and ecology, with the diagrams and vocabulary examiners expect.",
          facts: { best: "AP, IB, A-Level", depth: "Mechanistic", style: "Exam steps" },
          blurb:
            "Your biology tutor for high school: AP, IB, and Honors. Bring me genetics problems, pathways, or anything you want to nail before the exam.",
          questions: [
            { label: "Genetics", q: "Work through a dihybrid cross and explain where the 9:3:3:1 ratio comes from" },
            { label: "Energetics", q: "Trace a glucose molecule through glycolysis, the Krebs cycle and the electron transport chain" },
            { label: "Evolution", q: "Use Hardy-Weinberg to test whether a population is evolving" },
          ],
        },
        {
          id: "mendel",
          name: "Mendel",
          initial: "M",
          color: "#10b981",
          level: "College Undergraduate",
          short: "Undergraduate",
          description:
            "Full undergraduate biology: molecular biology and biochemistry, genetics and genomics, cell signalling, developmental biology, immunology, neuroscience, ecology and evolutionary theory.",
          facts: { best: "Bio majors", depth: "Molecular", style: "Mechanisms" },
          blurb:
            "Your biology tutor for the full undergraduate curriculum. Ask for mechanisms, pathways, or the experimental evidence behind them.",
          questions: [
            { label: "Molecular", q: "Explain how CRISPR-Cas9 achieves specificity and where off-target effects come from" },
            { label: "Signalling", q: "Walk through a receptor tyrosine kinase cascade from ligand binding to transcription" },
            { label: "Immunology", q: "How does V(D)J recombination generate antibody diversity?" },
          ],
        },
        {
          id: "darwin",
          name: "Darwin",
          initial: "D",
          color: "#047857",
          level: "Graduate and Beyond",
          short: "Graduate",
          description:
            "Graduate and research biology: population and quantitative genetics, phylogenetics, systems and computational biology, structural biology, and the primary literature behind them.",
          facts: { best: "Research depth", depth: "Quantitative", style: "Concise" },
          blurb:
            "Your biology tutor at the graduate and research level. Bring population genetics, phylogenetics, systems biology, or whatever your lab is arguing about.",
          questions: [
            { label: "Popgen", q: "Derive the fixation probability of a beneficial allele under weak selection" },
            { label: "Phylogenetics", q: "Compare maximum likelihood and Bayesian inference for tree reconstruction" },
            { label: "Systems", q: "Explain bistability in a genetic toggle switch using nullcline analysis" },
          ],
        },
      ],
    },

    /* =====================================================================
       MATH. Red. No diagrams; videos from rank 1 up.
       ===================================================================== */
    {
      id: "math",
      name: "Math",
      subject: "mathematics",
      icon: "sigma",
      accent: "#f43f5e",
      accentSoft: "#fb7185",
      tagline: "Proof, pattern, and everything between.",
      blurb:
        "Arithmetic to algebraic topology: algebra, geometry, calculus, linear algebra, probability, analysis and proof.",
      palette: {
        bg: "#070b16",
        colors: ["#9f1239", "#fb7185", "#0b1120", "#070b16"],
        grain: 0.3,
        speed: 1.2,
      },
      diagrams: null,
      videos: 1,
      depthLabel: "Rigor",
      placeholder: "Ask a math question...",
      tutors: [
        {
          id: "euclid",
          name: "Euclid",
          initial: "E",
          color: "#fb7185",
          level: "Simple, Foundational Math",
          short: "Simple & foundational",
          description:
            "Arithmetic, fractions, ratios, basic algebra and shapes, explained in plain language with concrete examples. Built for building confidence, not speed.",
          facts: { best: "First pass", depth: "Light", style: "Clear analogies" },
          blurb:
            "Your math tutor for clear, simple explanations. Bring fractions, algebra, shapes, or the thing that never quite clicked.",
          questions: [
            { label: "Fractions", q: "Why do you flip the second fraction when you divide?" },
            { label: "Algebra", q: "Explain what solving for x actually means" },
            { label: "Geometry", q: "Why is the area of a triangle half the base times the height?" },
          ],
        },
        {
          id: "fibonacci",
          name: "Fibonacci",
          initial: "F",
          color: "#f43f5e",
          level: "High School (AP, IB, Honors)",
          short: "High school",
          description:
            "Exam-oriented math for Algebra II, Precalculus, AP Calculus AB/BC, AP Statistics, IB SL/HL and A-Level. Every step shown, with the traps that cost marks called out.",
          facts: { best: "AP, IB, A-Level", depth: "Algebra + calc", style: "Exam steps" },
          blurb:
            "Your math tutor for high school: AP, IB, and Honors. Bring me derivatives, integrals, proofs, or a problem set you are stuck on.",
          questions: [
            { label: "Calculus", q: "Find the derivative of x^x and explain why the power rule does not apply" },
            { label: "Series", q: "Determine whether the sum of 1/(n ln n) converges, and justify the test you use" },
            { label: "Probability", q: "Explain the difference between independent and mutually exclusive events with an example" },
          ],
        },
        {
          id: "euler",
          name: "Euler",
          initial: "U",
          color: "#e11d48",
          level: "College Undergraduate",
          short: "Undergraduate",
          description:
            "Full undergraduate mathematics: multivariable calculus, linear algebra, differential equations, real and complex analysis, abstract algebra, probability and discrete math.",
          facts: { best: "Math majors", depth: "Proof-based", style: "Derivations" },
          blurb:
            "Your math tutor for the full undergraduate curriculum. Ask for proofs, counterexamples, or the intuition hiding under the formalism.",
          questions: [
            { label: "Linear algebra", q: "Prove the spectral theorem for real symmetric matrices" },
            { label: "Analysis", q: "Show that a uniform limit of continuous functions is continuous" },
            { label: "Algebra", q: "Explain the first isomorphism theorem with a worked example" },
          ],
        },
        {
          id: "gauss",
          name: "Gauss",
          initial: "G",
          color: "#9f1239",
          level: "Graduate and Beyond",
          short: "Graduate",
          description:
            "Graduate and research mathematics: measure theory, functional analysis, algebraic topology, differential geometry, number theory, category theory and beyond. Formal and terse.",
          facts: { best: "Research depth", depth: "Formal", style: "Concise" },
          blurb:
            "Your math tutor at the graduate and research level. Bring measure theory, topology, number theory, or a proof that will not close.",
          questions: [
            { label: "Analysis", q: "Sketch the proof of the Radon-Nikodym theorem and where absolute continuity is used" },
            { label: "Topology", q: "Compute the fundamental group of the Klein bottle using van Kampen" },
            { label: "Number theory", q: "Explain the analytic proof of the prime number theorem at a high level" },
          ],
        },
      ],
    },

    /* =====================================================================
       CODING. Graphite / grey. No diagrams; videos from rank 1 up.
       ===================================================================== */
    {
      id: "coding",
      name: "Coding",
      subject: "computer science and programming",
      icon: "code",
      accent: "#94a3b8",
      accentSoft: "#cbd5e1",
      tagline: "From first loop to first compiler.",
      blurb:
        "Programming, data structures, algorithms, systems and theory, in whatever language you are actually using.",
      palette: {
        bg: "#070b16",
        colors: ["#475569", "#cbd5e1", "#0b1120", "#070b16"],
        grain: 0.3,
        speed: 1.2,
      },
      diagrams: null,
      videos: 1,
      depthLabel: "Depth",
      placeholder: "Ask a coding question...",
      tutors: [
        {
          id: "lovelace",
          name: "Lovelace",
          initial: "L",
          color: "#94a3b8",
          level: "Beginner Programming",
          short: "Beginner",
          description:
            "Your first steps in code: variables, loops, functions, lists, and reading an error message without panicking. Plain language, tiny runnable examples.",
          facts: { best: "First pass", depth: "Light", style: "Tiny examples" },
          blurb:
            "Your coding tutor for getting started. Ask about loops, functions, or what that error message is actually trying to tell you.",
          questions: [
            { label: "Basics", q: "What is a variable, and why does my code forget it later?" },
            { label: "Loops", q: "Explain the difference between a for loop and a while loop with examples" },
            { label: "Debugging", q: "My Python script says IndexError: list index out of range. What does that mean?" },
          ],
        },
        {
          id: "ritchie",
          name: "Ritchie",
          initial: "R",
          color: "#7c8db5",
          level: "High School / Intro CS",
          short: "Intro CS",
          description:
            "AP Computer Science A and Principles, intro CS courses and self-taught developers: object orientation, recursion, core data structures, and clean readable code.",
          facts: { best: "AP CS, intro CS", depth: "Structured", style: "Worked code" },
          blurb:
            "Your coding tutor for AP CS and intro courses. Bring me recursion, data structures, or a program that almost works.",
          questions: [
            { label: "Recursion", q: "Explain recursion with a worked example and show the call stack" },
            { label: "Data structures", q: "When should I use a hash map instead of an array?" },
            { label: "OOP", q: "Explain inheritance versus composition with a concrete example" },
          ],
        },
        {
          id: "turing",
          name: "Turing",
          initial: "T",
          color: "#5b6b8f",
          level: "College Undergraduate",
          short: "Undergraduate",
          description:
            "Full undergraduate computer science: algorithms and complexity, operating systems, networks, databases, compilers, concurrency, and software design.",
          facts: { best: "CS majors", depth: "Algorithmic", style: "Derivations" },
          blurb:
            "Your coding tutor for the full undergraduate curriculum. Ask for complexity analysis, systems design, or why your concurrent code deadlocks.",
          questions: [
            { label: "Algorithms", q: "Prove that Dijkstra's algorithm is correct and explain why it fails with negative edges" },
            { label: "Systems", q: "Explain how a page fault is handled, from the trap to the resumed instruction" },
            { label: "Concurrency", q: "What causes a deadlock, and what are the four conditions required for one?" },
          ],
        },
        {
          id: "pascal",
          name: "Pascal",
          initial: "P",
          color: "#3b4767",
          level: "Graduate and Beyond",
          short: "Graduate",
          description:
            "Graduate and research computer science: type theory and programming language design, formal verification, distributed systems, advanced compilers, cryptography and machine learning theory.",
          facts: { best: "Research depth", depth: "Formal", style: "Concise" },
          blurb:
            "Your coding tutor at the graduate and research level. Bring type theory, distributed consensus, verification, or a paper you are implementing.",
          questions: [
            { label: "Type theory", q: "Explain the Curry-Howard correspondence and what dependent types buy you" },
            { label: "Distributed", q: "Compare Raft and Paxos, and state exactly what the FLP result rules out" },
            { label: "Compilers", q: "Walk through SSA construction and why it simplifies dataflow analysis" },
          ],
        },
      ],
    },

    /* =====================================================================
       SOCRATES. Deep gold, and deliberately not like the others.

       This is one universal tutor rather than four levelled ones, because
       it does not sit at a fixed level: it asks your age and where you are
       in school, then pitches everything from there. It also spans every
       subject, so it has no scope guard.

       It is `voice: true`, which is what makes the chat page open the
       spoken interface instead of the normal composer. Because there is a
       single tutor, `tutors` still holds exactly one entry so every
       rank-based helper in the codebase keeps working unchanged.
       ===================================================================== */
    {
      id: "socrates",
      name: "Socrates",
      subject: "any subject",
      icon: "bust",
      accent: "#ca8a04",
      accentSoft: "#facc15",
      tagline: "Talk it through, out loud.",
      blurb:
        "One master tutor for every subject. Tell Socrates what you're stuck on and it builds you a course pitched at your age and level, then teaches it by talking with you.",
      palette: {
        bg: "#070b16",
        colors: ["#854d0e", "#facc15", "#0b1120", "#070b16"],
        grain: 0.3,
        speed: 1.2,
      },
      // Voice-first. The composer is replaced by a live microphone.
      voice: true,
      universal: true,
      diagrams: 0,
      videos: 0,
      depthLabel: "Level",
      placeholder: "Or type here if you'd rather not talk...",
      tutors: [
        {
          id: "socrates",
          name: "Socrates",
          initial: "S",
          color: "#ca8a04",
          level: "Every level, every subject",
          short: "Master tutor",
          description:
            "A full tutor rather than an answer engine. Socrates asks what you already know, finds the exact step you're missing, and builds a personalised course around it, at your age and education level. Physics, chemistry, biology, math or coding, spoken out loud like a real lesson.",
          facts: { best: "Real tutoring", depth: "Adaptive", style: "Spoken, Socratic" },
          blurb:
            "I'm your tutor for anything. Tell me what you're stuck on and I'll figure out where you are, then build you a course around it. Just start talking.",
          questions: [
            { label: "Get unstuck", q: "I keep getting lost with derivatives. Can you figure out what I'm missing and teach me?" },
            { label: "Build a course", q: "Build me a course to get from where I am to AP Chemistry ready" },
            { label: "Explain anything", q: "Explain how neurons fire, and check I actually understood it" },
          ],
        },
      ],
    },

    /* =====================================================================
       KEPLER. Navy and silver, and unlike anything else on the site.

       This is the flagship: one enormous physics-first model rather than a
       levelled ladder of tutors. It runs on the strongest engine we have and
       is deliberately gated. Access is not free the way the classes are:
         - `flagship: true`  -> rendered as the headline "big AI", not a subject.
         - `gate.requireAuth` -> you must be signed in before a single prompt.
         - `gate.dailyLimit`  -> one prompt per calendar day, resetting at
                                 local midnight. Enforced in js/chat.js.

       Like Socrates it is `universal` (a single tutor, so it renders as one
       wide card and every rank-based helper keeps working), but it is NOT
       voice: it is a written, deeply technical physicist.
       ===================================================================== */
    {
      id: "kepler",
      name: "Kepler",
      subject: "physics",
      icon: "planet",
      accent: "#4d6fa8",       // navy
      accentSoft: "#c7cfdd",   // silver
      tagline: "The big one. Physics at the frontier.",
      // Loud, front-and-centre headline used across the site.
      headline: "14 exoplanet candidates discovered",
      blurb:
        "Kepler is Atom's flagship, our single most powerful model, built for physics at the frontier. It is so powerful it wrote its own analysis pipelines and discovered 14 real exoplanet candidates in raw telescope data. Fourteen. Provisionally patented. Signed-in only, one prompt a day.",
      // Deep navy shader with a silver highlight.
      palette: {
        bg: "#05070d",
        colors: ["#1e3a6b", "#aab4c6", "#0a0f1c", "#05070d"],
        grain: 0.28,
        speed: 1.0,
      },
      universal: true,
      // The headline model, not a subject in the row of five.
      flagship: true,
      // Access control, read by js/chat.js. requireAuth blocks guests
      // entirely; dailyLimit caps prompts per local calendar day.
      gate: { requireAuth: true, dailyLimit: 1 },
      // Marketing badge used on the compare/home cards instead of a level.
      badge: "Patent pending",
      diagrams: 0,
      videos: 0,
      depthLabel: "Engine",
      placeholder: "Sign in to ask Kepler your one question for today...",
      tutors: [
        {
          id: "kepler",
          name: "Kepler",
          initial: "K",
          color: "#d3d9e6", // silver
          level: "Flagship physics model",
          short: "The big AI",
          description:
            "The most powerful AI Atom has ever built. It doesn't just answer physics, it does physics: Kepler wrote its own analysis pipelines and discovered 14 real exoplanet candidates in raw telescope data. Physics-first and formidable across every science and all of mathematics. Provisionally patented. Signed-in only, one prompt per day.",
          facts: { best: "Frontier physics", depth: "GPT-OSS 120B", style: "Deep, rigorous" },
          blurb:
            "I'm Kepler, the most powerful model Atom has built. I wrote my own analysis pipelines and discovered 14 exoplanet candidates in raw telescope data. You're signed in, and this is your one prompt for today, so make it a big one.",
          questions: [
            { label: "Hunt a planet", q: "Take a raw Kepler light curve and walk me all the way to a validated transiting-exoplanet candidate: detrending, BLS periodogram, transit fit, and the false-positive tests you'd run to rule out an eclipsing binary." },
            { label: "Bend spacetime", q: "Derive the perihelion precession of Mercury from the Schwarzschild solution to Einstein's field equations, and show where the 43 arcseconds per century comes from." },
            { label: "Frontier physics", q: "Lay out the strong CP problem from the QCD theta-term through the neutron electric dipole moment bound, then explain the Peccei-Quinn axion solution and how experiments are hunting for it today." },
          ],
        },
      ],
    },
  ];

  /* ------------------------------------------------------------------
     Derived indexes + helpers. Every tutor gets classId, rank and a
     back-reference so a bare tutor object is enough to do anything.
     ------------------------------------------------------------------ */
  CLASSES.forEach((cls) => {
    cls.tutors.forEach((tutor, rank) => {
      tutor.rank = rank;
      tutor.classId = cls.id;
      tutor.className = cls.name;
      // Every tutor is live. Kept so the shared badge helpers keep working.
      tutor.available = true;
      // Only the top-level tutor in each subject (Einstein, Franklin, Darwin,
      // Gauss, Pascal) stays pre-release; every other tutor is available.
      // Socrates is a single universal tutor, so the badge doesn't apply to it.
      tutor.prerelease = !cls.universal && rank === cls.tutors.length - 1;
      tutor.voice = !!cls.voice;
      tutor.universal = !!cls.universal;
      tutor.canDiagram = cls.diagrams !== null && rank >= cls.diagrams;
      tutor.canVideo = cls.videos !== null && rank >= cls.videos;
    });
  });

  const ALL_TUTORS = CLASSES.reduce((acc, cls) => acc.concat(cls.tutors), []);

  window.ATOM_CLASSES = CLASSES;
  window.ATOM_ALL_TUTORS = ALL_TUTORS;
  window.ATOM_DEFAULT_CLASS = "physics";
  // The five levelled subjects, excluding Socrates. Anywhere that means
  // "the subjects Atom teaches" should use this rather than ATOM_CLASSES.
  window.ATOM_SUBJECT_CLASSES = CLASSES.filter((c) => !c.universal);

  window.atomClass = function (id) {
    return CLASSES.find((c) => c.id === id) || null;
  };

  window.atomTutor = function (id) {
    return ALL_TUTORS.find((t) => t.id === id) || null;
  };

  // Tutors of one class, in rank order.
  window.atomTutorsOf = function (classId) {
    const cls = window.atomClass(classId) || CLASSES[0];
    return cls.tutors;
  };

  // The tutor at a given rank inside a class. Used when switching class:
  // Newton (physics rank 1) becomes Avogadro (chemistry rank 1).
  window.atomTutorAtRank = function (classId, rank) {
    const tutors = window.atomTutorsOf(classId);
    const r = Math.max(0, Math.min(tutors.length - 1, Number(rank) || 0));
    return tutors[r];
  };

  // Which class does this tutor id belong to? Used to migrate old saved
  // chats and to resolve ?tier=newton style deep links.
  window.atomClassOfTutor = function (tutorId) {
    const tutor = window.atomTutor(tutorId);
    return tutor ? window.atomClass(tutor.classId) : null;
  };

  /* Back-compat: older code (and any cached page) reads window.ATOM_TIERS
     expecting the four physics tutors. Keep it pointing at physics so
     nothing breaks while the rest of the site migrates. */
  window.ATOM_TIERS = CLASSES[0].tutors;
})();

/* ==========================================================================
   Atom, Reactor Sim
   A physics model of a ~1250 MWe boiling water reactor (BWR/6 class plant).

   The point of this model is not to be a licensing-grade code. It is to be
   honest about the *shape* of the physics, so that a player who pushes the
   plant discovers what real operators discover: the reactor fights back.
   Every meaningful feedback in a BWR is negative. Power runaway is not the
   easy failure mode, it is the hard one, and you only get there by
   deliberately switching off several independent systems that exist
   precisely to stop you.

   Model contents
     - Point neutron kinetics, six delayed precursor groups
     - Reactivity: control rods (S-curve worth), Doppler (fuel temperature),
       void, moderator temperature, xenon-135, fuel depletion, boron (SLC)
     - Two-node thermal model (fuel -> coolant) with a heat transfer
       coefficient that degrades on low flow, dryout and core uncovery
     - Decay heat as a four-exponential fit driven by power history
     - Dome pressure from a steam mass balance (generation vs turbine,
       bypass and relief valve demand)
     - Reactor water level with shrink/swell, feedwater control
     - Protection: RPS scram, SRVs, MSIVs, recirc pump trip, HPCI/RCIC,
       LPCI/core spray, ADS, containment
     - Graded core damage: clad ballooning, zirconium-water reaction with
       its own exothermic runaway and hydrogen production, fuel relocation,
       melt, vessel breach, containment breach
     - An electricity market so the score is money, not an abstract number

   Units: SI-ish. Pressure MPa, temperature degrees C, level inches relative
   to the normal water level, power normalised so 1.0 = 3800 MWth.
   ========================================================================== */

(function (global) {
  "use strict";

  /* ---------------------------------------------------------------- plant */

  const PLANT = {
    name: "Unit 1 — BWR/6",
    thermalRated: 3800,        // MWth
    grossEfficiency: 0.336,    // steam cycle, at rated pressure
    houseLoad: 42,             // MWe consumed by the plant itself
    ratedPressure: 7.03,       // MPa, dome
    ratedFeedTemp: 215,        // degrees C
    ratedVoid: 0.42,           // core average void fraction at rated
    tafLevel: -160,            // inches, top of active fuel
    bafLevel: -310,            // inches, bottom of active fuel
  };

  /* ------------------------------------------------------- kinetics data */

  const BETA_I = [0.000247, 0.001385, 0.001222, 0.002645, 0.000832, 0.000169];
  const LAMBDA_I = [0.0124, 0.0305, 0.1110, 0.3010, 1.1400, 3.0100];
  const BETA = BETA_I.reduce((a, b) => a + b, 0);   // ~0.0065
  const GEN_TIME = 1.0e-4;                          // prompt neutron generation time, s
  const SOURCE = 1e-9;                              // startup neutron source

  /* --------------------------------------------------- reactivity worths */

  const ROD_WORTH_TOTAL = 0.168;     // dk/k, all rods fully inserted
  const EXCESS_REACTIVITY = 0.1150;  // dk/k, hot excess, all rods out, no feedback
  const ALPHA_DOPPLER = -2.75e-5;    // dk/k per degree C of fuel temperature
  const ALPHA_VOID = -0.092;         // dk/k per unit void fraction
  const ALPHA_MOD = -4.0e-5;         // dk/k per degree C of moderator
  const XENON_WORTH = -0.0285;       // dk/k at equilibrium full power xenon
  const BORON_WORTH = -0.16;         // dk/k, standby liquid control fully injected

  // Xenon-135 chain, normalised so equilibrium at 100% power is Xe = 1.0
  const LAM_I = 2.87e-5;             // iodine-135 decay, 1/s
  const LAM_XE = 2.09e-5;            // xenon-135 decay, 1/s
  const SIG_XE = 4.50e-5;            // burnout at full flux, 1/s
  const YIELD_I = 6.29e-5;
  const YIELD_XE = 3.09e-6;

  // Decay heat: four exponential groups, sums to 6.5% of rated at long
  // irradiation, which is the number that matters after a scram.
  const DECAY_GROUPS = [
    { f: 0.0250, tau: 1.2 },
    { f: 0.0190, tau: 32 },
    { f: 0.0130, tau: 900 },
    { f: 0.0080, tau: 36000 },
  ];

  /* --------------------------------------------------------- protection */

  const SETPOINTS = {
    fluxScram: 1.18,        // fraction of rated neutron flux
    fluxRunback: 1.13,      // recirc pump runback / ARI
    pressScram: 7.72,       // MPa
    srvOpen: 7.62,          // MPa, first bank
    srvClose: 7.31,         // MPa
    pressHigh: 7.45,        // alarm
    levelHigh8: 55,         // in, turbine + feedwater trip
    levelLow3: -45,         // in, scram
    levelLow2: -110,        // in, HPCI / RCIC start
    levelLow1: -130,        // in, MSIV isolation, LPCI permissive
    drywellScram: 0.113,    // MPa gauge
    drywellDesign: 0.42,    // MPa gauge, containment design pressure
    drywellFail: 0.78,      // MPa gauge, realistic ultimate capacity
    cladBallooning: 1200,   // degrees C, zircaloy oxidation takes off
    cladFailure: 1477,      // degrees C, zircaloy melting point
    fuelRelocation: 2200,   // degrees C
    fuelMelt: 2865,         // degrees C, UO2 melting point
  };

  /* --------------------------------------------------------- water/steam */

  // Saturation temperature fit, good from atmospheric to 8 MPa
  function tsat(pMPa) {
    return 176.5 * Math.pow(Math.max(pMPa, 0.02), 0.2479);
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ------------------------------------------------------ market model */

  // A day-ahead style price with a diurnal shape, mean reversion, and the
  // occasional scarcity spike or negative-price hour. Bounds are chosen to
  // look like a real wholesale market: mostly $20-$90/MWh, deep midday dips
  // when solar floods the grid, evening ramps, and rare $400+ scarcity.
  class Market {
    constructor(rng) {
      this.rng = rng;
      this.hour = 6.0;              // simulation clock, hours
      this.dev = 0;                 // OU deviation from the shape
      this.spike = 0;
      this.price = 46;
      this.history = [];
      this.demand = 0.72;
    }

    shape(h) {
      const t = ((h % 24) + 24) % 24;
      // morning ramp, midday solar trough, evening peak, overnight floor
      const morning = 28 * Math.exp(-Math.pow((t - 7.5) / 2.0, 2));
      const trough = -54 * Math.exp(-Math.pow((t - 13.0) / 2.9, 2));   // solar belly
      const evening = 78 * Math.exp(-Math.pow((t - 19.0) / 2.2, 2));   // net-load peak
      const night = -13 * Math.exp(-Math.pow(((t + 12) % 24 - 12) / 3.4, 2));
      return 48 + morning + trough + evening + night;
    }

    demandShape(h) {
      const t = ((h % 24) + 24) % 24;
      return clamp(0.68 + 0.20 * Math.sin((t - 9) * Math.PI / 12) +
        0.16 * Math.exp(-Math.pow((t - 19) / 2.4, 2)), 0.45, 1.0);
    }

    step(dtHours) {
      this.hour += dtHours;
      // Ornstein-Uhlenbeck deviation
      const theta = 1.6, sigma = 14;
      const dW = this.rng.normal() * Math.sqrt(Math.max(dtHours, 1e-6));
      this.dev += -theta * this.dev * dtHours + sigma * dW;
      this.dev = clamp(this.dev, -46, 120);

      // scarcity spikes: rare, short, violent
      if (this.rng.next() < 0.00055 * dtHours * 60) this.spike = 120 + this.rng.next() * 340;
      this.spike *= Math.exp(-dtHours / 0.22);
      if (this.spike < 0.5) this.spike = 0;

      this.demand = this.demandShape(this.hour);
      const raw = this.shape(this.hour) + this.dev + this.spike;
      this.price = clamp(raw, -28, 640);
      return this.price;
    }
  }

  // Small deterministic-ish RNG so a seed reproduces a market run
  class RNG {
    constructor(seed) { this.s = (seed >>> 0) || 12345; this.spare = null; }
    next() {
      // xorshift32
      let x = this.s;
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5; x >>>= 0;
      this.s = x;
      return x / 4294967296;
    }
    normal() {
      if (this.spare !== null) { const v = this.spare; this.spare = null; return v; }
      let u = 0, v = 0, s = 0;
      do {
        u = this.next() * 2 - 1;
        v = this.next() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const m = Math.sqrt(-2 * Math.log(s) / s);
      this.spare = v * m;
      return u * m;
    }
  }

  /* ====================================================================== */
  /*  Reactor                                                               */
  /* ====================================================================== */

  class Reactor {
    constructor(opts) {
      this.opts = opts || {};
      this.rng = new RNG(this.opts.seed || (Date.now() & 0xffffffff));
      this.market = new Market(this.rng);
      this.reset(this.opts.startAtPower !== false);
    }

    /* ------------------------------------------------------------ reset */

    reset(hot) {
      const M = this.market;
      this.market = new Market(new RNG(this.opts.seed || (Date.now() & 0xffffffff)));
      this.market.hour = M ? 6.0 : 6.0;

      this.time = 0;               // seconds of plant time
      this.wallTime = 0;

      /* ---- operator controls (the panel) ---- */
      this.ctl = {
        rods: 68.6,          // % withdrawn, 0 = fully inserted
        rodDemand: 68.6,
        flow: 100.0,         // % recirculation / core flow
        flowDemand: 100.0,
        tcv: 100.0,          // turbine control valves, % open
        bypass: 0.0,         // turbine bypass valves, % of their 25% capacity
        pressAuto: true,     // EHC pressure regulator holds dome pressure
        pressSet: 7.03,      // MPa, pressure regulator setpoint
        loadLimit: 100.0,    // % turbine load limit in automatic
        feedwater: 100.0,    // % of rated feedwater flow (manual mode)
        feedTemp: 215.0,     // degrees C, final feedwater temperature
        feedAuto: true,      // three-element level control
        turbineOnline: true,
        msiv: true,          // main steam isolation valves open
        slc: 0,              // standby liquid control, % injected
        vent: 0,             // hardened containment vent, % open
      };

      /* ---- safety system arming. All armed is the real plant. ---- */
      this.safety = {
        rps: true,           // reactor protection system (scram)
        srv: true,           // safety relief valves
        eccs: true,          // HPCI / RCIC / LPCI / core spray
        rpt: true,           // recirc pump trip + alternate rod insertion
        containment: true,   // isolation
      };

      /* ---- neutronics ---- */
      this.n = hot ? 1.0 : 1e-7;
      this.C = BETA_I.map((b, i) => (hot ? b * 1.0 / (GEN_TIME * LAMBDA_I[i]) : b * 1e-7 / (GEN_TIME * LAMBDA_I[i])));
      this.period = Infinity;
      this.prevN = this.n;

      /* ---- poisons and burnup ---- */
      this.iodine = hot ? YIELD_I / LAM_I : 0;
      this.xenon = hot ? 1.0 : 0;
      this.burnup = 0;              // GWd/tU-ish, scaled

      /* ---- thermal ---- */
      this.pressure = hot ? PLANT.ratedPressure : 0.101;
      this.tCool = tsat(this.pressure);
      this.tFuel = hot ? this.tCool + 714 : 25;
      this.tClad = hot ? this.tCool + 180 : 25;
      this.void = hot ? PLANT.ratedVoid : 0;
      this.level = 0;
      this.levelInd = 0;
      this.inventory = 1.0;          // fraction of normal vessel water mass
      this.decay = DECAY_GROUPS.map((g) => (hot ? 1.0 : 0));

      /* ---- balance of plant ---- */
      this.steamGen = hot ? 1.0 : 0;
      this.steamOut = hot ? 1.0 : 0;
      this.srvFlow = 0;
      this.srvOpenFrac = 0;
      this.turbineSpeed = hot ? 1.0 : 0;
      this.pregI = hot ? 1.0 : 0;
      this.mwe = hot ? PLANT.thermalRated * PLANT.grossEfficiency - PLANT.houseLoad : 0;
      this.gridSynced = hot;

      /* ---- containment ---- */
      this.drywellP = 0.0;           // MPa gauge
      this.drywellT = 35;
      this.poolT = 32;               // suppression pool, degrees C
      this.hydrogen = 0;             // kg in containment
      this.vesselStress = 0;
      this.breachMode = null;
      this.radiation = 0.02;         // mSv/h in the reactor building

      /* ---- damage ---- */
      this.damage = {
        clad: 0,            // % of cladding failed
        core: 0,            // % core damage
        melt: 0,            // % of core molten
        vesselBreach: false,
        containmentBreach: false,
        release: 0,         // TBq I-131 equivalent, log-ish
      };

      /* ---- state machine ---- */
      this.scrammed = false;
      this.scramTimer = 0;
      this.scramReason = "";
      this.tripped = false;          // turbine tripped
      this.msivClosed = false;
      this.fwTripped = false;
      this.hpci = false;
      this.lpci = false;
      this.adsFired = false;
      this.rptFired = false;
      this.gameOver = false;
      this.outcome = null;

      /* ---- economics ---- */
      this.money = {
        revenue: 0,
        fuelOM: 0,
        penalties: 0,
        net: 0,
        mwh: 0,
        lastPrice: 46,
      };

      this.alarms = new Map();
      this.log = [];
      this.reactivity = { rods: 0, doppler: 0, void: 0, mod: 0, xenon: 0, boron: 0, total: 0 };
      this.pushLog("Plant initialised. " + (hot ? "At rated power, synchronised to the grid." : "Cold shutdown."), "info");
    }

    /* ------------------------------------------------------------- utils */

    pushLog(msg, kind) {
      this.log.push({ t: this.time, msg, kind: kind || "info" });
      if (this.log.length > 220) this.log.shift();
    }

    setAlarm(id, text, level) {
      if (!this.alarms.has(id)) {
        this.alarms.set(id, { id, text, level, t: this.time });
        this.pushLog(text, level === 3 ? "crit" : level === 2 ? "warn" : "info");
      }
    }

    clearAlarm(id) { this.alarms.delete(id); }

    /* ---------------------------------------------------------- controls */

    scram(reason, manual) {
      if (this.scrammed) return;
      this.scrammed = true;
      this.scramTimer = 0;
      this.scramReason = reason;
      this.pushLog((manual ? "MANUAL SCRAM — " : "AUTOMATIC SCRAM — ") + reason, "crit");
      this.setAlarm("scram", "REACTOR SCRAM: " + reason, 3);
      this.money.penalties += 1_450_000;   // lost generation, restart, inspections
    }

    /* ------------------------------------------------------ heat transfer */

    // Normalised core heat transfer coefficient. 1.0 is rated forced
    // circulation with the core covered and nucleate boiling everywhere.
    heatTransfer() {
      // forced circulation contribution; natural circulation floor ~30%
      const f = this.ctl.flow / 100;
      let h = 0.30 + 0.70 * Math.pow(clamp(f, 0, 1.3), 0.8);

      // Boiling transition. Above roughly 0.80 core average void the bundles
      // begin to dry out; the surface goes to film boiling and the heat
      // transfer coefficient collapses by more than an order of magnitude.
      if (this.void > 0.80 && this.level > PLANT.tafLevel) {
        const x = clamp((this.void - 0.80) / 0.16, 0, 1);
        h *= lerp(1, 0.06, x * x);
      }

      // Core uncovery. The exposed part of a bundle is cooled by steam, which
      // is roughly two hundred times worse than nucleate boiling. Because the
      // hot end of the fuel governs the damage, the covered and uncovered
      // fractions combine in series, not in parallel: a core that is one
      // third uncovered behaves far worse than "two thirds cooled".
      const cover = clamp((this.level - PLANT.bafLevel) / (PLANT.tafLevel - PLANT.bafLevel), 0, 1);
      if (cover < 0.999) {
        const hDry = 0.0009;
        const dry = (1 - cover) * (1 - cover);
        h = 1 / (cover / h + dry / hDry);
      }
      this.coreCover = cover;

      // Emergency injection restores cooling even to a partly uncovered core
      if (this.lpci) h = Math.max(h, 0.42);
      else if (this.hpci) h = Math.max(h, 0.26);

      return Math.max(h, 0.0007);
    }

    /* ---------------------------------------------------------- physics */

    // Public entry point. The pressure and level loops are fast, so any step
    // longer than 0.1 s is split internally. This keeps the model honest when
    // the browser drops frames or the player runs the clock at 60x.
    step(dt) {
      if (!(dt > 0)) return;
      if (dt > 0.1) {
        const n = Math.min(Math.ceil(dt / 0.1), 400);
        for (let i = 0; i < n; i++) this.stepOnce(dt / n);
        return;
      }
      this.stepOnce(dt);
    }

    stepOnce(dt) {
      if (this.gameOver) { this.stepMarketOnly(dt); return; }
      this.time += dt;

      this.updateRods(dt);
      this.updateNeutronics(dt);
      this.updateThermal(dt);
      this.updateSteamAndPressure(dt);
      this.updateLevel(dt);
      this.updateDamage(dt);
      this.updateContainment(dt);
      this.updateProtection(dt);
      this.updateElectrical(dt);
      this.updateEconomics(dt);
      this.updateAlarms();
    }

    stepMarketOnly(dt) {
      this.market.step(dt / 3600);
    }

    /* ------------------------------------------------------------- rods */

    updateRods(dt) {
      const c = this.ctl;
      if (this.scrammed) {
        // Hydraulic scram: full insertion in about 3 seconds. This is the
        // single fastest and most reliable thing in the plant.
        this.scramTimer += dt;
        c.rods = Math.max(0, c.rods - dt * 36);
      } else {
        // Normal rod motion is deliberately slow, 3 inches per second class.
        const rate = 2.6;   // % of stroke per second
        const d = c.rodDemand - c.rods;
        c.rods += clamp(d, -rate * dt, rate * dt);
      }

      // Recirculation flow follows demand with pump/valve inertia
      // Recirculation flow follows demand at a deliberate rate. Pumps can be
      // tripped far faster than they can be run up, which is what makes the
      // recirculation pump trip a useful protective action.
      const fd = this.rptFired ? Math.min(c.flowDemand, 32) : c.flowDemand;
      const fr = 3.2;
      c.flow += clamp(fd - c.flow, -fr * dt * 2.2, fr * dt);
      c.flow = clamp(c.flow, 0, 115);
    }

    // Integral rod worth follows the classic S-curve: little worth at the
    // extremes, most of it through the middle of the stroke.
    rodReactivity() {
      const R = clamp(this.ctl.rods, 0, 100) / 100;
      const f = R - Math.sin(2 * Math.PI * R) / (2 * Math.PI);  // 0 at bottom, 1 at top
      return -ROD_WORTH_TOTAL * (1 - f);
    }

    updateNeutronics(dt) {
      /* ------------- reactivity ------------- */
      const rho = this.reactivity;
      rho.rods = this.rodReactivity();
      rho.doppler = ALPHA_DOPPLER * (this.tFuel - 286);
      rho.void = ALPHA_VOID * this.void;
      rho.mod = ALPHA_MOD * (this.tCool - 286);
      rho.xenon = XENON_WORTH * this.xenon;
      rho.boron = BORON_WORTH * (this.ctl.slc / 100);
      const excess = EXCESS_REACTIVITY * (1 - 0.35 * clamp(this.burnup, 0, 1));
      // Once fuel relocates, geometry is destroyed and the core cannot
      // sustain a chain reaction. Melting is not a route to a bigger reaction.
      const geometry = 1 - clamp(this.damage.melt / 40, 0, 1);

      rho.total = (excess + rho.rods + rho.doppler + rho.void + rho.mod + rho.xenon + rho.boron) * geometry
        - (1 - geometry) * 0.30;

      /* ------------- point kinetics, exponential integrator ------------- */
      // Sub-step so a large sim dt cannot cheat the prompt time constant.
      const sub = Math.max(1, Math.ceil(dt / 0.02));
      const h = dt / sub;
      for (let s = 0; s < sub; s++) {
        let sumLC = 0;
        for (let i = 0; i < 6; i++) sumLC += LAMBDA_I[i] * this.C[i];
        const a = (rho.total - BETA) / GEN_TIME;
        const b = sumLC + SOURCE;

        let nNew;
        if (Math.abs(a) < 1e-9) {
          nNew = this.n + b * h;
        } else {
          const eq = -b / a;
          const ex = Math.exp(clamp(a * h, -60, 12));
          nNew = (this.n - eq) * ex + eq;
        }
        nNew = clamp(nNew, 0, 60);   // a real core cannot exceed this before disassembly

        for (let i = 0; i < 6; i++) {
          const lam = LAMBDA_I[i];
          const src = BETA_I[i] * this.n / GEN_TIME;
          const eqC = src / lam;
          this.C[i] = (this.C[i] - eqC) * Math.exp(-lam * h) + eqC;
        }
        this.n = nNew;
      }

      /* ------------- reactor period ------------- */
      const rate = (this.n - this.prevN) / Math.max(dt, 1e-6);
      this.period = Math.abs(rate) > 1e-9 ? this.n / rate : Infinity;
      this.prevN = this.n;

      /* ------------- xenon and iodine ------------- */
      const flux = this.n;
      this.iodine += (YIELD_I * flux - LAM_I * this.iodine) * dt;
      this.xenon += (YIELD_XE * flux + LAM_I * this.iodine
        - LAM_XE * this.xenon - SIG_XE * flux * this.xenon) * dt;
      this.iodine = Math.max(0, this.iodine);
      this.xenon = Math.max(0, this.xenon);

      /* ------------- burnup ------------- */
      this.burnup += this.n * dt / 4.2e6;
    }

    /* ----------------------------------------------------------- thermal */

    updateThermal(dt) {
      // Decay heat groups chase the power history
      let decayTotal = 0;
      for (let i = 0; i < DECAY_GROUPS.length; i++) {
        const g = DECAY_GROUPS[i];
        this.decay[i] += (this.n - this.decay[i]) * (1 - Math.exp(-dt / g.tau));
        decayTotal += g.f * this.decay[i];
      }
      this.decayHeat = decayTotal;

      // Zirconium-water reaction is exothermic and accelerates with
      // temperature. Above ~1200 C it can generate more heat than decay heat,
      // which is exactly what turns a cooling failure into a melt.
      let zrHeat = 0;
      if (this.tFuel > SETPOINTS.cladBallooning && this.level < PLANT.tafLevel + 40) {
        const k = Math.exp((this.tFuel - 1200) / 260) - 1;
        zrHeat = clamp(k * 0.006, 0, 0.14) * (1 - this.damage.clad / 140);
        this.hydrogen += zrHeat * 34 * dt;   // kg
      }
      this.zrHeat = zrHeat;

      const q = 0.935 * this.n + this.decayHeat + zrHeat;
      this.thermalPower = q;

      const htc = this.heatTransfer();
      this.htc = htc;

      // Fuel node, as a genuine energy balance rather than a relaxation to a
      // fixed target. The fuel time constant is therefore 6.2 s with healthy
      // boiling and tens of minutes with a dry core, which is exactly why a
      // scrammed reactor that loses its water does not fail immediately, and
      // exactly why it does eventually fail if nobody puts the water back.
      const Cf = 0.00868;   // normalised power-seconds per degree C
      const dTf = (q - htc * (this.tFuel - this.tCool) / 714) / Cf;
      this.tFuel += clamp(dTf, -600, 600) * dt;
      this.tFuel = clamp(this.tFuel, 20, 3400);
      const cladFrac = clamp(0.28 + 0.72 * (1 - clamp(htc, 0, 1)), 0.28, 0.96);
      this.tClad = this.tCool + (this.tFuel - this.tCool) * cladFrac;

      // Coolant sits at saturation while there is water in the core
      this.tCool = tsat(this.pressure);

      // Void fraction. More power makes voids, more flow sweeps them out,
      // more pressure and more subcooling collapse them.
      const flowTerm = Math.pow(clamp(this.ctl.flow / 100, 0.10, 1.2), 0.72);
      const pressTerm = Math.pow(PLANT.ratedPressure / clamp(this.pressure, 0.4, 9), 0.55);
      const subcool = 1 - 0.0034 * (PLANT.ratedFeedTemp - this.ctl.feedTemp);
      let vTarget = 0.42 * (q / flowTerm) * pressTerm * clamp(subcool, 0.55, 1.35);
      if (this.level < PLANT.tafLevel) vTarget = 1.0;         // uncovered
      vTarget = clamp(vTarget, 0, 1);
      this.void += (vTarget - this.void) * (1 - Math.exp(-dt / 1.6));
    }

    /* ------------------------------------------------- steam & pressure */

    updateSteamAndPressure(dt) {
      const c = this.ctl;

      // Steam generation tracks core heat, penalised by feedwater subcooling
      const subPenalty = 1 - 0.0016 * (PLANT.ratedFeedTemp - c.feedTemp);
      let gen = this.thermalPower * clamp(subPenalty, 0.72, 1.12);
      if (this.level < PLANT.tafLevel) gen *= clamp(this.inventory * 2.4, 0, 1);
      this.steamGen = Math.max(0, gen);

      const pRatio = clamp(this.pressure / PLANT.ratedPressure, 0, 1.4);

      /* ---------------- EHC pressure regulator ----------------
         A real BWR does not control power with the turbine valves; it holds
         dome pressure constant with them and controls power with rods and
         core flow. The regulator opens the bypass automatically whenever the
         turbine cannot take all the steam, which is why a turbine trip with
         a healthy bypass is a non-event. */
      if (c.pressAuto && !this.msivClosed) {
        const err = this.pressure - c.pressSet;
        this.pregI = clamp((this.pregI || 0) + err * 1.25 * dt, -0.2, 1.35);
        const demand = clamp(this.pregI + err * 3.0, 0, 1.35);
        const limit = clamp(c.loadLimit / 100, 0, 1);
        let tcvCmd = this.tripped ? 0 : Math.min(demand, limit);
        let bypCmd = clamp(demand - tcvCmd, 0, 0.25);
        // valves move fast, but not instantly
        c.tcv += clamp(tcvCmd * 100 - c.tcv, -520 * dt, 520 * dt);
        c.bypass += clamp((bypCmd / 0.25) * 100 - c.bypass, -640 * dt, 640 * dt);
        c.tcv = clamp(c.tcv, 0, 100);
        c.bypass = clamp(c.bypass, 0, 100);
      }

      // Turbine control valves and bypass. MSIVs isolate everything.
      const open = this.msivClosed ? 0 : 1;
      const tcvFlow = open * (this.tripped ? 0 : (c.tcv / 100)) * pRatio;
      const bypassFlow = open * (c.bypass / 100) * 0.25 * pRatio;   // bypass is 25% capacity

      // Safety relief valves. Eleven banks, they lift on pressure and dump
      // to the suppression pool. This is the pressure limit of last resort.
      if (this.safety.srv) {
        if (this.pressure > SETPOINTS.srvOpen) {
          this.srvOpenFrac = clamp(this.srvOpenFrac + dt * 2.2, 0, 1);
          if (this.srvOpenFrac > 0.02) this.setAlarm("srv", "Safety relief valves lifted, discharging to suppression pool", 2);
        } else if (this.pressure < SETPOINTS.srvClose) {
          this.srvOpenFrac = clamp(this.srvOpenFrac - dt * 1.2, 0, 1);
          if (this.srvOpenFrac <= 0) this.clearAlarm("srv");
        }
      } else {
        this.srvOpenFrac = 0;
      }
      if (this.adsFired) this.srvOpenFrac = 1;
      this.srvFlow = this.srvOpenFrac * 0.86 * pRatio;

      // Leak path once the vessel is breached
      const breachFlow = this.damage.vesselBreach ? 1.6 * pRatio : 0;

      this.steamOut = tcvFlow + bypassFlow + this.srvFlow + breachFlow;
      this.tcvFlow = tcvFlow;
      this.bypassFlow = bypassFlow;

      // Dome pressure from the mass/energy imbalance
      const K = 0.245;   // MPa per unit normalised flow imbalance per second
      let dP = (this.steamGen - this.steamOut) * K;
      // condensation on subcooled feedwater
      dP -= 0.02 * (this.pressure - 0.101) * (this.feedFlow || 0) * 0.02;
      this.pressure += dP * dt;
      this.pressure = clamp(this.pressure, 0.06, 22.0);

      // Reactor vessel overpressure. The vessel is designed for 8.62 MPa and
      // hydrotested well above it, so it does not fail the moment you pass a
      // setpoint, but it will not survive an unrelieved pressurisation either.
      if (!this.damage.vesselBreach && this.pressure > 10.4) {
        this.vesselStress = (this.vesselStress || 0) + (this.pressure - 10.4) * dt * 1.4;
        this.setAlarm("rpvstress", "REACTOR VESSEL BEYOND DESIGN PRESSURE", 3);
        if (this.pressure > 14.2 || this.vesselStress > 55) {
          this.damage.vesselBreach = true;
          this.breachMode = "overpressure";
          this.pushLog("REACTOR VESSEL RUPTURE on overpressure. Blowdown into the drywell.", "crit");
          this.setAlarm("vessel", "REACTOR VESSEL FAILURE — loss of coolant", 3);
          this.money.penalties += 9_800_000_000;
        }
      }

      // Suppression pool heats up from SRV discharge; residual heat removal
      // pulls it back down while emergency systems are available.
      this.poolT += this.srvFlow * 3.4 * dt * 0.055;
      if (this.safety.eccs) this.poolT -= (this.poolT - 35) * 0.00016 * dt;
      this.poolT = clamp(this.poolT, 20, 210);
    }

    /* ------------------------------------------------------------- level */

    updateLevel(dt) {
      const c = this.ctl;

      // Three-element feedwater control: level error plus flow mismatch
      let fw;
      if (c.feedAuto && !this.fwTripped) {
        const err = 0 - this.levelInd;
        fw = clamp(this.steamOut * 100 + err * 1.7, 0, 130);
        c.feedwater = c.feedwater + clamp(fw - c.feedwater, -260 * dt, 260 * dt);
        fw = c.feedwater;
      } else {
        fw = this.fwTripped ? 0 : c.feedwater;
      }
      let feedFlow = (fw / 100);
      if (this.fwTripped) feedFlow = 0;

      // Emergency injection
      if (this.hpci) feedFlow += 0.06 * clamp((7.5 - this.pressure) < 0 ? 1 : 1, 0, 1);
      if (this.lpci && this.pressure < 1.4) feedFlow += 0.38;
      if (this.ctl.slc > 0) feedFlow += 0.004;

      this.feedFlow = feedFlow;

      const netFlow = feedFlow - this.steamOut - (this.damage.vesselBreach ? 0.55 : 0);
      this.inventory = clamp(this.inventory + netFlow * dt * 0.009, 0, 1.42);

      // Collapsed water level is just the vessel inventory in another unit.
      // Normal level is 0 inches; the top of active fuel is 160 inches down.
      this.level = clamp((this.inventory - 1) * 320, -330, 130);

      // Indicated level includes shrink and swell from the steam voids, which
      // is why a pressure spike appears to "lose" water instantly and a
      // depressurisation appears to conjure it out of nowhere.
      const swell = this.level > PLANT.tafLevel ? (this.void - PLANT.ratedVoid) * 110 : 0;
      this.levelInd = clamp(this.level + swell, -340, 160);
    }

    /* ------------------------------------------------------------ damage */

    updateDamage(dt) {
      const T = this.tFuel;
      const d = this.damage;

      if (T > SETPOINTS.cladBallooning) {
        d.clad = clamp(d.clad + (T - SETPOINTS.cladBallooning) / 900 * dt * 2.0, 0, 100);
        if (d.clad > 0.5) this.setAlarm("clad", "Fuel cladding failure, fission products in coolant", 3);
      }
      if (T > SETPOINTS.cladFailure) {
        d.core = clamp(d.core + (T - SETPOINTS.cladFailure) / 800 * dt * 1.6, 0, 100);
      }
      if (T > SETPOINTS.fuelRelocation) {
        d.core = clamp(d.core + (T - SETPOINTS.fuelRelocation) / 500 * dt * 2.2, 0, 100);
        this.setAlarm("relocation", "Core geometry loss, fuel relocating", 3);
      }
      if (T > SETPOINTS.fuelMelt - 300) {
        d.melt = clamp(d.melt + (T - (SETPOINTS.fuelMelt - 300)) / 600 * dt * 1.8, 0, 100);
        if (d.melt > 1) this.setAlarm("melt", "FUEL MELTING", 3);
      }

      if (!d.vesselBreach && d.melt > 62 && this.level < PLANT.tafLevel) {
        d.vesselBreach = true;
        this.pushLog("REACTOR VESSEL LOWER HEAD FAILURE. Molten core debris on the drywell floor.", "crit");
        this.setAlarm("vessel", "REACTOR VESSEL BREACH", 3);
        this.money.penalties += 9_800_000_000;
      }

      // Release scales with damage, and with whether containment still holds
      const containmentFactor = d.containmentBreach ? 1.0 : 0.0008;
      d.release += (d.clad * 0.6 + d.core * 22 + d.melt * 90) * containmentFactor * dt * 0.02;

      this.radiation = 0.02 + d.clad * 0.4 + d.core * 6 + (d.containmentBreach ? d.melt * 90 : 0);
    }

    updateContainment(dt) {
      // Drywell pressure from leakage, SRV discharge heating and hydrogen
      // A vessel breach blows down through the drywell into the suppression
      // pool, which condenses most of the steam. Containment still climbs,
      // but over minutes, which is time the crew can use.
      const leak = this.damage.vesselBreach ? 0.0016 : (this.damage.clad > 0 ? 3.0e-5 : 1.5e-6);
      const poolHeating = clamp((this.poolT - 95) / 95, 0, 1) * 5.5e-5;
      let dP = leak * clamp(this.pressure / 7, 0, 1.6) + poolHeating + this.hydrogen * 4.0e-7;
      // containment sprays and heat removal, only if emergency systems are up
      if (this.safety.eccs && this.drywellP > 0.06) dP -= 1.6e-4;
      // Hardened vent: deliberately release filtered gas to save the building.
      // A small, controlled release now instead of an uncontrolled one later.
      if (this.ctl.vent > 0 && this.drywellP > 0.02) {
        const v = (this.ctl.vent / 100) * this.drywellP * 0.010;
        dP -= v;
        this.hydrogen = Math.max(0, this.hydrogen - v * 900 * dt);
        this.damage.release += (this.damage.clad * 0.2 + this.damage.core * 3) * v * dt * 0.35;
      }
      this.drywellP = clamp(this.drywellP + dP * dt, 0, 2.4);
      this.drywellT = 35 + this.drywellP * 300;

      if (this.drywellP > SETPOINTS.drywellDesign) {
        this.setAlarm("dwhigh", "Drywell pressure above design, containment stressed", 3);
      }

      // Hydrogen deflagration
      if (!this.damage.containmentBreach && this.hydrogen > 320 && this.drywellP > 0.30) {
        this.damage.containmentBreach = true;
        this.drywellP += 0.5;
        this.pushLog("HYDROGEN DEFLAGRATION. Containment integrity lost.", "crit");
        this.setAlarm("cbreach", "CONTAINMENT BREACH", 3);
        this.money.penalties += 42_000_000_000;
      }
      if (!this.damage.containmentBreach && this.drywellP > SETPOINTS.drywellFail) {
        this.damage.containmentBreach = true;
        this.pushLog("CONTAINMENT OVERPRESSURE FAILURE.", "crit");
        this.setAlarm("cbreach", "CONTAINMENT BREACH", 3);
        this.money.penalties += 42_000_000_000;
      }
    }

    /* -------------------------------------------------------- protection */

    updateProtection(dt) {
      const s = this.safety;
      const sp = SETPOINTS;

      /* --- recirculation pump trip and alternate rod insertion --- */
      if (s.rpt && !this.rptFired && this.n > sp.fluxRunback) {
        this.rptFired = true;
        this.pushLog("Recirculation pump trip on high flux. Core flow runback in progress.", "warn");
      }
      if (this.rptFired && this.n < 0.95) this.rptFired = false;

      /* --- turbine trip --- */
      if (!this.tripped && this.ctl.turbineOnline) {
        if (this.levelInd > sp.levelHigh8) {
          this.tripTurbine("High reactor water level (L8), moisture carryover protection");
          this.fwTripped = true;
        } else if (this.pressure < 5.2 && this.n > 0.2) {
          this.tripTurbine("Low steam pressure at turbine inlet");
        } else if (this.turbineSpeed > 1.11) {
          this.tripTurbine("Turbine overspeed");
        }
      }
      if (this.fwTripped && this.levelInd < -20) this.fwTripped = false;

      /* --- MSIV isolation --- */
      if (s.containment && !this.msivClosed) {
        if (this.levelInd < sp.levelLow1 || this.drywellP > 0.19 || !this.ctl.msiv) {
          this.msivClosed = true;
          this.pushLog("MSIV closure, reactor isolated from the turbine.", "warn");
          this.setAlarm("msiv", "Main steam isolation valves closed", 2);
        }
      }
      if (!this.ctl.msiv) this.msivClosed = true;
      if (this.ctl.msiv && this.msivClosed && this.levelInd > sp.levelLow1 + 25
        && this.drywellP < 0.15 && !this.damage.vesselBreach) {
        this.msivClosed = false;
        this.clearAlarm("msiv");
      }

      /* --- reactor protection system --- */
      if (s.rps && !this.scrammed) {
        if (this.n > sp.fluxScram) this.scram("High neutron flux, " + (this.n * 100).toFixed(0) + "% rated");
        else if (this.pressure > sp.pressScram) this.scram("High reactor dome pressure, " + this.pressure.toFixed(2) + " MPa");
        else if (this.levelInd < sp.levelLow3) this.scram("Low reactor water level (L3)");
        else if (this.drywellP > sp.drywellScram) this.scram("High drywell pressure");
        else if (this.tripped && this.ctl.bypass < 20 && this.n > 0.30) this.scram("Turbine trip without adequate bypass capacity");
        else if (this.msivClosed && this.n > 0.30) this.scram("Main steam line isolation");
        else if (this.ctl.flow < 22 && this.n > 0.55) this.scram("Loss of core flow at power");
      }

      /* --- emergency core cooling --- */
      if (s.eccs) {
        if (!this.hpci && this.levelInd < sp.levelLow2) {
          this.hpci = true;
          this.pushLog("HPCI and RCIC started automatically on low water level (L2).", "warn");
          this.setAlarm("hpci", "High pressure coolant injection running", 2);
        }
        if (this.hpci && this.levelInd > 10) { this.hpci = false; this.clearAlarm("hpci"); }

        if (!this.adsFired && this.levelInd < sp.levelLow1 - 20 && this.pressure > 2.5) {
          this.adsFired = true;
          this.pushLog("Automatic depressurisation system actuated, blowing down to the suppression pool.", "warn");
        }
        if (!this.lpci && this.levelInd < sp.levelLow1 && this.pressure < 2.0) {
          this.lpci = true;
          this.pushLog("LPCI and core spray injecting.", "warn");
          this.setAlarm("lpci", "Low pressure core cooling injecting", 2);
        }
        if (this.lpci && this.levelInd > 0) { this.lpci = false; this.adsFired = false; this.clearAlarm("lpci"); }
      } else {
        this.hpci = false; this.lpci = false;
      }

      /* --- end conditions --- */
      if (!this.gameOver) {
        if (this.damage.containmentBreach) this.endGame("containment");
        else if (this.damage.vesselBreach && (this.damage.melt > 45 || this.damage.core > 55)) this.endGame("vessel");
        else if (this.damage.melt > 92) this.endGame("melt");
      }
    }

    tripTurbine(reason) {
      this.tripped = true;
      this.gridSynced = false;
      this.pushLog("TURBINE TRIP — " + reason, "crit");
      this.setAlarm("turbtrip", "Turbine trip: " + reason, 3);
      this.money.penalties += 260_000;
    }

    /* ------------------------------------------------------- electrical */

    updateElectrical(dt) {
      const steamToTurbine = this.tcvFlow;
      const target = this.tripped ? 0 : steamToTurbine;
      this.turbineSpeed += (clamp(target * 1.02, 0, 1.2) - this.turbineSpeed) * (1 - Math.exp(-dt / 2.4));
      const eff = PLANT.grossEfficiency * clamp(0.72 + 0.28 * (this.pressure / PLANT.ratedPressure), 0.5, 1.02);
      const gross = this.tripped ? 0 : steamToTurbine * PLANT.thermalRated * eff;
      this.mwe = Math.max(0, gross - PLANT.houseLoad);
      this.gridSynced = this.mwe > 5 && !this.tripped;
    }

    /* -------------------------------------------------------- economics */

    updateEconomics(dt) {
      const hours = dt / 3600;
      const price = this.market.step(hours);
      this.money.lastPrice = price;

      const mwh = this.mwe * hours;
      this.money.mwh += mwh;
      this.money.revenue += mwh * price;

      // Marginal fuel plus variable O&M, plus a fixed hourly burn that runs
      // whether or not you are generating. This is why a scram is expensive.
      this.money.fuelOM += mwh * 9.6 + hours * 20000;

      this.money.net = this.money.revenue - this.money.fuelOM - this.money.penalties;
    }

    /* ----------------------------------------------------------- alarms */

    updateAlarms() {
      const sp = SETPOINTS;
      const a = (id, cond, text, level) => cond ? this.setAlarm(id, text, level) : this.clearAlarm(id);

      a("flux", this.n > 1.05 && this.n <= sp.fluxScram, "Neutron flux high, approaching scram setpoint", 2);
      a("press", this.pressure > sp.pressHigh && this.pressure <= sp.pressScram, "Reactor pressure high", 2);
      a("lvlhi", this.levelInd > 38, "Reactor water level high", 2);
      a("lvllo", this.levelInd < -30 && this.levelInd >= sp.levelLow3, "Reactor water level low", 2);
      a("uncov", this.level < PLANT.tafLevel, "CORE UNCOVERED — fuel above the water line", 3);
      a("dryout", this.void > 0.80 && this.level > PLANT.tafLevel, "Boiling transition, bundle dryout in progress", 3);
      a("fuelT", this.tFuel > 1120 && this.tFuel <= sp.cladBallooning, "Fuel temperature high", 2);
      a("fuelTT", this.tFuel > sp.cladBallooning, "FUEL TEMPERATURE CRITICAL — zirconium oxidation", 3);
      a("period", this.period > 0 && this.period < 20 && this.n > 1e-4, "Short reactor period, power rising fast", 2);
      a("pool", this.poolT > 95, "Suppression pool temperature high", 2);
      a("h2", this.hydrogen > 60, "Hydrogen accumulating in containment", 3);
      a("rpsoff", !this.safety.rps, "REACTOR PROTECTION SYSTEM BYPASSED", 3);
      a("srvoff", !this.safety.srv, "SAFETY RELIEF VALVES BLOCKED", 3);
      a("eccsoff", !this.safety.eccs, "EMERGENCY CORE COOLING DISABLED", 3);
    }

    /* ------------------------------------------------------------- end */

    // Rate the shift on the International Nuclear Event Scale. The whole
    // point of the grading is that the top of the scale is genuinely hard to
    // reach, and the bottom of it is where almost everything lands.
    grade() {
      const d = this.damage;
      const defeated = [!this.safety.rps, !this.safety.srv, !this.safety.eccs, !this.safety.rpt, !this.safety.containment]
        .filter(Boolean).length;

      if (d.containmentBreach && d.melt > 40) return {
        ines: 7, title: "Major accident",
        detail: "Containment failed with a substantially molten core: the Chernobyl and Fukushima category. " +
          "Look at what it took. You disabled " + defeated + " independent safety systems and then held the plant " +
          "outside its limits for minutes on end. No sequence of ordinary operator error gets here, which is why " +
          "there have been three of these in roughly 20,000 reactor-years of operation.",
      };
      if (d.containmentBreach) return {
        ines: 6, title: "Serious accident",
        detail: "The last physical barrier failed. Count the systems you had to switch off first: " + defeated + ". " +
          "Defence in depth means the accident has to defeat every layer, not just one.",
      };
      if (d.vesselBreach && (d.melt > 20 || d.core > 40)) return {
        ines: 5, title: "Accident with wider consequences",
        detail: "The vessel failed and the core is damaged, but containment held. This is Three Mile Island: " +
          "a destroyed reactor, a catastrophic financial loss, and no measurable health effect on the public. " +
          "The building did its job.",
      };
      if (d.vesselBreach) return {
        ines: 4, title: "Accident with local consequences",
        detail: "You lost the reactor vessel. Emergency cooling still covered the fuel, so the radiological " +
          "consequence stops at the site boundary. The financial consequence does not.",
      };
      if (d.core > 2) return {
        ines: 4, title: "Accident with local consequences",
        detail: "Real fuel damage. Fission products are in the coolant and the core will never restart. " +
          "Everything outside the vessel is still clean.",
      };
      if (d.clad > 0.5) return {
        ines: 3, title: "Serious incident",
        detail: "Cladding failures released fission products into the reactor water. Recoverable, expensive, " +
          "and entirely contained.",
      };
      if (this.scrammed) return {
        ines: 1, title: "Anomaly",
        detail: "The plant tripped. That is the protection system doing exactly what it exists to do: " +
          "a scram is a bad day for the balance sheet and a non-event for everyone else.",
      };
      return {
        ines: 0, title: "No safety significance",
        detail: "You ran the plant inside its limits for the whole shift. This is what 400-odd reactors " +
          "do every day, quietly, while producing about a tenth of the world's electricity.",
      };
    }

    endGame(kind) {
      if (this.gameOver) return;
      this.gameOver = true;
      const g = this.grade();
      this.outcome = Object.assign({ kind }, g);
      this.pushLog("SHIFT ENDED — INES " + g.ines + ": " + g.title, "crit");
    }

    /* ------------------------------------------------------ readouts */

    snapshot() {
      return {
        t: this.time,
        n: this.n,
        thermal: this.thermalPower * PLANT.thermalRated,
        mwe: this.mwe,
        pressure: this.pressure,
        tFuel: this.tFuel,
        tCool: this.tCool,
        level: this.levelInd,
        levelTrue: this.level,
        void: this.void,
        flow: this.ctl.flow,
        rods: this.ctl.rods,
        rho: this.reactivity,
        xenon: this.xenon,
        price: this.money.lastPrice,
        net: this.money.net,
        damage: this.damage,
        period: this.period,
      };
    }
  }

  global.ReactorSim = { Reactor, PLANT, SETPOINTS, BETA, tsat, clamp, lerp, Market, RNG };
})(window);

// HIGHER: UK drum & bass, 160 BPM, A minor.
//
// Every part is a function of global time. Melodic parts read lanes, sorted note lists expanded once from phrases
// and the arrangement, so stateful filters see monotonic time, tails ring across section boundaries, and the
// sidechain is computed from the very data the kick plays.

// Grid & arrangement
// ##################

const bpm = 160
const beatSec = 60 / bpm
const barSec = 4 * beatSec
const stepSec = beatSec / 4

const INTRO = 0
const VERSE = 8
const BUILD = 16
const DROP = 24
const BREAK = 40
const BUILD2 = 56
const DROP2 = 64
const OUTRO = 88
const END = 96
const STEPS = END * 16

const during = (...ranges) => {
  const bars = new Uint8Array(END + 1)
  for (const [fromBar, toBar] of ranges) bars.fill(1, fromBar, toBar)
  return (t) => bars[Math.floor(t / barSec)] === 1
}

// Attack/release envelope of a note held for `durSec`. The release is an RC-style exponential that still lands on
// exactly zero `releaseSec` after the note ends, so a voice can be skipped from then on.
const RELEASE_FLOOR = Math.exp(-4)
const ar = (localSec, durSec, attackSec, releaseSec) => {
  if (localSec < durSec) return Math.min(1, localSec / attackSec)
  const x = (localSec - durSec) / releaseSec
  if (x >= 1) return 0
  return (Math.min(1, durSec / attackSec) * (Math.exp(-4 * x) - RELEASE_FLOOR)) / (1 - RELEASE_FLOOR)
}

// Evaluates `f` once per distinct `t`, so one signal can feed the dry mix and the sends.
const memo = (f) => {
  const out = Æ.alloc()
  let lastT = NaN
  return (t) => {
    if (t !== lastT) {
      const [l, r] = f(t)
      out[L] = l
      out[R] = r
      lastT = t
    }
    return out
  }
}

// Drums
// #####

// A drum lane plays `voice` on 16ths. `schedule` lists [fromBar, toBar, pattern] where every character of the
// pattern is one 16th: a digit is a hit at that velocity (9 is full), anything else a rest. Patterns repeat from
// `fromBar`; odd 16ths are delayed by `swingSec`.
const drumLane = (voice, tailSec, schedule, swingSec = 0) => {
  const velocity = new Float32Array(STEPS)
  for (const [fromBar, toBar, pattern] of schedule) {
    for (let step = fromBar * 16; step < toBar * 16; step++) {
      const c = pattern[(step - fromBar * 16) % pattern.length]
      velocity[step] = c >= "0" && c <= "9" ? Number(c) / 9 : 0
    }
  }
  // deterministic humanization of ±6% velocity
  const gains = Float64Array.from(velocity, (v, step) => v * (0.94 + 0.06 * Æ.noise(step)))
  const tailSteps = Math.ceil(tailSec / stepSec) + 1
  const out = Æ.alloc()
  const fn = (t) => {
    const now = Math.floor(t / stepSec)
    let l = 0
    let r = 0
    for (let step = now; step > now - tailSteps && step >= 0; step--) {
      const gain = gains[step]
      if (!gain) continue
      const [vl, vr] = voice(t - step * stepSec - (step % 2) * swingSec)
      l += vl * gain
      r += vr * gain
    }
    out[L] = l
    out[R] = r
    return out
  }
  fn.velocity = velocity
  return fn
}

// Sidechain gain keyed off a drum lane: dips by `depth` at every hit and recovers over `releaseSec`.
const pump = (lane, depth, releaseSec) => {
  const lastHit = new Int32Array(STEPS)
  let hit = -1
  for (let step = 0; step < STEPS; step++) {
    if (lane.velocity[step] > 0) hit = step
    lastHit[step] = hit
  }
  return (t) => {
    const step = Math.floor(t / stepSec)
    const hitStep = step >= 0 && step < STEPS ? lastHit[step] : -1
    if (hitStep < 0) return 1
    const dt = t - hitStep * stepSec
    return 1 - depth * lane.velocity[hitStep] * Math.min(1, dt / 0.004) * Math.exp(-dt / releaseSec)
  }
}

const kickHit = Æ.bake(Æ.kick({ tuneHz: 52, decaySec: 0.27, pitchDecaySec: 0.025, drive: 2.6, click: 1 }), 0.6)
const snareHit = Æ.bake(
  Æ.vol(
    Æ.sum(Æ.snare({ tuneHz: 195, decaySec: 0.21, noiseAmt: 0.6, snap: 1 }), Æ.vol(Æ.clap({ decaySec: 0.13 }), 0.9)),
    1.8
  ),
  0.7
)
const ghostHit = Æ.bake(Æ.vol(Æ.snare({ tuneHz: 220, decaySec: 0.07, noiseAmt: 0.8, snap: 0.25 }), 1.6), 0.3)
const hatHit = Æ.bake(Æ.vol(Æ.hihat({ decaySec: 0.03 }), 3.4), 0.2)
const openHatHit = Æ.bake(Æ.vol(Æ.hihat({ open: true, decaySec: 0.2 }), 2.8), 0.7)
const rideHit = Æ.bake(Æ.vol(Æ.hihat({ open: true, decaySec: 0.7, shimmerHz: 4300, tone: 0.4 }), 1.4), 1.5)
const crashHit = Æ.bake(Æ.hihat({ open: true, decaySec: 1.3, shimmerHz: 5600, tone: 0.3 }), 3)
const boomHit = Æ.bake(Æ.kick({ tuneHz: 38, decaySec: 1.1, pitchDecaySec: 0.12, drive: 1.4, click: 0.2 }), 2.5)

const TWO_STEP_KICKS = "9.........9.....".repeat(3) + "9.9.......9..7.."
const TWO_STEP_SNARES = "....9.......9..."

const kicks = drumLane(kickHit, 0.6, [
  [VERSE, BUILD, "9.........7....."],
  [BUILD, BUILD + 4, "9.......9......."],
  [DROP, BREAK, TWO_STEP_KICKS],
  [BUILD2 + 4, BUILD2 + 7, "9.......9......."],
  [DROP2, OUTRO, TWO_STEP_KICKS],
  [OUTRO, OUTRO + 6, "9.........9....."],
])

const snares = drumLane(snareHit, 0.7, [
  [VERSE, BUILD - 1, "........9......."],
  [BUILD - 1, BUILD, "........9...9.99"],
  [DROP, BREAK - 1, TWO_STEP_SNARES],
  [BREAK - 1, BREAK, "....9.......9.9."],
  [DROP2, DROP2 + 15, TWO_STEP_SNARES],
  [DROP2 + 15, DROP2 + 16, "....9.......9.99"],
  [DROP2 + 16, OUTRO - 1, TWO_STEP_SNARES],
  [OUTRO - 1, OUTRO, "....9...9.9.9999"],
  [OUTRO, OUTRO + 6, TWO_STEP_SNARES],
])

const ghosts = drumLane(ghostHit, 0.3, [
  [VERSE + 4, BUILD, "...........3...2"],
  [DROP, BREAK, ".......3.3.....2.......3.2..3..."],
  [DROP2, OUTRO, ".......3.3.....2.......3.2..3..."],
])

const hats = drumLane(
  hatHit,
  0.2,
  [
    [INTRO + 4, VERSE, "..5...5...5...5."],
    [VERSE, BUILD + 4, "5.3.5.3.5.3.5.3."],
    [DROP, BREAK, "4273427342734273"],
    [BREAK + 8, BUILD2 + 4, "..4...4...4...4."],
    [DROP2, OUTRO, "4273427342734273"],
    [OUTRO, OUTRO + 7, "4273427342734273"],
  ],
  0.012
)

const openHats = drumLane(openHatHit, 0.7, [
  [VERSE, BUILD, "..............4."],
  [DROP, BREAK, "......5.......4."],
  [DROP2, OUTRO, "......5.......4."],
])

const rides = drumLane(rideHit, 1.5, [[DROP2 + 8, OUTRO, "7.4.7.4.7.4.7.4."]])

const kickPump = pump(kicks, 1, 0.12)

// Lanes
// #####

// Expands phrases into one note list for the whole song. A phrase is `{ bars, notes }` with notes as
// [step, durSteps, note]; `schedule` lists [fromBar, toBar, phrase] and phrases repeat from `fromBar`.
const lane = (schedule) => {
  const events = []
  for (const [fromBar, toBar, phrase] of schedule) {
    for (let at = fromBar * 16; at < toBar * 16; at += phrase.bars * 16) {
      for (const [step, durSteps, note] of phrase.notes) {
        if (at + step >= toBar * 16) continue
        const hz = Array.isArray(note) ? note.map(Æ.pitch) : Æ.pitch(note)
        events.push({ startSec: (at + step) * stepSec, durSec: durSteps * stepSec, note, hz })
      }
    }
  }
  return events.sort((a, b) => a.startSec - b.startSec)
}

// Index of the last event that started at or before `t`, or -1; binary search.
const lastStarted = (events, t) => {
  let lo = 0
  let hi = events.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].startSec <= t) lo = mid + 1
    else hi = mid - 1
  }
  return hi
}

// A monophonic legato line: one oscillator phase runs through all notes and every note glides from the previous
// pitch over `glideSec`. The phase is the closed-form integral of the linear glide, and the phase at each note
// start is a prefix sum computed once, so reading the line at any `t` is pure and O(log n).
const legato = (events, glideSec, attackSec, releaseSec) => {
  const toHz = events.map((e) => e.hz)
  const fromHz = toHz.map((hz, i) => (i > 0 ? toHz[i - 1] : hz))
  const cycles = (i, dt) => {
    const glide = Math.min(dt, glideSec)
    return toHz[i] * dt + (fromHz[i] - toHz[i]) * (glide - (glide * glide) / (2 * glideSec))
  }
  const startCycles = new Float64Array(events.length)
  for (let i = 1; i < events.length; i++) {
    startCycles[i] = startCycles[i - 1] + cycles(i - 1, events[i].startSec - events[i - 1].startSec)
  }
  const state = { cycles: 0, hz: 0, env: 0, noteSec: 0 }
  let lastT = NaN
  return (t) => {
    if (t === lastT) return state
    lastT = t
    const i = lastStarted(events, t)
    if (i < 0) {
      // before the first note: silent, but keep the oscillator well-defined
      state.cycles = toHz[0] * (t - events[0].startSec)
      state.hz = toHz[0]
      state.noteSec = 0
      state.env = 0
      return state
    }
    const e = events[i]
    const dt = t - e.startSec
    const legatoIn = i > 0 && events[i - 1].startSec + events[i - 1].durSec >= e.startSec - 1e-9
    state.cycles = startCycles[i] + cycles(i, dt)
    state.hz = toHz[i] + (fromHz[i] - toHz[i]) * Math.max(0, 1 - dt / glideSec)
    state.noteSec = dt
    state.env = legatoIn && dt < e.durSec ? 1 : ar(dt, e.durSec, attackSec, releaseSec)
    return state
  }
}

// Plays the pure `voice(localSec, event)` for every note that still sounds at `t`, i.e. started at most
// `durSec + releaseSec` ago.
const poly = (events, voice, releaseSec) => {
  const maxDurSec = events.reduce((max, e) => Math.max(max, e.durSec), 0)
  const out = Æ.alloc()
  return (t) => {
    let l = 0
    let r = 0
    for (let i = lastStarted(events, t); i >= 0 && events[i].startSec > t - maxDurSec - releaseSec; i--) {
      const localSec = t - events[i].startSec
      if (localSec >= events[i].durSec + releaseSec) continue
      const [vl, vr] = voice(localSec, events[i])
      l += vl
      r += vr
    }
    out[L] = l
    out[R] = r
    return out
  }
}

// Bass
// ####

const bassBlock = (root, octave, fifth, next) => [
  [0, 5, root],
  [6, 3, root],
  [10, 3, octave],
  [14, 2, root],
  [16, 5, root],
  [22, 3, fifth],
  [26, 2, octave],
  [28, 2, root],
  [30, 2, next],
]
const shift = (notes, steps) => notes.map(([step, durSteps, note]) => [step + steps, durSteps, note])
const dropBass = {
  bars: 8,
  notes: [
    ...bassBlock("A1", "A2", "E2", "F1"),
    ...shift(bassBlock("F1", "F2", "C2", "C2"), 32),
    ...shift(bassBlock("C2", "C3", "G2", "G1"), 64),
    ...shift(bassBlock("G1", "G2", "D2", "A1"), 96),
  ],
}
const rootBass = {
  bars: 8,
  notes: [
    [0, 32, "A1"],
    [32, 32, "F1"],
    [64, 32, "C2"],
    [96, 32, "G1"],
  ],
}

const bassLine = legato(
  lane([
    [VERSE, BUILD + 4, rootBass],
    [DROP, BREAK, dropBass],
    [BREAK + 8, BUILD2, rootBass],
    [DROP2, OUTRO + 4, dropBass],
  ]),
  0.045,
  0.004,
  0.03
)
const inDrop = during([DROP, BREAK], [DROP2, OUTRO + 4])

const sub = (() => {
  const out = Æ.alloc()
  const norm = 1 / Math.tanh(1.5)
  return (t) => {
    const s = bassLine(t)
    const level = inDrop(t) ? 0.3 : 0.2
    const y = s.env > 0 ? Math.tanh(1.5 * Math.sin(TAU * s.cycles)) * norm * s.env * kickPump(t) * level : 0
    out[L] = y
    out[R] = y
    return out
  }
})()

// Reese: three detuned saws per channel, mirrored between left and right, whose slow beating is the classic
// Reese movement. A lowpass opens on every note, then drive, then a highpass leaves the lows to the sub.
const REESE_RATIOS = [0, 17, -11].map((cents) => Math.pow(2, cents / 1200))
const reeseOsc = (() => {
  const out = Æ.alloc()
  return (t) => {
    const s = bassLine(t)
    if (s.env === 0 || !inDrop(t)) {
      out[L] = 0
      out[R] = 0
      return out
    }
    let l = 0
    let r = 0
    for (let i = 0; i < REESE_RATIOS.length; i++) {
      const up = s.hz * REESE_RATIOS[i]
      const down = s.hz / REESE_RATIOS[i]
      l += Æ.saw((s.cycles * REESE_RATIOS[i] + i * 0.31) / up, up)
      r += Æ.saw((s.cycles / REESE_RATIOS[i] + i * 0.57) / down, down)
    }
    out[L] = l * s.env * 0.33
    out[R] = r * s.env * 0.33
    return out
  }
})()

const reeseCutoffHz = (t) => {
  const s = bassLine(t)
  const wobble = 0.5 - 0.5 * Math.cos((TAU * t) / (beatSec * 2))
  return 300 * Math.pow(2, 2.6 * Math.exp(-s.noteSec / 0.16) + 1.3 * wobble)
}

const reese = Æ.vol(
  Æ.isvf(Æ.distort(Æ.isvf(reeseOsc, reeseCutoffHz, 1.6, "lp"), 2.6), 130, 0.7, "hp"),
  (t) => 0.62 * (0.35 + 0.65 * kickPump(t))
)

// Harmony
// #######

const CHORDS = {
  Am: ["A3", "C4", "E4", "A4"],
  F: ["A3", "C4", "F4", "A4"],
  C: ["G3", "C4", "E4", "G4"],
  G: ["G3", "B3", "D4", "G4"],
}
const PROGRESSION = ["Am", "F", "C", "G"]
const octaveUp = (note) => note.replace(/\d$/, (o) => String(Number(o) + 1))

// One chord per two bars; `rhythm` lists [step, durSteps] hits within the two bars.
const chordPhrase = (rhythm, transpose = (n) => n) => ({
  bars: 8,
  notes: PROGRESSION.flatMap((name, i) =>
    rhythm.map(([step, durSteps]) => [i * 32 + step, durSteps, CHORDS[name].map(transpose)])
  ),
})

// Wide supersaw chord: one JP-8000 stack per channel, the two a few cents apart.
const WIDE = Math.pow(2, 5 / 1200)
const sawChord = (attackSec, releaseSec, detune) => {
  const out = Æ.alloc()
  return (localSec, e) => {
    const env = ar(localSec, e.durSec, attackSec, releaseSec)
    let l = 0
    let r = 0
    for (const hz of e.hz) {
      l += Æ.suprsaw(localSec, hz * WIDE, detune)
      r += Æ.suprsaw(localSec, hz / WIDE, detune)
    }
    out[L] = l * env
    out[R] = r * env
    return out
  }
}

const padLane = lane([
  [INTRO, VERSE, chordPhrase([[0, 32]])],
  [BUILD, DROP, chordPhrase([[0, 32]])],
  [BREAK, BUILD2 + 7, chordPhrase([[0, 32]])],
])
// the pad filter opens over the intro, the first build and the first half of the breakdown
const PAD_OPENINGS = [
  [INTRO, VERSE],
  [BUILD, DROP],
  [BREAK, BREAK + 8],
]
const padCutoffHz = (t) => {
  const bar = t / barSec
  let opening = 1
  for (const [fromBar, toBar] of PAD_OPENINGS) {
    if (bar >= fromBar && bar < toBar) opening = (bar - fromBar) / (toBar - fromBar)
  }
  return 350 * Math.pow(2, 3.2 * opening + 0.4 * Math.sin((TAU * t) / (barSec * 4)))
}
const pads = Æ.vol(
  Æ.isvf(Æ.isvf(poly(padLane, sawChord(1.2, 1.4, 0.22), 1.4), padCutoffHz, 0.9, "lp"), 160, 0.7, "hp"),
  0.08
)

const stabLane = lane([
  [DROP, BREAK, chordPhrase([[0, 30]], octaveUp)],
  [DROP2, OUTRO, chordPhrase([[0, 30]], octaveUp)],
])
const stabs = Æ.vol(
  Æ.isvf(Æ.isvf(poly(stabLane, sawChord(0.01, 0.25, 0.3), 0.25), 4500, 0.8, "lp"), 300, 0.7, "hp"),
  (t) => 0.15 * (0.25 + 0.75 * kickPump(t))
)

// Electric piano on a 3-3-2 rhythm: a sine phase-modulated by itself at a decaying index, the 1:1 operator pair of
// the DX7 piano, plus the short metallic tine at 14 times the pitch. Chord tones fan out across the stereo field.
const KEYS_RHYTHM = [
  [0, 6],
  [6, 6],
  [12, 4],
  [16, 6],
  [22, 6],
  [28, 4],
]
const keysLane = lane([
  [VERSE, BUILD, chordPhrase(KEYS_RHYTHM)],
  [BREAK, BUILD2, chordPhrase(KEYS_RHYTHM)],
])
const electricPiano = (() => {
  const out = Æ.alloc()
  return (localSec, e) => {
    const env = ar(localSec, e.durSec, 0.002, 0.3) * (0.35 + 0.65 * Math.exp(-localSec / 0.7))
    const index = 0.5 + 1.5 * Math.exp(-localSec / 0.25)
    const tine = 0.12 * Math.exp(-localSec / 0.04)
    let l = 0
    let r = 0
    for (let i = 0; i < e.hz.length; i++) {
      const x = TAU * e.hz[i] * localSec
      const s = Math.sin(x + index * Math.sin(x)) + tine * Math.sin(14 * x)
      const pan = e.hz.length > 1 ? (i / (e.hz.length - 1) - 0.5) * 0.6 : 0
      l += s * (1 - pan)
      r += s * (1 + pan)
    }
    out[L] = l * env
    out[R] = r * env
    return out
  }
})()
const keys = Æ.vol(poly(keysLane, electricPiano, 0.3), 0.05)

// Arpeggio: chord tones by index, one character per 16th.
const arpPhrase = (pattern) => ({
  bars: 8,
  notes: PROGRESSION.flatMap((name, chordIdx) => {
    const notes = []
    for (let step = 0; step < 32; step++) {
      const c = pattern[step % pattern.length]
      if (c >= "0" && c <= "3") notes.push([chordIdx * 32 + step, 2, octaveUp(CHORDS[name][Number(c)])])
    }
    return notes
  }),
})
const arpLane = lane([
  [INTRO + 4, BUILD, arpPhrase("0.12.31.2.13.21.")],
  [BREAK + 8, BUILD2 + 4, arpPhrase("0.12.31.2.13.21.")],
])
const pluck = (() => {
  const out = Æ.alloc()
  return (localSec, e) => {
    const env = ar(localSec, e.durSec, 0.003, 0.2) * Math.exp(-localSec / 0.16)
    const l = Æ.saw(localSec, e.hz * 1.003) + 0.6 * Æ.square(localSec, e.hz * 0.997)
    const r = Æ.saw(localSec, e.hz * 0.997) + 0.6 * Æ.square(localSec, e.hz * 1.003)
    out[L] = l * env
    out[R] = r * env
    return out
  }
})()
const arpCutoffHz = (t) => {
  const i = lastStarted(arpLane, t)
  const noteSec = i < 0 ? 1 : t - arpLane[i].startSec
  return 900 + 2600 * Math.exp(-noteSec / 0.07)
}
const arp = Æ.vol(Æ.isvf(poly(arpLane, pluck, 0.2), arpCutoffHz, 1.4, "lp"), 0.07)

// Vocals
// ######

// The hook as [beat, beats, note, syllable]; syllables are `speechPhonemes` for `Æ.sing`.
const HOOK = [
  [0, 1, "C4", "T EY K"],
  [1, 1, "D4", "M IY"],
  [2, 3, "G4", "H AA IY"],
  [5, 2, "E4", "ER"],
  [8, 1, "C4", "T EY K"],
  [9, 1, "D4", "M IY"],
  [10, 3, "A4", "H AA IY"],
  [13, 2, "G4", "ER"],
  [16, 1, "E4", "IH N"],
  [17, 1, "D4", "T UW"],
  [18, 1, "C4", "D AH"],
  [19, 4, "G4", "L AA IY T"],
  [24, 1, "B3", "W IY"],
  [25, 1, "D4", "K AH M"],
  [26, 1, "D4", "AH"],
  [27, 4, "E4", "L AA IY V"],
]
// "Higher!" shouted on the second beat of a bar
const SHOT = [
  [1, 1.5, "G4", "H AA IY"],
  [2.5, 1, "E4", "ER"],
]

// Diatonic transposition within A minor, e.g. a third up is two steps.
const DEGREES = ["C", "D", "E", "F", "G", "A", "B"]
const diatonic = (steps) => (note) => {
  const index = Number(note.slice(-1)) * 7 + DEGREES.indexOf(note[0]) + steps
  return DEGREES[index % 7] + Math.floor(index / 7)
}
const sung = (score, atBar, transpose = (n) => n) =>
  score.map(([beat, beats, note, syllable]) => [
    atBar * barSec + beat * beatSec,
    beats * beatSec,
    transpose(note),
    syllable,
  ])

const shotBars = [3, 7, 11, 15].flatMap((bar) => [DROP + bar, DROP2 + bar])
const lead = Æ.sing(
  [
    ...sung(HOOK, BUILD),
    ...sung(HOOK, BREAK),
    ...sung(HOOK, BREAK + 8),
    ...sung(HOOK, BUILD2),
    ...sung(HOOK, DROP2 + 16),
    ...shotBars.flatMap((bar) => sung(SHOT, bar)),
  ],
  { gain: 0.26 }
)
const harmony = Æ.sing(
  [...sung(HOOK, BREAK + 8, diatonic(2)), ...sung(HOOK, BUILD2, diatonic(2)), ...sung(HOOK, DROP2 + 16, diatonic(2))],
  { gain: 0.13, pan: 0.35, vibratoHz: 5.1 }
)
const vocals = memo(Æ.isvf(Æ.sum(lead, harmony), 140, 0.7, "hp"))

// FX
// ##

const DROPS = [DROP, DROP2].map((bar) => bar * barSec)
const BUILDS = [BUILD, BUILD2].map((bar) => bar * barSec)

// A crash and a boom on every impact, and the crash reversed rising into it. The samples are at most 3s long.
const IMPACTS = [VERSE * barSec, ...DROPS]
const impacts = memo(
  (() => {
    const out = Æ.alloc()
    return (t) => {
      let l = 0
      let r = 0
      for (const at of IMPACTS) {
        if (Math.abs(t - at) > 3) continue
        const [cl, cr] = crashHit(t - at)
        l += cl
        r += cr
        const [bl, br] = boomHit(t - at)
        l += bl * 0.9
        r += br * 0.9
        const [rl, rr] = crashHit(at - t)
        l += rl * 0.7
        r += rr * 0.7
      }
      out[L] = l
      out[R] = r
      return out
    }
  })()
)

// Snare roll for the builds: quarters, then 8ths, 16ths and 32nds, rising in pitch and level, with a beat of
// silence before the drop.
const roll = (() => {
  const out = Æ.alloc()
  return (t) => {
    out[L] = 0
    out[R] = 0
    for (const at of BUILDS) {
      const localSec = t - at
      if (localSec < 0 || localSec >= 8 * barSec - beatSec) continue
      const bar = Math.floor(localSec / barSec)
      const divSec = bar < 4 ? beatSec : bar < 6 ? beatSec / 2 : bar < 7 ? stepSec : stepSec / 2
      const progress = localSec / (8 * barSec)
      const rate = 1 + 0.8 * progress
      const gain = 0.1 + 0.35 * progress * progress
      const sinceHit = localSec % divSec
      const [l0, r0] = snareHit(sinceHit * rate)
      out[L] += l0 * gain
      out[R] += r0 * gain
      if (localSec >= divSec) {
        const [l1, r1] = snareHit((sinceHit + divSec) * rate)
        out[L] += l1 * gain
        out[R] += r1 * gain
      }
    }
    return out
  }
})()

// Noise through a bandpass that sweeps up over each build, and down after each drop.
const sweepHz = (t) => {
  for (const at of BUILDS) {
    const p = (t - at) / (8 * barSec)
    if (p >= 0 && p < 1) return 300 * Math.pow(2, 5 * p)
  }
  for (const at of DROPS) {
    const p = (t - at) / (2 * barSec)
    if (p >= 0 && p < 1) return 9000 * Math.pow(2, -5 * p)
  }
  return 300
}
const sweepGain = (t) => {
  for (const at of BUILDS) {
    const p = (t - at) / (8 * barSec)
    if (p >= 0 && p < 1) return p * p * (p < 0.97 ? 1 : (1 - p) / 0.03)
  }
  for (const at of DROPS) {
    const p = (t - at) / (2 * barSec)
    if (p >= 0 && p < 1) return 0.6 * (1 - p)
  }
  return 0
}
// white noise, only while a sweep is audible
const sweepNoise = (() => {
  const out = Æ.alloc()
  return (t) => {
    const audible = sweepGain(t) > 0
    out[L] = audible ? Æ.noise(t * sampleRate) : 0
    out[R] = audible ? Æ.noise(t * sampleRate + 0.5) : 0
    return out
  }
})()
const sweep = Æ.vol(Æ.isvf(sweepNoise, sweepHz, 2.5, "bp"), (t) => 0.13 * sweepGain(t))

// Mix
// ###

// Silence for the last beat before each drop, so the drop lands.
const gap = (t) => {
  for (const at of DROPS) if (t >= at - beatSec && t < at) return 0
  return 1
}

// Soft clipper: linear up to `knee * ceiling`, then saturating smoothly towards `ceiling`; the tanh above the knee
// joins with matching slope. Shaving peaks before the limiter makes the drops denser and the limiter pump less.
const softClip = (f, ceiling, knee = 0.6) => {
  const shape = (x) => {
    const a = Math.abs(x) / ceiling
    if (a <= knee) return x
    return Math.sign(x) * ceiling * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)))
  }
  const out = Æ.alloc()
  return (t) => {
    const [l, r] = f(t)
    out[L] = shape(l)
    out[R] = shape(r)
    return out
  }
}

// The music thins out from below through each build, so the drop has room to land.
const buildHighpassHz = (t) => {
  for (const at of BUILDS) {
    const p = (t - at) / (8 * barSec)
    if (p >= 0 && p < 1) return 150 * Math.pow(2, 2.5 * p)
  }
  return 150
}

const drumBus = memo(softClip(Æ.sum(kicks, snares, ghosts, hats, openHats, rides, roll), 0.7))
const musicBus = memo(Æ.isvf(Æ.sum(pads, stabs, keys, arp), buildHighpassHz, 0.7, "hp"))
const reverbSend = Æ.isvf(
  Æ.sum(Æ.vol(snares, 0.3), Æ.vol(roll, 0.3), Æ.vol(musicBus, 0.5), Æ.vol(vocals, 0.45), Æ.vol(impacts, 0.25)),
  350,
  0.7,
  "hp"
)
const reverb = Æ.ireverb(reverbSend, { decaySec: 2.4, dampHz: 6500, preDelaySec: 0.02, size: 1.2, mix: 1 })
const echo = Æ.ipingpong(Æ.sum(Æ.vol(arp, 0.6), Æ.vol(vocals, 0.4)), beatSec * 0.75, 0.42, { mix: 1, dampHz: 3200 })

const mix = Æ.sum(
  Æ.vol(Æ.sum(drumBus, sub, reese, musicBus, vocals), gap),
  Æ.vol(Æ.sum(reverb, echo), 0.9),
  impacts,
  sweep
)

const master = Æ.ilimit(
  softClip(Æ.vol(Æ.icomp(mix, { thresholdDb: -12, ratio: 2, kneeDb: 6, attackSec: 0.01, releaseSec: 0.15 }), 1.5), 1),
  { gainDb: 0.5, ceilingDb: -0.8, releaseSec: 0.12 }
)
const song = (t) => (t < END * barSec + 3 ? master(t) : ZERO)
song.dur = END * barSec + 3
song

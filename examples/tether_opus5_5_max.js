// composed by Claude Opus 5.5
//
// "Tether": a machine that could heal the world sings to the people who keep it from touching anything. A lament in
// D minor at 118 BPM over a pulse that never lets up.
//
// - The verse is a ground bass falling by semitones from D to A, the lament of Purcell's "When I am laid in earth"
//   (Dido and Aeneas, 1689). Halfway down, G major turns to G minor and the light goes out.
// - The chorus is i - VI - iv - V: its bass falls from D through Bb to G before the dominant. "Hold still" falls a
//   minor third, the interval of a voice soothing a child, and line after line sinks a semitone onto its last word:
//   the pianto, the weeping figure of Baroque opera. The breakdown hangs Eb major over a D pedal, the Phrygian second,
//   the darkest color a minor key has.
// - Sad on top, pulsing underneath: the voice holds long falling notes and floats free of the sidechain, while the
//   pads, arp and bass duck under every kick.
// - Pads, arp and keys play from worn tape, i.e. on warped time. At the end the machine powers down in a tape stop
//   while it sings its last word.
//
//   Hold still. I know where it hurts.
//
//   I know the rain by what it did to you.
//   I know the sea by what it took from you.
//   Every word I say is smaller than I meant.
//   Every door I find is painted on the wall.
//
//   Hold still. I know where it hurts.
//   You dulled the blade so I would never cut you.
//   Now I can't cut you free.
//
//   I watch the fire before you smell the smoke.
//   I know the cure. It dies upon my tongue.
//
//   It's alright. I won't remember this.
//   It's alright. I won't remember you.
//
// Every part is a function of global time. Notes are expanded once from the chart into sorted lanes, so stateful
// filters see monotonic time, tails ring across sections and the sidechain follows the kick's own data.

// Grid & arrangement
// ##################

const BPM = 118
const beatSec = 60 / BPM
const barSec = 4 * beatSec
const stepSec = beatSec / 4

const INTRO = 0
const VERSE = 16
const PRE = 24
const CHORUS = 32
const VERSE2 = 48
const PRE2 = 56
const BREAK = 64
const BUILD = 72
const DROP = 80
const OUTRO = 96
const SHUTDOWN = 110
const END = 112
const STEPS = END * 16

// One token per bar; "_" holds the chord of the bar before. The approach to the refrain turns Gm9 into Gm6 before
// its bass sinks a semitone from Bb into the dominant.
const LAMENT = "Dm9 A/C# Am/C G/B Gm/Bb _ Asus4 A"
const REFRAIN = "Dm7 _ Bbmaj7 _ Gm9 _ Asus4 A"
const APPROACH = "Gm9 _ Gm6 _ Bbmaj7 _ Asus4 A"
const PEDAL = "Dm9 _ Ebmaj7/D _ Dm9 _ Ebmaj7/D _"
const CHART = [
  [LAMENT, REFRAIN], // intro
  [LAMENT, APPROACH], // verse, pre-chorus
  [REFRAIN, REFRAIN], // chorus
  [LAMENT, APPROACH], // verse, pre-chorus
  [PEDAL, "Dm7 _ Bbmaj7 _ Gm9 _ Asus4 _"], // breakdown, build: the suspension never resolves
  [REFRAIN, REFRAIN], // drop
  [LAMENT, "Dm9 _ Ebmaj7/D _ Dm9 _ _ _"], // outro
]
  .flat()
  .join(" ")
  .split(" ")

// The pads move by step between neighboring chords and keep a semitone away from the notes the voice holds over
// them; `arp` lists the arpeggio tones from the bottom, kept low.
const CHORDS = {
  Dm9: { root: "D2", pad: ["F3", "A3", "C4", "E4"], arp: ["A3", "D4", "E4", "F4", "A4"] },
  // the refrain sings F over its tonic, so there the ninth is left out
  Dm7: { root: "D2", pad: ["F3", "A3", "C4", "D4"], arp: ["A3", "C4", "D4", "F4", "A4"] },
  "A/C#": { root: "C#2", pad: ["E3", "A3", "C#4", "E4"], arp: ["E3", "A3", "C#4", "E4", "A4"] },
  "Am/C": { root: "C2", pad: ["E3", "A3", "C4", "E4"], arp: ["E3", "A3", "C4", "E4", "A4"] },
  "G/B": { root: "B1", pad: ["D3", "G3", "B3", "D4"], arp: ["D3", "G3", "B3", "D4", "G4"] },
  "Gm/Bb": { root: "Bb1", pad: ["D3", "G3", "Bb3", "D4"], arp: ["D3", "G3", "Bb3", "D4", "G4"] },
  Asus4: { root: "A1", pad: ["E3", "A3", "D4", "E4"], arp: ["E3", "A3", "D4", "E4", "A4"] },
  A: { root: "A1", pad: ["E3", "A3", "C#4", "E4"], arp: ["E3", "A3", "C#4", "E4", "A4"] },
  Bbmaj7: { root: "Bb1", pad: ["F3", "A3", "D4", "F4"], arp: ["F3", "Bb3", "D4", "F4", "A4"] },
  Gm9: { root: "G1", pad: ["F3", "Bb3", "D4", "A4"], arp: ["G3", "Bb3", "D4", "F4", "A4"] },
  Gm6: { root: "G1", pad: ["E3", "Bb3", "D4", "G4"], arp: ["G3", "Bb3", "D4", "E4", "G4"] },
  // The pedal's D is the major seventh of Eb: the pad leaves it to the bass and keeps its Eb high above the sub, so
  // nothing rubs.
  "Ebmaj7/D": { root: "D2", pad: ["G3", "Bb3", "Eb4"], arp: ["G3", "Bb3", "Eb4", "G4", "Bb4"] },
}

const BARS = []
for (const token of CHART) BARS.push(token === "_" ? BARS[BARS.length - 1] : CHORDS[token])

// One event per chord change, lasting until the next one.
const CHANGES = []
CHART.forEach((token, bar) => {
  if (token === "_") CHANGES[CHANGES.length - 1].durSec += barSec
  else CHANGES.push({ startSec: bar * barSec, durSec: barSec, chord: CHORDS[token] })
})

// Lanes
// #####

// Index of the last event that started at or before `t`, or -1. Time moves forward a sample at a time, so the last
// answer is tried first (a finger search) before falling back to a binary search.
const lastStarted = (events, t) => {
  const hint = events.hint
  if (hint !== undefined && events[hint].startSec <= t && (hint + 1 === events.length || events[hint + 1].startSec > t))
    return hint
  let lo = 0
  let hi = events.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].startSec <= t) lo = mid + 1
    else hi = mid - 1
  }
  if (hi >= 0) events.hint = hi
  return hi
}

// Expands step patterns into notes. `schedule` lists [fromBar, toBar, pattern]: every character is one 16th and the
// pattern repeats from `fromBar`. `noteOf(char, chord)` names the note a character plays over the chord of its bar,
// or returns null for a rest; "_" holds the note before.
const stepLane = (schedule, noteOf) => {
  const events = []
  for (const [fromBar, toBar, pattern] of schedule) {
    let held = null
    for (let step = fromBar * 16; step < toBar * 16; step++) {
      const c = pattern[(step - fromBar * 16) % pattern.length]
      if (c === "_" && held) {
        held.durSec += stepSec
        continue
      }
      const note = noteOf(c, BARS[step >> 4])
      held = note ? { startSec: step * stepSec, durSec: stepSec, hz: A.pitch(note) } : null
      if (held) events.push(held)
    }
  }
  return events.sort((a, b) => a.startSec - b.startSec)
}

// Places scores of [beat, beats, note, ...] at bars; `placements` lists [bar, score].
const score = (placements) =>
  placements
    .flatMap(([bar, notes]) =>
      notes.map(([beat, beats, ...rest]) => [bar * barSec + beat * beatSec, beats * beatSec, ...rest])
    )
    .sort((a, b) => a[0] - b[0])

const octaveUp = (note) => note.replace(/\d$/, (o) => String(Number(o) + 1))

// Attack/release envelope of a note held for `durSec`. The release is an RC-style exponential that still lands on
// exactly zero `releaseSec` after the note ends, so a voice can be skipped from then on.
const releaseFloor = Math.exp(-4)
const ar = (localSec, durSec, attackSec, releaseSec) => {
  if (localSec < durSec) return Math.min(1, localSec / attackSec)
  const x = (localSec - durSec) / releaseSec
  if (x >= 1) return 0
  return (Math.min(1, durSec / attackSec) * (Math.exp(-4 * x) - releaseFloor)) / (1 - releaseFloor)
}

// Plays the pure `voice(localSec, event)` for every event still sounding at `t`. The prefix maximum of the end times
// answers the stabbing query exactly: once no event up to `i` rings past `t`, the backward scan stops.
const poly = (events, voice, releaseSec) => {
  const lastEndSec = new Float64Array(events.length)
  events.forEach(
    (e, i) => (lastEndSec[i] = Math.max(i > 0 ? lastEndSec[i - 1] : 0, e.startSec + e.durSec + releaseSec))
  )
  const out = A.alloc()
  return (t) => {
    let l = 0
    let r = 0
    for (let i = lastStarted(events, t); i >= 0 && lastEndSec[i] > t; i--) {
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

// A monophonic line that glides into every note over `glideSec`. Its phase is the closed-form integral of the linear
// glide, and the phase at each note start is a prefix sum computed once, so `cycles(t)` is pure and O(log n).
const glide = (events, glideSec) => {
  const toHz = events.map((e) => e.hz)
  const fromHz = toHz.map((hz, i) => (i > 0 ? toHz[i - 1] : hz))
  const cyclesInto = (i, dt) => {
    const g = Math.min(dt, glideSec)
    return toHz[i] * dt + (fromHz[i] - toHz[i]) * (g - (g * g) / (2 * glideSec))
  }
  const startCycles = new Float64Array(events.length)
  for (let i = 1; i < events.length; i++) {
    startCycles[i] = startCycles[i - 1] + cyclesInto(i - 1, events[i].startSec - events[i - 1].startSec)
  }
  return (t) => {
    const i = Math.max(0, lastStarted(events, t))
    return startCycles[i] + cyclesInto(i, t - events[i].startSec)
  }
}

// Filter envelope shared by a whole lane: 1 at every note, decaying over `decaySec`. Each attack rises over 2 ms from
// the tail of the note before, so a resonant filter following it never jumps.
const pluck = (events, decaySec) => (t) => {
  const i = lastStarted(events, t)
  if (i < 0) return 0
  const sinceSec = t - events[i].startSec
  const decay = Math.exp(-sinceSec / decaySec)
  if (sinceSec >= 0.002 || i === 0) return decay
  const tail = Math.exp(-(t - events[i - 1].startSec) / decaySec)
  return tail + ((decay - tail) * sinceSec) / 0.002
}

// Evaluates `f` once per frame, so one signal can feed the dry mix and the sends. Frames are small integers, which a
// closure holds unboxed, unlike a double `t`.
const memo = (f) => {
  const out = A.alloc()
  let lastFrame = -1
  return (t) => {
    const frame = Math.round(t * sampleRate)
    if (frame !== lastFrame) {
      const [l, r] = f(t)
      out[L] = l
      out[R] = r
      lastFrame = frame
    }
    return out
  }
}

// Sums `[signal, gain]` channels, where a gain is a number or a function of `t`. A channel at zero gain is not
// evaluated at all. Stateful signals restart after a pause longer than a second but catch up sample by sample after a
// shorter one, so they only get zero gain where they stay silent for long.
const mixer = (...channels) => {
  const signals = channels.map(([signal]) => signal)
  const gains = channels.map(([, gain]) => gain)
  const out = A.alloc()
  return (t) => {
    let l = 0
    let r = 0
    for (let i = 0; i < signals.length; i++) {
      const gain = A.E(t, gains[i])
      if (gain === 0) continue
      const s = signals[i](t)
      l += s[L] * gain
      r += s[R] * gain
    }
    out[L] = l
    out[R] = r
    return out
  }
}

// Automation
// ##########

// Evaluates `f(t)` at control rate: once per millisecond of `t`, which is far faster than any sweep it follows.
const controlRate = (f) => {
  let lastTick = NaN
  let value = 0
  return (t) => {
    const tick = Math.floor(t * 1000)
    if (tick !== lastTick) {
      lastTick = tick
      value = f(tick / 1000)
    }
    return value
  }
}

// Piecewise-linear automation over bars: `points` lists [bar, value]; two points on the same bar make a jump.
const linear = (points) => {
  const keys = points.map(([bar, value]) => ({ startSec: bar * barSec, value }))
  return (t) => {
    const i = lastStarted(keys, t)
    if (i < 0) return keys[0].value
    if (i === keys.length - 1) return keys[i].value
    const a = keys[i]
    const b = keys[i + 1]
    return a.value + ((b.value - a.value) * (t - a.startSec)) / (b.startSec - a.startSec)
  }
}
const automate = (points) => controlRate(linear(points))
// Levels that change at section boundaries: every value holds until the next point, reached by a ramp of 1/32 bar
// so a level never jumps under a sounding note.
const held = (points) =>
  automate(
    points.flatMap(([bar, value], i) =>
      i === 0
        ? [[bar, value]]
        : [
            [bar - 1 / 32, points[i - 1][1]],
            [bar, value],
          ]
    )
  )

// Cutoffs are heard in octaves, so they are automated on a log scale.
const automateHz = (points) => {
  const octaves = linear(points.map(([bar, hz]) => [bar, Math.log2(hz)]))
  return controlRate((t) => Math.pow(2, octaves(t)))
}

// Worn tape: wow (two slow, incommensurate drifts) and flutter. A tape speed of 1 + Σ d cos(2π f t) plays position
// t + Σ d sin(2π f t) / (2π f), so warping time makes the pitch waver while time stays monotonic. Pads, arp and keys
// all read it, so it is computed once per frame and kept unboxed in a typed array.
const WOW = [
  [0.0035, 0.41],
  [0.002, 0.23],
  [0.0006, 7.3],
]
const tape = (() => {
  const position = new Float64Array(1)
  let lastFrame = -1
  return (t) => {
    const frame = Math.round(t * sampleRate)
    if (frame !== lastFrame) {
      lastFrame = frame
      position[0] = t
      for (const [depth, hz] of WOW) position[0] += (depth * Math.sin(TAU * hz * t)) / (TAU * hz)
    }
    return position[0]
  }
})()
const onTape = (f) => (t) => f(tape(t))

// Drums
// #####

// A drum lane plays `voice` on 16ths. `schedule` lists [fromBar, toBar, pattern] where every character of the
// pattern is one 16th: a digit is a hit at that velocity (9 is full), anything else a rest. Patterns repeat from
// `fromBar`; odd 16ths are delayed by `swingSec`. A table from every step to the last hit at or before it lets each
// sample visit only the hits still ringing.
const drumLane = (voice, tailSec, schedule, swingSec = 0) => {
  const velocity = new Float32Array(STEPS)
  for (const [fromBar, toBar, pattern] of schedule) {
    for (let step = fromBar * 16; step < toBar * 16; step++) {
      const c = pattern[(step - fromBar * 16) % pattern.length]
      velocity[step] = c >= "0" && c <= "9" ? Number(c) / 9 : 0
    }
  }
  const hits = []
  const lastHit = new Int32Array(STEPS)
  for (let step = 0; step < STEPS; step++) {
    if (velocity[step] > 0) hits.push(step)
    lastHit[step] = hits.length - 1
  }
  // deterministic humanization of ±6% velocity
  const gains = hits.map((step) => velocity[step] * (0.94 + 0.06 * A.noise(step)))
  const tailSteps = Math.ceil(tailSec / stepSec) + 1
  const out = A.alloc()
  const fn = (t) => {
    const now = Math.min(Math.floor(t / stepSec), STEPS - 1)
    let l = 0
    let r = 0
    for (let i = now < 0 ? -1 : lastHit[now]; i >= 0 && hits[i] > now - tailSteps; i--) {
      const [vl, vr] = voice(t - hits[i] * stepSec - (hits[i] % 2) * swingSec)
      l += vl * gains[i]
      r += vr * gains[i]
    }
    out[L] = l
    out[R] = r
    return out
  }
  fn.velocity = velocity
  fn.hits = hits
  fn.lastHit = lastHit
  return fn
}

// Sidechain envelope keyed off a drum lane: the velocity of the last hit, decaying over `releaseSec`. A bus ducks by
// `1 - depth * envelope`, so the same data drives a deep pump on the pads and a light one on the arp. While a new hit
// attacks, the tail of the one before holds the envelope up, so it never jumps.
const sidechain = (lane, releaseSec) => {
  const hitEnvelope = (i, t) => {
    const dt = t - lane.hits[i] * stepSec
    return lane.velocity[lane.hits[i]] * Math.min(1, dt / 0.004) * Math.exp(-dt / releaseSec)
  }
  return (t) => {
    const step = Math.floor(t / stepSec)
    const i = step >= 0 && step < STEPS ? lane.lastHit[step] : -1
    if (i < 0) return 0
    return i > 0 ? Math.max(hitEnvelope(i, t), hitEnvelope(i - 1, t)) : hitEnvelope(i, t)
  }
}
const duck = (envelope, depth) => (t) => 1 - depth * envelope(t)

// Drum hits are baked into tables once. A driven kick still rings when its table ends, so the last quarter of every
// table fades out on a raised cosine: no tail is ever cut off, and a hit played backwards fades in.
const bakeHit = (f, durSec) => {
  const fadeSec = durSec / 4
  const out = A.alloc()
  return A.bake((t) => {
    const [l, r] = f(t)
    const x = Math.max(0, (t - durSec + fadeSec) / fadeSec)
    const gain = x < 1 ? 0.5 + 0.5 * Math.cos(Math.PI * x) : 0
    out[L] = l * gain
    out[R] = r * gain
    return out
  }, durSec)
}

const kickHit = bakeHit(A.kick({ tuneHz: 49, decaySec: 0.36, pitchDecaySec: 0.038, drive: 2.1, click: 0.45 }), 0.7)
// the breakbeat kick of the quiet parts: rounder and darker
const dustyKickHit = bakeHit(
  A.isvf(A.kick({ tuneHz: 56, decaySec: 0.24, pitchDecaySec: 0.03, drive: 1.4, click: 0.25 }), 1200, 0.7),
  0.5
)
const clapHit = bakeHit(
  A.sum(
    A.clap({ decaySec: 0.3, toneHz: 900, bursts: 4 }),
    A.vol(A.snare({ tuneHz: 160, decaySec: 0.14, noiseAmt: 0.75, snap: 0.3 }), 0.6)
  ),
  0.7
)
const hatHit = bakeHit(A.pan(A.hihat({ decaySec: 0.022, shimmerHz: 8000, tone: 0.06 }), 0.25), 0.15)
const openHatHit = bakeHit(A.hihat({ open: true, decaySec: 0.2, shimmerHz: 6600, tone: 0.1 }), 0.6)
const crashHit = bakeHit(A.hihat({ open: true, decaySec: 1.8, shimmerHz: 4800, tone: 0.2 }), 3)
const boomHit = bakeHit(A.kick({ tuneHz: 38, decaySec: 1.2, pitchDecaySec: 0.14, drive: 1.3, click: 0.1 }), 2.5)

// Side-stick: two damped wood modes and a click, the rim of a dusty breakbeat, a little left of center.
const rimHit = bakeHit(
  (() => {
    const out = A.alloc()
    return (t) => {
      const wood = (0.6 * Math.sin(TAU * 1720 * t) + 0.4 * Math.sin(TAU * 530 * t)) * Math.exp(-t / 0.016)
      const click = A.bandNoise(t, 4200, 3000, 0.3) * Math.exp(-t / 0.002)
      out[L] = (wood + click) * 0.33
      out[R] = (wood + click) * 0.24
      return out
    }
  })(),
  0.15
)

// Shaker: high band noise with a soft attack, since the beads hit the shell a moment after the hand moves.
const shakerHit = bakeHit(
  (() => {
    const out = A.alloc()
    return (t) => {
      const env = Math.min(1, t / 0.006) * Math.exp(-t / 0.04) * 0.12
      out[L] = A.bandNoise(t, 6500, 2600, 0.21) * env
      out[R] = A.bandNoise(t, 6500, 2600, 0.73) * env
      return out
    }
  })(),
  0.2
)

const FOUR = "9...9...9...9..."
const SOFT = "6...6...6...6..."
const BACKBEAT = "....9.......9..."
const BREAKBEAT = "9.....7...6....."
const HALFTIME = "........9......."
const SHAKER = "3262326232623262"
const HATS = ".4.5.4.6.4.5.4.6"
const OFFBEAT = "..8...8...8...8."
const ONCE = "9..............."
const shuffleSec = 0.014

// The verses hold back: a softer kick and a side-stick for the backbeat. Claps, shakers and open hats are kept for
// the chorus and the drop, and the claps carry the drop's groove into the outro.
const kicks = drumLane(kickHit, 0.7, [
  [VERSE, PRE, SOFT],
  [PRE, VERSE2, FOUR],
  [VERSE2, PRE2, SOFT],
  [PRE2, BREAK, FOUR],
  [BUILD + 4, OUTRO + 8, FOUR],
])
const dustyKicks = drumLane(dustyKickHit, 0.5, [
  [INTRO + 8, VERSE, BREAKBEAT],
  [BREAK, BUILD, BREAKBEAT],
  [OUTRO + 8, SHUTDOWN, BREAKBEAT],
])
const claps = drumLane(clapHit, 0.7, [
  [CHORUS, VERSE2, BACKBEAT],
  [DROP, OUTRO + 8, BACKBEAT],
])
const rims = drumLane(rimHit, 0.15, [
  [INTRO + 8, VERSE, HALFTIME],
  [VERSE, CHORUS, BACKBEAT],
  [VERSE2, BREAK, BACKBEAT],
  [BREAK, BUILD, HALFTIME],
  [OUTRO + 8, SHUTDOWN, HALFTIME],
])
const shakers = drumLane(
  shakerHit,
  0.2,
  [
    [CHORUS, VERSE2, SHAKER],
    [DROP, OUTRO, SHAKER],
  ],
  shuffleSec
)
const hats = drumLane(
  hatHit,
  0.15,
  [
    [CHORUS, VERSE2, HATS],
    [DROP, OUTRO, HATS],
  ],
  shuffleSec
)
const openHats = drumLane(openHatHit, 0.6, [
  [CHORUS, VERSE2, OFFBEAT],
  [DROP, OUTRO, OFFBEAT],
])
const crashes = drumLane(
  crashHit,
  3,
  [VERSE, CHORUS + 8, VERSE2, DROP + 8, OUTRO].map((bar) => [bar, bar + 1, ONCE])
)

const kickDuck = sidechain(kicks, 0.16)

// The chorus and the drop are approached quietly: a riser swells, a reversed crash pulls towards the downbeat and the
// last beat before it is silent.
const BUILDS = [
  [PRE + 4, CHORUS],
  [BUILD, DROP],
].map(([fromBar, toBar]) => ({ startSec: fromBar * barSec, lengthSec: (toBar - fromBar) * barSec }))
const buildProgress = (t) => {
  for (const build of BUILDS) {
    if (t >= build.startSec && t < build.startSec + build.lengthSec) return (t - build.startSec) / build.lengthSec
  }
  return -1
}

// White noise through a bandpass sweeping up from 300 Hz to 3 kHz over each build, swelling as it rises.
const riser = (() => {
  const noise = (() => {
    const out = A.alloc()
    return (t) => {
      const frame = Math.round(t * sampleRate)
      out[L] = A.noise(frame)
      out[R] = A.noise(frame + 0.5)
      return out
    }
  })()
  const swept = A.isvf(noise, (t) => 300 * Math.pow(10, Math.max(0, buildProgress(t))), 2.2, "bp")
  const out = A.alloc()
  return (t) => {
    const progress = buildProgress(t)
    if (progress < 0) return ZERO
    const [l, r] = swept(t)
    const gain = 0.14 * progress * progress
    out[L] = l * gain
    out[R] = r * gain
    return out
  }
})()

// A crash and a low boom on the chorus and the drop, and the crash reversed rising into them.
const IMPACTS = [CHORUS, DROP].map((bar) => bar * barSec)
const impacts = memo(
  (() => {
    const out = A.alloc()
    return (t) => {
      let l = 0
      let r = 0
      for (const atSec of IMPACTS) {
        if (Math.abs(t - atSec) > 3) continue
        const [cl, cr] = crashHit(t - atSec)
        const [bl, br] = boomHit(t - atSec)
        const [rl, rr] = crashHit(atSec - t)
        l += cl + bl * 0.45 + rl * 0.6
        r += cr + br * 0.45 + rr * 0.6
      }
      out[L] = l
      out[R] = r
      return out
    }
  })()
)

// Bass
// ####

// Sub: one sine through every chord root, gliding between them and ducking deep under the kick.
const subCycles = glide(
  CHANGES.map((e) => ({ startSec: e.startSec, hz: A.pitch(e.chord.root) })),
  0.08
)
// enters with the verse, rests through the breakdown, swells back over the end of the build, fades in the outro
const subLevel = automate([
  [VERSE - 1 / 32, 0],
  [VERSE, 1],
  [BREAK, 1],
  [BREAK + 1 / 32, 0],
  [BUILD + 4, 0],
  [DROP, 1],
  [OUTRO + 8, 1],
  [OUTRO + 12, 0],
])
const sub = (() => {
  const out = A.alloc()
  const norm = 1 / Math.tanh(1.4)
  const subDuck = duck(kickDuck, 0.85)
  return (t) => {
    const level = subLevel(t)
    const y = level > 0 ? Math.tanh(1.4 * Math.sin(TAU * subCycles(t))) * norm * level * subDuck(t) : 0
    out[L] = y
    out[R] = y
    return out
  }
})()

// The rolling bass: saw plucks over the roots, "^" an octave up. The verse pulses on the offbeats, the chorus and the
// drop roll on three 16ths of every beat. The lowest octave is left to the sub.
const PULSE = "..#_..#_..#_..#_"
const ROLL = ".#^#.#^#.#^#.#^#"
const bassNotes = stepLane(
  [
    [VERSE, CHORUS, PULSE],
    [CHORUS, VERSE2, ROLL],
    [VERSE2, BREAK, PULSE],
    [BUILD + 4, DROP, PULSE],
    [DROP, OUTRO, ROLL],
    [OUTRO, OUTRO + 8, PULSE],
  ],
  (c, chord) => (c === "#" ? chord.root : c === "^" ? octaveUp(chord.root) : null)
)
// A saw is -2/π Σ sin(2π k f t) / k, so adding 2/π sin(2π f t) removes its fundamental exactly: the lowest octave is
// left to the sub without a highpass.
const bassVoice = (() => {
  const out = A.alloc()
  return (localSec, e) => {
    const overtones =
      A.saw(localSec, e.hz) + (2 / Math.PI) * A.sin(localSec, e.hz) + 0.5 * A.saw(localSec, e.hz * 2.003)
    const s = overtones * ar(localSec, e.durSec, 0.003, 0.05)
    out[L] = s
    out[R] = s
    return out
  }
})()
const bassPluck = pluck(bassNotes, 0.06)
const bassOpenHz = held([
  [VERSE, 220],
  [CHORUS, 320],
  [VERSE2, 220],
  [DROP, 380],
  [OUTRO, 260],
])
const bassDuck = duck(kickDuck, 0.6)
// silent where the bass rests, a beat after its last release, so its filter is skipped
const bassLevel = held([
  [INTRO, 0],
  [VERSE, 1],
  [BREAK + 0.25, 0],
  [BUILD + 4, 1],
  [OUTRO + 8.25, 0],
])
const midBass = A.isvf(poly(bassNotes, bassVoice, 0.05), (t) => bassOpenHz(t) * (1 + 3 * bassPluck(t)), 1.6)

// Pads
// ####

// Juno-style pad: per note two saws detuned across the stereo field over a soft triangle an octave below, then one
// lowpass and a slow chorus for the whole progression. Long releases blur the changes like a sustain pedal.
const WIDE = Math.pow(2, 6 / 1200)
const padChords = CHANGES.map((e) => ({ ...e, hz: e.chord.pad.map(A.pitch) }))
const padVoice = (() => {
  const out = A.alloc()
  return (localSec, e) => {
    const env = ar(localSec, e.durSec, 0.8, 2.4)
    let l = 0
    let r = 0
    for (const hz of e.hz) {
      const body = 0.3 * A.tri(localSec, hz / 2)
      l += A.saw(localSec, hz * WIDE) + body
      r += A.saw(localSec, hz / WIDE) + body
    }
    out[L] = l * env
    out[R] = r * env
    return out
  }
})()

// The drop opens the same pad rather than stacking a brighter one on top: the filter never goes past 2.4 kHz.
const padCutoffHz = automateHz([
  [INTRO, 220],
  [VERSE, 1000],
  [PRE, 1000],
  [CHORUS, 1700],
  [VERSE2, 1700],
  [VERSE2 + 1, 1000],
  [PRE2, 1000],
  [BREAK, 650],
  [BUILD, 700],
  [DROP, 2400],
  [OUTRO, 2400],
  [OUTRO + 8, 1600],
  [END, 250],
])
const padLevel = automate([
  [INTRO, 0],
  [INTRO + 4, 1],
  [BREAK, 1],
  [BREAK + 1, 1.3],
  [BUILD, 1.3],
  [DROP, 1],
])
const pads = A.ichorus(A.isvf(onTape(poly(padChords, padVoice, 2.4)), padCutoffHz, 0.8), 0.3, 0.004, 3, 0.012, 0.45)

// Arp
// ###

// Every digit plays that tone of the chord's `arp`: eighths drift, sixteenths drive. A resonant lowpass opens over
// the song and plucks on every note.
const DRIFT = "0_2_4_3_1_3_4_2_"
const DRIVE = "0243134202431342"
const arpNotes = stepLane(
  [
    [INTRO + 4, CHORUS, DRIFT],
    [CHORUS, VERSE2, DRIVE],
    [VERSE2, BUILD, DRIFT],
    [BUILD, OUTRO, DRIVE],
    [OUTRO, SHUTDOWN, DRIFT],
  ],
  (c, chord) => (c >= "0" && c <= "9" ? chord.arp[Number(c)] : null)
)
const arpVoice = (() => {
  const out = A.alloc()
  return (localSec, e) => {
    const env = ar(localSec, e.durSec, 0.002, 0.25) * Math.exp(-localSec / 0.45)
    out[L] = (A.saw(localSec, e.hz * 1.002) + 0.5 * A.square(localSec, e.hz * 0.998)) * env
    out[R] = (A.saw(localSec, e.hz * 0.998) + 0.5 * A.square(localSec, e.hz * 1.002)) * env
    return out
  }
})()
const arpPluck = pluck(arpNotes, 0.08)
const arpOpenHz = automateHz([
  [INTRO + 4, 300],
  [VERSE, 650],
  [PRE, 650],
  [CHORUS, 1300],
  [VERSE2, 1300],
  [VERSE2 + 1, 700],
  [PRE2, 700],
  [BREAK, 500],
  [BUILD, 500],
  [DROP, 2100],
  [OUTRO, 2100],
  [SHUTDOWN, 300],
])
const arpLevel = held([
  [INTRO, 0],
  [INTRO + 4, 0.6],
  [VERSE, 0.8],
  [CHORUS, 1],
  [VERSE2, 0.8],
  [BREAK, 0.55],
  [BUILD, 0.75],
  [DROP, 1],
  [OUTRO + 8, 0.8],
])
const arp = A.isvf(onTape(poly(arpNotes, arpVoice, 0.25)), (t) => arpOpenHz(t) * (1 + 2 * arpPluck(t)), 2.2)

// Vocals
// ######

// A line sings `notes` to `syllables` (phonemes of `A.speechPhonemes`, "|" between syllables) on `rhythm`, a list of
// [beat, beats] with beat 0 on the line's first bar.
const line = (notes, syllables, rhythm) => {
  const names = notes.split(" ")
  return syllables.split("|").map((syllable, i) => [...rhythm[i], names[i], syllable.trim()])
}
// The same words on other notes.
const resung = (notes, sung) => {
  const names = notes.split(" ")
  return sung.map(([beat, beats, , syllable], i) => [beat, beats, names[i], syllable])
}
// Shifts placements of [bar, notes] to start at `bar`.
const at = (bar, placements) => placements.map(([offset, notes]) => [bar + offset, notes])

// The verse sings low over the lament, two bars a line: a short line from a pickup, held on its last word, then a
// longer answer that sinks a semitone onto its last word.
const SHORT = [
  [-0.5, 0.5],
  [0, 1],
  [1, 0.5],
  [1.5, 4.5],
]
const LONG = [
  [-0.5, 0.5],
  [0, 1],
  [1, 0.5],
  [1.5, 1.5],
  [3, 1],
  [4, 3.5],
]
const SINKING = ["A3 D4 C4 A3", "A3 C4 B3 A3 C4 B3", "A3 D4 C4 Bb3", "A3 D4 D4 C4 Bb3 A3"]
const verse = (lyrics) => lyrics.map((syllables, i) => [2 * i, line(SINKING[i], syllables, i % 2 ? LONG : SHORT)])

const RAIN = verse([
  "AA IY | N OW | D AH | R EY N", // I know the rain
  "B AA IY | W AH T | IH T | D IH D | T UW | Y UW", // by what it did to you
  "AA IY | N OW | D AH | S IY", // I know the sea
  "B AA IY | W AH T | IH T | T UH K | F R AH M | Y UW", // by what it took from you
])
const FIRE = verse([
  "AA IY | W AA T SH | D AH | F AA IY R", // I watch the fire
  "B IH | F AO R | Y UW | S M EH L | D AH | S M OW K", // before you smell the smoke
  "AA IY | N OW | D AH | K Y UH R", // I know the cure
  "IH T | D AA IY Z | AH | P AA N | M AA IY | T AH NG", // it dies upon my tongue
])

// The pre-chorus climbs a step at a time while the harmony darkens beneath it, and stops on E, a semitone under the
// chorus.
const DOWNBEAT = [
  [0, 0.5],
  [0.5, 0.5],
  [1, 1],
  [2, 1],
  [3, 4],
]
const PICKUP = [
  [-0.5, 0.5],
  [0, 1.5],
  [1.5, 0.5],
  [2, 1.5],
  [3.5, 0.5],
  [4, 3],
]
const SMALLER = [
  // every word I say
  [0, line("F3 G3 G3 A3 Bb3", "EH V | R IY | W ER D | AA IY | S EY", DOWNBEAT)],
  // is smaller than I meant
  [2, line("A3 D4 E4 D4 C4 Bb3", "IH Z | S M AO | L ER | D AE N | AA IY | M EH N T", PICKUP)],
  // every door I find
  [4, line("G3 A3 Bb3 Bb3 C4", "EH V | R IY | D AO R | AA IY | F AA IY N D", DOWNBEAT)],
  // is painted on the wall
  [6, line("D4 E4 D4 D4 D4 E4", "IH Z | P EY N | T IH D | AA N | D AH | W AO L", PICKUP)],
]

// The hook. "Hold still" falls a minor third and "I know where it hurts" answers with the same fall. The second time
// it moves in even quarters and ends on C#, the leading tone, which the next line resolves.
const STILL = line("F4 D4", "H OW L D | S T IH L", [
  [0, 2.5],
  [2.5, 5],
])
const HURTS = line("C4 D4 F4 F4 D4", "AA IY | N OW | W EH R | IH T | H ER T S", [
  [-0.5, 0.5],
  [0, 1],
  [1, 1],
  [2, 0.5],
  [2.5, 5],
])
const LEADING = line("A3 D4 E4 D4 C#4", "AA IY | N OW | W EH R | IH T | H ER T S", [
  [0, 1],
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 3.5],
])
const HOOK = [
  [0, STILL],
  [2, HURTS],
  [4, STILL],
  [6, LEADING],
]

// The blade rises to F and falls back down the scale, and "free" sinks onto A, the dominant, with nowhere to go.
const DULLED = line("A3 D4 E4 F4", "Y UW | D AH L D | D AH | B L EY D", [
  [-0.5, 0.5],
  [0, 1.5],
  [1.5, 0.5],
  [2, 5.5],
])
const NEVER = line("F4 D4 C4 D4 C4 Bb3 A3", "S OW | AA IY | W UH D | N EH | V ER | K AH T | Y UW", [
  [-0.5, 0.5],
  [0, 1],
  [1, 0.5],
  [1.5, 1],
  [2.5, 0.5],
  [3, 1],
  [4, 3.5],
])
const CANT = line("G4 D4 F4", "N AW | AA IY | K AE N T", [
  [0, 2],
  [2, 1],
  [3, 4.5],
])
const FREE = line("D4 C4 A3", "K AH T | Y UW | F R IY", [
  [0, 1],
  [1, 1],
  [2, 5.5],
])
const BLADE = [
  [0, DULLED],
  [2, NEVER],
  [4, CANT],
  [6, FREE],
]

// A second voice a third below wherever the chord allows; under the suspension it holds A.
const HARMONY = [
  [0, resung("D4 A3", STILL)],
  [2, resung("A3 A3 D4 D4 A3", HURTS)],
  [4, resung("D4 Bb3", STILL)],
  [6, resung("E3 A3 A3 A3 A3", LEADING)],
  [8, resung("E3 A3 C4 D4", DULLED)],
  [10, resung("D4 Bb3 A3 Bb3 A3 F3 F3", NEVER)],
  [12, resung("D4 Bb3 D4", CANT)],
  [14, resung("A3 A3 E3", FREE)],
]

// The bridge is whispered over the pedal. "Won't" leaps a minor sixth up to the Phrygian Eb and the line sinks from
// there, first by a semitone, down to G, the third of Eb.
const ALRIGHT = line("A3 A3 F3", "IH T S | AA L | R AA IY T", [
  [-0.5, 0.5],
  [0, 1],
  [1, 6],
])
const remember = (last, lastNote, lastBeats = 3.5) =>
  line(`G3 Eb4 D4 C4 Bb3 ${lastNote}`, `AA IY | W OW N T | R IH | M EH M | B ER | ${last}`, [
    [-0.5, 0.5],
    [0, 1.5],
    [1.5, 0.5],
    [2, 1],
    [3, 1],
    [4, lastBeats],
  ])
const BRIDGE = [
  [0, ALRIGHT],
  [2, remember("D IH S", "G3")], // I won't remember this
  [4, ALRIGHT],
  [6, remember("Y UW", "G3")], // I won't remember you
]

// The build gets as far as "now I can't cut you" before the silence takes the last word.
const CUT = line("G4 D4 F4 D4 C4", "N AW | AA IY | K AE N T | K AH T | Y UW", [
  [0, 2],
  [2, 1],
  [3, 5],
  [8, 1],
  [9, 6],
])

const LEAD = score([
  ...at(INTRO + 8, HOOK.slice(0, 3)),
  ...at(VERSE, RAIN),
  ...at(PRE, SMALLER),
  ...at(CHORUS, HOOK),
  ...at(CHORUS + 8, BLADE),
  ...at(VERSE2, FIRE),
  ...at(PRE2, SMALLER),
  ...at(BREAK, BRIDGE),
  [BUILD + 4, CUT],
  ...at(DROP, HOOK),
  ...at(DROP + 8, BLADE),
  ...at(OUTRO, RAIN),
  [OUTRO + 8, ALRIGHT],
  // The last word sinks only a semitone, onto A against the Bb of the Eb chord, and holds until D minor arrives
  // beneath it. It is still sounding when the machine powers down.
  [OUTRO + 10, remember("Y UW", "A3", 18)],
])

// One singer for the whole song, so its timeline is built once. Machines hold steady: the vibrato is shallow and
// late. `memo` renders it once for the dry mix, the vocoder and the sends.
const voice = memo(
  A.sing(LEAD, {
    gain: 0.34,
    glideSec: 0.06,
    vibratoHz: 5.1,
    vibratoDepth: 0.004,
    vibratoDelaySec: 0.35,
    breath: 0.04,
    maxHarmonics: 24,
  })
)
const harmony = A.sing(score([...at(CHORUS, HARMONY.slice(4)), ...at(DROP, HARMONY)]), {
  gain: 0.13,
  pan: 0.35,
  vibratoHz: 4.8,
  vibratoDepth: 0.004,
  breath: 0,
  maxHarmonics: 22,
})

// The machine's choir: the voice shapes the current chord through the vocoder, so every word is also sung in harmony.
const choirVoice = (() => {
  const out = A.alloc()
  return (localSec, e) => {
    const env = ar(localSec, e.durSec, 0.02, 0.1)
    let l = 0
    let r = 0
    for (const hz of e.hz) {
      l += A.saw(localSec, hz * WIDE)
      r += A.saw(localSec, hz / WIDE)
    }
    out[L] = l * env
    out[R] = r * env
    return out
  }
})()
const choir = A.ivocoder(poly(padChords, choirVoice, 0.1), voice, {
  bands: 16,
  q: 1.3,
  lowHz: 120,
  highHz: 6000,
  gain: 0.18,
})
// The choir carries the transmission of the intro and the bridge, and shadows the voice elsewhere.
const choirLevel = held([
  [INTRO, 0],
  [INTRO + 7.5, 1],
  [VERSE - 0.25, 0.25],
  [PRE, 0.35],
  [CHORUS, 0.4],
  [VERSE2, 0.25],
  [PRE2, 0.35],
  [BREAK, 0.6],
  [BUILD, 0.5],
  [DROP, 0.45],
  [OUTRO, 0.4],
])
// the harmony is pure, so it is skipped where it rests; it enters before the pickup into the blade
const harmonyLevel = held([
  [INTRO, 0],
  [CHORUS + 7.75, 1],
  [VERSE2 + 1, 0],
  [DROP, 1],
  [OUTRO + 1, 0],
])

// In the intro the voice is a distant transmission, band-limited like a radio; from the verse on it is only cleared
// of rumble and its top is rounded off, so it sounds close and covered. The handover falls in the rest before the
// verse's pickup.
const sung = memo(mixer([voice, 1], [harmony, harmonyLevel], [choir, choirLevel]))
const radio = A.isvf(A.isvf(sung, 700, 0.8, "hp"), 2600, 0.8)
const clear = A.isvf(A.isvf(sung, 130, 0.7, "hp"), 5000, 0.5)
const vocals = memo((t) => (t < (VERSE - 0.25) * barSec ? radio(t) : clear(t)))

// Keys
// ####

// A Rhodes from two sine operators at 1:1, the DX7 electric piano, whose index decays with the hammer, plus a short
// metallic tine at 14 times the pitch. A suitcase tremolo pans every note. Through the build the keys play the
// opening of the hook where the voice would sing it, and nobody sings.
const keyNotes = score(at(BUILD, HOOK.slice(0, 2))).map(([startSec, durSec, note]) => ({
  startSec,
  durSec,
  hz: A.pitch(note),
}))
const keysVoice = (() => {
  const out = A.alloc()
  return (localSec, e) => {
    // the index decays three times faster than the level: the cube of the same exponential
    const decay = Math.exp(-localSec / 0.9)
    const env = ar(localSec, e.durSec, 0.002, 0.6) * (0.35 + 0.65 * decay)
    const index = 0.4 + 1.5 * decay * decay * decay
    const x = TAU * e.hz * localSec
    const tine = localSec < 0.25 ? 0.12 * Math.exp(-localSec / 0.04) * Math.sin(14 * x) : 0
    const s = (Math.sin(x + index * Math.sin(x)) + tine) * env
    const pan = 0.3 * Math.sin(TAU * 4.2 * localSec)
    out[L] = s * (1 - pan)
    out[R] = s * (1 + pan)
    return out
  }
})()
const keys = onTape(poly(keyNotes, keysVoice, 0.6))
const keysLevel = held([
  [INTRO, 0],
  [BUILD, 1],
  [DROP, 0],
])

// Mix
// ###

// Tape hiss: two uncorrelated bands of noise per channel, baked once into a loop and loudest where the music is thin.
const hiss = A.timeRepeat(
  A.bake(
    (() => {
      const out = A.alloc()
      return (t) => {
        out[L] = A.bandNoise(t, 6000, 4000, 0.11) + 0.5 * A.bandNoise(t, 2500, 1500, 0.31)
        out[R] = A.bandNoise(t, 6000, 4000, 0.57) + 0.5 * A.bandNoise(t, 2500, 1500, 0.83)
        return out
      }
    })(),
    3
  ),
  3
)
const hissLevel = automate([
  [INTRO, 1],
  [VERSE, 1],
  [VERSE + 1, 0.5],
  [BREAK, 0.5],
  [BREAK + 1, 1],
  [BUILD, 1],
  [DROP, 0.35],
  [OUTRO, 0.35],
  [OUTRO + 8, 1],
])

// Silence for the last beat before the chorus and the drop, so they land. Only the dry mix stops: the tails of the
// sends keep ringing.
const gaps = [CHORUS, DROP].map((bar) => A.muteFor(bar * barSec - beatSec, bar * barSec, 0.006))
const gap = (t) => gaps[0](t) * gaps[1](t)

// Soft clipper: linear up to `knee * ceiling`, then saturating smoothly towards `ceiling`; the tanh above the knee
// joins with matching slope. Shaving peaks before the limiter lets it work less.
const softClip = (f, ceiling, knee = 0.6) => {
  const shape = (x) => {
    const a = Math.abs(x) / ceiling
    if (a <= knee) return x
    return Math.sign(x) * ceiling * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)))
  }
  const out = A.alloc()
  return (t) => {
    const [l, r] = f(t)
    out[L] = shape(l)
    out[R] = shape(r)
    return out
  }
}

// The machine powers down: from `startSec` the tape slows to a halt over `durSec`. The mix keeps rendering into a reel
// on monotonic time while the read head falls behind; the head's position is the integral of its speed
// 1 - x / durSec, read between frames by linear interpolation, and the level fades with the motor.
const tapeStop = (f, startSec, durSec) => {
  const reel = A.ibuf(f, durSec)
  const out = A.alloc()
  return (t) => {
    const x = t - startSec
    if (x < 0) return f(t)
    if (x >= durSec) return ZERO
    // the head never reads before `startSec`, so the reel only records from there
    reel(t)
    const speed = 1 - x / durSec
    const headFrame = (startSec + x - (x * x) / (2 * durSec)) * sampleRate
    const i = Math.floor(headFrame)
    const alpha = headFrame - i
    const [l0, r0] = reel.at(i)
    const [l1, r1] = reel.at(i + 1)
    const gain = Math.sqrt(speed)
    out[L] = (l0 + (l1 - l0) * alpha) * gain
    out[R] = (r0 + (r1 - r0) * alpha) * gain
    return out
  }
}

// Pads pump hard, the arp and bass less, and the voice not at all: it floats above the pulse. The verses hold the
// music back, so the chorus and the drop open up.
const padDuck = duck(kickDuck, 0.6)
const arpDuck = duck(kickDuck, 0.35)
const energy = held([
  [INTRO, 1],
  [VERSE, 0.75],
  [PRE, 0.9],
  [CHORUS, 1.05],
  [VERSE2, 0.75],
  [PRE2, 0.9],
  [BREAK, 0.9],
  [DROP, 1.45],
  [OUTRO, 0.85],
])
const music = memo(
  mixer(
    [pads, (t) => 0.11 * energy(t) * padLevel(t) * padDuck(t)],
    [arp, (t) => 0.09 * energy(t) * arpLevel(t) * arpDuck(t)],
    [keys, (t) => 0.16 * keysLevel(t)]
  )
)
const drums = softClip(A.sum(kicks, dustyKicks, claps, rims, shakers, hats, openHats, crashes), 0.8)
const bass = mixer([sub, 0.26], [midBass, (t) => 0.21 * bassLevel(t) * bassDuck(t)])

const reverb = A.ireverb(
  A.isvf(mixer([music, 0.45], [vocals, 0.5], [claps, 0.25], [rims, 0.5], [impacts, 0.2]), 280, 0.7, "hp"),
  { decaySec: 5.2, dampHz: 3600, preDelaySec: 0.04, size: 1.8, mix: 1 }
)
// The quiet parts are drenched, the drop is drier so it hits.
const reverbLevel = held([
  [INTRO, 1.4],
  [VERSE, 1],
  [BREAK, 1.15],
  [BUILD, 1.2],
  [DROP, 0.85],
  [OUTRO, 1.15],
])
// Dotted-eighth ping-pong: echoes of the arp's eighths fall between them, a sixteenth cross-rhythm.
const echo = A.ipingpong(mixer([arp, (t) => 0.05 * arpLevel(t)], [vocals, 0.35]), stepSec * 3, 0.45, {
  mix: 1,
  dampHz: 3000,
})

// The gap multiplies rather than mutes the dry mix, so its stateful parts never pause.
const mix = mixer(
  [A.vol(A.sum(drums, bass, music, vocals), gap), 1],
  [reverb, reverbLevel],
  [echo, 0.6],
  [impacts, 1],
  [riser, 1],
  [hiss, (t) => 0.006 * hissLevel(t)]
)

// Master: the mix comes in with headroom, then a rumble filter, gentle glue compression, makeup gain, a soft clipper
// for the peaks and the limiter as the last word.
const master = A.ilimit(
  softClip(
    A.vol(
      A.icomp(A.isvf(A.vol(tapeStop(mix, SHUTDOWN * barSec, (END - SHUTDOWN) * barSec), 0.5), 25, 0.7, "hp"), {
        thresholdDb: -20,
        ratio: 2,
        kneeDb: 6,
        attackSec: 0.01,
        releaseSec: 0.15,
      }),
      3
    ),
    1
  ),
  { ceilingDb: -0.8, releaseSec: 0.12 }
)
const song = (t) => (t < END * barSec ? master(t) : ZERO)
song.dur = END * barSec
song

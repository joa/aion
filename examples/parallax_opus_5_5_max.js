// composed by Claude Opus 5.5
//
// "Parallax": progressive house that drops like trance. 128 BPM, F minor, Db - Ab - Eb - Fm, two bars per chord.
//
// - The ostinato is a chain of sighs: its top voice falls one scale step per half bar from F5 down to F4, so most
//   chord changes arrive on a suspension that resolves downward (Db over Ab, Ab over Eb). The last bar climbs
//   back up to start the fall again.
// - The sound design is about filters and pumping: saw chords under a resonant lowpass that opens over sixteen
//   bars, a bass whose mid layer growls through a resonant filter on a two-bar LFO, a square lead with a
//   resonant filter pluck, and everything melodic ducking under the kick.
// - The builds are trance: accelerating snare rolls, a noise riser, a reversed crash, one beat of silence, then
//   gated chords and a doubled hook on the drop.
//
// Mix: every part returns a dry signal plus sends for the reverb and the ping-pong echo. The effects run outside
// `song` on global time, so their tails ring across part boundaries.

const BPM = 128
const tempo = A.tempoBpm(BPM)
const beatSec = 60 / BPM
const stepSec = beatSec / 4
const bar = (n) => n * 4 * beatSec

const layers = (...fs) => A.sum(...fs.filter(Boolean))

// Plays `f` in its own local time from bar `fromBar` until bar `toBar`; it is not evaluated outside.
const span = (f, fromBar, toBar = Infinity) => {
  const startSec = bar(fromBar)
  const endSec = bar(toBar)
  return (t) => (t >= startSec && t < endSec ? f(t - startSec) : ZERO)
}

// Sidechain-style pump keyed to the kick on every quarter note.
const pump = (f, depth = 0.6, releaseSec = 0.16) => {
  const out = A.alloc()
  return (t) => {
    const [l, r] = f(t)
    const g = 1 - depth * Math.exp(-(t % beatSec) / releaseSec)
    out[0] = l * g
    out[1] = r * g
    return out
  }
}

// Trance gate: "#" steps are open, "-" steps closed. Short ramps keep the edges from clicking.
const gate = (f, steps) => {
  const open = steps.split("").map((s) => s === "#")
  const out = A.alloc()
  return (t) => {
    const step = Math.floor(t / stepSec)
    const x = t - step * stepSec
    const g = open[step % open.length] ? Math.min(1, x / 0.002, Math.max(0, (stepSec * 0.8 - x) / 0.006)) : 0
    if (g === 0) return ZERO
    const [l, r] = f(t)
    out[0] = l * g
    out[1] = r * g
    return out
  }
}

// Sample-and-hold downsampling: a pure bitcrusher-style grit, since it only quantizes time.
const downsample = (f, rateHz) => (t) => f(Math.floor(t * rateHz) / rateHz)

// Exponential sweep from `fromHz` to `toHz` over `bars` bars, then held.
const sweep = (fromHz, toHz, bars) => (t) => fromHz * Math.pow(toHz / fromHz, Math.min(1, t / bar(bars)))

// Harmony
// #######
const PROGRESSION = [
  { root: "Db2", pad: ["Db3", "F3", "Ab3", "C4"] },
  { root: "Ab1", pad: ["C3", "Eb3", "Ab3", "C4"] },
  { root: "Eb2", pad: ["Bb2", "Eb3", "G3", "Bb3"] },
  { root: "F1", pad: ["C3", "F3", "Ab3", "C4"] },
]

// One bar per line, 16th steps. "_" holds the previous note, "." is silence.
// Each bar is "top, inner, inner" twice in a 3-3-2 rhythm, and the second top note is one step below the first.
const OSTINATO = [
  "F5 _ _ Ab4 _ _ F4 _ Eb5 _ _ Ab4 _ _ F4 _",
  "Eb5 _ _ Ab4 _ _ F4 _ Db5 _ _ Ab4 _ _ F4 _",
  "Db5 _ _ Ab4 _ _ Eb4 _ C5 _ _ Ab4 _ _ Eb4 _",
  "C5 _ _ Ab4 _ _ Eb4 _ Bb4 _ _ Ab4 _ _ Eb4 _",
  "Bb4 _ _ Eb4 _ _ Bb3 _ Ab4 _ _ Eb4 _ _ Bb3 _",
  "Ab4 _ _ Eb4 _ _ Bb3 _ G4 _ _ Eb4 _ _ Bb3 _",
  "G4 _ _ C4 _ _ Ab3 _ F4 _ _ C4 _ _ Ab3 _",
  "Ab4 _ _ C4 _ _ F4 _ C5 _ _ Ab4 _ _ Eb5 _",
]
  .join(" ")
  .split(" ")

const HOOK = [
  "Ab4 _ _ C5 _ _ Db5 _ C5 _ Ab4 _ F4 _ _ _",
  ". . . . Eb4 _ F4 _ Ab4 _ _ _ _ _ _ _",
  "C5 _ _ Eb5 _ _ F5 _ Eb5 _ C5 _ Ab4 _ _ _",
  ". . . . Ab4 _ Bb4 _ C5 _ _ _ _ _ _ _",
  "Bb4 _ _ Eb5 _ _ G5 _ F5 _ Eb5 _ Bb4 _ _ _",
  ". . . . G4 _ Ab4 _ Bb4 _ _ _ _ _ _ _",
  "C5 _ _ F5 _ _ Ab5 _ G5 _ F5 _ C5 _ _ _",
  "Eb5 _ _ C5 _ _ Ab4 _ G4 _ _ _ . . . .",
]
  .join(" ")
  .split(" ")

const shiftOctave = (note, octaves) => note.replace(/\d+$/, (o) => String(Number(o) + octaves))
const transpose = (tokens, octaves) =>
  tokens.map((token) => (token === "_" || token === "." ? token : shiftOctave(token, octaves)))

// One voice per note start, made by `makeVoice(note, steps)` where `steps` counts the held steps.
const noteVoices = (tokens, makeVoice) =>
  tokens.map((token, i) => {
    if (token === "." || token === "_") return null
    let steps = 1
    while (tokens[i + steps] === "_") steps++
    return makeVoice(token, steps)
  })

// Synths
// ######
// The ostinato pluck: a soft saw pair whose tone lives in a filter envelope, rounded off by a sine an octave below
// for warmth. Notes ring through their holds and overlap, so the falling line blurs like a sustain pedal.
const ostinatoWave = (t, hz) => A.saw(t, hz) * 0.7 + A.sin(t, hz * 0.5) * 0.6
const ostinatoNote = (brightness) => (note, steps) =>
  A.isynth(A.pitch(note), {
    wave: ostinatoWave,
    voices: 2,
    detuneCents: 7,
    spread: 0.8,
    drive: 1.2,
    cutoffHz: 380 * brightness,
    q: 1.1,
    envOct: 3.2,
    keyTrack: 0.4,
    filter: { decaySec: 0.25, sustain: 0.1, releaseSec: 0.3 },
    amp: { attackSec: 0.004, decaySec: 0.9, sustain: 0.2, releaseSec: 0.4 },
    gateSec: steps * stepSec,
    gain: 0.6,
  })
const ostinato = (brightness = 1) => A.polyseq(noteVoices(OSTINATO, ostinatoNote(brightness)), "1/16", tempo, 6)

// The chords: five saws per note, all the color comes from the resonant lowpass the parts sweep over them.
const chordNote = (note) =>
  A.isynth(A.pitch(note), {
    voices: 5,
    detuneCents: 16,
    spread: 1,
    drive: 1.4,
    cutoffHz: 6000,
    q: 0.7,
    envOct: 0,
    keyTrack: 0,
    amp: { attackSec: 0.01, decaySec: 0.5, sustain: 0.9, releaseSec: 0.35 },
    gateSec: bar(2) - 0.05,
    gain: 0.3,
  })
const chords = () =>
  A.polyseq(
    PROGRESSION.map(({ pad }) => A.sum(...pad.map(chordNote))),
    "2",
    tempo,
    2
  )
const filteredChords = (cutoffHz, q = 2.4) => A.isvf(chords(), cutoffHz, q)

// The bass is two layers on the offbeat eighths: a clean sine sub, and a driven square mid layer that growls
// through a resonant filter on a two-bar LFO.
const BASS_STEPS = "--#---#---#---#-"
const bassLine = (makeNote) =>
  A.seq(
    PROGRESSION.flatMap(({ root }) => {
      const note = makeNote(root)
      return [...BASS_STEPS, ...BASS_STEPS].map((s) => (s === "#" ? note : null))
    }),
    "1/16",
    tempo
  )
const subNote = (note) =>
  A.isynth(A.pitch(note), {
    wave: A.sin,
    voices: 1,
    drive: 1.3,
    cutoffHz: 2000,
    envOct: 0,
    keyTrack: 0,
    amp: { attackSec: 0.003, decaySec: 0.2, sustain: 0.7, releaseSec: 0.04 },
    gateSec: stepSec * 1.6,
    gain: 1.1,
  })
const midBassNote = (note) =>
  A.isynth(A.pitch(note) * 2, {
    wave: "square",
    voices: 3,
    detuneCents: 9,
    spread: 0.5,
    drive: 3,
    cutoffHz: 260,
    q: 1.4,
    envOct: 2.6,
    keyTrack: 0.2,
    filter: { decaySec: 0.12, sustain: 0.15, releaseSec: 0.04 },
    amp: { attackSec: 0.002, decaySec: 0.15, sustain: 0.6, releaseSec: 0.04 },
    gateSec: stepSec * 1.6,
    gain: 0.8,
  })
const growlHz = (t) => 500 * Math.pow(5, 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / bar(2)))
const bass = (growl = true) =>
  A.sum(
    bassLine(subNote),
    A.isvf(A.isvf(bassLine(midBassNote), growl ? growlHz : 700, growl ? 3.2 : 1), 140, 0.7, "hp")
  )

// The lead: a square stack with a resonant filter pluck, driven hard and downsampled a touch for grit.
const leadNote = (note, steps) =>
  A.isynth(A.pitch(note), {
    wave: "square",
    voices: 5,
    detuneCents: 14,
    spread: 0.9,
    drive: 2.8,
    cutoffHz: 1100,
    q: 2.2,
    envOct: 2.4,
    keyTrack: 0.5,
    filter: { decaySec: 0.22, sustain: 0.3, releaseSec: 0.1 },
    amp: { attackSec: 0.002, decaySec: 0.3, sustain: 0.7, releaseSec: 0.12 },
    gateSec: steps * stepSec * 0.9,
    gain: 0.8,
  })
const lead = (octaves = 0) =>
  downsample(A.polyseq(noteVoices(transpose(HOOK, octaves), leadNote), "1/16", tempo, 3), 16000)

// The second drop doubles the hook an octave up with a wide super saw.
const sawLeadNote = (note, steps) =>
  A.isynth(A.pitch(note), {
    wave: A.suprsaw,
    voices: 2,
    detuneCents: 10,
    spread: 1,
    drive: 1.4,
    cutoffHz: 2400,
    q: 0.8,
    envOct: 1.5,
    keyTrack: 0.3,
    filter: { decaySec: 0.25, sustain: 0.4, releaseSec: 0.1 },
    amp: { attackSec: 0.003, decaySec: 0.3, sustain: 0.7, releaseSec: 0.15 },
    gateSec: steps * stepSec * 0.9,
    gain: 0.75,
  })
const sawLead = () => A.polyseq(noteVoices(transpose(HOOK, 1), sawLeadNote), "1/16", tempo, 2)

// Drums
// #####
const kickHit = A.kick({ tuneHz: 50, decaySec: 0.32, pitchDecaySec: 0.035, drive: 2.2, click: 0.55 })
const kick = A.seq(A.pattern("#---", kickHit), "1/16", tempo)
const clapHit = A.snare({ tuneHz: 190, noiseAmt: 0.92, decaySec: 0.2, snap: 0.8 })
const clap = A.seq(A.pattern("----#-------#---", A.vol(clapHit, 0.5)), "1/16", tempo)
const closedHat = A.hihat({ decaySec: 0.02, shimmerHz: 9500, tone: 0.06 })
const shaker = A.seq(
  [0.12, 0.22, 0.3, 0.22].map((v) => A.vol(closedHat, v)),
  "1/16",
  tempo
)
const openHats = A.seq(
  A.pattern("--#-", A.vol(A.hihat({ open: true, decaySec: 0.12, shimmerHz: 8000, tone: 0.1 }), 0.45)),
  "1/16",
  tempo
)
const ride = A.seq(
  A.pattern("#-#-", A.vol(A.hihat({ open: true, decaySec: 0.3, shimmerHz: 5200, tone: 0.3 }), 0.2)),
  "1/16",
  tempo
)

const oneShot = (f, durSec) => (t) => (t < durSec ? f(t) : ZERO)
const crashHit = A.vol(A.hihat({ open: true, decaySec: 2, shimmerHz: 5800, tone: 0.16 }), 0.45)
const crash = oneShot(crashHit, 6)

// A crash played backwards that lands on the downbeat after `bars` bars.
const reverseCrash = (bars) => {
  const lengthSec = bar(bars)
  return (t) => (t < lengthSec ? crashHit((lengthSec - t) * 0.6) : ZERO)
}

// Parallel ("New York") compression; `ibuf` renders the kit once for both paths.
const drumBus = (f) => {
  const kit = A.ibuf(f, 0.05)
  const squashed = A.icomp(kit, {
    thresholdDb: -30,
    ratio: 8,
    kneeDb: 4,
    attackSec: 0.004,
    releaseSec: 0.06,
    makeupDb: 4,
  })
  return A.sum(kit, A.vol(squashed, 0.4))
}

// Builds
// ######
const rollHit = A.snare({ tuneHz: 220, noiseAmt: 0.88, decaySec: 0.09, snap: 0.6 })

// Accelerating snare roll over `bars` bars: quarters, eighths, sixteenths, then thirty-seconds, rising in level.
const snareRoll = (bars) => {
  const out = A.alloc()
  return (t) => {
    const progress = t / bar(bars)
    if (progress < 0 || progress >= 1) return ZERO
    const hitSec = bar(1) / [4, 8, 16, 32][Math.floor(progress * 4)]
    const [l, r] = rollHit(t % hitSec)
    const g = 0.12 + 0.6 * progress * progress
    out[0] = l * g
    out[1] = r * g
    return out
  }
}

const whiteNoise = (() => {
  const out = A.alloc()
  return (t) => {
    const n = Math.round(t * sampleRate)
    out[0] = A.noise(n)
    out[1] = A.noise(n + 0.5)
    return out
  }
})()

// Noise through a resonant bandpass that sweeps up five octaves and swells.
const riser = (bars) => {
  const lengthSec = bar(bars)
  return A.vol(A.isvf(whiteNoise, sweep(250, 8000, bars), 2.5, "bp"), (t) => 0.2 * Math.min(1, t / lengthSec) ** 2)
}

// One beat of silence before the drop.
const breath = (f, bars) => A.vol(f, A.muteFor(bar(bars) - beatSec, bar(bars) + 1, 0.01))

// Parts
// #####
// A part is a dry signal plus what it sends to the reverb and to the echo.
const part = (bars, dry, verb, echo) => ({ bars, dry, verb: verb ?? NULL_VOICE, echo: echo ?? NULL_VOICE })

const groove = drumBus(A.sum(kick, clap, shaker, openHats))

// Lane 8 style opening: the ostinato alone, muffled, with the kick and shaker; the bass and clap join at bar 9.
const introOstinato = A.isvf(ostinato(), sweep(500, 1800, 16), 1.2)
const intro = part(
  16,
  layers(
    drumBus(A.sum(kick, span(shaker, 4))),
    span(drumBus(A.sum(clap, openHats)), 8),
    span(pump(bass(false)), 8),
    pump(A.vol(introOstinato, 1.5), 0.35)
  ),
  A.vol(introOstinato, 0.35),
  A.vol(introOstinato, 0.35)
)

// The groove: chords open up under a sweeping resonant filter over sixteen bars.
const grooveChords = filteredChords(sweep(250, 4500, 16))
const grooveOstinato = ostinato()
const verse = part(
  16,
  layers(
    groove,
    crash,
    pump(bass()),
    pump(grooveChords, 0.7),
    pump(A.vol(grooveOstinato, 1.6), 0.4),
    span(snareRoll(2), 14),
    span(reverseCrash(2), 14)
  ),
  layers(A.vol(grooveChords, 0.35), A.vol(grooveOstinato, 0.3), A.vol(clap, 0.3)),
  A.vol(grooveOstinato, 0.35)
)

// The breakdown: chords swell without drums, the ostinato carries the hook's harmony, then the lead rises in through
// a filter while the roll and riser build for eight bars.
const breakdown = (bars) => {
  const half = bars / 2
  const padChords = A.vol(filteredChords(sweep(700, 2400, bars), 1.2), 1.2)
  const keys = ostinato(1.6)
  const risingLead = span(A.isvf(lead(), sweep(300, 9000, half), 1.6), half)
  const lateBass = span(bass(false), half)
  const dry = layers(
    padChords,
    keys,
    A.vol(risingLead, 0.85),
    A.vol(pump(lateBass, 0.7), 0.8),
    span(snareRoll(half), half),
    span(riser(half), half),
    span(drumBus(A.vol(kick, sweep(0.1, 0.9, half / 2))), half + half / 2)
  )
  return part(
    bars,
    A.sum(breath(dry, bars), span(reverseCrash(2), bars - 2)),
    layers(A.vol(padChords, 0.5), A.vol(keys, 0.5), A.vol(risingLead, 0.5)),
    layers(A.vol(keys, 0.5), A.vol(risingLead, 0.5))
  )
}

// The drop: gated chords, growling bass, the square hook. The final drop adds the super saw an octave up and a ride.
const DROP_GATE = "#-##-##-#-##-#-#"
const drop = (final = false) => {
  const hook = final ? A.sum(lead(), A.vol(sawLead(), 1.2)) : lead()
  const stabs = gate(filteredChords(final ? 5000 : sweep(1500, 5000, 8), 1.6), DROP_GATE)
  const keys = ostinato(2)
  return part(
    16,
    layers(
      final ? drumBus(A.sum(kick, clap, shaker, openHats, ride)) : groove,
      crash,
      pump(bass()),
      pump(hook, 0.45),
      pump(A.vol(stabs, 1.5), 0.5),
      pump(A.vol(keys, 1.2), 0.5)
    ),
    layers(A.vol(hook, 0.45), A.vol(stabs, 0.3), A.vol(keys, 0.3), A.vol(clap, 0.4), crash),
    layers(A.vol(hook, 0.5), A.vol(keys, 0.4))
  )
}

const outroChords = filteredChords(sweep(4000, 200, 8))
const outroOstinato = A.isvf(ostinato(), sweep(3000, 400, 8), 1.2)
const outro = part(
  8,
  layers(
    A.vol(groove, A.fadeOut(bar(4), bar(4))),
    A.vol(pump(bass(false)), A.fadeOut(bar(4), bar(2))),
    pump(outroChords, 0.6),
    pump(outroOstinato, 0.4)
  ),
  layers(A.vol(outroChords, 0.4), A.vol(outroOstinato, 0.4)),
  A.vol(outroOstinato, 0.5)
)

const parts = [intro, verse, breakdown(16), drop(), breakdown(8), drop(true), outro]
const bus = (key) => A.song(...parts.map((p) => A.section(p[key], bar(p.bars))))

// Effects
// #######
// Ping-pong echo: dotted-eighth taps alternate left and right. `ibuf` keeps the send rendered once.
const pingPong = (f, delaySec, feedback, taps = 6) => {
  const tapped = A.ibuf(f, delaySec * (taps + 1))
  const delayFrames = Math.round(delaySec * sampleRate)
  const out = A.alloc()
  return (t) => {
    tapped(t)
    const frame = Math.round(t * sampleRate)
    let l = 0,
      r = 0,
      g = 1
    for (let i = 1; i <= taps; i++) {
      g *= feedback
      const [tl, tr] = tapped.at(frame - i * delayFrames)
      const mono = (tl + tr) * 0.5 * g
      if (i % 2 === 1) l += mono
      else r += mono
    }
    out[0] = l
    out[1] = r
    return out
  }
}

const echo = A.isvf(A.isvf(pingPong(bus("echo"), stepSec * 3, 0.55), 4500, 0.7), 400, 0.7, "hp")
const reverb = A.ireverb(A.isvf(A.sum(bus("verb"), A.vol(echo, 0.4)), 250, 0.7, "hp"), {
  decaySec: 3.6,
  dampHz: 6000,
  preDelaySec: 0.025,
  size: 1.5,
  mix: 1,
})

const track = A.sum(bus("dry"), A.vol(echo, 0.45), A.vol(reverb, 0.5))

// Master: a 25Hz rumble filter, glue compression, then a soft clipper as a limiter.
const master = A.icomp(A.isvf(track, 25, 0.7, "hp"), {
  thresholdDb: -16,
  ratio: 3,
  kneeDb: 6,
  attackSec: 0.01,
  releaseSec: 0.14,
  makeupDb: 4,
})
A.vol(A.distort(master, 1.6), 0.82)

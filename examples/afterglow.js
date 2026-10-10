// composed by Claude Opus 5.5
//
// "Afterglow": uplifting trance in the early 2000s Dutch style. 138 BPM, A minor, Am - F - C - G.
// A rolling offbeat bass, a syncopated super saw hook with ping-pong echoes, plucked 16th arps, an FM electric
// piano and a vocoded hook in the breakdown, and accelerating snare rolls into every drop.
//
// Mix: every part returns a dry signal plus sends for the reverb and the ping-pong echo. The effects run outside
// `song` on global time, so their tails ring across part boundaries.

const BPM = 138
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
const pump = (f, depth = 0.55, releaseSec = 0.13) => {
  const out = A.alloc()
  return (t) => {
    const [l, r] = f(t)
    const g = 1 - depth * Math.exp(-(t % beatSec) / releaseSec)
    out[0] = l * g
    out[1] = r * g
    return out
  }
}

// Harmony
// #######
const PROGRESSION = [
  { root: "A1", pad: ["A3", "C4", "E4", "A4"], arp: "A3 C4 E4 A4 C5 A4 E4 C4" },
  { root: "F1", pad: ["F3", "A3", "C4", "F4"], arp: "F3 A3 C4 F4 A4 F4 C4 A3" },
  { root: "C2", pad: ["G3", "C4", "E4", "G4"], arp: "C4 E4 G4 C5 E5 C5 G4 E4" },
  { root: "G1", pad: ["G3", "B3", "D4", "G4"], arp: "G3 B3 D4 G4 B4 G4 D4 B3" },
]

// One bar per line, 16th steps. "_" holds the previous note, "." is silence.
const HOOK = [
  "A4 _ A4 G4 _ E4 _ E4 _ D4 _ E4 _ C4 _ _",
  "A4 _ A4 G4 _ F4 _ F4 _ E4 _ F4 _ C4 _ _",
  "G4 _ G4 E4 _ C4 _ C4 _ D4 _ E4 _ G4 _ _",
  "B4 _ B4 A4 _ G4 _ D4 _ G4 _ A4 _ B4 _ _",
]
  .join(" ")
  .split(" ")

const shiftOctave = (note, octaves) => note.replace(/\d+$/, (o) => String(Number(o) + octaves))

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
// The lead: seven saws wide across the stereo field, a filter envelope for the pluck at the front of every note.
const leadNote = (note, steps) =>
  A.isynth(A.pitch(note), {
    voices: 7,
    detuneCents: 24,
    spread: 1,
    drive: 1.6,
    cutoffHz: 1500,
    q: 0.8,
    envOct: 2.2,
    keyTrack: 0.4,
    filter: { decaySec: 0.18, sustain: 0.35, releaseSec: 0.12 },
    amp: { attackSec: 0.002, decaySec: 0.25, sustain: 0.6, releaseSec: 0.12 },
    gateSec: steps * stepSec * 0.85,
    gain: 1.2,
  })
const lead = (octaves = 0) =>
  A.polyseq(
    noteVoices(
      HOOK.map((token) => (token === "_" || token === "." ? token : shiftOctave(token, octaves))),
      leadNote
    ),
    "1/16",
    tempo,
    3
  )

// The pluck arp: almost all of the tone is in a fast filter envelope.
const arpNote = (note) =>
  A.isynth(A.pitch(note), {
    voices: 2,
    detuneCents: 8,
    spread: 0.6,
    cutoffHz: 320,
    q: 1.2,
    envOct: 4,
    keyTrack: 0.5,
    filter: { decaySec: 0.09, sustain: 0, releaseSec: 0.05 },
    amp: { attackSec: 0.001, decaySec: 0.2, sustain: 0, releaseSec: 0.05 },
    gateSec: stepSec * 0.9,
    gain: 0.7,
  })
const arpNotes = PROGRESSION.flatMap(({ arp }) => [...arp.split(" "), ...arp.split(" ")])
const arp = A.polyseq(arpNotes.map(arpNote), "1/16", tempo, 2)

// The rolling bass sits on the three 16ths between the kicks.
const bassNote = (note) =>
  A.isynth(A.pitch(note), {
    voices: 1,
    sub: 0.35,
    drive: 2,
    cutoffHz: 220,
    q: 1.1,
    envOct: 2.4,
    keyTrack: 0.3,
    filter: { decaySec: 0.07, sustain: 0.1, releaseSec: 0.03 },
    amp: { attackSec: 0.001, decaySec: 0.1, sustain: 0.5, releaseSec: 0.03 },
    gateSec: stepSec * 0.75,
    gain: 1.05,
  })
const bass = A.seq(
  PROGRESSION.flatMap(({ root }) => Array.from({ length: 16 }, (unused, i) => (i % 4 === 0 ? null : bassNote(root)))),
  "1/16",
  tempo
)

// Pads swell in slowly and ring into the next chord, so they use a polyphonic sequencer.
const padChord = (notes) =>
  A.sum(
    ...notes.map((note) =>
      A.isynth(A.pitch(note), {
        voices: 4,
        detuneCents: 18,
        spread: 1,
        drive: 1,
        cutoffHz: 900,
        q: 0.7,
        envOct: 0.8,
        keyTrack: 0.5,
        filter: { attackSec: 0.8, decaySec: 1, sustain: 0.6, releaseSec: 0.8 },
        amp: { attackSec: 0.5, decaySec: 1, sustain: 0.85, releaseSec: 0.8 },
        gateSec: bar(1) - 0.05,
        gain: 0.3,
      })
    )
  )
const pads = A.polyseq(
  PROGRESSION.map(({ pad }) => padChord(pad)),
  "1",
  tempo,
  2
)

// An FM electric piano (carrier and modulator at the same pitch, soft index) plays the hook in the breakdown.
const pianoNote = (note, steps) =>
  A.fm2(A.pitch(note), {
    ratio: 1,
    modIndex: 2.4,
    modDecaySec: 0.7,
    modSustain: 0.15,
    feedback: 0.12,
    env: A.adsr({ attackSec: 0.002, decaySec: 1.4, sustain: 0.25, releaseSec: 0.5, releaseTime: steps * stepSec }),
  })
const piano = A.polyseq(noteVoices(HOOK, pianoNote), "1/16", tempo, 6)

// Vocal
// #####
// A line is a list of syllables separated by "|". Each syllable lasts half a beat unless a ":beats" suffix says
// otherwise. Consonants get a short fixed length and the vowels fill the rest, so syllables land on the grid.
const VOWELS = new Set(["AA", "AE", "AH", "AO", "AW", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"])
const syllable = (text) => {
  const [phonemes, beats = "0.5"] = text.split(":").map((s) => s.trim())
  const durSec = Number(beats) * beatSec
  const parts = phonemes.split(" ")
  if (phonemes === "SP") return [{ phoneme: "SP", durSec }]
  const vowelCount = parts.filter((p) => VOWELS.has(p)).length
  const consonantSec = Math.min(0.05, (durSec * 0.35) / Math.max(1, parts.length - vowelCount))
  const vowelSec = durSec - (parts.length - vowelCount) * consonantSec
  let vowelIdx = 0
  return parts.map((p) => {
    if (!VOWELS.has(p)) return { phoneme: p, durSec: consonantSec }
    const share = vowelCount === 2 ? (vowelIdx++ === 0 ? 0.7 : 0.3) : 1 / vowelCount
    return { phoneme: p, durSec: vowelSec * share }
  })
}
const sing = (...lines) => lines.join("|").split("|").flatMap(syllable)

// Two bars each, sung over Am - F and C - G.
const feelTheLight = "F IY L :1 | TH AH :0.5 | L AA IY T :2.5 | SP :4"
const takeMeHigher = "T EY K :1 | M IY :1 | H AA IY :1.5 | ER :2.5 | SP :2"
const VOCAL_MELODY = "A4 _ C5 E5 _ _ _ _ . . . . . . . . E5 _ D5 _ C5 _ _ A4 _ _ _ _ _ . . .".split(" ")

const vocalVoice = (note, steps) => {
  const hz = A.pitch(note)
  const out = A.alloc()
  return (t) => {
    const sub = A.square(t, hz * 0.5) * 0.3
    out[0] = A.saw(t, hz * 0.997) + A.saw(t + 0.0013, hz * 1.002) * 0.6 + sub
    out[1] = A.saw(t + 0.0007, hz * 1.003) + A.saw(t + 0.0021, hz * 0.998) * 0.6 + sub
    return out
  }
}
const carrierChord = (notes) => {
  const hzs = notes.map(A.pitch)
  const out = A.alloc()
  return (t) => {
    let l = 0,
      r = 0
    for (const hz of hzs) {
      l += A.saw(t, hz * 0.997)
      r += A.saw(t + 0.0011, hz * 1.003)
    }
    out[0] = l
    out[1] = r
    return out
  }
}

// The vocoder carrier sings the melody over the chords; the formant synth provides the words.
const vocal = (repeats) => {
  const melody = A.polyseq(noteVoices(VOCAL_MELODY, vocalVoice), "1/8", tempo, 6)
  const harmony = A.seq(
    PROGRESSION.map(({ pad }) => carrierChord(pad)),
    "1",
    tempo
  )
  const lines = Array.from({ length: repeats }, () => [feelTheLight, takeMeHigher]).flat()
  const voice = A.formantSpeech(sing(...lines), { vibratoDepth: 0 })
  const vocoded = A.ivocoder(A.sum(A.vol(melody, 0.16), A.vol(harmony, 0.05)), voice, {
    bands: 24,
    q: 1.3,
    lowHz: 100,
    highHz: 10000,
    noise: 0.55,
  })
  const compressed = A.icomp(A.isvf(vocoded, 160, 0.7, "hp"), {
    thresholdDb: -20,
    ratio: 4,
    kneeDb: 6,
    attackSec: 0.001,
    releaseSec: 0.08,
    makeupDb: 4,
  })
  return A.vol(A.distort(compressed, 1.5), 0.85)
}

// Drums
// #####
const kick = A.seq(
  A.pattern("#---", A.kick({ tuneHz: 52, decaySec: 0.34, pitchDecaySec: 0.04, drive: 2.6, click: 0.6 })),
  "1/16",
  tempo
)
const clapHit = A.snare({ tuneHz: 210, noiseAmt: 0.9, decaySec: 0.17, snap: 0.7 })
const clap = A.seq(A.pattern("----#-------#---", A.vol(clapHit, 0.5)), "1/16", tempo)
const closedHat = A.hihat({ decaySec: 0.025, shimmerHz: 9000, tone: 0.08 })
const hats = A.seq(
  [0.35, 0.15, 0.25, 0.15].map((v) => A.vol(closedHat, v)),
  "1/16",
  tempo
)
const openHats = A.seq(
  A.pattern("--#-", A.vol(A.hihat({ open: true, decaySec: 0.14, shimmerHz: 7600, tone: 0.1 }), 0.5)),
  "1/16",
  tempo
)

const oneShot = (f, durSec) => (t) => (t < durSec ? f(t) : ZERO)
const crash = oneShot(A.vol(A.hihat({ open: true, decaySec: 2, shimmerHz: 5800, tone: 0.16 }), 0.45), 6)

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

// Noise through a resonant bandpass that sweeps up four octaves and swells.
const riser = (bars) => {
  const lengthSec = bar(bars)
  return A.vol(
    A.isvf(whiteNoise, (t) => 300 * Math.pow(30, Math.min(1, t / lengthSec)), 2.5, "bp"),
    (t) => 0.2 * Math.min(1, t / lengthSec) ** 2
  )
}

// Parts
// #####
// A part is a dry signal plus what it sends to the reverb and to the echo.
const part = (bars, dry, verb, echo) => ({ bars, dry, verb: verb ?? NULL_VOICE, echo: echo ?? NULL_VOICE })

const groove = drumBus(A.sum(kick, clap, hats, openHats))

const introArp = A.isvf(arp, (t) => 250 * Math.pow(4, Math.min(1, t / bar(16))), 1.4)
const intro = part(
  16,
  layers(
    drumBus(A.sum(kick, span(hats, 4))),
    span(drumBus(A.sum(clap, openHats)), 8),
    span(pump(bass), 8),
    pump(introArp, 0.4)
  ),
  A.vol(introArp, 0.3),
  A.vol(introArp, 0.2)
)

const buildArp = A.isvf(arp, (t) => 1000 * Math.pow(6, Math.min(1, t / bar(8))), 1.2)
const buildPads = pump(A.vol(pads, 0.6), 0.5)
const build = part(
  8,
  layers(groove, pump(bass), pump(buildArp, 0.45), buildPads, span(snareRoll(4), 4), riser(8)),
  layers(A.vol(buildArp, 0.3), A.vol(buildPads, 0.4), A.vol(clap, 0.4)),
  A.vol(buildArp, 0.25)
)

const breakdown = (bars) => {
  const voice = vocal(bars / 4)
  const half = bars / 2
  const risingLead = A.isvf(lead(), (t) => 300 * Math.pow(20, Math.min(1, t / bar(half))), 1.3)
  const keys = span(A.vol(piano, 0.6), 0, half)
  const lateArp = span(
    A.isvf(arp, (t) => 400 * Math.pow(8, Math.min(1, t / bar(half))), 1.2),
    half
  )
  const late = span(risingLead, half)
  return part(
    bars,
    layers(
      pads,
      keys,
      voice,
      A.vol(lateArp, 0.7),
      A.vol(late, 0.8),
      span(snareRoll(half), half),
      span(riser(half), half)
    ),
    layers(A.vol(pads, 0.4), keys, voice, A.vol(late, 0.5)),
    layers(keys, A.vol(voice, 0.7), A.vol(late, 0.6))
  )
}

const drop = (withOctave = false, withVocal = false) => {
  const hook = withOctave ? A.sum(lead(), A.vol(lead(1), 0.45)) : lead()
  const voice = withVocal && vocal(4)
  return part(
    16,
    layers(
      groove,
      crash,
      pump(bass),
      pump(hook, 0.45),
      pump(A.vol(arp, 0.6), 0.5),
      pump(A.vol(pads, 0.45), 0.6),
      voice
    ),
    layers(A.vol(hook, 0.5), A.vol(arp, 0.25), A.vol(pads, 0.2), A.vol(clap, 0.4), crash, voice),
    layers(A.vol(hook, 0.55), voice && A.vol(voice, 0.5))
  )
}

const outroArp = A.isvf(arp, (t) => 4000 * Math.pow(1 / 16, Math.min(1, t / bar(8))), 1.2)
const outro = part(
  8,
  layers(A.vol(groove, A.fadeOut(bar(4), bar(4))), A.vol(pump(bass), A.fadeOut(bar(4), bar(2))), pump(outroArp, 0.4)),
  A.vol(outroArp, 0.4),
  A.vol(outroArp, 0.3)
)

const parts = [intro, build, breakdown(16), drop(), breakdown(8), drop(true, true), outro]
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

const echo = A.isvf(A.isvf(pingPong(bus("echo"), stepSec * 3, 0.5), 5000, 0.7), 350, 0.7, "hp")
const reverb = A.ireverb(A.isvf(A.sum(bus("verb"), A.vol(echo, 0.4)), 250, 0.7, "hp"), {
  decaySec: 3.2,
  dampHz: 7000,
  preDelaySec: 0.03,
  size: 1.4,
  mix: 1,
})

const track = A.sum(bus("dry"), A.vol(echo, 0.4), A.vol(reverb, 0.5))

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

// composed by Claude Opus 5.5
//
// "Machine Heart": robot rock / French house. A fuzzed, double-tracked power-chord riff, a pumping disco
// four-on-the-floor, a monotone vocoded robot for the verses and a vocoded chorus over Em - C - G - D.
//
// Mix: every section returns a dry signal plus sends for the reverb and the vocal echo. The effects run outside
// `song` on global time, so their tails ring across section boundaries.

const BPM = 120
const tempo = A.tempoBpm(BPM)
const beatSec = 60 / BPM
const bar = (n) => n * 4 * beatSec

// Sidechain-style pump keyed to the quarter notes.
const pump = (f, depth = 0.6, releaseSec = 0.11) => {
  const out = A.alloc()
  return (t) => {
    const [l, r] = f(t)
    const g = 1 - depth * Math.exp(-(t % beatSec) / releaseSec)
    out[0] = l * g
    out[1] = r * g
    return out
  }
}

const layers = (...fs) => A.sum(...fs.filter(Boolean))
const delayed = (f, sec) => (t) => f(t - sec)

// Lyrics
// ######
// A line is a list of syllables separated by "|". Each syllable is a group of phonemes, lasting half a beat unless
// a ":beats" suffix says otherwise. Consonants get a short fixed length and the vowels fill the rest, so every
// syllable lands exactly on the beat grid. In a diphthong (two vowels) the first vowel takes 70%.
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
const restBars = (n) => `SP :${n * 4}`

// Every line is one bar (4 beats).
const systemOnline = "S IH S | T AH M | AA N | L AA IY N :1.5 | SP :1"
const rhythmEngaged = "R IH | TH AH M | EH N | G EY D ZH D :1.5 | SP :1"
const bodiesInMotion = "B AA | D IY Z | IH N | M OW | SH AH N :1 | SP :1"
const feelingElectric = "F IY | L IH NG | IH :0.25 | L EH K | T R IH K :1 | SP :1.25"

const lightsAreFlashing = "L AA IY T S :1 | AA R | F L AE | SH IH NG :1 | SP :1"
const heartsAreRacing = "H AA R T S :1 | AA R | R EY | S IH NG :1 | SP :1"
const timeIsMelting = "T AA IY M :1 | IH Z | M EH L | T IH NG :1 | SP :1"
const weAreMetal = "W IY :1 | AA R | M EH | T AH L :1 | SP :1"

const systemOffline = "S IH S | T AH M | AO F | L AA IY N :1.5 | SP :1"

const machineHeart = "M AH | SH IY N :1 | H AA R T :2 | SP"
const beatingOnAndOn = "B IY | T IH NG | AA N :1 | AE N D | AA N :1 | SP"
const neverGonnaStop = "N EH | V ER | G AH | N AH | S T AA P :1.5 | SP"
const chorusLyrics = [machineHeart, beatingOnAndOn, machineHeart, neverGonnaStop]

// Two bars each.
const areWeMachines = "AA R :1 | W IY :1 | M AH :1 | SH IY N Z :3 | SP :2"
const orAreWeDreaming = "AO R :1 | AA R :1 | W IY :1 | D R IY :1 | M IH NG :3 | SP :1"

const speech = (lines, opts = {}) => A.formantSpeech(sing(...lines), { vibratoDepth: 0, ...opts })

// Vocal carriers
// ##############
// "_" holds the previous note, "." is silence. Held steps keep the oscillator phase running.
const heldVoices = (tokens, stepSec, makeVoice) => {
  let note = null,
    heldSteps = 0
  return tokens.map((token) => {
    if (token === "_") heldSteps++
    else [note, heldSteps] = [token === "." ? null : token, 0]
    return note === null ? null : makeVoice(note, heldSteps * stepSec)
  })
}

// A vocoder needs a carrier with energy in every band: detuned saws plus a square sub.
const leadVoice = (octaveUp) => (note, offsetSec) => {
  const hz = A.pitch(note) * (octaveUp ? 2 : 1)
  const out = A.alloc()
  return (t) => {
    const tt = t + offsetSec
    const sub = A.square(tt, hz * 0.5) * 0.3
    out[0] = A.saw(tt, hz * 0.996) + A.saw(tt + 0.0013, hz * 1.001) * 0.6 + sub
    out[1] = A.saw(tt + 0.0007, hz * 1.004) + A.saw(tt + 0.0021, hz * 0.999) * 0.6 + sub
    return out
  }
}

const chorusMelody = [
  ..."B4 B4 _ G4 _ _ _ _".split(" "),
  ..."G4 G4 E4 _ D4 E4 _ _".split(" "),
  ..."B4 B4 _ D5 _ _ _ _".split(" "),
  ..."A4 A4 F#4 E4 D4 _ _ _".split(" "),
]
const chorusLead = (octaveUp = false) => A.seq(heldVoices(chorusMelody, beatSec / 2, leadVoice(octaveUp)), "1/8", tempo)

const CHORDS = [
  ["E3", "G3", "B3", "E4"],
  ["C3", "E3", "G3", "C4"],
  ["B2", "D3", "G3", "B3"],
  ["D3", "F#3", "A3", "D4"],
]
const carrierChord = (notes) => {
  const hzs = notes.map(A.pitch)
  const out = A.alloc()
  return (t) => {
    let l = 0,
      r = 0
    for (let i = 0; i < hzs.length; i++) {
      l += A.saw(t, hzs[i] * 0.997)
      r += A.saw(t + 0.0011, hzs[i] * 1.003)
    }
    out[0] = l
    out[1] = r
    return out
  }
}
const carrierChords = A.seq(CHORDS.map(carrierChord), "1", tempo)

// The robot speaks on a fixed E, which gives the flat "machine" voice.
const robotCarrier = (() => {
  const out = A.alloc()
  const [e2, b2, e3] = ["E2", "B2", "E3"].map(A.pitch)
  return (t) => {
    const s = A.square(t, e2) * 0.5 + A.saw(t, b2) * 0.35
    out[0] = s + A.suprsaw(t, e3 * 0.998, 0.1)
    out[1] = s + A.suprsaw(t + 0.0009, e3 * 1.002, 0.1)
    return out
  }
})()

// Vocals get a low cut so they sit above the bass, a fast compressor that keeps every syllable upfront, and a soft
// clipper that catches the onsets the compressor is too slow for.
const vocalChain = (f, gain) => {
  const compressed = A.icomp(A.isvf(f, 140, 0.7, "hp"), {
    thresholdDb: -20,
    ratio: 4,
    kneeDb: 6,
    attackSec: 0.001,
    releaseSec: 0.08,
    makeupDb: 4,
  })
  return A.vol(A.distort(compressed, 1.5), gain)
}

const robot = (lines) =>
  vocalChain(A.ivocoder(robotCarrier, speech(lines), { bands: 24, q: 1.15, noise: 0.5, highHz: 10000, gain: 0.35 }), 1)

const chorusVocal = (octaveUp = false) => {
  const carrier = layers(
    A.vol(chorusLead(), 0.16),
    A.vol(carrierChords, 0.05),
    octaveUp && A.vol(chorusLead(true), 0.07)
  )
  const voice = speech([...chorusLyrics, ...chorusLyrics])
  const vocoded = A.ivocoder(carrier, voice, { bands: 24, q: 1.3, lowHz: 100, highHz: 10000, noise: 0.55 })
  return vocalChain(vocoded, 0.85)
}

// Guitar
// ######
// Each power chord (root, fifth, octave) is one oscillator, so the fuzz intermodulates them like a real amp.
// Two unison voices hard left and right are the double-tracked takes; the filter envelope is the pick attack.
// "!" lets a chord ring, everything else is palm-muted.
const powerChord = (t, hz) => A.saw(t, hz) + 0.8 * A.saw(t, hz * 1.4983) + 0.5 * A.saw(t, hz * 2)
const guitar = (note, ring) =>
  A.isynth(A.pitch(note), {
    wave: powerChord,
    voices: 2,
    detuneCents: 7,
    spread: 1,
    drive: 3.5,
    cutoffHz: 1300,
    q: 1.1,
    envOct: 1.5,
    keyTrack: 0,
    filter: { decaySec: ring ? 0.3 : 0.05, sustain: 0.25 },
    amp: { attackSec: 0.002, decaySec: ring ? 0.6 : 0.08, sustain: ring ? 0.4 : 0.15, releaseSec: 0.04 },
    gateSec: ring ? beatSec * 0.7 : beatSec * 0.22,
  })

const RIFF = "E2 . E2 E2 . E2 G2! . . E2 A2! . . G2 E2 . E2 . E2 E2 . E2 D3! . . B2 A2! . G2 . E2 ."
const riffVoices = RIFF.split(" ").map((token) =>
  token === "." ? null : guitar(token.replace("!", ""), token.endsWith("!"))
)
const riffRaw = A.polyseq(riffVoices, "1/16", tempo, 3)
const riff = (gain = 0.85) => A.vol(A.isvf(riffRaw, 90, 0.7, "hp"), gain)

// Drums
// #####
const kick = A.seq(
  A.pattern("#---", A.kick({ tuneHz: 50, decaySec: 0.3, pitchDecaySec: 0.04, drive: 2.6, click: 0.7 })),
  "1/16",
  tempo
)
const clapHit = A.snare({ tuneHz: 205, noiseAmt: 0.86, decaySec: 0.15, snap: 0.6 })
const clap = A.seq(A.pattern("----#-------#---", A.vol(clapHit, 0.55)), "1/16", tempo)
const closedHat = A.hihat({ decaySec: 0.028, shimmerHz: 8200, tone: 0.1 })
const hats = A.seq(
  [0.45, 0.2, 0.75, 0.25].map((v) => A.vol(closedHat, v)),
  "1/16",
  tempo
)
const openHats = A.seq(
  A.pattern("--#-", A.vol(A.hihat({ open: true, decaySec: 0.16, shimmerHz: 7200, tone: 0.12 }), 0.45)),
  "1/16",
  tempo
)
const snareRoll = A.seq(
  Array.from({ length: 16 }, (unused, i) =>
    A.vol(A.snare({ tuneHz: 190 + i * 6, noiseAmt: 0.85, decaySec: 0.08 }), 0.08 + i * 0.03)
  ),
  "1/16",
  tempo
)
const riser = A.vol(A.timeReverse(A.hihat({ open: true, decaySec: 1.6, shimmerHz: 5200, tone: 0.05 }), 0, bar(2)), 0.5)
const crash = A.vol(A.hihat({ open: true, decaySec: 1.4, shimmerHz: 5600, tone: 0.16 }), 0.4)

// Parallel ("New York") compression: the squashed copy adds sustain and density, the dry copy keeps the transients.
// `ibuf` renders the kit once for both paths.
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
const drums = drumBus(A.sum(kick, clap, hats))
const fullDrums = drumBus(A.sum(kick, clap, hats, openHats, crash))

// Bass
// ####
// A saw with a square sub and a fast filter envelope: the pluck is the filter, not the amp.
const bassNote = (note, accent = false) =>
  A.isynth(A.pitch(note), {
    voices: 1,
    sub: 0.5,
    drive: 2.2,
    cutoffHz: 150,
    q: 1.5,
    envOct: accent ? 3.8 : 3,
    keyTrack: 0.3,
    filter: { decaySec: 0.13, sustain: 0.12 },
    amp: { attackSec: 0.002, decaySec: 0.3, sustain: 0.6, releaseSec: 0.05 },
    gateSec: beatSec * 0.38,
    gain: accent ? 0.8 : 0.7,
  })
const bassLine = (tokens) =>
  A.seq(
    tokens.map((token) => (token === "." ? null : bassNote(token.replace("!", ""), token.endsWith("!")))),
    "1/8",
    tempo
  )

const verseBass = bassLine("E1 E1 E2! E1 . E1 E2! G1 E1 E1 E2! E1 . D2! B1 A1".split(" "))
const ROOTS = ["E1", "C2", "G1", "D2"]
const octaveUp = (note) => note.replace(/\d/, (n) => String(Number(n) + 1))
const chorusBass = bassLine(
  ROOTS.flatMap((root) => [root, root, octaveUp(root) + "!", root, ".", root, octaveUp(root) + "!", root])
)

// Chords
// ######
// French house stabs: four detuned saws per note through a filter that opens on every bar, pumped by the kick.
const chordSynth = (notes) =>
  A.sum(
    ...notes.map((note) =>
      A.isynth(A.pitch(note), {
        voices: 4,
        detuneCents: 16,
        spread: 0.9,
        drive: 1.2,
        cutoffHz: 650,
        q: 0.9,
        envOct: 2.2,
        keyTrack: 0.6,
        filter: { attackSec: 0.002, decaySec: 0.4, sustain: 0.35, releaseSec: 0.15 },
        amp: { attackSec: 0.004, decaySec: 0.5, sustain: 0.8, releaseSec: 0.15 },
        gateSec: bar(1) - 0.2,
        gain: 0.45,
      })
    )
  )
const chords = A.seq(CHORDS.map(chordSynth), "1", tempo)

// Sections
// ########
// A part is a dry signal plus what it sends to the reverb and to the vocal echo.
const part = (bars, dry, verb = null, echo = null) => ({
  bars,
  dry,
  verb: verb ?? NULL_VOICE,
  echo: echo ?? NULL_VOICE,
})

const introRobot = robot([systemOnline, restBars(3), rhythmEngaged, restBars(3)])
const introRiff = A.isvf(riff(), (t) => 180 * Math.pow(18, Math.min(1, t / bar(8))), 1.6)
const intro = part(
  8,
  layers(
    introRiff,
    A.vol(hats, A.fadeIn(bar(4), bar(4))),
    introRobot,
    A.vol(snareRoll, A.window(bar(7), bar(8), 0.01)),
    delayed(riser, bar(6))
  ),
  layers(A.vol(introRiff, 0.3), introRobot, delayed(riser, bar(6))),
  introRobot
)

const verse = (lines) => {
  const vocal = robot(lines.flatMap((line) => [line, restBars(1)]))
  return part(
    8,
    layers(drums, pump(A.sum(verseBass, riff()), 0.4), vocal, crash),
    layers(A.vol(vocal, 0.6), A.vol(clap, 0.5), crash),
    A.vol(vocal, 0.5)
  )
}

const chorus = (octave = false, withRiff = false) => {
  const vocal = chorusVocal(octave)
  const stabs = pump(chords, 0.6)
  return part(
    8,
    layers(fullDrums, pump(chorusBass, 0.35), stabs, withRiff && riff(0.55), vocal),
    layers(vocal, A.vol(stabs, 0.5), A.vol(clap, 0.6), crash),
    A.vol(vocal, 0.6)
  )
}

// The formant synth sings directly here. `ibuf` renders it once for the dry signal and both sends.
const breakVoice = A.ibuf(
  speech([areWeMachines, restBars(2), orAreWeDreaming, restBars(2)], {
    pitchHz: A.pitch("E3"),
    vibratoDepth: 0.006,
    breath: 0.3,
    gain: 0.5,
    mouth: 1.04,
    maxHarmonics: 40,
  }),
  0.1
)
const breakPad = A.isvf(A.vol(chords, 0.55), (t) => 500 + 1500 * Math.min(1, t / bar(8)), 1.1)
const breakdown = part(
  8,
  layers(
    breakPad,
    A.vol(chorusBass, A.fadeIn(bar(2), bar(4))),
    A.pan(breakVoice, -0.1),
    A.vol(snareRoll, A.window(bar(7), bar(8), 0.01)),
    delayed(riser, bar(6))
  ),
  layers(breakPad, breakVoice, delayed(riser, bar(6))),
  breakVoice
)

const outroRobot = robot([systemOffline, restBars(7)])
const outro = part(
  8,
  layers(
    A.vol(drums, A.fadeOut(bar(4), bar(4))),
    A.vol(A.sum(verseBass, riff()), A.fadeOut(bar(6), bar(2))),
    outroRobot
  ),
  outroRobot,
  outroRobot
)

const parts = [
  intro,
  verse([systemOnline, rhythmEngaged, bodiesInMotion, feelingElectric]),
  chorus(),
  verse([lightsAreFlashing, heartsAreRacing, timeIsMelting, weAreMetal]),
  chorus(false, true),
  breakdown,
  chorus(true, true),
  chorus(true, true),
  outro,
]
const bus = (key) => A.song(...parts.map((p) => A.section(p[key], bar(p.bars))))

// Effects
// #######
// Dotted-eighth echo, darkened and thinned so it does not cloud the vocal, feeding the reverb as well.
const echo = A.isvf(A.isvf(A.idelay(bus("echo"), 4, beatSec * 0.75, 0.45), 3500, 0.7), 300, 0.7, "hp")
const reverb = A.ireverb(A.isvf(A.sum(bus("verb"), A.vol(echo, 0.5)), 250, 0.7, "hp"), {
  decaySec: 2.4,
  dampHz: 6500,
  preDelaySec: 0.02,
  size: 1.2,
  mix: 1,
})

const track = A.sum(bus("dry"), A.vol(echo, 0.35), A.vol(reverb, 0.55))

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

// Strobe-inspired progressive pluck study.
// The note cells are shaped from the supplied piano MIDI, then voiced as layered saw plucks.

const BPM = 128
const tempo = A.tempoLfo(A.tempoBpm(BPM), 0.18, 0.018)
const barSec = A.sec("1", tempo)
const quarterSec = A.sec("1/4", tempo)
const eighthSec = A.sec("1/8", tempo)
const sixteenthSec = A.sec("1/16", tempo)
const bar = (n) => barSec * n

const clamp01 = (x) => Math.max(0, Math.min(1, x))
const pumpShape = (t) => {
  const p = (t % quarterSec) / quarterSec
  const attack = clamp01(p / 0.32)
  const notch = 1 - Math.exp(-p * 9)
  return 0.18 + 0.82 * Math.max(attack, notch)
}
const sidechain = (f, depth = 1) => {
  const out = A.alloc()
  return (t) => {
    const [l, r] = f(t)
    const g = A.lerp(1, pumpShape(t), depth)
    out[0] = l * g
    out[1] = r * g
    return out
  }
}

// Drums: restrained progressive-house kit, leaving space for the plucks.
const kick = A.seq(A.pattern("#---", A.kick({ tuneHz: 31, decaySec: 0.46, pitchDecaySec: 0.06 })), "1/16", tempo)
const ghostKick = A.seq(
  A.pattern("-------#------#-", A.vol(A.kick({ tuneHz: 43, decaySec: 0.18, pitchDecaySec: 0.06 }), 0.16)),
  "1/16",
  tempo
)

const hatClosed = A.hihat({ decaySec: 0.019, shimmerHz: 9100, tone: 0.055 })
const hatTick = A.hihat({ decaySec: 0.012, shimmerHz: 11200, tone: 0.04 })
const hatOpen = A.hihat({ open: true, decaySec: 0.22, shimmerHz: 7300, tone: 0.11 })
const hats = A.seq(
  [
    null,
    A.vol(hatClosed, 0.055),
    A.vol(hatOpen, 0.23),
    A.vol(hatTick, 0.07),
    null,
    A.vol(hatClosed, 0.05),
    A.vol(hatOpen, 0.2),
    A.vol(hatTick, 0.08),
    null,
    A.vol(hatClosed, 0.06),
    A.vol(hatOpen, 0.26),
    A.vol(hatTick, 0.07),
    null,
    A.vol(hatClosed, 0.052),
    A.vol(hatOpen, 0.22),
    A.vol(hatTick, 0.1),
  ],
  "1/16",
  tempo
)
const clap = A.seq(
  [
    null,
    null,
    null,
    null,
    A.vol(A.snare({ tuneHz: 190, noiseAmt: 0.82, decaySec: 0.11, snap: 0.38 }), 0.36),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    A.vol(A.snare({ tuneHz: 176, noiseAmt: 0.84, decaySec: 0.13, snap: 0.4 }), 0.38),
    null,
    null,
    A.vol(A.snare({ tuneHz: 235, noiseAmt: 0.92, decaySec: 0.04, snap: 0.5 }), 0.08),
  ],
  "1/16",
  tempo
)
const ride = A.seq(
  [null, null, A.vol(A.hihat({ open: true, decaySec: 0.42, shimmerHz: 6200, tone: 0.15 }), 0.16), null],
  "1/16",
  tempo
)

// Saw-based plucks: fast click, short body, detuned layer, and stereo width.
const sawPluck = (note, vel = 1, rel = 0.18, pan = 0) => {
  const hz = A.pitch(note)
  const env = A.adsr({ releaseTime: rel, attackSec: 0.0025, decaySec: 0.16, sustain: 0.03, releaseSec: 0.22 })
  const out = A.alloc()
  return A.pan((t) => {
    const e = env(t)
    const pitchSettle = 1 + 0.0025 * Math.exp(-t / 0.028)
    const wob = 1 + 0.0012 * A.sin(t, 0.29)
    const h = hz * pitchSettle
    const body =
      A.saw(t, h) * 0.36 +
      A.saw(t, h * 1.003) * 0.2 +
      A.saw(t, h * 0.997) * 0.16 +
      A.suprsaw(t, h * wob) * 0.34 +
      A.sin(t, h * 0.5) * 0.08
    const click = A.saw(t, h * 2.01) * Math.exp(-t / 0.009) * 0.09
    const s = (body + click) * e * vel * 0.23
    out[0] = s * (0.96 + 0.04 * A.sin(t, 0.37))
    out[1] = s * (0.96 - 0.04 * A.sin(t, 0.31))
    return out
  }, pan)
}

const filteredStack = (raw, openEnv = () => 1, airEnv = () => 0) => {
  const dark = A.ilpf(raw, 520, 1.35, 192)
  const mid = A.ilpf(raw, 1250, 1.05, 192)
  const bright = A.ilpf(raw, 2700, 0.82, 160)
  const out = A.alloc()
  return (t) => {
    const o = openEnv(t)
    const a = airEnv(t)
    const [dl, dr] = dark(t)
    const [ml, mr] = mid(t)
    const [bl, br] = bright(t)
    out[0] = dl * (0.9 - o * 0.18) + ml * o * 0.72 + bl * a * 0.38
    out[1] = dr * (0.9 - o * 0.18) + mr * o * 0.72 + br * a * 0.38
    return out
  }
}

// MIDI-derived ostinato: the cover begins by alternating G# and B.
const pulseNotes = [
  "G#3",
  "B4",
  "G#3",
  "B4",
  "G#3",
  "B4",
  "G#3",
  "B4",
  "G#3",
  "B4",
  "G#3",
  "B4",
  "G#3",
  "B4",
  "G#3",
  "B4",
]
const pulseRaw = A.seq(
  pulseNotes.map((n, i) => sawPluck(n, i % 2 ? 0.75 : 0.55, 0.28, i % 2 ? 0.1 : -0.08)),
  "1/8",
  tempo
)
const pulseDark = sidechain(
  A.vol(
    A.mix(
      filteredStack(
        pulseRaw,
        () => 0.28,
        () => 0
      ),
      A.idelay(pulseRaw, 7, eighthSec * 3, 0.5),
      0.78
    ),
    0.62
  ),
  0.34
)
const pulseOpen = sidechain(
  A.vol(
    A.mix(
      filteredStack(pulseRaw, A.fadeIn(bar(12)), A.fadeIn(bar(18))),
      A.idelay(pulseRaw, 7, eighthSec * 3, 0.53, 6),
      0.68
    ),
    0.66
  ),
  0.46
)

const arpCell = [
  "G#3",
  "B4",
  "D#4",
  "F#5",
  "B4",
  "D#4",
  "E5",
  "G#4",
  "C#4",
  "A#4",
  "B4",
  "F#5",
  "C#5",
  "D#5",
  "B4",
  "F#5",
  "E4",
  "B4",
  "E5",
  "G#4",
  "B4",
  "E5",
  "B4",
  "E5",
  "C#4",
  "F#4",
  "G#4",
  "C#5",
  "D#5",
  "F#4",
  "G#4",
  "D#4",
]
const arpRaw = A.seq(
  arpCell.map((n, i) => sawPluck(n, i % 4 === 1 ? 0.74 : 0.56, 0.16, (i % 8) / 12 - 0.3)),
  "1/16",
  tempo
)
const arpDark = sidechain(
  A.vol(
    A.mix(
      filteredStack(
        arpRaw,
        () => 0.18,
        () => 0
      ),
      A.idelay(arpRaw, 5, eighthSec * 3, 0.42),
      0.78
    ),
    0.36
  ),
  0.4
)
const arpOpening = sidechain(
  A.vol(
    A.mix(
      filteredStack(arpRaw, A.fadeIn(bar(10)), A.fadeIn(bar(14))),
      A.idelay(arpRaw, 6, eighthSec * 3, 0.48, 6),
      0.66
    ),
    0.48
  ),
  0.58
)
const arpFull = sidechain(
  A.vol(
    A.mix(
      A.ichorus(
        filteredStack(
          arpRaw,
          () => 1,
          () => 0.9
        ),
        0.08,
        0.007,
        4,
        0.022,
        0.42
      ),
      A.idelay(arpRaw, 7, eighthSec * 3, 0.5, 6),
      0.64
    ),
    0.56
  ),
  0.62
)

const topCell = [
  "B5",
  null,
  "C#6",
  null,
  "D#6",
  null,
  "F#5",
  null,
  "G#5",
  null,
  "E5",
  null,
  "B4",
  null,
  "G#4",
  null,
  "G#5",
  null,
  "C#6",
  null,
  "F#6",
  null,
  "F#5",
  null,
  "G#5",
  null,
  "D#5",
  null,
  "B4",
  null,
  "F#4",
  null,
]
const topRaw = A.seq(
  topCell.map((n, i) => (n ? sawPluck(n, i % 8 === 4 ? 0.62 : 0.42, 0.11, i % 4 === 0 ? -0.36 : 0.36) : null)),
  "1/16",
  tempo
)
const topSpark = sidechain(
  A.vol(
    A.mix(
      A.ilpf(
        A.pan(topRaw, (t) => A.sin(t, 0.08) * 0.5),
        4200,
        0.72,
        128
      ),
      A.idelay(topRaw, 4, eighthSec * 3, 0.46),
      0.58
    ),
    0.25
  ),
  0.48
)

// Slow chord layers underneath the plucks.
const padVoice = (hz) => {
  const env = A.adsr({ releaseTime: bar(3.75), attackSec: 1.15, decaySec: 0.6, sustain: 0.72, releaseSec: 3.5 })
  const out = A.alloc()
  return (t) => {
    const e = env(t)
    const drift = 1 + 0.003 * A.sin(t, 0.11) + 0.0015 * A.sin(t, 0.37)
    const s = (A.suprsaw(t, hz * drift) * 0.52 + A.tri(t, hz * 0.5) * 0.26 + A.sin(t, hz * 2) * 0.08) * e * 0.08
    out[0] = s * (0.9 + 0.1 * A.sin(t, 0.055))
    out[1] = s * (0.9 - 0.1 * A.sin(t, 0.049))
    return out
  }
}
const padChord = (notes) => A.chord(padVoice, ...notes)
const padsRaw = A.polyseq(
  [
    padChord(["G#2", "B2", "D#3", "F#3", "B3"]),
    null,
    padChord(["B2", "D#3", "F#3", "B3", "C#4"]),
    null,
    padChord(["C#3", "E3", "G#3", "B3", "D#4"]),
    null,
    padChord(["E2", "B2", "E3", "G#3", "B3"]),
    null,
    padChord(["C#3", "F#3", "G#3", "B3", "D#4"]),
    null,
    padChord(["F#2", "C#3", "F#3", "A#3", "C#4"]),
    null,
    padChord(["G#2", "B2", "D#3", "F#3", "G#3"]),
    null,
    null,
    null,
  ],
  "1/1",
  tempo,
  8
)
const padsDark = sidechain(A.vol(A.ichorus(A.ilpf(padsRaw, 620, 0.74, 220), 0.055, 0.011, 5, 0.03, 0.55), 0.62), 0.28)
const padsWide = sidechain(
  A.vol(
    A.ichorus(A.iphaser(A.ilpf(padsRaw, 1700, 0.78, 220), 0.042, 0.44, 4, 160), 0.075, 0.012, 5, 0.028, 0.58),
    0.52
  ),
  0.58
)

// Low end follows the later MIDI bass walk but with club-friendly roots.
const bassVoice = (note, next = note, vel = 1) => {
  const from = A.pitch(note)
  const to = A.pitch(next)
  const env = A.adsr({ releaseTime: barSec * 0.92, attackSec: 0.008, decaySec: 0.24, sustain: 0.78, releaseSec: 0.18 })
  const out = A.alloc()
  return (t) => {
    const glide = clamp01(t / (eighthSec * 1.3))
    const hz = A.lerp(from, to, glide * glide)
    const e = env(t)
    const s = (A.sin(t, hz) * 0.78 + A.saw(t, hz) * 0.16 + A.saw(t, hz * 2) * 0.045) * e * vel * 0.5
    out[0] = s
    out[1] = s
    return out
  }
}
const bassRaw = A.polyseq(
  [
    bassVoice("G#1", "G#1", 1),
    null,
    bassVoice("B1", "C#2", 0.82),
    null,
    bassVoice("C#2", "E2", 0.94),
    null,
    bassVoice("E2", "C#2", 0.88),
    null,
    bassVoice("C#2", "F#1", 0.9),
    null,
    bassVoice("F#1", "G#1", 0.88),
    null,
    bassVoice("G#1", "G#1", 1),
    null,
    bassVoice("G#1", "G#1", 0.76),
    null,
  ],
  "1/2",
  tempo,
  3
)
const bass = sidechain(A.vol(A.distort(A.ilpf(bassRaw, 155, 0.95, 180), 1.7), 0.84), 0.93)
const rumble = sidechain(
  A.vol(A.distort(A.ilpf(A.idelay(A.vol(kick, 0.7), 8, eighthSec, 0.58, 4), 74, 1.15, 300), 4.2), 0.34),
  0.97
)
const lowEnd = A.sum(A.vol(kick, 0.98), ghostKick, bass, rumble)

const chordHitVoice = (hz) => {
  const env = A.adsr({ releaseTime: bar(1.5), attackSec: 0.018, decaySec: 0.32, sustain: 0.46, releaseSec: 0.8 })
  const out = A.alloc()
  return (t) => {
    const e = env(t)
    const s = (A.suprsaw(t, hz) * 0.6 + A.saw(t, hz * 2) * 0.16 + A.sin(t, hz) * 0.08) * e * 0.1
    out[0] = s
    out[1] = s
    return out
  }
}
const chordHits = sidechain(
  A.vol(
    A.ichorus(
      A.polyseq(
        [
          A.chord(chordHitVoice, "G#3", "B3", "D#4", "F#4"),
          null,
          null,
          null,
          A.chord(chordHitVoice, "E3", "G#3", "B3", "E4"),
          null,
          null,
          null,
        ],
        "1/1",
        tempo,
        4
      ),
      0.06,
      0.011,
      4,
      0.026,
      0.5
    ),
    0.62
  ),
  0.72
)

// Classic filtered-noise lifts and a pitch riser into the drops.
const noiseWash = A.hihat({ open: true, decaySec: 4.0, shimmerHz: 5200, tone: 0.045 })
const reverse16 = A.vol(A.timeReverse(noiseWash, 0, bar(16)), 0.55)
const reverse8 = A.vol(A.timeReverse(noiseWash, 0, bar(8)), 0.5)
const crash = A.seq(
  [A.vol(A.hihat({ open: true, decaySec: 1.2, shimmerHz: 4800, tone: 0.08 }), 0.42), null, null, null],
  "1/1",
  tempo
)
const snareBuild = A.sum(
  A.seq(
    [null, null, A.vol(A.snare({ tuneHz: 205, noiseAmt: 0.86, decaySec: 0.08, snap: 0.42 }), 0.11), null],
    "1/16",
    tempo
  ),
  A.vol(
    A.seq(
      [
        A.vol(A.snare({ tuneHz: 220, noiseAmt: 0.9, decaySec: 0.05, snap: 0.5 }), 0.13),
        null,
        A.vol(A.snare({ tuneHz: 250, noiseAmt: 0.92, decaySec: 0.04, snap: 0.52 }), 0.1),
        A.vol(A.snare({ tuneHz: 275, noiseAmt: 0.94, decaySec: 0.033, snap: 0.55 }), 0.08),
      ],
      "1/16",
      tempo
    ),
    A.fadeIn(bar(6), bar(6))
  )
)
const pitchRiseVoice = (hz) => {
  const out = A.alloc()
  return (t) => {
    const e = A.fadeIn(bar(11))(t) * A.fadeOut(bar(2), bar(14))(t)
    const climb = Math.pow(2, t / bar(16))
    const s = (A.saw(t, hz * climb) * 0.13 + A.sin(t, hz * 2 * climb) * 0.09) * e
    out[0] = s
    out[1] = -s
    return out
  }
}
const pitchRise = A.vol(A.chord(pitchRiseVoice, "G#2", "D#3", "G#3"), 0.38)

const intro = A.sum(A.vol(padsDark, A.fadeIn(bar(10))), A.vol(pulseDark, A.fadeIn(bar(6))), reverse16)
const awaken = A.sum(
  A.vol(kick, A.fadeIn(bar(6), bar(6))),
  A.vol(hats, A.fadeIn(bar(8))),
  A.vol(bass, A.fadeIn(bar(10))),
  A.vol(padsDark, 1.15),
  pulseOpen,
  A.vol(arpDark, A.fadeIn(bar(8))),
  reverse16
)
const groove = A.sum(lowEnd, hats, clap, padsWide, pulseOpen, arpOpening, A.vol(crash, 0.72))
const breakdown = A.sum(A.vol(padsDark, 1.25), A.vol(pulseDark, 0.78), A.vol(arpDark, A.fadeIn(bar(6))), reverse8)
const build = A.sum(
  A.vol(kick, A.fadeOut(bar(5), bar(9))),
  A.vol(hats, A.fadeIn(bar(5))),
  A.vol(padsWide, 0.82),
  A.vol(pulseOpen, 0.9),
  arpOpening,
  A.vol(snareBuild, A.fadeIn(bar(7))),
  pitchRise,
  reverse16
)
const drop = A.sum(lowEnd, hats, clap, ride, padsWide, pulseOpen, arpFull, topSpark, chordHits, A.vol(crash, 0.9))
const outro = A.sum(
  A.vol(kick, A.fadeOut(bar(6), 0)),
  A.vol(bass, A.fadeOut(bar(8), 0)),
  A.vol(hats, A.fadeOut(bar(8), 0)),
  A.vol(padsDark, A.fadeOut(bar(12), 0)),
  A.vol(pulseDark, A.fadeOut(bar(10), 0)),
  A.vol(arpDark, A.fadeOut(bar(8), 0))
)

// 128 bars at 128 BPM: four minutes of slow-open progressive pluck energy.
const arrangement = A.song(
  A.section(intro, bar(16)),
  A.section(awaken, bar(16)),
  A.section(groove, bar(24)),
  A.section(breakdown, bar(16)),
  A.section(build, bar(16)),
  A.section(drop, bar(32)),
  A.section(outro, bar(8))
)

A.icomp(arrangement, {
  thresholdDb: -8.8,
  ratio: 3.5,
  kneeDb: 4.5,
  attackSec: 0.0038,
  releaseSec: 0.13,
  makeupDb: 1.25,
})

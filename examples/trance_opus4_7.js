// composed by opus 4.7

const BPM = 126
const tempo = Æ.tempoLfo(Æ.tempoBpm(BPM), 0.7, 0.04)
const barSec = Æ.sec("1", BPM)
const loopSec = barSec * 4
const sixteenthSec = Æ.sec("1/16", BPM)
const eighthSec = Æ.sec("1/8", BPM)
const quarterSec = Æ.sec("1/4", BPM)
const halfSec = Æ.sec("1/2", BPM)

const duck = (t) => 0.38 + 0.62 * Math.min(1, (t % quarterSec) / sixteenthSec)
const sidechain = (f) => {
  const out = Æ.alloc()
  return (t) => {
    const [l, r] = f(t)
    const g = duck(t)
    out[0] = l * g
    out[1] = r * g
    return out
  }
}

const kick = Æ.seq([Æ.kick({ tuneHz: 23, decaySec: 0.45, pitchDecaySec: 0.075 }), null, null, null], "1/16", tempo)

const hats = Æ.seq(
  [
    null,
    null,
    Æ.vol(Æ.hihat({ open: true, decaySec: 0.22, shimmerHz: 7600, tone: 0.12 }), 0.3),
    Æ.vol(Æ.hihat({ decaySec: 0.026, shimmerHz: 8800, tone: 0.08 }), 0.08),
    null,
    null,
    Æ.vol(Æ.hihat({ open: true, decaySec: 0.2, shimmerHz: 7400, tone: 0.1 }), 0.27),
    null,
    null,
    Æ.vol(Æ.hihat({ decaySec: 0.03, shimmerHz: 9200, tone: 0.08 }), 0.07),
    Æ.vol(Æ.hihat({ open: true, decaySec: 0.24, shimmerHz: 7800, tone: 0.12 }), 0.32),
    null,
    null,
    Æ.vol(Æ.hihat({ decaySec: 0.028, shimmerHz: 8800, tone: 0.07 }), 0.07),
    Æ.vol(Æ.hihat({ open: true, decaySec: 0.18, shimmerHz: 8000, tone: 0.11 }), 0.25),
    Æ.vol(Æ.hihat({ decaySec: 0.022, shimmerHz: 9800, tone: 0.08 }), 0.06),
  ],
  "1/16",
  tempo
)

const clap = Æ.seq(
  [
    null,
    null,
    null,
    null,
    Æ.vol(Æ.snare({ tuneHz: 165, noiseAmt: 0.74, decaySec: 0.11, snap: 0.24 }), 0.34),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    Æ.vol(Æ.snare({ tuneHz: 155, noiseAmt: 0.76, decaySec: 0.13, snap: 0.26 }), 0.36),
    null,
    null,
    Æ.vol(Æ.snare({ tuneHz: 210, noiseAmt: 0.82, decaySec: 0.045, snap: 0.32 }), 0.1),
  ],
  "1/16",
  tempo
)

const acidVoice = (note, accent = false, decaySec = 0.22) => {
  const lfo = Æ.lfo(1, 1)
  const opts = { accent, cutoffHz: accent ? 360 : 230, envModOct: accent ? 4.4 : 2.6, q: 11, decaySec }
  const acid = Æ.iacid(Æ.pitch(note), opts)
  return (t) => {
    opts.cutoffHz = (accent ? 360 : 230) + lfo(t, 1000)
    return acid(t)
  }
}

let acid = Æ.seq(
  [
    acidVoice("D#2", true, 0.3),
    null,
    acidVoice("D#2", false, 0.14),
    acidVoice("F#2", false, 0.16),
    acidVoice("A#2", true, 0.24),
    null,
    acidVoice("B2", false, 0.16),
    acidVoice("A#2", false, 0.12),
    acidVoice("F#2", true, 0.28),
    null,
    acidVoice("D#2", false, 0.14),
    acidVoice("C#3", false, 0.18),
    acidVoice("B2", true, 0.26),
    acidVoice("A#2", false, 0.12),
    null,
    acidVoice("C#3", true, 0.2),
  ],
  "1/16",
  tempo
)
acid = Æ.vol(Æ.distort(Æ.mix(acid, Æ.idelay(acid, 5, Æ.sec("3/16", BPM), 0.42), 0.72), 2.4), 0.32)

let lead = Æ.seq(
  [
    null,
    null,
    null,
    Æ.iacid(Æ.pitch("F#4"), { accent: true, cutoffHz: 650, envModOct: 2.8, q: 7, decaySec: 0.16 }),
    null,
    Æ.iacid(Æ.pitch("A#4"), { accent: false, cutoffHz: 520, envModOct: 2.2, q: 7, decaySec: 0.12 }),
    null,
    null,
    Æ.iacid(Æ.pitch("C#5"), { accent: true, cutoffHz: 740, envModOct: 3.1, q: 7, decaySec: 0.18 }),
    null,
    Æ.iacid((t) => Æ.lerp(Æ.pitch("A#4"), Æ.pitch("B4"), Math.min(1, t / sixteenthSec)), {
      accent: true,
      cutoffHz: 600,
      envModOct: 2.5,
      q: 8,
      decaySec: 0.18,
    }),
    null,
    null,
    Æ.iacid(Æ.pitch("F#4"), { accent: false, cutoffHz: 560, envModOct: 2.2, q: 7, decaySec: 0.13 }),
    Æ.iacid(Æ.pitch("D#4"), { accent: false, cutoffHz: 500, envModOct: 2.0, q: 7, decaySec: 0.11 }),
    null,
  ],
  "1/16",
  tempo
)
lead = Æ.pan(Æ.mix(Æ.vol(lead, 0.1), Æ.idelay(lead, 6, Æ.sec("3/16", BPM), 0.52), 0.66), (t) => Æ.sin(t, 0.08) * 0.28)

const oscPad = Æ.suprsaw
const padChord = (notes) => Æ.chord((hz) => Æ.sum(Æ.pad(hz, oscPad), Æ.pad(hz, Æ.square)), ...notes)
let pads = Æ.polyseq(
  [
    padChord(["D#3", "F#3", "A#3", "D#4"]),
    null,
    null,
    null,
    padChord(["B2", "D#3", "F#3", "B3"]),
    null,
    null,
    null,
    padChord(["F#2", "A#2", "C#3", "F#3"]),
    null,
    null,
    null,
    padChord(["C#3", "F3", "G#3", "C#4"]),
    null,
    null,
    null,
  ],
  "1/4",
  tempo,
  8
)
pads = sidechain(Æ.vol(Æ.ichorus(Æ.ilpf(pads, 1800, 0.8, 160)), 0.38))

const guitarNote = (note) => Æ.ikarplus(Æ.pitch(note), { decay: 0.994 })
let guitar = Æ.seq(
  [
    null,
    guitarNote("F#3"),
    null,
    guitarNote("A#3"),
    null,
    guitarNote("B3"),
    null,
    null,
    guitarNote("C#4"),
    null,
    guitarNote("A#3"),
    null,
    null,
    guitarNote("F#3"),
    guitarNote("D#3"),
    null,
  ],
  "1/16",
  tempo
)
guitar = Æ.pan(Æ.vol(Æ.mix(guitar, Æ.idelay(guitar, 4, Æ.sec("3/16", BPM), 0.45), 0.7), 0.95), 0.4)

const swellVoice = Æ.vol(Æ.hihat({ open: true, decaySec: 1.7, shimmerHz: 6000 }), 0.28)
const reverseSwell = Æ.crossfade(Æ.timeReverse(swellVoice, 0, loopSec), swellVoice, loopSec - eighthSec, 0.05)
const swellStart = loopSec - halfSec
const loopSwell = Æ.timeRepeat((t) => (t > swellStart ? reverseSwell(t) : ZERO), loopSec)

const bar = (n) => barSec * n

// Section mixes -- each picks a subset of the layers above.
const introMix = Æ.sum(Æ.vol(kick, Æ.fadeIn(bar(2), 0)), Æ.vol(hats, Æ.fadeIn(bar(4), bar(2))))

const verseMix = Æ.sum(Æ.vol(kick, 0.95), hats, clap, pads, sidechain(guitar))

const buildMix = Æ.sum(
  Æ.vol(kick, 0.95),
  hats,
  clap,
  pads,
  sidechain(guitar),
  Æ.vol(sidechain(acid), Æ.fadeIn(bar(6), 0)), // acid swells in across the build
  Æ.vol(loopSwell, Æ.fadeIn(bar(6), 0))
)

const dropMix = Æ.sum(Æ.vol(kick, 0.95), hats, clap, pads, sidechain(guitar), sidechain(acid), sidechain(lead))

const bridgeMix = Æ.sum(Æ.vol(kick, 0.4), Æ.vol(pads, 1.2), Æ.vol(sidechain(guitar), 0.7))

const buildupMix = Æ.sum(
  Æ.vol(kick, Æ.fadeOut(bar(4), 0)), // kick falls away into the drop
  Æ.vol(hats, Æ.fadeIn(bar(3), 0)),
  Æ.vol(loopSwell, Æ.fadeIn(bar(4), 0))
)

const outroMix = Æ.sum(Æ.vol(pads, Æ.fadeOut(bar(6), bar(2))), Æ.vol(sidechain(guitar), Æ.fadeOut(bar(4), bar(2))))

// 12 sections, ~124 bars (~2:25 at 126 BPM)
const arrangement = Æ.song(
  Æ.section(introMix, bar(8)),
  Æ.section(verseMix, bar(16)),
  Æ.section(buildMix, bar(8)),
  Æ.section(dropMix, bar(8)),
  Æ.section(bridgeMix, bar(8)),
  Æ.section(verseMix, bar(16)),
  Æ.section(buildMix, bar(8)),
  Æ.section(dropMix, bar(8)),
  Æ.section(bridgeMix, bar(8)),
  Æ.section(buildupMix, bar(4)),
  Æ.section(dropMix, bar(8)),
  Æ.section(outroMix, bar(8))
)

Æ.icomp(arrangement, { thresholdDb: -9, ratio: 3, kneeDb: 5, attackSec: 0.004, releaseSec: 0.12, makeupDb: 1.5 })

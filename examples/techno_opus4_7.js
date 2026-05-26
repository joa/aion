// composed by opus 4.7 -- with a bit of human kick drum tweaking

const BPM = 132
const tempo = A.tempoBpm(BPM)
const barSec = A.sec("1", tempo)
const quarterSec = A.sec("1/4", tempo)
const eighthSec = A.sec("1/8", tempo)
const sixteenthSec = A.sec("1/16", tempo)
const bar = (n) => barSec * n

const pump = (t) => 0.22 + 0.78 * Math.min(1, (t % quarterSec) / (sixteenthSec * 1.25))
const sidechain = (f, depth = 1) => {
  const out = A.alloc()
  return (t) => {
    const [l, r] = f(t)
    const g = A.lerp(1, pump(t), depth)
    out[0] = l * g
    out[1] = r * g
    return out
  }
}

const kick = A.polyseq(A.pattern("#---", A.kick({ tuneHz: 8, decaySec: quarterSec, pitchDecaySec: eighthSec  })), "1/16", tempo, 1)

const ghostKick = A.seq(
  A.pattern("-------#------#-", A.vol(A.kick({ tuneHz: 22, decaySec: 0.12, pitchDecaySec: 0.1 }), 0.16)),
  "1/16",
  tempo
)

const ch = A.hihat({ decaySec: 0.018, shimmerHz: 9400, tone: 0.07 })
const oh = A.hihat({ open: true, decaySec: 0.18, shimmerHz: 7200, tone: 0.11 })
const hats = A.seq(
  [
    null,
    A.vol(ch, 0.06),
    A.vol(oh, 0.27),
    A.vol(ch, 0.07),
    null,
    A.vol(ch, 0.05),
    A.vol(oh, 0.24),
    null,
    null,
    A.vol(ch, 0.07),
    A.vol(oh, 0.29),
    A.vol(ch, 0.06),
    null,
    A.vol(ch, 0.05),
    A.vol(oh, 0.22),
    A.vol(ch, 0.09),
  ],
  "1/16",
  tempo
)

const ride = A.seq(
  [null, null, A.vol(A.hihat({ open: true, decaySec: 0.34, shimmerHz: 5800, tone: 0.18 }), 0.2), null],
  "1/16",
  tempo
)
const clap = A.seq(
  [
    null,
    null,
    null,
    null,
    A.vol(A.snare({ tuneHz: 150, noiseAmt: 0.82, decaySec: 0.105, snap: 0.34 }), 0.36),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    A.vol(A.snare({ tuneHz: 145, noiseAmt: 0.84, decaySec: 0.12, snap: 0.36 }), 0.39),
    null,
    null,
    A.vol(A.snare({ tuneHz: 210, noiseAmt: 0.9, decaySec: 0.04, snap: 0.45 }), 0.12),
  ],
  "1/16",
  tempo
)

const perc = A.seq(
  [
    null,
    null,
    null,
    A.pan(A.vol(A.fm2(A.pitch("D#5"), { ratio: 1.49, modIndex: 7, modDecaySec: 0.05 }), 0.16), -0.36),
    null,
    null,
    A.pan(A.vol(A.fm2(A.pitch("F#5"), { ratio: 1.8, modIndex: 6, modDecaySec: 0.04 }), 0.12), 0.28),
    null,
    null,
    A.pan(A.vol(A.fm2(A.pitch("C#5"), { ratio: 1.33, modIndex: 8, modDecaySec: 0.045 }), 0.14), 0.42),
    null,
    null,
    null,
    A.pan(A.vol(A.fm2(A.pitch("A#4"), { ratio: 2.01, modIndex: 5, modDecaySec: 0.035 }), 0.1), -0.22),
    null,
    null,
  ],
  "1/16",
  tempo
)

const rumbleSeed = A.idelay(A.vol(kick, 0.8), 7, eighthSec, 0.64, 4)
const rumbleBody = A.ilpf(A.distort(rumbleSeed, 5.8), 92, 1.35, 360)
const rumble = sidechain(A.vol(A.distort(rumbleBody, 2.4), 0.62), 0.95)

const acidVoice = (note, accent = false, cutoffBase = 360, envModOct = 3, decaySec = 0.18) =>
  A.iacid(A.pitch(note), {
    accent,
    cutoffHz: (t) => cutoffBase + 180 * (0.5 + 0.5 * A.sin(t, 0.13)) + 95 * (0.5 + 0.5 * A.sin(t, 0.53)),
    envModOct,
    q: accent ? 13 : 10,
    decaySec,
  })

let acid = A.seq(
  [
    acidVoice("D#2", true, 340, 4.8, 0.28),
    null,
    acidVoice("D#2", false, 260, 2.6, 0.12),
    acidVoice("F#2", false, 300, 2.9, 0.13),
    null,
    acidVoice("A#2", true, 380, 4.2, 0.2),
    acidVoice("B2", false, 320, 3.1, 0.12),
    null,
    acidVoice("D#3", true, 420, 4.5, 0.19),
    null,
    acidVoice("C#3", false, 330, 3.0, 0.13),
    acidVoice("B2", false, 310, 2.8, 0.12),
    acidVoice("A#2", true, 390, 4.3, 0.22),
    null,
    acidVoice("F#2", false, 290, 3.0, 0.12),
    acidVoice("C#3", true, 450, 4.7, 0.16),
  ],
  "1/16",
  tempo
)
acid = sidechain(A.vol(A.distort(A.mix(acid, A.idelay(acid, 6, A.sec("3/16", tempo), 0.47), 0.7), 3.1), 0.36), 0.75)

let acidHook = A.seq(
  [
    null,
    null,
    acidVoice("F#3", true, 700, 2.5, 0.12),
    null,
    acidVoice("A#3", false, 620, 2.2, 0.1),
    null,
    null,
    acidVoice("C#4", true, 820, 2.7, 0.13),
    null,
    acidVoice("D#4", false, 680, 2.1, 0.1),
    null,
    null,
    acidVoice("C#4", true, 760, 2.6, 0.12),
    null,
    acidVoice("A#3", false, 640, 2.2, 0.1),
    null,
  ],
  "1/16",
  tempo
)
acidHook = sidechain(
  A.pan(A.mix(A.vol(acidHook, 0.12), A.idelay(acidHook, 5, eighthSec * 3, 0.42), 0.6), (t) => A.sin(t, 0.07) * 0.35),
  0.65
)

const padChord = (notes) => A.chord((hz) => A.sum(A.pad(hz, A.suprsaw), A.vol(A.pad(hz / 2, A.tri), 0.45)), ...notes)
let pads = A.polyseq(
  [
    padChord(["D#2", "F#2", "A#2", "C#3"]),
    null,
    null,
    null,
    padChord(["B1", "D#2", "F#2", "A#2"]),
    null,
    null,
    null,
    padChord(["F#1", "A#1", "C#2", "F#2"]),
    null,
    null,
    null,
    padChord(["C#2", "F2", "G#2", "C#3"]),
    null,
    null,
    null,
  ],
  "1/2",
  tempo,
  8
)
pads = sidechain(
  A.vol(A.ichorus(A.iphaser(A.ilpf(pads, 1250, 0.9, 180), 0.045, 0.55, 5, 160), 0.07, 0.012, 4, 0.028, 0.55), 0.33),
  0.8
)

const stab = A.seq(
  [
    null,
    null,
    A.chord((hz) => A.pluck(hz, A.square), "D#3", "A#3", "C#4"),
    null,
    null,
    null,
    null,
    null,
    A.chord((hz) => A.pluck(hz, A.square), "B2", "F#3", "A#3"),
    null,
    null,
    null,
    null,
    null,
    A.chord((hz) => A.pluck(hz, A.square), "C#3", "G#3", "C#4"),
    null,
  ],
  "1/16",
  tempo
)
const delayedStab = sidechain(A.pan(A.vol(A.mix(stab, A.idelay(stab, 5, eighthSec * 3, 0.5), 0.58), 0.18), -0.18), 0.65)

const sweepSource = A.hihat({ open: true, decaySec: 1.8, shimmerHz: 5000, tone: 0.04 })
const sweep = A.timeRepeat((t) => (t < bar(3) ? A.stereo(0) : A.vol(sweepSource, A.fadeIn(bar(1), bar(3)))(t)), bar(4))

const drums = A.sum(A.vol(kick, 0.98), ghostKick, hats, clap, perc)
const fullDrums = A.sum(drums, ride)
const lowEnd = A.sum(A.vol(kick, 0.98), rumble)

const intro = A.sum(
  A.vol(kick, A.fadeIn(bar(4))),
  A.vol(rumble, A.fadeIn(bar(8))),
  A.vol(hats, A.fadeIn(bar(8), bar(4)))
)
const groove = A.sum(lowEnd, hats, clap, A.vol(perc, 0.45), A.vol(pads, A.fadeIn(bar(8))))
const acidIn = A.sum(lowEnd, drums, pads, delayedStab, A.vol(acid, A.fadeIn(bar(12))), A.vol(sweep, 0.35))
const drop = A.sum(lowEnd, fullDrums, pads, delayedStab, acid, acidHook)
const breakDown = A.sum(
  A.vol(kick, 0.32),
  A.vol(rumble, 0.55),
  A.vol(pads, 1.4),
  A.vol(delayedStab, 0.75),
  A.vol(acidHook, 0.32)
)
const tension = A.sum(
  A.vol(kick, A.fadeOut(bar(4), 0)),
  A.vol(hats, A.fadeIn(bar(4))),
  A.vol(acid, A.fadeIn(bar(4))),
  A.vol(sweep, 0.75)
)
const outro = A.sum(
  A.vol(lowEnd, A.fadeOut(bar(6), bar(2))),
  A.vol(hats, A.fadeOut(bar(8), 0)),
  A.vol(pads, A.fadeOut(bar(8), 0))
)

const arrangement = A.song(
  A.section(intro, bar(16)),
  A.section(groove, bar(16)),
  A.section(acidIn, bar(16)),
  A.section(drop, bar(32)),
  A.section(breakDown, bar(8)),
  A.section(tension, bar(8)),
  A.section(drop, bar(32)),
  A.section(outro, bar(16))
)

A.icomp(arrangement, { thresholdDb: -8.5, ratio: 3.5, kneeDb: 4, attackSec: 0.004, releaseSec: 0.14, makeupDb: 1.2 })

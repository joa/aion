// composed by codex 5.5

const BPM = 138
const tempo = A.tempoLfo(A.tempoBpm(BPM), 0.35, 0.025)
const barSec = A.sec("1", tempo)
const quarterSec = A.sec("1/4", tempo)
const eighthSec = A.sec("1/8", tempo)
const sixteenthSec = A.sec("1/16", tempo)
const bar = (n) => barSec * n

const clamp01 = (x) => Math.max(0, Math.min(1, x))
const pulse = (t) => clamp01((t % quarterSec) / (sixteenthSec * 1.15))
const pump = (t) => 0.2 + 0.8 * pulse(t)
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

// Drums
const kick = A.seq(A.pattern("#---", A.kick({ tuneHz: 29, decaySec: 0.48, pitchDecaySec: 0.058 })), "1/16", tempo)
const subKick = A.seq(
  A.pattern("-------#------#-", A.vol(A.kick({ tuneHz: 24, decaySec: 0.2, pitchDecaySec: 0.08 }), 0.13)),
  "1/16",
  tempo
)

const ch = A.hihat({ decaySec: 0.018, shimmerHz: 9400, tone: 0.065 })
const tick = A.hihat({ decaySec: 0.012, shimmerHz: 11200, tone: 0.04 })
const oh = A.hihat({ open: true, decaySec: 0.2, shimmerHz: 7600, tone: 0.115 })
const hats = A.seq(
  [
    null,
    A.vol(ch, 0.06),
    A.vol(oh, 0.3),
    A.vol(tick, 0.07),
    null,
    A.vol(ch, 0.055),
    A.vol(oh, 0.26),
    A.vol(tick, 0.08),
    null,
    A.vol(ch, 0.065),
    A.vol(oh, 0.32),
    A.vol(tick, 0.07),
    null,
    A.vol(ch, 0.055),
    A.vol(oh, 0.25),
    A.vol(tick, 0.105),
  ],
  "1/16",
  tempo
)
const rides = A.seq(
  [null, null, A.vol(A.hihat({ open: true, decaySec: 0.38, shimmerHz: 6100, tone: 0.18 }), 0.18), null],
  "1/16",
  tempo
)
const clap = A.seq(
  [
    null,
    null,
    null,
    null,
    A.vol(A.snare({ tuneHz: 175, noiseAmt: 0.83, decaySec: 0.12, snap: 0.4 }), 0.38),
    null,
    null,
    A.vol(A.snare({ tuneHz: 230, noiseAmt: 0.92, decaySec: 0.035, snap: 0.55 }), 0.07),
    null,
    null,
    null,
    null,
    A.vol(A.snare({ tuneHz: 168, noiseAmt: 0.84, decaySec: 0.13, snap: 0.42 }), 0.42),
    null,
    null,
    A.vol(A.snare({ tuneHz: 245, noiseAmt: 0.95, decaySec: 0.045, snap: 0.5 }), 0.11),
  ],
  "1/16",
  tempo
)
const tom = (note, pan, vel) =>
  A.pan(A.vol(A.fm2(A.pitch(note), { ratio: 0.52, modIndex: 8, modDecaySec: 0.08 }), vel), pan)
const perc = A.seq(
  [
    null,
    null,
    null,
    tom("C#4", -0.4, 0.09),
    null,
    null,
    tom("E4", 0.38, 0.08),
    null,
    null,
    tom("G#4", -0.24, 0.1),
    null,
    null,
    null,
    tom("B4", 0.44, 0.08),
    null,
    tom("E5", -0.5, 0.06),
  ],
  "1/16",
  tempo
)

// Low end
const bassVoice = (note, glideTo = note) => {
  const from = A.pitch(note)
  const to = A.pitch(glideTo)
  const env = A.adsr({
    releaseTime: quarterSec * 0.94,
    attackSec: 0.006,
    decaySec: 0.18,
    sustain: 0.76,
    releaseSec: 0.12,
  })
  const out = A.alloc()
  return (t) => {
    const bend = clamp01(t / (sixteenthSec * 1.5))
    const hz = A.lerp(from, to, bend)
    const e = env(t)
    const s = (A.sin(t, hz) * 0.8 + A.saw(t, hz) * 0.16 + A.saw(t, hz * 2) * 0.05) * e * 0.48
    out[0] = s
    out[1] = s
    return out
  }
}
const bassRaw = A.polyseq(
  [
    bassVoice("F#1"),
    null,
    bassVoice("F#1", "G#1"),
    bassVoice("C#2"),
    bassVoice("D2"),
    null,
    bassVoice("D2", "E2"),
    bassVoice("C#2"),
    bassVoice("A1"),
    null,
    bassVoice("A1"),
    bassVoice("E2"),
    bassVoice("E2"),
    null,
    bassVoice("G#1"),
    bassVoice("E2", "F#2"),
  ],
  "1/8",
  tempo,
  3
)
const bass = sidechain(A.vol(A.distort(A.ilpf(bassRaw, 180, 0.95, 180), 1.8), 0.86), 0.92)
const rumbleSeed = A.idelay(A.vol(kick, 0.76), 7, eighthSec, 0.62, 4)
const rumble = sidechain(A.vol(A.distort(A.ilpf(rumbleSeed, 86, 1.25, 320), 4.4), 0.4), 0.95)
const lowEnd = A.sum(A.vol(kick, 0.98), subKick, bass, rumble)

// Harmonic bed
const padChord = (notes) =>
  A.chord(
    (hz) => A.sum(A.pad(hz, A.suprsaw), A.vol(A.pad(hz / 2, A.tri), 0.45), A.vol(A.pad(hz * 2, A.sin), 0.16)),
    ...notes
  )
const padCycle = A.polyseq(
  [
    padChord(["F#2", "A2", "C#3", "E3", "A3"]),
    null,
    null,
    null,
    padChord(["D2", "F#2", "A2", "C#3", "F#3"]),
    null,
    null,
    null,
    padChord(["A1", "C#2", "E2", "G#2", "C#3"]),
    null,
    null,
    null,
    padChord(["E2", "G#2", "B2", "D3", "G#3"]),
    null,
    null,
    null,
  ],
  "1/2",
  tempo,
  10
)
const padsBright = sidechain(
  A.vol(A.ichorus(A.iphaser(A.ilpf(padCycle, 1650, 0.82, 220), 0.05, 0.5, 5, 180), 0.09, 0.013, 5, 0.028, 0.58), 0.38),
  0.72
)
const padsDark = sidechain(A.vol(A.ichorus(A.ilpf(padCycle, 540, 0.75, 220), 0.055, 0.01, 4, 0.03, 0.5), 0.5), 0.45)

const choirVoice = (hz) => {
  const out = A.alloc()
  return (t) => {
    const drift = hz * (1 + 0.004 * A.sin(t, 0.17) + 0.002 * A.sin(t, 0.43))
    const env = A.adsr({ releaseTime: bar(4), attackSec: 1.2, decaySec: 0.6, sustain: 0.65, releaseSec: 3.5 })(t)
    const s = (A.sin(t, drift) + 0.34 * A.sin(t, drift * 2.01) + 0.16 * A.tri(t, drift * 0.5)) * env * 0.06
    out[0] = s * (0.92 + 0.08 * A.sin(t, 0.09))
    out[1] = s * (0.92 - 0.08 * A.sin(t, 0.09))
    return out
  }
}
const choirCycle = A.polyseq(
  [
    A.chord(choirVoice, "F#3", "C#4", "E4", "A4"),
    null,
    A.chord(choirVoice, "D3", "A3", "C#4", "F#4"),
    null,
    A.chord(choirVoice, "A3", "E4", "G#4", "C#5"),
    null,
    A.chord(choirVoice, "E3", "B3", "D4", "G#4"),
    null,
  ],
  "1/1",
  tempo,
  8
)
const choir = A.vol(A.ichorus(choirCycle, 0.035, 0.012, 5, 0.032, 0.62), 0.8)

// Arps and hooks
const arpVoice = (note, bright = false) =>
  A.fm2(A.pitch(note), {
    ratio: bright ? 2.02 : 1,
    modIndex: bright ? 1.2 : 1.8,
    modDecaySec: bright ? 0.035 : 0.055,
    env: A.adsr({
      releaseTime: 0.055,
      attackSec: 0.002,
      decaySec: bright ? 0.075 : 0.105,
      sustain: 0,
      releaseSec: 0.045,
    }),
  })
const arpNotes = [
  "F#3",
  "C#4",
  "A3",
  "E4",
  "C#4",
  "A3",
  "F#4",
  "C#4",
  "D3",
  "A3",
  "F#3",
  "C#4",
  "A3",
  "F#3",
  "D4",
  "A3",
  "A3",
  "E4",
  "C#4",
  "G#4",
  "E4",
  "C#4",
  "A4",
  "E4",
  "E3",
  "B3",
  "G#3",
  "D4",
  "B3",
  "G#3",
  "E4",
  "B3",
]
const arpRaw = A.seq(
  arpNotes.map((n) => arpVoice(n)),
  "1/16",
  tempo
)
const arp = sidechain(
  A.vol(
    A.mix(
      A.ichorus(A.ilpf(arpRaw, 2300, 1.25, 220), 0.18, 0.006, 3, 0.018, 0.45),
      A.idelay(arpRaw, 5, eighthSec * 3, 0.44),
      0.62
    ),
    0.37
  ),
  0.55
)
const arpDark = sidechain(A.vol(A.ilpf(arpRaw, 620, 0.8, 240), 0.32), 0.35)

const topArpNotes = [
  "F#5",
  null,
  "E5",
  null,
  "C#5",
  null,
  "A4",
  null,
  "D5",
  null,
  "C#5",
  null,
  "A4",
  null,
  "F#4",
  null,
  "A5",
  null,
  "G#5",
  null,
  "E5",
  null,
  "C#5",
  null,
  "B4",
  null,
  "G#4",
  null,
  "E5",
  null,
  "G#5",
  null,
]
const topArpRaw = A.seq(
  topArpNotes.map((n) => (n ? arpVoice(n, true) : null)),
  "1/8",
  tempo
)
const topArp = sidechain(
  A.vol(
    A.mix(
      A.pan(topArpRaw, (t) => A.sin(t, 0.11) * 0.52),
      A.idelay(topArpRaw, 4, eighthSec * 3, 0.42),
      0.58
    ),
    0.22
  ),
  0.45
)

const pluckLead = (note, vel = 1) =>
  A.vol(A.fm2(A.pitch(note), { ratio: 1.01, modIndex: 2.2, modDecaySec: 0.08 }), 0.24 * vel)
let hook = A.seq(
  [
    pluckLead("C#5", 0.9),
    null,
    pluckLead("E5", 0.75),
    pluckLead("F#5", 0.82),
    null,
    pluckLead("A5", 1),
    null,
    pluckLead("G#5", 0.76),
    pluckLead("F#5", 0.9),
    null,
    pluckLead("E5", 0.7),
    null,
    pluckLead("C#5", 0.85),
    pluckLead("B4", 0.7),
    null,
    pluckLead("A4", 0.65),
  ],
  "1/8",
  tempo
)
hook = sidechain(
  A.vol(
    A.mix(
      A.pan(hook, (t) => A.sin(t, 0.07) * 0.38),
      A.idelay(hook, 6, eighthSec * 3, 0.5),
      0.64
    ),
    0.42
  ),
  0.58
)

const acidVoice = (note, accent = false, cutoff = 520, envModOct = 3.2, decaySec = 0.16) =>
  A.iacid(A.pitch(note), {
    accent,
    wave: A.saw,
    cutoffHz: (t) => cutoff + 290 * (0.5 + 0.5 * A.sin(t, 0.09)) + 120 * (0.5 + 0.5 * A.sin(t, 0.61)),
    envModOct,
    q: accent ? 12 : 8,
    decaySec,
  })
let acid = A.seq(
  [
    acidVoice("F#2", true, 420, 4.5, 0.22),
    null,
    acidVoice("F#2", false, 360, 2.8, 0.12),
    acidVoice("C#3", false, 430, 3.1, 0.13),
    acidVoice("D3", true, 520, 4.2, 0.2),
    null,
    acidVoice("E3", false, 470, 3.0, 0.12),
    acidVoice("C#3", false, 420, 2.7, 0.11),
    acidVoice("A2", true, 500, 4.4, 0.2),
    null,
    acidVoice("A2", false, 380, 2.8, 0.12),
    acidVoice("E3", false, 460, 3.0, 0.13),
    acidVoice("E2", true, 480, 4.3, 0.22),
    null,
    acidVoice("G#2", false, 430, 2.8, 0.12),
    acidVoice("E3", true, 560, 4.6, 0.16),
  ],
  "1/16",
  tempo
)
acid = sidechain(A.vol(A.distort(A.mix(acid, A.idelay(acid, 6, eighthSec * 3, 0.46), 0.68), 2.8), 0.28), 0.72)

// Supersaw lead with a bright octave above it.
const leadEnv = A.adsr({ releaseTime: bar(2), attackSec: 0.04, decaySec: 0.22, sustain: 0.62, releaseSec: 0.7 })
const sawLeadVoice = (hz) => {
  const out = A.alloc()
  return (t) => {
    const e = leadEnv(t)
    const wob = hz * (1 + 0.004 * A.sin(t, 5.1))
    const s = (A.suprsaw(t, wob) * 0.58 + A.saw(t, wob * 2) * 0.18 + A.sin(t, wob) * 0.16) * e * 0.12
    out[0] = s * (0.9 + 0.1 * A.sin(t, 0.19))
    out[1] = s * (0.9 - 0.1 * A.sin(t, 0.19))
    return out
  }
}
const anthemCycle = A.polyseq(
  [
    A.chord(sawLeadVoice, "F#4", "A4", "C#5"),
    null,
    A.chord(sawLeadVoice, "E4", "A4", "C#5"),
    null,
    A.chord(sawLeadVoice, "D4", "F#4", "A4"),
    null,
    A.chord(sawLeadVoice, "E4", "G#4", "B4"),
    null,
    A.chord(sawLeadVoice, "A4", "C#5", "E5"),
    null,
    A.chord(sawLeadVoice, "G#4", "B4", "E5"),
    null,
    A.chord(sawLeadVoice, "E4", "G#4", "B4"),
    null,
    A.chord(sawLeadVoice, "C#4", "E4", "G#4"),
    null,
  ],
  "1/2",
  tempo,
  8
)
const anthem = sidechain(
  A.vol(
    A.mix(A.ichorus(anthemCycle, 0.06, 0.012, 5, 0.03, 0.55), A.idelay(anthemCycle, 5, eighthSec * 3, 0.38), 0.5),
    0.8
  ),
  0.7
)

// Reverse-time and build energy.
const noiseHit = A.hihat({ open: true, decaySec: 2.5, shimmerHz: 5200, tone: 0.05 })
const sweep8 = A.vol(A.timeReverse(noiseHit, 0, bar(8)), 0.62)
const sweep12 = A.vol(A.timeReverse(noiseHit, 0, bar(12)), 0.72)
const crash = A.vol(A.hihat({ open: true, decaySec: 1.1, shimmerHz: 4800, tone: 0.08 }), 0.44)
const crashOnOne = A.seq([crash, null, null, null], "1/1", tempo)
const snareBuild = A.sum(
  A.seq(
    [null, null, A.vol(A.snare({ tuneHz: 190, noiseAmt: 0.86, decaySec: 0.08, snap: 0.44 }), 0.11), null],
    "1/16",
    tempo
  ),
  A.vol(
    A.seq(
      [
        A.vol(A.snare({ tuneHz: 220, noiseAmt: 0.9, decaySec: 0.05, snap: 0.5 }), 0.13),
        null,
        A.vol(A.snare({ tuneHz: 240, noiseAmt: 0.92, decaySec: 0.04, snap: 0.5 }), 0.1),
        A.vol(A.snare({ tuneHz: 260, noiseAmt: 0.94, decaySec: 0.035, snap: 0.55 }), 0.08),
      ],
      "1/16",
      tempo
    ),
    A.fadeIn(bar(5), bar(7))
  )
)
const buildToneVoice = (hz) => {
  const out = A.alloc()
  return (t) => {
    const e = A.fadeIn(bar(11))(t)
    const climb = Math.pow(2, t / bar(12))
    const s = (A.saw(t, hz * climb) * 0.16 + A.sin(t, hz * 2 * climb) * 0.1) * e
    out[0] = s
    out[1] = -s
    return out
  }
}
const buildTone = A.vol(A.chord(buildToneVoice, "F#2", "C#3", "F#3"), 0.34)

// 104 bars at 138 BPM: about 3:01.
const intro = A.sum(A.vol(padsDark, A.fadeIn(bar(8))), A.vol(choir, A.fadeIn(bar(10))), A.vol(sweep12, 0.5))
const lift = A.sum(
  A.vol(kick, A.fadeIn(bar(4), bar(4))),
  A.vol(hats, A.fadeIn(bar(8))),
  A.vol(padsBright, 0.85),
  A.vol(bass, A.fadeIn(bar(6))),
  A.vol(arpDark, A.fadeIn(bar(4))),
  A.vol(sweep12, 0.7)
)
const drop1 = A.sum(lowEnd, hats, clap, padsBright, arp, hook, acid, A.vol(crashOnOne, 0.8))
const breakdown = A.sum(
  A.vol(padsDark, 1.25),
  A.vol(choir, 1.15),
  A.vol(arpDark, A.fadeIn(bar(4))),
  A.vol(hook, 0.35),
  A.vol(sweep8, 0.5)
)
const build = A.sum(
  A.vol(kick, A.fadeOut(bar(6), bar(4))),
  A.vol(hats, A.fadeIn(bar(6))),
  A.vol(padsBright, 0.8),
  A.vol(arpDark, A.fadeOut(bar(5), bar(7))),
  A.vol(acid, A.fadeIn(bar(8))),
  A.vol(snareBuild, A.fadeIn(bar(9))),
  buildTone,
  sweep12
)
const drop2 = A.sum(
  lowEnd,
  hats,
  rides,
  clap,
  perc,
  padsBright,
  arp,
  topArp,
  hook,
  acid,
  anthem,
  A.vol(crashOnOne, 0.9)
)
const outro = A.sum(
  A.vol(kick, A.fadeOut(bar(5), 0)),
  A.vol(bass, A.fadeOut(bar(6), 0)),
  A.vol(hats, A.fadeOut(bar(8), 0)),
  A.vol(padsDark, A.fadeOut(bar(8), 0)),
  A.vol(arpDark, A.fadeOut(bar(7), 0)),
  A.vol(choir, A.fadeOut(bar(8), 0))
)

const arrangement = A.song(
  A.section(intro, bar(12)),
  A.section(lift, bar(12)),
  A.section(drop1, bar(24)),
  A.section(breakdown, bar(16)),
  A.section(build, bar(12)),
  A.section(drop2, bar(24)),
  A.section(outro, bar(4))
)

A.icomp(arrangement, { thresholdDb: -8.2, ratio: 3.6, kneeDb: 4.5, attackSec: 0.0035, releaseSec: 0.13, makeupDb: 1.4 })

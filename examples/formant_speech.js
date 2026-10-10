const tempo = A.tempoBpm(96)
const eighthSec = A.sec("1/8", tempo)

const phrase = [
  { phoneme: "HH", durSec: 0.07 },
  "EH",
  "L",
  "OW",
  { phoneme: "SP", durSec: 0.1 },
  "EY",
  "AA",
  "N",
  { phoneme: "SP", durSec: 0.12 },
  "F",
  "AO",
  "R",
  "M",
  "AE",
  "N",
  "T",
  { phoneme: "SP", durSec: 0.08 },
  "S",
  "P",
  "IY",
  "T",
  "SH",
]

const voice = A.formantSpeech(phrase /*or just put "hello world" here */, {
  pitchHz: (t) => A.pitch("C4"),
  mouth: (t) => 0.9,
  breath: 0.05,
  gain: 0.95,
  rate: 0.75,
  transitionSec: 0.045,
})

const echo = A.idelay(
  A.pan(voice, (t) => 0.15 * A.sin(t, 0.2)),
  4,
  eighthSec * 1.5,
  0.48
)

const pulse = (note) => A.vol(A.iacid(A.pitch(note), { cutoffHz: 520, q: 1.4, decaySec: 0.22 }), 0.22)
const bass = A.seq([pulse("C2"), null, pulse("G1"), null, pulse("Bb1"), null, pulse("F1"), null], "1/8", tempo)

const hats = A.seq(
  A.pattern("#-#-", A.vol(A.hihat({ decaySec: 0.025, shimmerHz: 6200, tone: 0.08 }), 0.09)),
  "1/16",
  tempo
)

const line = A.sum(voice, A.vol(echo, 0.36), bass, hats)

A.icomp(line, { thresholdDb: -12, ratio: 3, kneeDb: 5, attackSec: 0.004, releaseSec: 0.12, makeupDb: 1.5 })
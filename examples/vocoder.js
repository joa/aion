// Formant speech sung by a detuned saw chord progression through the channel vocoder.

const tempo = A.tempoBpm(100)
const barSec = A.sec("1", tempo)

const sawPad = (hz) => {
  const out = A.alloc()
  return (t) => {
    out[0] = A.suprsaw(t, hz * 1.003) * 0.1
    out[1] = A.suprsaw(t, hz * 0.997) * 0.1
    return out
  }
}

const chords = A.seq(
  [
    A.chord(sawPad, "C3", "Eb3", "G3", "C4"),
    A.chord(sawPad, "Ab2", "C3", "Eb3", "Ab3"),
    A.chord(sawPad, "Bb2", "D3", "F3", "Bb3"),
    A.chord(sawPad, "G2", "B2", "D3", "G3"),
  ],
  "1",
  tempo
)

const voice = A.formantSpeech("we are the robots. we are made of time.", { rate: 0.85, mouth: 1.05 })

const robot = A.timeRepeat(A.ivocoder(chords, voice, { bands: 24, q: 1.2 }), barSec * 4)

const kick = A.seq(A.pattern("#---", A.kick({ tuneHz: 45, decaySec: 0.3 })), "1/16", tempo)
const hats = A.seq(A.pattern("--#-", A.vol(A.hihat({ decaySec: 0.03 }), 0.5)), "1/16", tempo)
const bassNote = (note) => {
  const out = A.alloc()
  const hz = A.pitch(note)
  return (t) => {
    out[0] = out[1] = A.sin(t, hz) * 0.3 * Math.exp(-t * 2)
    return out
  }
}
const bass = A.seq([bassNote("C2"), bassNote("Ab1"), bassNote("Bb1"), bassNote("G1")], "1", tempo)

A.sum(A.vol(robot, 0.9), kick, hats, bass)

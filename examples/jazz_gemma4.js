// composed by gemma4 26b-a4b with minor cleanup

/**
 * Aion Jazz Song
 * A composition featuring Rhodes chords, walking bass, 
 * jazz drums, and a melodic lead.
 */

const BPM = 90
const tempo = Æ.tempoBpm(BPM)

// --- Instruments ---

// Rhodes-like chord synth using FM and an ADSR envelope
const rhodes = (notes, vol = 0.3) => 
  Æ.vol(
    Æ.chord(
      hz => Æ.fm2(hz, { 
        env: Æ.adsr({ attackSec: 0.01, decaySec: 0.4, sustain: 0.2, releaseSec: 0.5 }), 
        ratio: 2, 
        modIndex: 4 
      }), 
      ...notes
    ), 
    vol
  )

// Double Bass using a plucked saw wave
const bass = (note, vol = 0.5) => 
  Æ.vol(Æ.pluck(Æ.pitch(note), Æ.saw), vol)

// Drum kit components
const kick = Æ.kick({ tuneHz: 50, decaySec: 0.3 })
const snare = Æ.snare({ tuneHz: 180, decaySec: 0.2 })
const hihat = Æ.hihat({ decaySec: 0.05 })

// --- Patterns & Sequences ---

// Chord progression: ii-V-I-VI in C Major
const prog = [
  ["D3", "F3", "A3", "C4"], // Dm7
  ["G3", "B3", "D4", "F4"], // G7
  ["C3", "E3", "G3", "B3"], // Cmaj7
  ["A3", "C#4", "E4", "G4"]  // A7
]

// A single 4-bar cycle of the chord progression
const chordCycle = Æ.seq(prog.map(p => rhodes(p, 0.4)), "1/1", tempo)

// Loop the chords for the song duration
const chords = Æ.timeRepeat(chordCycle, Æ.sec("16/1", tempo))

// Walking Bass Line
const bassSeq = Æ.seq(
  [
    bass("D2"), bass("D2"), bass("F2"), bass("G2"),
    bass("G2"), bass("G2"), bass("B2"), bass("D3"),
    bass("C2"), bass("C2"), bass("E2"), bass("G2"),
    bass("A2"), bass("A2"), bass("C#3"), bass("E3")
  ],
  "1/4",
  tempo
)
const bassLoop = Æ.timeRepeat(bassSeq, Æ.sec("16/1", tempo))

// Drum patterns: Kick on 1, Snare on 2 & 4, Eighth-note Hi-hats
const kickSeq = Æ.seq([kick, null, null, null], "1/4", tempo)
const snareSeq = Æ.seq([null, snare, null, snare], "1/4", tempo)
const hatSeq = Æ.seq([hihat, hihat, hihat, hihat, hihat, hihat, hihat, hihat], "1/8", tempo, Æ.shuffle(1/12))
const drums = Æ.sum(kickSeq, snareSeq, Æ.vol(hatSeq, 0.2))

// Melody (sax-like) using FM synthesis with a smooth ADSR envelope
const sax = (note, vol = 0.2) => 
  (t) => Æ.vol(
    Æ.fm2(Æ.pitch(note), { 
      env: Æ.adsr({ attackSec: 0.05, decaySec: 0.2, sustain: 0.5, releaseSec: 0.3 }), 
      ratio: 0.5, 
      modIndex: 4 
    }), 
    vol
  )(t)

const melodySeq = Æ.seq(
  [
    sax("A4"), null, sax("C5"), null,
    sax("D5"), null, sax("E5"), null,
    sax("G5"), null, sax("F5"), null,
    sax("E5"), sax("D5"), sax("C5"), null,
  ],
  "1/4",
  tempo
)
const melodyLoop = Æ.timeRepeat(melodySeq, Æ.sec("16/1", tempo))

// --- Song Arrangement ---

const intro = Æ.vol(chordCycle, 0.4)
const main = Æ.sum(drums, bassLoop, chords, melodyLoop)
const outro = Æ.vol(chordCycle, 0.2)

const song = Æ.song(
  Æ.section(intro, Æ.sec("4/1", tempo)),
  Æ.section(main, Æ.sec("16/1", tempo)),
  Æ.section(outro, Æ.sec("4/1", tempo))
)

// Master Compression to glue the arrangement together
Æ.icomp(song, { thresholdDb: -10, ratio: 4, attackSec: 0.01, releaseSec: 0.1 })
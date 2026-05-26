// composed by claude sonnet 4.6

const BPM = 78
// Subtle human tempo drift: ±0.4 BPM at 0.025 Hz — barely perceptible, just alive
const tempo = Æ.tempoLfo(Æ.tempoBpm(BPM), 0.4, 0.025)
const barSec = Æ.sec("1", BPM)
const bar = (n) => barSec * n

// Gentle jazz swing — 1/5 is softer than the classic 1/3 triplet; fits a lo-fi mood
const swing = Æ.shuffle(1 / 5)

// ─── Rhodes ─────────────────────────────────────────────────────────────────
//
// FM ratio 3 → odd-harmonic spectrum → bell/tine character of a real Rhodes 73.

const rhodesVoice = (hz) =>
  Æ.fm2(hz, {
    env: Æ.adsr({ attackSec: 0.006, decaySec: 0.7, sustain: 0.24, releaseSec: 1.2 }),
    ratio: 3,
    modIndex: 3.4,
    modDecaySec: 0.5,
  })

// Rootless jazz voicings — no root note, all tensions:
//   Dm9  → F-A-C-E  (3-5-7-9)
//   G13  → F-A-B-E  (7-9-3-13, omitting the 11th)
//   Cmaj9 → E-G-B-D (3-5-7-9)
//   A7♭9 → G-C#-E-Bb (7-3-5-♭9)
const chordCycle = Æ.polyseq(
  [
    Æ.chord(rhodesVoice, "F3", "A3", "C4", "E4"),
    null, null, null,
    Æ.chord(rhodesVoice, "F3", "A3", "B3", "E4"),
    null, null, null,
    Æ.chord(rhodesVoice, "E3", "G3", "B3", "D4"),
    null, null, null,
    Æ.chord(rhodesVoice, "G3", "C#4", "E4", "Bb4"),
    null, null, null,
  ],
  "1/4",
  tempo,
  5, // current chord + previous chord still decaying = natural overlap
)

// Chorus gives the Rhodes that lush shimmer; slight left pan = piano position in the room
const chords = Æ.pan(Æ.ichorus(chordCycle, 0.22, 0.007, 3, 0.024, 0.4), -0.12)

// ─── Upright Bass ────────────────────────────────────────────────────────────
//
// FM ratio 0.5 → sub-fundamental emphasis → woody upright character.
// Warm LPF at 300 Hz rolls off the transient click, keeps only the body.

const uprightVoice = (note) =>
  Æ.fm2(Æ.pitch(note), {
    env: Æ.adsr({ attackSec: 0.009, decaySec: 0.48, sustain: 0.13, releaseSec: 0.4 }),
    ratio: 0.5,
    modIndex: 2.2,
    modDecaySec: 0.09,
  })

// Walking bass: 4 quarter-notes per bar, each bar outlines one chord.
// Lines walk toward the next chord root on beat 4 (chromatic approach on A7♭9 → D).
const bassRaw = Æ.seq(
  [
    uprightVoice("D2"), uprightVoice("F2"), uprightVoice("A2"), uprightVoice("G2"), // Dm9
    uprightVoice("G2"), uprightVoice("B2"), uprightVoice("D3"), uprightVoice("F3"), // G13
    uprightVoice("C2"), uprightVoice("E2"), uprightVoice("G2"), uprightVoice("B2"), // Cmaj9
    uprightVoice("A2"), uprightVoice("C#3"), uprightVoice("E3"), uprightVoice("Eb3"), // A7♭9 → D (Eb is chromatic approach)
  ],
  "1/4",
  tempo,
  swing,
)
const bass = Æ.vol(Æ.ilpf(bassRaw, 300, 0.8, 180), 0.92)

// ─── Drums ───────────────────────────────────────────────────────────────────
//
// Jazz kit: ride cymbal (not hi-hats), brushy snare, ghost notes, sparse kick.

// Classic swing ride pattern: ♩ ♩♪♩ ♩♪ per bar (ding — dinga-ding — dinga…)
const rideCym = Æ.hihat({ open: true, decaySec: 0.10, shimmerHz: 5300, tone: 0.19 })
const rideSeq = Æ.seq(
  [
    rideCym, null,
    Æ.vol(rideCym, 0.6), Æ.vol(rideCym, 0.46),
    rideCym, null,
    Æ.vol(rideCym, 0.6), Æ.vol(rideCym, 0.46),
  ],
  "1/8",
  tempo,
  swing,
)

// Brush snare: breathy, low snap — more swish than crack
const brush = Æ.snare({ tuneHz: 150, noiseAmt: 0.91, decaySec: 0.11, snap: 0.09 })
const brushSeq = Æ.seq(
  [null, Æ.vol(brush, 0.27), null, Æ.vol(brush, 0.22)],
  "1/4",
  tempo,
  swing,
)

// Ghost notes: nearly inaudible snare flams between the backbeats
const ghost = Æ.snare({ tuneHz: 138, noiseAmt: 0.95, decaySec: 0.035, snap: 0.05 })
const ghostSeq = Æ.seq(
  [
    null, null, null, Æ.vol(ghost, 0.065),
    null, null, Æ.vol(ghost, 0.05), null,
    null, null, null, null,
    null, null, Æ.vol(ghost, 0.055), null,
  ],
  "1/16",
  tempo,
  swing,
)

// Jazz kick: beat 1 only, warm and subby — more felt than heard
const kickDrum = Æ.kick({ tuneHz: 46, decaySec: 0.26, pitchDecaySec: 0.055 })
const kickSeq = Æ.seq([Æ.vol(kickDrum, 0.55), null, null, null], "1/4", tempo, swing)

// Tape-warmth: roll off highs on the kit and add very light harmonic dirt
const drumsWarm = Æ.vol(Æ.ilpf(Æ.distort(Æ.sum(kickSeq, brushSeq, ghostSeq), 1.25), 9000, 0.85, 128), 0.9)
const drums = Æ.sum(drumsWarm, Æ.vol(rideSeq, 0.4))

// ─── Tenor Sax Melody ────────────────────────────────────────────────────────
//
// FM ratio 3 → reedy odd harmonics → tenor sax timbre.
// Melody is one 4-bar head:
//   bars 1–2 over Dm9 → G13: arpeggiates chord tones, descends by step on G
//   bars 3–4 over Cmaj9 → A7♭9: rises to a high E5 then resolves through C#5-Bb4-A4

const saxNote = (note) =>
  Æ.fm2(Æ.pitch(note), {
    env: Æ.adsr({ attackSec: 0.04, decaySec: 0.2, sustain: 0.54, releaseSec: 0.48 }),
    ratio: 3,
    modIndex: 1.9,
    modDecaySec: 0.3,
  })

const melodyRaw = Æ.seq(
  [
    saxNote("A4"), null, saxNote("C5"), null, saxNote("E5"), null, saxNote("D5"), saxNote("C5"),
    saxNote("B4"), saxNote("A4"), saxNote("G4"), null, saxNote("F4"), saxNote("E4"), null, null,
    saxNote("E4"), null, saxNote("G4"), saxNote("B4"), null, saxNote("D5"), saxNote("E5"), null,
    saxNote("C#5"), null, saxNote("Bb4"), saxNote("A4"), null, saxNote("G4"), null, null,
  ],
  "1/8",
  tempo,
  swing,
)

// Short room echo: 3 taps at ~230ms with 35% feedback — small, warm, not washy
const saxEcho = Æ.idelay(melodyRaw, 3, Æ.sec("1/8", BPM) * 0.6, 0.35, 4)
const melody = Æ.pan(Æ.vol(Æ.mix(melodyRaw, saxEcho, 0.82), 0.52), 0.14)

// ─── Vinyl texture ───────────────────────────────────────────────────────────

const vinylOut = Æ.alloc()
const vinyl = (t) => {
  const f = Math.round(t * sampleRate)
  const h = Æ.noise(f * 1.8179) * 0.0052
  vinylOut[0] = h
  vinylOut[1] = h * 0.96 + Æ.noise(f * 2.4731) * 0.0024
  return vinylOut
}

// ─── Arrangement ─────────────────────────────────────────────────────────────
//
// intro (4 bars)      – bass + ride only; listener settles into the groove
// verse (8 bars)      – chords enter; Rhodes colors the progression
// head  (16 bars)     – sax melody front and center; full kit
// break (8 bars)      – melody rests; chords breathe; ghost notes carry the feel
// head  (8 bars)      – melody reprise, shorter
// outro (8 bars)      – layers peel away one by one; vinyl hiss persists last

const intro = Æ.sum(Æ.vol(bass, 0.85), Æ.vol(drums, 0.65), vinyl)

const verse = Æ.sum(Æ.vol(bass, 0.88), drums, Æ.vol(chords, 0.6), vinyl)

const head = Æ.sum(Æ.vol(bass, 0.88), drums, Æ.vol(chords, 0.48), melody, vinyl)

const breakdown = Æ.sum(Æ.vol(bass, 0.84), Æ.vol(drums, 0.72), Æ.vol(chords, 0.66), vinyl)

const outro = Æ.sum(
  Æ.vol(bass, Æ.fadeOut(bar(6), bar(2))),
  Æ.vol(drums, Æ.fadeOut(bar(5), bar(2))),
  Æ.vol(chords, Æ.fadeOut(bar(7), bar(1))),
  vinyl,
)

const arrangement = Æ.song(
  Æ.section(intro, bar(4)),
  Æ.section(verse, bar(8)),
  Æ.section(head, bar(16)),
  Æ.section(breakdown, bar(8)),
  Æ.section(head, bar(8)),
  Æ.section(outro, bar(8)),
)

// Gentle glue comp: soft knee, slow attack to let transients breathe
Æ.icomp(arrangement, { thresholdDb: -10, ratio: 3.2, kneeDb: 6, attackSec: 0.008, releaseSec: 0.16, makeupDb: 1.0 })

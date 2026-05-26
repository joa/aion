const tempo = A.tempoLfo(A.tempoBpm(80), 40, 1)  // 80bpm base with 40bpm lfo at 1hz

const pluck = (note) => A.pluck(A.pitch(note), A.sin)

A.seq([pluck("A4"), pluck("C#5"), pluck("E5"), pluck("A5")], "1/8", tempo)

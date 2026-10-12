# ÆON

**[Live Demo](https://joa.github.io/aion/)**

Aion is a purely functional audio engine in roughly 100 LoC¹.

Traditional audio engines are **imperative**: they process chunks of data and maintain a hidden, internal state.

Aion is **declarative**: it treats audio as a mapping from $T \rightarrow \mathbb{R}^2$. Because there is no hidden state, "time" becomes just another variable you can multiply, offset, or reverse. This allows for complex temporal structures, like a delay that contains a reversed version of itself, to be expressed in just a few lines of code.

It's also lavishly inefficient and more of a thought experiment than anything usable.

**Example:** Fully self-contained sine oscillator with a repeating pluck envelope and a delay effect.

```js
new AionHost().start(`
const osc = (t, hz) => Math.sin(t * hz * 2 * Math.PI)   // a simple sine oscillator
const pluck = (t) => Math.exp(-5 * (t % 0.5))           // a 2Hz repeating pluck envelope

(t) => {
  if (t < 0) return [0, 0]                              // guarding against infinite recursion
  const dry = osc(t, 220) * pluck(t) * 0.2              // producing a dry signal
  const [wetL, wetR] = $(t - 0.125)                     // jumping back in time by 125ms
  return [dry + 0.9 * wetL, dry + 0.9 * wetR]           // producing the final output signal
}`)
```

## Concept

The Aion "audio engine" compiles JavaScript code that evaluates to an expression and executes it in an `AudioWorklet`. The expression has the type `(t: number) -> [number, number]` and can itself be evaluated using the `$` symbol. The engine prepends a [standard library](#standard-library) to the user-provided code, exported as `Æ` and `A`.

Functions are _expected_ to be pure.

> In computer programming, a pure function is a function that has the following properties:
>
> 1. the function return values are identical for identical arguments (no variation with local static variables, non-local variables, mutable reference arguments or input streams, i.e., referential transparency), and
> 2. the function has no side effects (no mutation of non-local variables, mutable reference arguments or input/output streams).
>
> -- [Pure Function](https://en.wikipedia.org/wiki/Pure_function) on Wikipedia

This results in interesting properties. For example, when editing code, delay lines that typically hold past samples update as if that note was played in the past. You can jump backwards and forwards in time at will and play sections in reverse, or at a different local tempo.

Functions of the Aion standard library are typically of the form `f(I) -> (t) -> O`. This makes them composable.

For example, a naive sum and product of audio samples can be implemented as:

```js
const mul =
  (...fs) =>
  (t) =>
    fs.reduce(
      (acc, f) => {
        const [l, r] = f(t)
        return [acc[0] * l, acc[1] * r]
      },
      [1, 1]
    )
const sum =
  (...fs) =>
  (t) =>
    fs.reduce(
      (acc, f) => {
        const [l, r] = f(t)
        return [acc[0] + l, acc[1] + r]
      },
      [0, 0]
    )
```

You could then combine these:

```js
const cnst = (t, v) => v // produce a constant
const sin = (t, hz) => Math.sin(t * hz * 2 * Math.PI) // produce a sine wave
const saw = (t, hz) => { // produce a saw wave
  const p = t * hz
  return 2 * (p - Math.floor(p)) - 1
}
const synth = (hz, osc) => (t) => [osc(t, hz), osc(t, hz)] // convert an oscillator to a stereo signal
sum(
  // add the signals together
  mul(synth(440, sin), synth(0.125, cnst)), //   adjust the vol of the sine
  mul(synth(110, saw), synth(0.125, cnst)) //   adjust the vol of the saw
)
```

## Performance

Because `f` is pure, you can evaluate `f` at any point in time and as many times as you want.

Typically, a delay in an audio engine is `O(n)` whereas the example above is `O(n * cost(f))` because we re-evaluate `f` every time. This can snowball pretty quickly if you place, for example, a delay in a delay. Many effects, such as a chorus, use the concept of a delay internally.

## Impure Functions

Most of the time it's enough if a function is _observationally pure under monotonic forward time_.

The Aion standard library prefixes all functions with this property with an `i`. `Æ.delay` is pure but `O(n * cost(f))`, `Æ.idelay` is `O(n)` but only observationally pure under monotonic forward time.

Practically it means: we can buffer data unless you jump backwards in time. A buffer is cleared when a discontinuity in `t` is observed. To buffer data, we use the `Æ.ibuf` function.

Every function is implemented pure unless it's not feasible from a performance perspective.

## Standard Library

The standard library is exported as `Æ` and `A`.

**Type Aliases:**

- `Pair`: `[number, number]` (stereo sample)
- `Osc`: `(t: number, hz: number) -> number`
- `Env`: `(t: number) -> number`

**Globals:**

- `L` and `R`: The left and right array indices
- `TAU`: `2 * Math.PI`
- `SEMIS`: Semitones from `C`; example: `SEMIS.D` is `2`
- `ZERO`: `[0,0]`
- `NULL_VOICE`: `() -> ZERO`
- `sampleRate`: The current sample rate in Hz
- `$`: The compiled expression itself

### Oscillators

Every oscillator has the form `Osc`.

| Symbol      | Type                    | Pure | Description                               | Example                                 |
| ----------- | ----------------------- | ---- | ----------------------------------------- | --------------------------------------- |
| `Æ.sin`     | `Osc`                   | ✓    | Sine wave in `[-1, 1]`.                   | `t => Æ.sin(t, 440)`                    |
| `Æ.cos`     | `Osc`                   | ✓    | Cosine wave in `[-1, 1]`.                 | `t => Æ.cos(t, 440)`                    |
| `Æ.saw`     | `Osc`                   | ✓    | Band-limited (PolyBLEP) saw in `[-1, 1]`. | `t => Æ.saw(t, 440)`                    |
| `Æ.suprsaw` | `Osc` + `detune`, `mix` | ✓    | JP-8000 style seven-saw super saw.        | `t => Æ.suprsaw(t, 440)`                |
| `Æ.tri`     | `Osc`                   | ✓    | Triangle wave in `[-1, 1]`.               | `t => Æ.tri(t, 440)`                    |
| `Æ.square`  | `Osc`                   | ✓    | Band-limited (PolyBLEP) square.           | `t => Æ.square(t, 440)`                 |
| `Æ.bell`    | `Osc`                   | ✓    | Bell-shape oscillator (0.5 - 0.5 \* cos). | `t => Æ.bell(t, 1)`                     |
| `Æ.stepSin` | `(n: number) -> Osc`    | ✓    | Creates a sine oscillator with `n` steps. | `const osc = Æ.stepSin(8); osc(t, 440)` |
| `Æ.noise`   | `(t: number) -> number` | ✓    | Deterministic pseudo-random noise.        | `t => Æ.noise(t)`                       |
| `Æ.valueNoise` | `Osc` (+ `seed`)     | ✓    | Smooth noise, lowpassed at `hz`.          | `t => Æ.valueNoise(t, 800)`             |
| `Æ.bandNoise` | `(t, centerHz, widthHz, seed?) -> number` | ✓ | Noise in `centerHz ± widthHz`.    | `t => Æ.bandNoise(t, 5000, 2000)`       |

### Utilities

| Symbol        | Type                                                                                               | Pure | Description                                              | Example                           |
| ------------- | -------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------- | --------------------------------- |
| `Æ.alloc`     | `() -> Pair`                                                                                       | ✓    | Allocates a stereo pair.                                 | `Æ.alloc()`                       |
| `Æ.wrap`      | `(i: number, n: number) -> number`                                                                 | ✓    | Wraps index `i` into `[0, n)`.                           | `Æ.wrap(-1, 10)`                  |
| `Æ.E`         | `(t: number, f: Env \| number) -> number`                                                          | ✓    | Evaluate `f(t)` or return the scalar `f`.                | `Æ.E(t, hz)`                      |
| `Æ.lerp`      | `(a: number, b: number, α: number) -> number`                                                      | ✓    | Linear interpolation by α.                               | `Æ.lerp(0, 100, 0.5)`             |
| `Æ.stereo`    | `(l: number, r: number?) -> Pair`                                                                  | ✓    | Casts numbers to stereo pair.                            | `Æ.stereo(0.5)`                   |
| `Æ.vol`       | `(f: (t: number) -> Pair, v: Env \| number) -> (t: number) -> Pair`                                | ✓    | Adjust volume.                                           | `Æ.vol(saw, 0.5)`                 |
| `Æ.sum`       | `(...fs: ((t: number) -> Pair)[]) -> (t: number) -> Pair`                                          | ✓    | Sums multiple stereo pairs.                              | `Æ.sum(lead, bass)`               |
| `Æ.mul`       | `(...fs: ((t: number) -> Pair)[]) -> (t: number) -> Pair`                                          | ✓    | Multiplies multiple stereo pairs.                        | `Æ.mul(carrier, mod)`             |
| `Æ.mix`       | `(f: (t: number) -> Pair, g: (t: number) -> Pair, v: number) -> (t: number) -> Pair`               | ✓    | Mixes `f` and `g` by amount `v`.                         | `Æ.mix(dry, wet, 0.75)`           |
| `Æ.crossfade` | `(f: (t: number) -> Pair, g: (t: number) -> Pair, t0: number, dur: number) -> (t: number) -> Pair` | ✓    | Linear blend from `f` to `g` across `[t0, t0 + durSec)`. | `Æ.crossfade(f, g, 0, 1)`         |
| `Æ.pan`       | `(f: (t: number) -> Pair, pos: Env \| number = 0) -> (t: number) -> Pair`                          | ✓    | Constant-power pan in `[-1, 1]`.                         | `Æ.pan(f, t => 0.5*Æ.sin(t, 0.1)` |
| `Æ.smooth`    | `(f: (t: number) -> Pair, windowSec: number, n: number = 8) -> (t: number) -> Pair`                | ✓    | Smooths over `windowSec` with `n` taps.                  | `Æ.smooth(f, 0.1)`                |
| `Æ.pitch`     | `(note: string \| number) -> number`                                                               | ✓    | Note name to Hz.                                         | `Æ.pitch("A4")`                   |
| `Æ.chord`     | `(f: (hz: number) -> (t: number) -> Pair, ...notes: (string \| number)[]) -> (t: number) -> Pair`  | ✓    | Plays multiple notes.                                    | `Æ.chord(Æ.pluck, "C3", "G3")`    |
| `Æ.sec`       | `(dur: string, tempo: Tempo \| number) -> number`                                                  | ✓    | Duration string to seconds.                              | `Æ.sec("1/4", 120)`               |
| `Æ.id`        | `(f: any) -> any`                                                                                  | ✓    | Identity function.                                       | `Æ.id(f)`                         |
| `Æ.pattern`   | `(p: string, f: (t: number) -> Pair) -> ((t: number) -> Pair)[]`                                                                                  | ✓    | Creates an array of `f`.                                       | `Æ.pattern("#---", kick)`                         |

### Envelopes

| Symbol      | Type                                                                       | Pure | Description                                                                                               | Example                           |
| ----------- | -------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `Æ.lfo`     | `(hz: number, amp: number = 1, center: number = 0, f: Osc = Æ.sin) -> Env` | ✓    | LFO envelope.                                                                                             | `Æ.lfo(1, 500, 1000)`             |
| `Æ.adsr`    | `(opts: AdsrOptions) -> Env`                                               | ✓    | ADSR envelope with analog-style exponential decay and release.                                           | `Æ.adsr({ attackSec: 0.1, ... })` |
| `Æ.fadeIn`  | `(durSec: number, startSec: number = 0) -> Env`                            | ✓    | Linear fade-in. 0 before `startSec`, ramp to 1 over `durSec`, 1 after.                                    | `Æ.fadeIn(2)`                     |
| `Æ.fadeOut` | `(durSec: number, startSec: number) -> Env`                                | ✓    | Linear fade-out. 1 before `startSec`, ramp to 0 over `durSec`, 0 after.                                   | `Æ.fadeOut(2, 4)`                 |
| `Æ.window`  | `(startSec: number, endSec: number, fadeSec: number = 0.05) -> Env`        | ✓    | Time-window envelope. 1 during `[startSec, endSec)` with `fadeSec` ramps at both edges; otherwise 0.      | `Æ.window(1, 3)`                  |
| `Æ.muteFor` | `(startSec: number, endSec: number, fadeSec: number = 0.05) -> Env`        | ✓    | Mutes during the interval. 0 during `[startSec, endSec)` with `fadeSec` ramps at both edges; otherwise 1. | `Æ.muteFor(1, 2)`                 |

#### ADSR Options

```js
{
  triggerTime: number = 0,          // at what time to trigger; 0 before triggerTime
  releaseTime: number = Infinity,   // at what time to release
  attackSec:   number,              // attack in sec
  decaySec:    number,              // decay in sec
  sustain:     number,              // sustain level
  releaseSec:  number,              // release time in sec; 0 after releaseTime+releaseSec
}
```

### Song Structure

| Symbol      | Type                                                                     | Pure | Description                                                                  | Example               |
| ----------- | ------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------- | --------------------- |
| `Æ.section` | `(f: (t: number) -> Pair, durSec: number, times: number = 1) -> Section` | ✓    | Defines a song part with length `durSec`, optionally repeated `times` times. | `Æ.section(verse, 8)` |
| `Æ.song`    | `(...parts: Section[]) -> (t: number) -> Pair`                           | ✓    | Compiles sections into a song.                                               | `Æ.song(s1, s2)`      |

**Note:** Sections receive _local time_ starting at `0` for each section.

```js
const tempo = Æ.tempoBpm(120)
const bar = (n) => n * Æ.sec("1/1", tempo)

const intro = Æ.seq(...)
const verse = Æ.seq(...)
const bridge = Æ.sum(Æ.seq(...), Æ.seq(...))

Æ.song(
  Æ.section(intro, bar(2)),
  Æ.section(verse, bar(8)),
  Æ.section(bridge, bar(4)),
  ...
)
```

### Tempo

We define tempo as `{ value(t) -> bpm, phase(t) -> beats elapsed }`. Each combinator carries its own analytic integral so that step sequencers can function under tempo variation.

| Symbol        | Type                                                 | Pure | Description        | Example                   |
| ------------- | ---------------------------------------------------- | ---- | ------------------ | ------------------------- |
| `Æ.tempoBpm`  | `(bpm: number) -> Tempo`                             | ✓    | Constant tempo.    | `Æ.tempoBpm(120)`         |
| `Æ.tempoLfo`  | `(base: Tempo, amp: number, hz: number) -> Tempo`    | ✓    | Modulated tempo.   | `Æ.tempoLfo(t1, 5, 0.1)`  |
| `Æ.tempoRamp` | `(base: Tempo, delta: number, dur: number) -> Tempo` | ✓    | Linear tempo ramp. | `Æ.tempoRamp(t1, 20, 10)` |

Tempos are combinators and can therefore be chained.

```js
// slight wobble of 2bpm at 0.5hz around 120bpm
const tempo = Æ.tempoLfo(Æ.tempoBpm(120), 2, 0.5)
```

### Time

| Symbol          | Type                                                                                | Pure | Description                          | Example                  |
| --------------- | ----------------------------------------------------------------------------------- | ---- | ------------------------------------ | ------------------------ |
| `Æ.timeReverse` | `(f: (t: number) -> Pair, startSec: number, endSec: number) -> (t: number) -> Pair` | ✓    | Mirror time in `[startSec, endSec)`. | `Æ.timeReverse(f, 0, 4)` |
| `Æ.timeRepeat`  | `(f: (t: number) -> Pair, durationSec: number) -> (t: number) -> Pair`              | ✓    | Loop `f` every `durationSec`.        | `Æ.timeRepeat(f, 2)`     |
| `Æ.ibuf`        | `(f: (t: number) -> Pair, capacitySec: number = 1) -> (t: number) -> Pair`          | ✗    | Internal ring-buffer.                | `const b = Æ.ibuf(f)`    |
| `Æ.bake`        | `(f: (t: number) -> Pair, durSec: number) -> (t: number) -> Pair`                   | ✓    | Pre-rendered sample of `f`.          | `Æ.bake(Æ.kick(), 0.5)`  |

#### Buffering

**General Usage**

- `let g = ibuf(f)` creates a buffer, `g(t)` fills the buffer forward to `Math.round(t * sampleRate)` and returns the current sample.
- `g.at(frame)` returns a past sample (zero outside the buffer window).
- `g.buf` / `g.cap` expose the raw stereo-interleaved `Float64Array` for hot loops.

**Example**

```js
const buf = Æ.ibuf(A.pluck(440, A.sin), 1) // create a buffer for one second
const out = Æ.alloc()                      // pre-allocate sample pair (optional; purely for perf reasons)

(t) => {
  buf(t)                                           // update the buffer
  const currentFrame = Math.round(t * sampleRate)  // compute the current frame
  ;[out[L], out[R]] = buf.at(currentFrame)         // read the signal
  // [...]                                         // do something with the signal...
  return out
}
```

#### Baking

`Æ.bake(f, durSec)` renders `f` over `[0, durSec)` into a table once, at construction, and plays it back with linear interpolation; it is silent outside that range. An expensive voice becomes a lookup, and an impure one becomes pure, so the sample may be shifted, reversed or pitched by scaling `t`.

```js
const snare = Æ.bake(Æ.sum(Æ.snare(), Æ.clap()), 0.5) // layered once, played as a sample
const higher = (t) => snare(t * 1.5)                  // a fifth up and shorter
```

Construction evaluates `f` `durSec * sampleRate` times while the code compiles, which blocks the worklet, so keep baked sounds short.

### Sequencers

| Symbol      | Type                                                                                                                               | Pure | Description                | Example                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------- | ------------------------------- |
| `Æ.shuffle` | `(amount: number?) -> SequencerOptions`                                                                                            | ✓    | Long-short step timing.    | `Æ.shuffle(1 / 3)`              |
| `Æ.seq`     | `(voices: ((t: number) -> Pair)[], div: string, tempo: Tempo, opts: SequencerOptions?) -> (t: number) -> Pair`                     | ✓    | Monophonic step sequencer. | `Æ.seq([v1, v2], "1/4", tempo)` |
| `Æ.polyseq` | `(voices: ((t: number) -> Pair)[], div: string, tempo: Tempo, maxVoices: number?, opts: SequencerOptions?) -> (t: number) -> Pair` | ✓    | Polyphonic step sequencer. | `Æ.polyseq(vs, "1/16", tempo)`  |

`polyseq` backtracks at most `min(maxVoices, voices.length)` voices. The same voice is never evaluated twice so that impure functions behave as expected.

**Note:** Voices receive _local time_ starting at `0` for each voice. `null` in the array is converted to `NULL_VOICE`.

`shuffle(amount)` delays every odd step by stretching each even/odd pair into long-short timing. `amount` is clamped to `[-0.95, 0.95]`; `0` is straight timing and the default `1 / 3` creates a 2:1 triplet shuffle. Use it as `Æ.seq(vs, "1/16", tempo, Æ.shuffle())`, `Æ.polyseq(vs, "1/16", tempo, Æ.shuffle())`, or `Æ.polyseq(vs, "1/16", tempo, 4, Æ.shuffle())`.

### Synths

| Symbol             | Type                                                                                   | Pure | Description                   | Example                         |
| ------------------ | -------------------------------------------------------------------------------------- | ---- | ----------------------------- | ------------------------------- |
| `Æ.pluck`          | `(hz: Env \| number, f: Osc, detuneCents = 3) -> (t: number) -> Pair`                                   | ✓    | Short ADSR, stereo detuned.   | `Æ.pluck(440, Æ.saw)`           |
| `Æ.pad`            | `(hz: Env \| number, f: Osc, detuneCents = 7) -> (t: number) -> Pair`                                   | ✓    | Long ADSR, stereo detuned.    | `Æ.pad(220, Æ.sin)`             |
| `Æ.iacid`          | `(hz: Env \| number, opts: AcidOptions) -> (t: number) -> Pair`                        | ✗    | Acid synth.                   | `Æ.iacid(Æ.pitch("C2"))`        |
| `Æ.isynth`         | `(hz: Env \| number, opts: SynthOptions) -> (t: number) -> Pair`                       | ✗    | Virtual-analog synth voice.   | `Æ.isynth(110, { sub: 0.5 })`   |
| `Æ.ikarplus`       | `(hz: Env \| number, opts: KarplusOptions) -> (t: number) -> Pair`                     | ✗    | Karplus-Strong guitar.        | `Æ.ikarplus(110)`               |
| `Æ.formantSpeech`  | `(text: string \| SpeechSegment[], opts: FormantSpeechOptions) -> (t: number) -> Pair` | ✓    | Formant speech synthesizer.   | `Æ.formantSpeech("hello aion")` |
| `Æ.speechPhonemes` | `{ [name: string]: SpeechPhoneme }`                                                    | ✓    | Built-in formant phoneme map. | `Æ.speechPhonemes.AH`           |
| `Æ.sing`           | `(notes: SungNote[], opts: SingOptions) -> (t: number) -> Pair`                        | ✓    | Formant singing voice.        | `Æ.sing([[0, 1, "A3", "L AA"]])` |
| `Æ.fm2`            | `(hz: Env \| number, opts: Fm2Options) -> (t: number) -> Pair`                         | ✓    | DX7-style 2-operator FM.      | `Æ.fm2(440, { modIndex: 8 })`   |

#### AcidOptions

```js
{
  wave:      Osc                        = Æ.saw
  cutoffHz:  Env | number               = 800
  envModOct: Env | number               = 3
  q:         Env | number               = 6
  decaySec:  Env | number               = 0.3
  accent:    bool | (t: number) -> bool = false
}
```

#### SynthOptions

Unison oscillators into drive and a resonant lowpass with its own envelope. Numbers may also be functions of `t`, except `voices`, `detuneCents`, `spread` and `gateSec`.

```js
{
  wave:        "saw" | "square" | Osc = "saw"
  voices:      number = 3         // unison
  detuneCents: number = 12
  spread:      number = 0.7       // stereo width of the unison
  sub:         number = 0         // square one octave down
  noise:       number = 0
  cutoffHz:    number = 900
  q:           number = 1
  envOct:      number = 3         // filter envelope amount in octaves
  keyTrack:    number = 0.5       // 1 = cutoff follows pitch fully
  drive:       number = 1.5
  gateSec:     number = Infinity  // note length; the release starts here
  amp:    { attackSec = 0.003, decaySec = 0.3, sustain = 0.7, releaseSec = 0.2 }
  filter: { attackSec = 0.001, decaySec = 0.25, sustain = 0.2, releaseSec = 0.3 }
  gain:        number = 1
}
```

#### KarplusOptions

```js
{
  decay: number = 0.998
}
```

#### Fm2Options

```js
{
  env:         Env          = Æ.adsr(...)
  ratio:       Env | number = 2
  modIndex:    Env | number = 4
  modDecaySec: Env | number = 0.3
  modSustain:  Env | number = 0.08  // index after the decay, relative to modIndex
  feedback:    Env | number = 0.2   // modulator self-feedback
  keyScale:    number       = 0.5   // index falls above 220Hz by (220 / hz)^keyScale
  detuneCents: number       = 4     // stereo detune
}
```

#### FormantSpeechOptions

```js
{
  pitchHz:       Env | number = 120
  gain:          number       = 0.75
  pan:           Env | number = 0
  rate:          number       = 1      // higher is faster
  phonemeSec:    number       = 1      // duration multiplier
  transitionSec: number       = 0.035
  mouth:         Env | number = 1      // scales formant frequencies
  breath:        Env | number = 0.22
  vibratoHz:     Env | number = 5.2
  vibratoDepth:  Env | number = 0.012
  maxHarmonics:  number       = 48
  spectralTilt:  number       = 0.85
}
```

`Æ.formantSpeech(...)` accepts a text string for quick sketches, or a phoneme sequence for more control. It returns a normal stereo signal and carries `.dur` with the generated phrase length in seconds, and `.spectralEnvelope` for `Æ.ivocoder`.

```js
Æ.formantSpeech([{ phoneme: "HH", durSec: 0.08 }, "EH", "L", "OW", { phoneme: "SP", durSec: 0.12 }, "EY", "AA", "N"])
```

Built-in phonemes: `SP`, `AA`, `AE`, `AH`, `AO`, `AW`, `EH`, `ER`, `EY`, `IH`, `IY`, `OW`, `OY`, `UH`, `UW`, `B`, `D`, `F`, `G`, `H`, `K`, `L`, `M`, `N`, `NG`, `P`, `R`, `S`, `SH`, `T`, `TH`, `V`, `W`, `Y`, `Z`, `ZH`.

#### Singing

`Æ.formantSpeech` speaks; `Æ.sing` sings melodies. Its score is a list of `SungNote`, `[startSec, durSec, note, syllable]`, where `note` is a note name or Hz and `syllable` lists phonemes of `Æ.speechPhonemes` separated by spaces. The first vowel lands on `startSec`; consonants before it are sung ahead of `startSec`, consonants after it close the syllable, and a second vowel makes a diphthong. A syllable is held until the next one starts, so lines are legato unless the score leaves a rest.

```js
const beatSec = 60 / 120
const hook = [
  [0, 1, "C4", "T EY K"], // take
  [1, 1, "D4", "M IY"], //   me
  [2, 2, "G4", "H AA IY"], // hi-
  [4, 2, "E4", "ER"], //     -gher
]
Æ.sing(hook.map(([beat, beats, note, syllable]) => [beat * beatSec, beats * beatSec, note, syllable]))
```

Pitch glides between notes with a continuous phase, vowels come from cascade formant synthesis, and plosives close and burst. The voice is pure and carries `.dur`.

#### SingOptions

```js
{
  glideSec:        number       = 0.07
  transitionSec:   number       = 0.05   // crossfade between phonemes
  consonantSec:    number       = 0.055
  vibratoHz:       number       = 5.4
  vibratoDepth:    number       = 0.012  // fades in on held notes
  vibratoDelaySec: number       = 0.25
  breath:          number       = 0.03
  maxHarmonics:    number       = 48
  gain:            number       = 0.35
  pan:             Env | number = 0
}
```

### Drums

| Symbol    | Type                                         | Pure | Description           | Example                   |
| --------- | -------------------------------------------- | ---- | --------------------- | ------------------------- |
| `Æ.kick`  | `(opts: KickOptions) -> (t: number) -> Pair` | ✓    | Synthetic kick drum.  | `Æ.kick({ tuneHz: 40 })`  |
| `Æ.snare` | `(opts: SnareOptions) -> (t: number) -> Pair` | ✓    | Synthetic snare drum. | `Æ.snare()`               |
| `Æ.hihat` | `(opts: HihatOptions) -> (t: number) -> Pair` | ✓    | Synthetic hi-hat.     | `Æ.hihat({ open: true })` |
| `Æ.clap`  | `(opts: ClapOptions) -> (t: number) -> Pair`  | ✓    | Synthetic hand clap.  | `Æ.clap({ bursts: 4 })`   |

#### KickOptions
```js
{
  attackSec:     number = 0.002
  decaySec:      number = 0.3
  tuneHz:        number = 50
  pitchDecaySec: number = 0.05
  drive:         number = 1.8   // tanh saturation
  click:         number = 0.5   // beater click level
}
```

#### SnareOptions
```js
{
  attackSec: number = 0.001
  decaySec:  number = 0.18
  tuneHz:    number = 180
  noiseAmt:  number = 0.7
  snap:      number = 0.35
}
```

#### HihatOptions 
```js
{
  open:      bool   = false
  attackSec: number = 0.001
  decaySec:  number = 0.05   // 0.35 if open: true
  shimmerHz: number = 7000
  tone:      number = 0.18
}
```

#### ClapOptions
```js
{
  decaySec:  number = 0.16   // room tail
  toneHz:    number = 1200
  spreadSec: number = 0.009  // time between the hands
  bursts:    number = 3
}
```


### Effects

| Symbol       | Type                                                                                                                      | Pure | Description                       | Example                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------- | --------------------------- |
| `Æ.delay`    | `(f: (t: number) -> Pair, steps: number, stepSec: Env \| number, feedback: number) -> (t: number) -> Pair`                      | ✓    | Pure delay. `O(steps * cost(f))`. | `Æ.delay(f, 4, 0.2, 0.5)`   |
| `Æ.idelay`   | `(f: (t: number) -> Pair, steps: number, stepSec: Env \| number, feedback: number, capacitySec: number = 8) -> (t: number) -> Pair`        | ✗    | Impure delay. `O(steps)`.         | `Æ.idelay(f, 8, 0.1, 0.6)`  |
| `Æ.ilpf`     | `(f: (t: number) -> Pair, cutoffHz: number, q: number = 10, n: number = 256) -> (t: number) -> Pair`                    | ✗    | Resonant LPF (convolution). Precomputes weight; cannot modify cutoff or q.    | `Æ.ilpf(f, 800, 10)`        |
| `Æ.iflanger` | `(f: (t: number) -> Pair, rateHz: number = 0.5, depthSec: number = 1, baseSec: number = 0.005, mix: number = 0.5) -> (t: number) -> Pair`                 | ✗    | Flanger effect.                   | `Æ.iflanger(f, 0.2, 0.005)` |
| `Æ.ichorus`  | `(f: (t: number) -> Pair, rateHz: number = 0.5, depthSec: number = 0.008, voices: number = 3, baseSec: number = 0.025, mix: number = 0.5) -> (t: number) -> Pair` | ✗    | Chorus effect.                    | `Æ.ichorus(f)`              |
| `Æ.iphaser`  | `(f: (t: number) -> Pair, rateHz: number = 0.5, depth: number = 1, stages: number = 4, n: number = 256) -> (t: number) -> Pair`                 | ✗    | Phaser effect.                    | `Æ.iphaser(f)`              |
| `Æ.distort`  | `(f: (t: number) -> Pair, drive: number = 3, kind: "soft" \| "hard" = "soft") -> (t: number) -> Pair`                                           | ✓    | Soft/Hard clipping.               | `Æ.distort(f, 5, "hard")`   |
| `Æ.icomp`    | `(f: (t: number) -> Pair, opts: CompressorOptions) -> (t: number) -> Pair`                                                           | ✗    | Soft-knee compressor.             | `Æ.icomp(f, { ratio: 4 })`  |
| `Æ.ilimit`   | `(f: (t: number) -> Pair, opts: LimiterOptions) -> (t: number) -> Pair`                                                              | ✗    | Lookahead peak limiter.           | `Æ.ilimit(f, { gainDb: 3 })` |
| `Æ.ipingpong` | `(f: (t: number) -> Pair, stepSec: number, feedback: number = 0.5, opts: PingPongOptions) -> (t: number) -> Pair`                   | ✗    | Stereo ping-pong delay.           | `Æ.ipingpong(f, 0.28, 0.4)` |
| `Æ.isvf`     | `(f: (t: number) -> Pair, cutoffHz: Env \| number = 1000, q: Env \| number = 0.707, mode: "lp" \| "bp" \| "hp" = "lp") -> (t: number) -> Pair` | ✗ | Sweepable resonant filter. | `Æ.isvf(f, (t) => 200 + 2000 * t)` |
| `Æ.ireverb`  | `(f: (t: number) -> Pair, opts: ReverbOptions) -> (t: number) -> Pair` | ✗ | FDN reverb. | `Æ.ireverb(f, { decaySec: 3 })` |
| `Æ.ivocoder` | `(carrier: (t: number) -> Pair, modulator: (t: number) -> Pair, opts: VocoderOptions) -> (t: number) -> Pair`                        | ✗    | Channel vocoder.                  | `Æ.ivocoder(synth, voice)`  |

#### CompressorOptions
```js
{
  thresholdDb: number              = -20
  ratio:       number              = 4
  kneeDb:      number              = 6
  attackSec:   number              = 0.005
  releaseSec:  number              = 0.1
  makeupDb:    number              = 0
  sidechain:   (t: number) -> Pair = f
  capacitySec: number              = 0.5
}
```

#### LimiterOptions
```js
{
  gainDb:       number = 0      // drive into the limiter
  ceilingDb:    number = -1     // the output never exceeds this
  lookaheadSec: number = 0.005  // also the latency
  releaseSec:   number = 0.1
}
```

`Æ.ilimit` is the last stage of a master bus. The gain each sample needs is min-held over the lookahead window and then averaged, so the gain is already down when a peak arrives and the ceiling holds without clipping.

#### PingPongOptions
```js
{
  dampHz: number = 3500  // each repeat is darker than the last
  mix:    number = 0.35  // 1 = echoes only, for a send bus
}
```

#### ReverbOptions

```js
{
  decaySec:    number = 2      // RT60
  dampHz:      number = 5000
  preDelaySec: number = 0.015
  size:        number = 1
  mix:         number = 0.25   // 1 = wet only, for a send bus
  width:       number = 1
}
```

Stateful effects need monotonic time. `Æ.song` restarts time in every section, so a reverb inside a section loses its tail at each boundary; put it on a send bus outside the song instead, like `examples/machine_heart.js` does.

#### VocoderOptions
```js
{
  bands:      number = 20
  lowHz:      number = 120
  highHz:     number = 8000
  q:          number = 1      // > 1 narrows the bands
  attackSec:  number = 0.004  // envelope followers, analysis mode only
  releaseSec: number = 0.03
  noise:      number = 0.4    // carrier noise for unvoiced phonemes; 0 and constant in analysis mode
  gain:       number = 1
}
```

When the modulator is an `Æ.formantSpeech(...)`, the vocoder reads its spectral envelope directly instead of analyzing the audio, so there is no envelope lag and consonants get noise. Pass the speech directly: wrappers such as `vol`, `pan` or `timeRepeat` hide `.spectralEnvelope` and the vocoder falls back to analysis. Any other stereo signal works as a modulator too.

```js
const voice = Æ.formantSpeech("we are the robots", { rate: 0.8 })
const saw = (hz) => (t) => Æ.stereo(Æ.suprsaw(t, hz) * 0.1)
Æ.ivocoder(Æ.chord(saw, "C3", "Eb3", "G3"), voice)
```

See `examples/vocoder.js`.

---

¹: The optional standard lib clocks in with another 2.4k LoC

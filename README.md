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
| `Æ.saw`     | `Osc`                   | ✓    | Saw wave in `[-1, 1]`.                    | `t => Æ.saw(t, 440)`                    |
| `Æ.suprsaw` | `Osc`                   | ✓    | Layered and detuned saw waves.            | `t => Æ.suprsaw(t, 440)`                |
| `Æ.tri`     | `Osc`                   | ✓    | Triangle wave in `[-1, 1]`.               | `t => Æ.tri(t, 440)`                    |
| `Æ.square`  | `Osc`                   | ✓    | Square wave in `[-1, 1]`.                 | `t => Æ.square(t, 440)`                 |
| `Æ.bell`    | `Osc`                   | ✓    | Bell-shape oscillator (0.5 - 0.5 \* cos). | `t => Æ.bell(t, 1)`                     |
| `Æ.stepSin` | `(n: number) -> Osc`    | ✓    | Creates a sine oscillator with `n` steps. | `const osc = Æ.stepSin(8); osc(t, 440)` |
| `Æ.noise`   | `(t: number) -> number` | ✓    | Deterministic pseudo-random noise.        | `t => Æ.noise(t)`                       |

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
| `Æ.adsr`    | `(opts: AdsrOptions) -> Env`                                               | ✓    | Attack-Decay-Sustain-Release envelope.                                                                    | `Æ.adsr({ attackSec: 0.1, ... })` |
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

### Sequencers

| Symbol      | Type                                                                                                      | Pure | Description                | Example                         |
| ----------- | --------------------------------------------------------------------------------------------------------- | ---- | -------------------------- | ------------------------------- |
| `Æ.seq`     | `(voices: ((t: number) -> Pair)[], div: string, tempo: Tempo) -> (t: number) -> Pair`                     | ✓    | Monophonic step sequencer. | `Æ.seq([v1, v2], "1/4", tempo)` |
| `Æ.polyseq` | `(voices: ((t: number) -> Pair)[], div: string, tempo: Tempo, maxVoices: number?) -> (t: number) -> Pair` | ✓    | Polyphonic step sequencer. | `Æ.polyseq(vs, "1/16", tempo)`  |

`polyseq` backtracks at most `min(maxVoices, voices.length)` voices. The same voice is never evaluated twice so that impure functions behave as expected.

**Note:** Voices receive _local time_ starting at `0` for each voice. `null` in the array is converted to `NULL_VOICE`.

### Synths

| Symbol       | Type                                                               | Pure | Description                   | Example                       |
| ------------ | ------------------------------------------------------------------ | ---- | ----------------------------- | ----------------------------- |
| `Æ.pluck`    | `(hz: Env \| number, f: Osc) -> (t: number) -> Pair`               | ✓    | Synth with short ADSR curve.  | `Æ.pluck(440, Æ.saw)`         |
| `Æ.pad`      | `(hz: Env \| number, f: Osc) -> (t: number) -> Pair`               | ✓    | Synth with long ADSR release. | `Æ.pad(220, Æ.sin)`           |
| `Æ.iacid`    | `(hz: Env \| number, opts: AcidOptions) -> (t: number) -> Pair`    | ✗    | Acid synth.                   | `Æ.iacid(Æ.pitch("C2"))`      |
| `Æ.ikarplus` | `(hz: Env \| number, opts: KarplusOptions) -> (t: number) -> Pair` | ✗    | Karplus-Strong guitar.        | `Æ.ikarplus(110)`             |
| `Æ.fm2`      | `(hz: Env \| number, opts: Fm2Options) -> (t: number) -> Pair`     | ✓    | 2-operator FM synth.          | `Æ.fm2(440, { modIndex: 8 })` |

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
}
```

### Drums

| Symbol    | Type                                         | Pure | Description           | Example                   |
| --------- | -------------------------------------------- | ---- | --------------------- | ------------------------- |
| `Æ.kick`  | `(opts: KickOptions) -> (t: number) -> Pair` | ✓    | Synthetic kick drum.  | `Æ.kick({ tuneHz: 40 })`  |
| `Æ.snare` | `(opts: SnareOptions) -> (t: number) -> Pair` | ✓    | Synthetic snare drum. | `Æ.snare()`               |
| `Æ.hihat` | `(opts: HihatOptions) -> (t: number) -> Pair` | ✓    | Synthetic hi-hat.     | `Æ.hihat({ open: true })` |

#### KickOptions
```js
{
  attackSec:     number = 0.002
  decaySec:      number = 0.3
  tuneHz:        number = 50
  pitchDecaySec: number = 0.05
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

---

¹: The optional standard lib clocks in with another 1k LoC

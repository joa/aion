// # Æon
//
// This is the standard library. It is being loaded as a raw string and prepended to the
// user-given code.
//
// ## Purity
// Functions that are impure are prefixed with `i`. This is most of the time the case when a `ibuf`
// is used within the function. The function is still _observationally pure under monotonic forward time_
// but not in the general sense.
//
// Practically this means they won't produce correct output when wrapped in `timeReverse` for example.
//
// For some `i` variants, a pure variant may exist (`delay` and `idelay`). Note that the pure variant
// is usually significantly more expensive. For example `delay` is `O(steps * cost(f))` per sample
// vs `O(steps)` for `idelay`; note that the cost of `f` is significant here. Wrapping a delay in
// a delay is immediately quadratic.
//
// ## Stereo Convention
// Synthesizers produce a `[l, r]` stereo pair. Combinators are allowed to allocate *one* `[l,r]`
// pair at construction and re-use it for every call. It means also the values of a combinator
// must immediately be deconstructed.
//
//   const [l, r] = f(t)  // good; we deconstruct directly into l and r
//   const lr = f(t)      // dangerous; calling f(t) again overrides lr
//
// ## Globals
// The Æon processor provides the following global symbols:
// - `sampleRate` is the current sample rate
// - `$` is the compiled function evaluated by the engine

const TAU = 2 * Math.PI
const SEMIS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const L = 0
const R = 1
const ZERO = new Float64Array(2)
const NULL_VOICE = () => ZERO

const Æ = (() => {
  // Oscillators
  // ###########
  // Every oscillator has the form `(t, hz) => scalar`.
  const sin = (t, hz) => Math.sin(t * hz * TAU)

  const cos = (t, hz) => Math.cos(t * hz * TAU)

  // PolyBLEP residual of a unit step at phase 0 (Välimäki & Huovilainen, "Antialiasing Oscillators in Subtractive
  // Synthesis", 2007). Subtracting it from a naive discontinuity band-limits the edge; `dt` is the phase increment
  // per sample.
  const polyBlep = (p, dt) => {
    if (p < dt) {
      const x = p / dt
      return x + x - x * x - 1
    }
    if (p > 1 - dt) {
      const x = (p - 1) / dt
      return x * x + x + x + 1
    }
    return 0
  }

  const phaseStep = (hz) => Math.min(0.5, Math.abs(hz) / sampleRate)

  const saw = (t, hz) => {
    const p = t * hz - Math.floor(t * hz)
    return 2 * p - 1 - polyBlep(p, phaseStep(hz))
  }

  // JP-8000 super saw after Adam Szabo, "How to Emulate the Super Saw" (2010): seven saws at his measured detune
  // offsets, a center/side balance, and fixed phase offsets so the voices never start aligned.
  // `detune` scales the offsets (1 is the full ±11%) and `mix` moves energy from the center saw to the sides.
  const SUPERSAW_OFFSETS = [-0.11002313, -0.06288439, -0.01952356, 0, 0.01991221, 0.06216538, 0.10745242]
  const SUPERSAW_PHASES = [0.11, 0.63, 0.27, 0, 0.84, 0.42, 0.95]
  const suprsaw = (t, hz, detune = 0.15, mix = 0.5) => {
    const sideGain = -0.73764 * mix * mix + 1.2841 * mix + 0.044372
    const centerGain = -0.55366 * mix + 0.99785
    let s = 0
    for (let i = 0; i < 7; i++) {
      const voiceHz = hz * (1 + detune * SUPERSAW_OFFSETS[i])
      s += saw(t + SUPERSAW_PHASES[i] / voiceHz, voiceHz) * (i === 3 ? centerGain : sideGain)
    }
    // The saws are uncorrelated, so their powers add.
    return (s * 0.55) / Math.sqrt(centerGain * centerGain + 6 * sideGain * sideGain)
  }

  const tri = (t, hz) => {
    const p = t * hz - Math.floor(t * hz)
    return 1 - 4 * Math.abs(p - 0.5)
  }

  // Centered ±1 square. For PWM, compose: `(t, hz) => (saw(t, hz) < -0.4 ? -1 : 1)`.
  const square = (t, hz) => {
    const p = t * hz - Math.floor(t * hz)
    const dt = phaseStep(hz)
    const half = p < 0.5 ? p + 0.5 : p - 0.5
    return (p < 0.5 ? -1 : 1) - polyBlep(p, dt) + polyBlep(half, dt)
  }

  const bell = (t, hz) => 0.5 - 0.5 * cos(t, hz)

  // Creates and returns a sin oscillator with `n` steps.
  const stepSin = (n) => (t, hz) => Math.sin((Math.floor(t * hz * n) / n) * TAU)

  // Deterministic pseudo-random noise in [-1, 1].
  const noise = (t) => {
    const x = Math.sin(t * 12.9898 + 78.233) * 43758.5453
    return 2 * (x - Math.floor(x)) - 1
  }

  // Value noise: random values at `hz` blended with a smoothstep, i.e. noise lowpassed at roughly `hz`.
  // Different `seed` values give uncorrelated streams.
  const valueNoise = (t, hz, seed = 0) => {
    const x = t * hz
    const i = Math.floor(x)
    const f = x - i
    const a = noise(i + seed)
    return a + (noise(i + 1 + seed) - a) * f * f * (3 - 2 * f)
  }

  // Band-limited noise in `centerHz ± widthHz`, without filter state.
  //
  // Ring modulation shifts the lowpassed value noise up to the carrier (heterodyning), which is the same as
  // bandpassing white noise but costs O(1) per sample and stays pure.
  const bandNoise = (t, centerHz, widthHz, seed = 0) => valueNoise(t, widthHz, seed) * sin(t, centerHz)

  // Utils
  // #####

  // Alloc L/R pair
  //
  // We use this throughout instead of writing `[0, 0]`
  const alloc = () => new Float64Array(2)

  // Wrap a (possibly negative) integer index into `[0, n)`.
  //
  // We use this in every ring-buffer reader.
  const wrap = (i, n) => ((i % n) + n) % n

  // Evaluate `f` at `t` if it's a function; otherwise return `f`.
  const E = (t, f) => (typeof f === "function" ? f(t) : f)

  // Lerp `a` to `b` by `alpha`.
  const lerp = (a, b, alpha) => a * (1 - alpha) + b * alpha

  // Stereo cast of one or two scalars.
  //
  // This allocates a new array. It's only a cold-path helper.
  const stereo = (l, r) => new Float64Array([l, r ?? l])

  // Volume adjust `f` by `v`.
  // `v` is a scalar or a function of `t`
  //
  // Use fadeIn/fadeOut/section/muteFor to schedule volume changes over time.
  const vol = (f, v) => {
    const out = alloc()
    return (t) => {
      const s = f(t)
      const g = E(t, v)
      out[L] = s[L] * g
      out[R] = s[R] * g
      return out
    }
  }

  // Sum of stereo signals.
  const sum = (...fs) => {
    // This is the faster version of the following:
    // `(...fs) => (t) => fs.reduce((acc, f) => { const [l, r] = f(t); return [acc[0] + l, acc[1] + r] }, [0, 0])`
    const out = alloc()
    return (t) => {
      let l = 0,
        r = 0
      for (let i = 0; i < fs.length; i++) {
        const [sl, sr] = fs[i](t)
        l += sl
        r += sr
      }
      out[L] = l
      out[R] = r
      return out
    }
  }

  // Multiplication of stereo signals.
  const mul = (...fs) => {
    // This is the faster version of the following:
    // `(...fs) => (t) => fs.reduce((acc, f) => { const [l, r] = f(t); return [acc[0] * l, acc[1] * r] }, [1, 1])`
    const out = alloc()
    return (t) => {
      let l = 1,
        r = 1
      for (let i = 0; i < fs.length; i++) {
        const [sl, sr] = fs[i](t)
        l *= sl
        r *= sr
      }
      out[L] = l
      out[R] = r
      return out
    }
  }

  // Mix `f(t) * v + g(t) * (1 - v)`.
  const mix = (f, g, v) => {
    // Inlined version of `sum(vol(f, v), vol(g, 1-v))`.
    const out = alloc()
    const w = 1 - v
    return (t) => {
      const [al, ar] = f(t)
      const [bl, br] = g(t)
      out[L] = al * v + bl * w
      out[R] = ar * v + br * w
      return out
    }
  }

  // Linear blend from `f` to `g` across [t0, t0 + durSec).
  const crossfade = (f, g, t0, durSec) => {
    const out = alloc()
    return (t) => {
      const alpha = (t - t0) / durSec
      if (alpha <= 0) return f(t)
      if (alpha >= 1) return g(t)
      const [fl, fr] = f(t)
      const [gl, gr] = g(t)
      out[L] = fl * (1 - alpha) + gl * alpha
      out[R] = fr * (1 - alpha) + gr * alpha
      return out
    }
  }

  // Pan at constant-power balance.
  //
  // `position` in [-1, 1] (number or function of t for auto-pan); `-1` is full left, `1` is full right.
  const pan = (f, position = 0) => {
    const out = alloc()
    return (t) => {
      const p = Math.max(-1, Math.min(1, E(t, position)))
      const angle = (p + 1) * Math.PI * 0.25
      const gL = Math.cos(angle)
      const gR = Math.sin(angle)
      const [il, ir] = f(t)
      out[L] = il * gL
      out[R] = ir * gR
      return out
    }
  }

  // Smooth the stereo signal `f` over `windowSec` by `n` taps.
  const smooth = (f, windowSec, n = 8) => {
    const out = alloc()
    return (t) => {
      let l = 0,
        r = 0
      for (let i = 0; i < n; i++) {
        const [sl, sr] = f(t - (i * windowSec) / n)
        l += sl
        r += sr
      }
      out[L] = l / n
      out[R] = r / n
      return out
    }
  }

  // Pitch for a note.
  //
  // Example:
  //   - `pitch("A4")` is the same as `pitch("A-4")`
  //   - `pitch("Bb2")`
  //   - `pitch("g#3")`is the same as `pitch("G#3")`
  //   - `pitch(440)` is the same as `pitch("A4")`
  const pitch = (note) => {
    if (typeof name === "number") {
      return name
    }
    const m = note.match(/^([A-Ga-g])([#b]?)-?(\d+)$/)
    if (!m) throw new Error(`bad note: ${note}`)
    const offset = SEMIS[m[1].toUpperCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0)
    const midi = 12 * (parseInt(m[3], 10) + 1) + offset
    return 440 * Math.pow(2, (midi - 69) / 12)
  }

  // Chord utility.
  //
  // Each `f(pitch(name))` may return either a stereo voice `t -> [l, r]` or a scalar signal
  // `t -> number`; scalars are summed and broadcast to both channels.
  //
  // Example:
  // - `chord(hz => pad(hz, saw), "D#3", "F#3", "A#3")`
  // - `chord(i303, "E2", "B2", "E3")`
  const chord = (f, ...notes) => {
    const voices = notes.map((note) => f(pitch(note)))
    const out = alloc()
    return (t) => {
      let l = 0,
        r = 0
      for (let i = 0; i < voices.length; i++) {
        const [vl, vr] = voices[i](t)
        l += vl
        r += vr
      }
      out[L] = l
      out[R] = r
      return out
    }
  }

  // Convert a duration to seconds at a BPM.
  //
  // Works with a scalar or tempo object.
  const sec = (duration, tempo) => {
    const bpm = typeof tempo === "object" ? tempo.value(0) : tempo
    const [num, den = 1] = duration.split("/").map(Number)
    return ((60 / bpm) * 4 * num) / den
  }

  // Identity to skip a function while playing around.
  const id = (f) => f

  // Convert the string `s` to a pattern of `f`.
  // Example:
  //   - `pattern("#---, kick)` is the same as `[kick, null, null, null]`
  const pattern = (s, f) => s.split("").map((x) => (x === "#" ? f : NULL_VOICE))

  // Envelopes
  // #########
  // Envelopes produce always a scalar that can be used in C.vol for example.
  // To combine multiple envelopes, use `env0 * env1 * ... * envN`.

  // LFO envelope.
  const lfo =
    (rateHz, amp = 1, center = 0, f = sin) =>
    (t) =>
      center + amp * f(t, rateHz)

  // Exponential segment falling from 1 at `x = 0` to exactly 0 at `x = 1`, like the RC curve of an analog
  // envelope generator. `k` is the curvature.
  const expFall = (x, k) => (Math.exp(-k * x) - Math.exp(-k)) / (1 - Math.exp(-k))

  // ADSR envelope with analog-style exponential segments; attack, decay and release still end exactly on time.
  const adsr = ({
    triggerTime: t0 = 0,
    releaseTime: t1 = Infinity,
    attackSec: a,
    decaySec: d,
    sustain: s,
    releaseSec: r,
  }) => {
    const held = (t) => {
      const dt = t - t0
      if (dt < 0) return 0
      if (dt < a) return 1 - expFall(dt / a, 2)
      if (dt < a + d) return s + (1 - s) * expFall((dt - a) / d, 2)
      return s
    }
    const peak = held(t1)
    return (t) => {
      if (t < t1) return held(t)
      const dt = t - t1
      return dt >= r ? 0 : peak * expFall(dt / r, 2)
    }
  }

  // Linear fade-in envelope.
  // 0 before `startSec`, ramp to 1 over `durSec`, 1 after.
  const fadeIn =
    (durSec, startSec = 0) =>
    (t) => {
      if (t <= startSec) return 0
      if (t >= startSec + durSec) return 1
      return (t - startSec) / durSec
    }

  // Linear fade-out envelope.
  // 1 before `startSec`, ramp to 0 over `durSec`, 0 after.
  const fadeOut = (durSec, startSec) => (t) => {
    if (t <= startSec) return 1
    if (t >= startSec + durSec) return 0
    return 1 - (t - startSec) / durSec
  }

  // Time-window envelope.
  // 1 during [startSec, endSec) with `fadeSec` ramps at both edges; otherwise 0.
  const window =
    (startSec, endSec, fadeSec = 0.05) =>
    (t) => {
      if (t <= startSec || t >= endSec) return 0
      if (t < startSec + fadeSec) return (t - startSec) / fadeSec
      if (t > endSec - fadeSec) return (endSec - t) / fadeSec
      return 1
    }

  // Inverse of `window`
  // 0 during [startSec, endSec) with `fadeSec` ramps at both edges; otherwise 1.
  const muteFor =
    (startSec, endSec, fadeSec = 0.05) =>
    (t) => {
      if (t <= startSec || t >= endSec) return 1
      if (t < startSec + fadeSec) return 1 - (t - startSec) / fadeSec
      if (t > endSec - fadeSec) return 1 - (endSec - t) / fadeSec
      return 0
    }

  // Song structure
  // ##############

  // Tag a stereo signal as a song part of `durSec` seconds, optionally repeated `times` times.
  //
  // Each repeat sees local time starting at 0 (stateful voices retrigger; seqs reset to step 0).
  // Pass the result to `song(...)`.
  const section = (f, durSec, times = 1) => ({ f, unit: durSec, times })

  // Concatenate song sections sequentially. Each section sees local time starting at 0 within its
  // window; output is silent before `t=0` and after the song ends. The returned function carries
  // `.dur` (total length in seconds).
  const song = (...parts) => {
    const segs = []
    let acc = 0
    for (const p of parts) {
      for (let i = 0; i < p.times; i++) {
        segs.push({ f: p.f, start: acc })
        acc += p.unit
      }
    }
    const total = acc
    const out = alloc()
    let lastIdx = 0
    const fn = (t) => {
      if (t < 0 || t >= total) {
        out[L] = 0
        out[R] = 0
        return out
      }
      // Monotonic-forward search, cached from previous call.
      let i = lastIdx
      if (t < segs[i].start) i = 0
      while (i < segs.length - 1 && t >= segs[i + 1].start) i++
      lastIdx = i
      const seg = segs[i]
      const [l, r] = seg.f(t - seg.start)
      out[L] = l
      out[R] = r
      return out
    }
    fn.dur = total
    return fn
  }

  // Tempo
  // #####
  // `tempo` is `{ value(t) -> bpm, phase(t) -> beats elapsed }`.
  // Each combinator carries its own analytic integral.

  // Constant tempo at given BPM scalar.
  const tempoBpm = (bpm) => ({ value: (t) => bpm, phase: (t) => (bpm * t) / 60 })

  // LFO around given base tempo.
  const tempoLfo = (base, amp, hz) => ({
    value: (t) => base.value(t) + amp * sin(t, hz),
    phase: (t) => base.phase(t) + (amp / (60 * TAU * hz)) * (1 - cos(t, hz)),
  })

  // Tempo ramp of `deltaBpm` over `durSec` atop given base tempo.
  const tempoRamp = (base, deltaBpm, durSec) => ({
    value: (t) => base.value(t) + deltaBpm * Math.min(t / durSec, 1),
    phase: (t) => base.phase(t) + (deltaBpm / 60) * (t < durSec ? (t * t) / (2 * durSec) : t - durSec / 2),
  })

  // Time
  // ####

  // Time mirror in [startSec, endSec).
  //
  // Time flows normal outside of the interval. Use `crossfade` to smooth out boundary click noise.
  //
  // NOTE: non-monotonic time; never wrap in ibuf.
  const timeReverse = (f, startSec, endSec) => (t) => f(t >= startSec && t < endSec ? startSec + endSec - t : t)

  // Loop `f` every `durationSec` forever.
  //
  // `f` always sees local time in [0, durationSec).
  const timeRepeat = (f, durationSec) => (t) => f(t - Math.floor(t / durationSec) * durationSec)

  // Ring-buffer around `f`.
  //
  // - `ibuf(f)(t)` fills the buffer forward to `Math.round(t * sampleRate)` and returns the current sample.
  // - `ibuf(f).at(frame)` returns a past sample (zero outside the buffer window).
  // - `ibuf.buf` / `ibuf.cap` expose the raw stereo-interleaved Float64Array for hot loops.
  //
  // Pure under monotonic-time evaluation. `Math.round(t * sampleRate)` is bijective with `t` since the
  // engine drives `t = frame / sampleRate`.
  //
  // Backward jumps (reset, recompile-into-old-frame) trigger a zero-and-realign.
  // NEVER wrap inside `timeReverse` -- that calls f(start+end-t).
  const ibuf = (f, capacitySec = 1) => {
    const sr = sampleRate
    const cap = Math.max(2, Math.ceil(capacitySec * sr))
    const buf = new Float64Array(cap * 2)
    const out = alloc()
    let last = -1

    const fill = (frame) => {
      if (frame < last || frame > last + cap) {
        last = frame - 1
        buf.fill(0)
      }
      while (last < frame) {
        last++
        const [l, r] = f(last / sr)
        const i = (last % cap) * 2
        buf[i] = l
        buf[i + 1] = r
      }
    }

    const fn = (t) => {
      const frame = Math.round(t * sr)
      fill(frame)
      const i = wrap(frame, cap) * 2
      out[L] = buf[i]
      out[R] = buf[i + 1]
      return out
    }

    fn.at = (frame) => {
      if (frame < 0 || frame > last || frame <= last - cap) {
        out[L] = 0
        out[R] = 0
        return out
      }
      const i = wrap(frame, cap) * 2
      out[L] = buf[i]
      out[R] = buf[i + 1]
      return out
    }

    fn.buf = buf
    fn.cap = cap

    return fn
  }

  // Sequencers
  // ##########
  // Sequencers are of the form `(voices, division, tempo) => (t) => ...` and may contain additional
  // `opts` after the `tempo` parameter.
  //
  // The `voices` is always a 1d-array of functions. All sequencers support `null` or `undefined`
  // entries within the `voices` array.

  const STRAIGHT_STEPS = {
    index: (p) => Math.floor(p),
    start: (idx) => idx,
  }

  const sequencerTiming = (opts) => opts?.timing ?? STRAIGHT_STEPS

  // Long-short step timing for shuffle/swing grooves.
  //
  // `amount` is the step fraction moved from every odd step to the previous even step.
  // `1 / 3` creates a classic 2:1 triplet shuffle.
  const shuffle = (amount = 1 / 3) => {
    const a = Math.max(-0.95, Math.min(0.95, amount))
    const split = 1 + a

    return {
      timing: {
        index: (p) => {
          const pair = Math.floor(p / 2) * 2
          return p - pair < split ? pair : pair + 1
        },
        start: (idx) => {
          const pair = Math.floor(idx / 2) * 2
          return idx - pair === 0 ? pair : pair + split
        },
      },
    }
  }

  // Step sequencer.
  //
  // Monophonic. Voices receive local time. `null` or undefined entries are skipped.
  //
  // Example:
  //   - `seq([voice1, voice2, voice3, voice4], "1/4", tempoBpm(120))` plays each voice for 1/4 at 120bpm.
  //   - `seq([bd, null, null, null], "1/16", tempoBpm(120))` 4-to-the-floor
  const seq = (voices, division, tempo, opts = undefined) => {
    const safe = voices.map((v) => v ?? NULL_VOICE)
    const [num, den = 1] = division.split("/").map(Number)
    const stepsPerBeat = den / (4 * num)
    const timing = sequencerTiming(opts)
    return (t) => {
      const p = tempo.phase(t) * stepsPerBeat
      const idx = timing.index(p)
      const slot = wrap(idx, safe.length)
      const stepsPerSec = (tempo.value(t) / 60) * stepsPerBeat
      return safe[slot]((p - timing.start(idx)) / stepsPerSec)
    }
  }

  // Polyphonic step sequencer.
  //
  // Like `seq`, but up to `maxVoices` are played. The cost is `O(maxVoices)`.
  //
  // NOTE: `maxVoices` is clamped to `voices.length` and the same voice is never evaluated
  //       twice as stateful functions (`delay`, `lpf`, ...) would not work properly.
  const polyseq = (voices, division, tempo, maxVoices = undefined, opts = undefined) => {
    const safe = voices.map((v) => v ?? NULL_VOICE)
    const [num, den = 1] = division.split("/").map(Number)
    const stepsPerBeat = den / (4 * num)
    const timingOpts = opts ?? (typeof maxVoices === "object" ? maxVoices : undefined)
    const timing = sequencerTiming(timingOpts)
    const max = typeof maxVoices === "number" ? maxVoices : safe.length
    const mv = Math.min(max, safe.length)
    const out = alloc()
    return (t) => {
      const p = tempo.phase(t) * stepsPerBeat
      const idx = timing.index(p)
      const stepsPerSec = (tempo.value(t) / 60) * stepsPerBeat
      let l = 0,
        r = 0
      for (let k = 0; k < mv; k++) {
        const j = idx - k
        if (j < 0) break
        const slot = wrap(j, safe.length)
        const [vl, vr] = safe[slot]((p - timing.start(j)) / stepsPerSec)
        l += vl
        r += vr
      }
      out[L] = l
      out[R] = r
      return out
    }
  }

  // Effects
  // #######

  // Pure multi-tap delay.
  //
  // - `steps` the amount of taps
  // - `stepSec` is seconds-per-tap
  // - `feedback` is the per-tap gain
  //
  // Cost is `O(steps)`.
  const delay = (f, steps, stepSec, feedback) => {
    const out = alloc()
    return (t) => {
      const d = E(t, stepSec)
      let l = 0,
        r = 0,
        gain = 1
      for (let i = 0; i < steps; i++) {
        const [vl, vr] = f(t - (i + 1) * d)
        l += vl * gain
        r += vr * gain
        gain *= feedback
      }
      out[L] = l
      out[R] = r
      return out
    }
  }

  // Impure multi-tap delay.
  //
  // - `steps` the amount of taps
  // - `stepSec` is seconds-per-tap
  // - `feedback` is the per-tap gain
  //
  // Cost is `O(steps)`.
  const idelay = (f, steps, stepSec, feedback, capacitySec = 8) => {
    const sr = sampleRate
    const tapped = ibuf(f, capacitySec)
    const out = alloc()
    return (t) => {
      tapped(t)
      const stepFrames = Math.round(E(t, stepSec) * sr)
      const currentFrame = Math.round(t * sr)
      let l = 0,
        r = 0,
        gain = 1
      for (let i = 0; i < steps; i++) {
        const [vl, vr] = tapped.at(currentFrame - (i + 1) * stepFrames)
        l += vl * gain
        r += vr * gain
        gain *= feedback
      }
      out[L] = l
      out[R] = r
      return out
    }
  }

  // Impure low-pass-filter.
  //
  // Precomputes weights which means `cutoffHz` and `q` cannot be modified
  // after construction.
  const ilpf = (f, cutoffHz = 500, q = 10, n = 256) => {
    // pure 2-pole resonant LPF: convolution against the analytic damped-sinusoid IR.
    // q is resonance (q > 0.5 underdamped; approx 0.707 = Butterworth).
    // n caps tap count; useful tap budget is `9*Q*sampleRate/(TAU*cutoffHz)`.
    const sr = sampleRate
    const omega = TAU * cutoffHz
    const zeta = 1 / (2 * q)
    const omegaD = omega * Math.sqrt(1 - zeta * zeta)
    const dt = 1 / sr
    const amp = omega / Math.sqrt(1 - zeta * zeta)
    const w = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const tau = i * dt
      w[i] = amp * Math.exp(-zeta * omega * tau) * Math.sin(omegaD * tau) * dt
    }
    const tapped = ibuf(f, (n + 1) * dt)
    const buf = tapped.buf
    const cap = tapped.cap
    const out = alloc()
    return (t) => {
      tapped(t)
      const currentFrame = Math.round(t * sr)
      let bufIdx = wrap(currentFrame, cap) * 2
      let l = 0,
        r = 0
      for (let i = 0; i < n; i++) {
        l += w[i] * buf[bufIdx]
        r += w[i] * buf[bufIdx + 1]
        bufIdx -= 2
        if (bufIdx < 0) bufIdx += cap * 2
      }
      out[L] = l
      out[R] = r
      return out
    }
  }

  // Impure Flanger
  const iflanger = (f, rateHz = 0.5, depthSec = 1, baseSec = 0.005, mix = 0.5) => {
    const sr = sampleRate
    const tapped = ibuf(f, baseSec + depthSec + 1 / sr)
    const dry = 1 - mix
    const out = alloc()
    return (t) => {
      tapped(t)
      const currentFrame = Math.round(t * sr)
      const back = Math.round((baseSec + depthSec * sin(t, rateHz)) * sr)
      const [xl, xr] = tapped.at(currentFrame)
      const [wl, wr] = tapped.at(currentFrame - back)
      out[L] = xl * dry + wl * mix
      out[R] = xr * dry + wr * mix
      return out
    }
  }

  // Impure Chorus
  const ichorus = (f, rateHz = 0.5, depthSec = 0.008, voices = 3, baseSec = 0.025, mix = 0.5) => {
    const sr = sampleRate
    const tapped = ibuf(f, baseSec + depthSec + 1 / sr)
    const dry = 1 - mix
    const inv = 1 / voices
    const out = alloc()
    return (t) => {
      tapped(t)
      const currentFrame = Math.round(t * sr)
      let l = 0,
        r = 0
      for (let i = 0; i < voices; i++) {
        const tOffSec = i / (voices * rateHz)
        const back = Math.round((baseSec + depthSec * sin(t + tOffSec, rateHz)) * sr)
        const [vl, vr] = tapped.at(currentFrame - back)
        l += vl
        r += vr
      }
      const [xl, xr] = tapped.at(currentFrame)
      out[L] = xl * dry + l * inv * mix
      out[R] = xr * dry + r * inv * mix
      return out
    }
  }

  // Impure Phaser
  const iphaser = (f, rateHz = 0.5, depth = 1, stages = 4, n = 256) => {
    // Cascade of `stages` identical 1-pole all-passes ((s-ω)/(s+ω))^stages with LFO-swept ω.
    // Convolves against the analytic cascaded IR h(t) = δ(t) + Q(t)·exp(-ωt) where Q is a degree-(stages-1)
    // polynomial from the binomial expansion (1 - 2ω/(s+ω))^stages. Static binomial/factorial factors are
    // hoisted; only `(-2ω(t))^k` recomputes per sample.
    const sr = sampleRate
    const dt = 1 / sr
    // staticC[k-1] = C(stages, k) / (k-1)!  for k = 1..stages
    const staticC = new Float64Array(stages)
    staticC[0] = stages
    let bin = stages,
      fact = 1
    for (let k = 2; k <= stages; k++) {
      bin = (bin * (stages - k + 1)) / k
      fact = fact * (k - 1)
      staticC[k - 1] = bin / fact
    }
    const coeffs = new Float64Array(stages)
    const tapped = ibuf(f, (n + 1) * dt)
    const buf = tapped.buf
    const cap = tapped.cap
    const out = alloc()
    return (t) => {
      tapped(t)
      const currentFrame = Math.round(t * sr)
      const cutoffHz = 200 + 1800 * (0.5 + 0.5 * sin(t, rateHz))
      const omega = TAU * cutoffHz
      let pw = -2 * omega
      coeffs[0] = staticC[0] * pw
      for (let k = 2; k <= stages; k++) {
        pw = pw * (-2 * omega)
        coeffs[k - 1] = staticC[k - 1] * pw
      }
      let bufIdx = wrap(currentFrame, cap) * 2
      const xl = buf[bufIdx],
        xr = buf[bufIdx + 1]
      let l = xl,
        r = xr
      for (let i = 0; i < n; i++) {
        const tau = i * dt
        let q = coeffs[stages - 1]
        for (let k = stages - 2; k >= 0; k--) q = q * tau + coeffs[k]
        const ww = q * Math.exp(-omega * tau) * dt
        l += ww * buf[bufIdx]
        r += ww * buf[bufIdx + 1]
        bufIdx -= 2
        if (bufIdx < 0) bufIdx += cap * 2
      }
      const wet = depth * 0.5
      const dryW = 1 - wet
      out[L] = xl * dryW + l * wet
      out[R] = xr * dryW + r * wet
      return out
    }
  }

  // Distortion
  //
  // `kind` can be `"soft"` or `"hard"`. `"hard"` is brick-wall clipping against +-1.
  // `drive` is the input gain.
  const distort = (f, drive = 3, kind = "soft") => {
    if (drive <= 0) return f
    const out = alloc()
    if (kind === "hard") {
      return (t) => {
        const [il, ir] = f(t)
        out[L] = Math.max(-1, Math.min(1, il * drive))
        out[R] = Math.max(-1, Math.min(1, ir * drive))
        return out
      }
    }
    const inv = 1 / Math.tanh(drive)
    return (t) => {
      const [l, r] = f(t)
      out[L] = Math.tanh(l * drive) * inv
      out[R] = Math.tanh(r * drive) * inv
      return out
    }
  }

  // Impure soft-knee compressor with optional sidechain.
  //
  // The default sidechain is `f` itself; pass `{ sidechain: kick }` for ducking.
  //
  // Options:
  //
  // - thresholdDb
  // - ratio
  // - kneeDb
  // - attackSec
  // - releaseSec
  // - makeupDb
  // - sidechain
  // - capacitySec
  const icomp = (f, opts = {}) => {
    const thresholdDb = opts.thresholdDb ?? -20
    const ratio = opts.ratio ?? 4
    const kneeDb = opts.kneeDb ?? 6
    const attackSec = opts.attackSec ?? 0.005
    const releaseSec = opts.releaseSec ?? 0.1
    const makeupDb = opts.makeupDb ?? 0
    const sidechain = opts.sidechain ?? f
    const capacitySec = opts.capacitySec ?? 0.5

    const sr = sampleRate
    const dt = 1 / sr
    const attackCoef = 1 - Math.exp(-dt / attackSec)
    const releaseCoef = 1 - Math.exp(-dt / releaseSec)
    const slope = 1 - 1 / ratio
    const halfKnee = kneeDb / 2
    const makeupLin = Math.pow(10, makeupDb / 20)
    const sameSrc = sidechain === f

    const cap = Math.max(2, Math.ceil(capacitySec * sr))
    const buf = new Float64Array(cap * 2)
    let env = 0
    let last = -1
    const out = alloc()

    return (t) => {
      const frame = Math.round(t * sr)
      if (frame < last || frame > last + cap) {
        env = 0
        buf.fill(0)
        last = frame - 1
      }
      while (last < frame) {
        last++
        const tt = last / sr
        const isamp = f(tt)
        const il = isamp[L],
          ir = isamp[R]
        let detect
        if (sameSrc) {
          detect = Math.max(Math.abs(il), Math.abs(ir))
        } else {
          const ssamp = sidechain(tt)
          detect = Math.max(Math.abs(ssamp[L]), Math.abs(ssamp[R]))
        }
        const coef = detect > env ? attackCoef : releaseCoef
        env += (detect - env) * coef
        const envDb = 20 * Math.log10(Math.max(env, 1e-12))
        const overshoot = envDb - thresholdDb
        let reductionDb = 0
        if (overshoot >= halfKnee) {
          reductionDb = slope * overshoot
        } else if (overshoot > -halfKnee) {
          const o = overshoot + halfKnee
          reductionDb = (slope * o * o) / (2 * kneeDb)
        }
        const gainLin = Math.pow(10, -reductionDb / 20) * makeupLin
        const i2 = (last % cap) * 2
        buf[i2] = il * gainLin
        buf[i2 + 1] = ir * gainLin
      }
      const i = wrap(frame, cap) * 2
      out[L] = buf[i]
      out[R] = buf[i + 1]
      return out
    }
  }

  // Impure channel vocoder (Dudley, "The Vocoder", 1939).
  //
  // Imposes the spectral envelope of `modulator` (usually speech) onto `carrier` (usually a rich synth) through
  // `bands` log-spaced bandpass filters. The filters are RBJ cookbook biquads in transposed direct form II.
  //
  // If `modulator` carries `.spectralEnvelope` (see `formantSpeech`), the band gains are read from it directly:
  // exact, without envelope-follower lag and without analysis filters. Unvoiced phonemes (S, SH, T, ...) then mix
  // noise into the carrier so consonants stay intelligible. Any other modulator is analyzed by envelope followers.
  //
  // Options:
  // - bands (20)
  // - lowHz (120), highHz (8000)
  // - q (1) scales the band Q; > 1 is narrower and more resonant
  // - attackSec (0.004), releaseSec (0.03) of the envelope followers; analysis only
  // - noise: carrier noise for unvoiced phonemes (0.4); in analysis mode it is mixed in constantly (0)
  // - gain (1)
  const ivocoder = (carrier, modulator, opts = {}) => {
    const sr = sampleRate
    const bands = opts.bands ?? 20
    const lowHz = opts.lowHz ?? 120
    const highHz = Math.min(opts.highHz ?? 8000, sr * 0.45)
    const spectral = typeof modulator.spectralEnvelope === "function"
    const noiseAmt = opts.noise ?? (spectral ? 0.4 : 0)
    const attackCoef = 1 - Math.exp(-1 / ((opts.attackSec ?? 0.004) * sr))
    const releaseCoef = 1 - Math.exp(-1 / ((opts.releaseSec ?? 0.03) * sr))
    const followerGain = 3
    const gain = (opts.gain ?? 1) * 3.4

    // Adjacent bands are `ratio` apart; Q = sqrt(ratio) / (ratio - 1) puts the -3dB points on the band edges.
    const ratio = Math.pow(highHz / lowHz, 1 / Math.max(1, bands - 1))
    const q = (Math.sqrt(ratio) / (ratio - 1)) * (opts.q ?? 1)

    // Constant 0dB peak gain bandpass, normalized by a0. Since b1 = 0 and b2 = -b0 we only store b0, a1, a2.
    const bandsHz = new Float64Array(bands)
    const b0 = new Float64Array(bands)
    const a1 = new Float64Array(bands)
    const a2 = new Float64Array(bands)
    for (let i = 0; i < bands; i++) {
      const hz = lowHz * Math.pow(ratio, i)
      const w0 = (TAU * hz) / sr
      const alpha = Math.sin(w0) / (2 * q)
      const a0 = 1 + alpha
      bandsHz[i] = hz
      b0[i] = alpha / a0
      a1[i] = (-2 * Math.cos(w0)) / a0
      a2[i] = (1 - alpha) / a0
    }

    // Two delay elements per band and signal.
    const carrierL = new Float64Array(bands * 2)
    const carrierR = new Float64Array(bands * 2)
    const analysis = new Float64Array(bands * 2)
    const followers = new Float64Array(bands)
    const gains = new Float64Array(bands)

    const bandpass = (state, i, x) => {
      const j = i * 2
      const y = b0[i] * x + state[j]
      state[j] = state[j + 1] - a1[i] * y
      state[j + 1] = -b0[i] * x - a2[i] * y
      return y
    }

    const out = alloc()
    let last = -1

    const render = (frame) => {
      const t = frame / sr
      const [cl, cr] = carrier(t)
      let unvoiced = 1
      if (spectral) {
        unvoiced = modulator.spectralEnvelope(t, bandsHz, gains)
      } else {
        const [ml, mr] = modulator(t)
        const m = (ml + mr) * 0.5
        for (let i = 0; i < bands; i++) {
          const y = Math.abs(bandpass(analysis, i, m))
          followers[i] += (y - followers[i]) * (y > followers[i] ? attackCoef : releaseCoef)
          gains[i] = followers[i] * followerGain
        }
      }
      const hiss = noiseAmt * unvoiced
      const xl = cl + noise(frame) * hiss
      const xr = cr + noise(frame + 0.5) * hiss
      let l = 0,
        r = 0
      for (let i = 0; i < bands; i++) {
        l += bandpass(carrierL, i, xl) * gains[i]
        r += bandpass(carrierR, i, xr) * gains[i]
      }
      out[L] = l * gain
      out[R] = r * gain
    }

    return (t) => {
      const frame = Math.round(t * sr)
      if (frame < last || frame > last + sr) {
        carrierL.fill(0)
        carrierR.fill(0)
        analysis.fill(0)
        followers.fill(0)
        last = frame - 1
      }
      while (last < frame) render(++last)
      return out
    }
  }

  // One step of the zero-delay-feedback state-variable filter from Zavalishin, "The Art of VA Filter Design" (2012),
  // on the two integrator states `state[j]` and `state[j + 1]`. `g = tan(PI * cutoffHz / sampleRate)`,
  // `k = 1 / q`. Writes lowpass, bandpass and highpass into `svfOut`.
  const svfOut = new Float64Array(3)
  const svfStep = (state, j, x, g, k) => {
    const hp = (x - (k + g) * state[j] - state[j + 1]) / (1 + k * g + g * g)
    const bp = g * hp + state[j]
    const lp = g * bp + state[j + 1]
    state[j] = bp + g * hp
    state[j + 1] = lp + g * bp
    svfOut[0] = lp
    svfOut[1] = bp
    svfOut[2] = hp
    return svfOut
  }
  const SVF_MODES = { lp: 0, bp: 1, hp: 2 }
  const svfCoef = (cutoffHz) => Math.tan((Math.PI * Math.min(Math.max(cutoffHz, 10), sampleRate * 0.45)) / sampleRate)

  // Impure resonant state-variable filter.
  //
  // Unlike `ilpf`, `cutoffHz` and `q` may be functions of t, so it sweeps. `mode` is "lp", "bp" or "hp".
  const isvf = (f, cutoffHz = 1000, q = 0.707, mode = "lp") => {
    const sr = sampleRate
    const tap = SVF_MODES[mode]
    const state = new Float64Array(4)
    const out = alloc()
    let last = -1
    return (t) => {
      const frame = Math.round(t * sr)
      if (frame < last || frame > last + sr) {
        state.fill(0)
        last = frame - 1
      }
      while (last < frame) {
        last++
        const tt = last / sr
        const [l, r] = f(tt)
        const g = svfCoef(E(tt, cutoffHz))
        const k = 1 / E(tt, q)
        out[L] = svfStep(state, 0, l, g, k)[tap]
        out[R] = svfStep(state, 2, r, g, k)[tap]
      }
      return out
    }
  }

  // Impure stereo reverb.
  //
  // An 8-line feedback delay network (Jot & Chaigne, "Digital Delay Networks for Designing Artificial
  // Reverberators", 1991). The lines are mixed by a fast Walsh-Hadamard transform, an orthogonal and therefore
  // lossless matrix, so the decay is set only by the per-line gains `10^(-3 * delay / decaySec)` (the RT60) and a
  // one-pole lowpass per line for air absorption. Two Schroeder allpasses per channel diffuse the input first.
  //
  // Options:
  // - decaySec (2): RT60
  // - dampHz (5000)
  // - preDelaySec (0.015)
  // - size (1) scales the delay lines
  // - mix (0.25): 1 returns only the reverb, which is what a send bus wants
  // - width (1)
  const FDN_LINES_MS = [31.3, 37.9, 41.1, 45.7, 49.3, 53.9, 59.1, 63.7]
  const DIFFUSER_MS = [4.77, 3.59, 4.93, 3.71]
  const ireverb = (f, opts = {}) => {
    const sr = sampleRate
    const decaySec = opts.decaySec ?? 2
    const mix = opts.mix ?? 0.25
    const width = opts.width ?? 1
    const size = opts.size ?? 1
    const damp = Math.exp((-TAU * (opts.dampHz ?? 5000)) / sr)
    const diffuseGain = 0.6
    const wetGain = 0.24

    const lines = FDN_LINES_MS.map((ms) => new Float64Array(Math.round((ms * size * sr) / 1000)))
    const lineGains = lines.map((line) => Math.pow(10, (-3 * line.length) / (decaySec * sr)))
    const dampState = new Float64Array(8)
    const diffusers = DIFFUSER_MS.map((ms) => new Float64Array(Math.round((ms * sr) / 1000)))
    const preDelay = new Float64Array(Math.max(1, Math.round((opts.preDelaySec ?? 0.015) * sr)) * 2)
    const x = new Float64Array(8)
    const out = alloc()
    let last = -1

    const ring = (buf, n) => buf[n % buf.length]
    const allpass = (buf, n, input) => {
      const delayed = ring(buf, n)
      const y = delayed - diffuseGain * input
      buf[n % buf.length] = input + diffuseGain * y
      return y
    }
    const reset = () => {
      for (const buf of [...lines, ...diffusers, preDelay, dampState]) buf.fill(0)
    }

    const render = (n) => {
      const [dl, dr] = f(n / sr)
      const pi = (n % (preDelay.length / 2)) * 2
      let inL = preDelay[pi]
      let inR = preDelay[pi + 1]
      preDelay[pi] = dl
      preDelay[pi + 1] = dr
      inL = allpass(diffusers[1], n, allpass(diffusers[0], n, inL))
      inR = allpass(diffusers[3], n, allpass(diffusers[2], n, inR))

      for (let i = 0; i < 8; i++) {
        dampState[i] = ring(lines[i], n) + damp * (dampState[i] - ring(lines[i], n))
        x[i] = dampState[i]
      }
      const wetL = x[0] - x[2] + x[4] - x[6]
      const wetR = x[1] - x[3] + x[5] - x[7]

      for (let h = 1; h < 8; h *= 2) {
        for (let i = 0; i < 8; i += h * 2) {
          for (let j = i; j < i + h; j++) {
            const a = x[j]
            x[j] = a + x[j + h]
            x[j + h] = a - x[j + h]
          }
        }
      }
      for (let i = 0; i < 8; i++) {
        lines[i][n % lines[i].length] = x[i] * Math.SQRT1_2 * 0.5 * lineGains[i] + (i % 2 === 0 ? inL : inR)
      }

      const mid = (wetL + wetR) * 0.5
      const side = (wetL - wetR) * 0.5 * width
      out[L] = dl * (1 - mix) + (mid + side) * wetGain * mix
      out[R] = dr * (1 - mix) + (mid - side) * wetGain * mix
    }

    return (t) => {
      const frame = Math.round(t * sr)
      if (frame < 0) return f(t)
      if (frame < last || frame > last + sr) {
        reset()
        last = frame - 1
      }
      while (last < frame) render(++last)
      return out
    }
  }

  // Synths
  // ######
  // Synths have always the form `f(hz, ...) -> t -> [l, r]`

  // Pluck with a short ADSR env, slightly detuned in stereo.
  const pluck = (hz, f, detuneCents = 3) => {
    const env = adsr({ releaseTime: 0.05, attackSec: 0.005, decaySec: 0.08, sustain: 0.4, releaseSec: 0.18 })
    return stereoDetuned(hz, f, detuneCents, env, 0.3)
  }

  // `f` in mid/side stereo, scaled by `env` and `gain`: mid is `f` itself, side is the difference of two copies
  // detuned by ±`detuneCents`. The mono sum is exactly the mid, so it can never cancel, however the copies drift.
  // Mid plus an uncorrelated side at half amplitude has 1.25x the power; this keeps the level of the mono voice.
  const STEREO_NORM = 1 / Math.sqrt(1.25)
  const stereoDetuned = (hz, f, detuneCents, env, gain) => {
    const ratio = Math.pow(2, detuneCents / 1200)
    const out = alloc()
    return (t) => {
      const hzNow = E(t, hz)
      const g = env(t) * gain
      const mid = f(t, hzNow)
      const side = (f(t, hzNow * ratio) - f(t, hzNow / ratio)) * 0.5
      out[L] = (mid + side) * g * STEREO_NORM
      out[R] = (mid - side) * g * STEREO_NORM
      return out
    }
  }

  // Pad with a longer ADSR env, detuned in stereo.
  const pad = (hz, f, detuneCents = 7) => {
    const env = adsr({ releaseTime: 0.6, attackSec: 0.4, decaySec: 0.2, sustain: 0.7, releaseSec: 2.0 })
    return stereoDetuned(hz, f, detuneCents, env, 0.25)
  }

  const iacid = (hz, opts = {}) => {
    const f = opts.wave ?? saw

    const sr = sampleRate
    const piOverSr = Math.PI / sr
    const cutoffMaxHz = sr * 0.49

    const cap = Math.max(2, Math.ceil(sr))
    const buf = new Float64Array(cap)
    let s1 = 0,
      s2 = 0
    let last = -1
    const out = alloc()

    return (t) => {
      const cutoffHz = E(t, opts.cutoffHz ?? 800)
      const envModOct = E(t, opts.envModOct ?? 3)
      const q = E(t, opts.q ?? 6)
      const decaySec = E(t, opts.decaySec ?? 0.3)
      const accent = E(t, opts.accent ?? false)
      const ampDecay = decaySec * 0.8
      const filterDecay = decaySec
      const ampGain = accent ? 0.45 : 0.3
      const sweepOct = envModOct * (accent ? 1.5 : 1.0)
      const Rq = 1 / (2 * q)

      const frame = Math.round(t * sr)
      if (frame < last || frame > last + cap) {
        s1 = 0
        s2 = 0
        buf.fill(0)
        last = frame - 1
      }
      while (last < frame) {
        last++
        const tt = last / sr
        const ampEnv = Math.exp(-tt / ampDecay)
        const filterEnv = Math.exp(-tt / filterDecay)
        const cutNowHz = Math.min(cutoffHz * Math.pow(2, sweepOct * filterEnv), cutoffMaxHz)
        const g = Math.tan(piOverSr * cutNowHz)
        const denom = 1 + 2 * Rq * g + g * g
        const x = f(tt, E(tt, hz)) * ampGain * ampEnv
        const hp = (x - (2 * Rq + g) * s1 - s2) / denom
        const bp = g * hp + s1
        const lp = g * bp + s2
        s1 = bp + g * hp
        s2 = lp + g * bp
        buf[last % cap] = lp
      }
      const v = buf[wrap(frame, cap)]
      out[L] = v
      out[R] = v
      return out
    }
  }

  const ikarplus = (hz, opts = {}) => {
    const decay = opts.decay ?? 0.998
    const sr = sampleRate
    const cap = Math.max(2, Math.ceil(sr / 20)) // up to 50 ms of delay (~20 Hz minimum)
    const buf = new Float64Array(cap)
    let delayLength = 2
    let currentOutput = 0
    let last = -1
    const out = alloc()

    return (t) => {
      const frame = Math.round(t * sr)
      if (last < 0 || frame < last || frame > last + cap) {
        const f0 = E(frame / sr, hz)
        delayLength = Math.max(2, Math.min(cap, Math.round(sr / f0)))
        for (let i = 0; i < delayLength; i++) buf[i] = Math.random() * 2 - 1
        last = frame - 1
      }
      while (last < frame) {
        last++
        const idx = wrap(last, delayLength)
        const prevIdx = wrap(last - 1, delayLength)
        currentOutput = buf[idx]
        buf[idx] = (currentOutput + buf[prevIdx]) * 0.5 * decay
      }
      const v = currentOutput * 0.3
      out[L] = v
      out[R] = v
      return out
    }
  }

  const speechPhonemes = {
    SP: { f: [500, 1500, 2500], bw: [100, 160, 220], amp: [0, 0, 0], voice: 0, noise: 0, dur: 0.08 },
    AA: { f: [730, 1090, 2440], bw: [80, 90, 120], amp: [1, 0.58, 0.24], voice: 1, noise: 0.02, dur: 0.14 },
    AE: { f: [660, 1720, 2410], bw: [80, 100, 120], amp: [1, 0.64, 0.28], voice: 1, noise: 0.02, dur: 0.13 },
    AH: { f: [640, 1190, 2390], bw: [80, 100, 120], amp: [1, 0.5, 0.25], voice: 1, noise: 0.02, dur: 0.12 },
    AO: { f: [570, 840, 2410], bw: [80, 90, 120], amp: [1, 0.46, 0.22], voice: 1, noise: 0.02, dur: 0.14 },
    AW: { f: [620, 1180, 2550], bw: [90, 120, 150], amp: [1, 0.52, 0.24], voice: 1, noise: 0.02, dur: 0.15 },
    EH: { f: [530, 1840, 2480], bw: [70, 90, 120], amp: [1, 0.66, 0.27], voice: 1, noise: 0.02, dur: 0.12 },
    ER: { f: [490, 1350, 1690], bw: [70, 110, 120], amp: [1, 0.42, 0.36], voice: 1, noise: 0.02, dur: 0.14 },
    EY: { f: [480, 2040, 2600], bw: [70, 100, 130], amp: [1, 0.62, 0.25], voice: 1, noise: 0.02, dur: 0.14 },
    IH: { f: [390, 1990, 2550], bw: [60, 100, 120], amp: [1, 0.6, 0.25], voice: 1, noise: 0.02, dur: 0.11 },
    IY: { f: [270, 2290, 3010], bw: [60, 100, 120], amp: [1, 0.62, 0.26], voice: 1, noise: 0.02, dur: 0.13 },
    OW: { f: [570, 900, 2550], bw: [80, 100, 140], amp: [1, 0.48, 0.22], voice: 1, noise: 0.02, dur: 0.14 },
    OY: { f: [500, 1550, 2600], bw: [80, 120, 150], amp: [1, 0.56, 0.24], voice: 1, noise: 0.02, dur: 0.15 },
    UH: { f: [440, 1020, 2240], bw: [70, 100, 120], amp: [1, 0.45, 0.22], voice: 1, noise: 0.02, dur: 0.12 },
    UW: { f: [300, 870, 2240], bw: [60, 90, 120], amp: [1, 0.45, 0.2], voice: 1, noise: 0.02, dur: 0.13 },
    B: { f: [350, 1150, 2200], bw: [110, 190, 260], amp: [0.7, 0.28, 0.12], voice: 0.55, noise: 0.18, dur: 0.055 },
    D: { f: [410, 1700, 2600], bw: [120, 220, 300], amp: [0.62, 0.36, 0.16], voice: 0.55, noise: 0.2, dur: 0.055 },
    F: { f: [1300, 4500, 7200], bw: [500, 900, 1400], amp: [0.2, 0.65, 0.35], voice: 0.05, noise: 0.85, dur: 0.08 },
    G: { f: [350, 1550, 2500], bw: [130, 240, 330], amp: [0.64, 0.32, 0.14], voice: 0.55, noise: 0.18, dur: 0.06 },
    H: { f: [600, 1800, 3200], bw: [400, 900, 1500], amp: [0.35, 0.45, 0.25], voice: 0.15, noise: 0.65, dur: 0.07 },
    K: { f: [450, 1900, 3300], bw: [140, 260, 420], amp: [0.52, 0.42, 0.2], voice: 0.08, noise: 0.7, dur: 0.065 },
    L: { f: [340, 1100, 2600], bw: [80, 120, 180], amp: [0.78, 0.32, 0.18], voice: 0.9, noise: 0.04, dur: 0.08 },
    M: { f: [250, 1200, 2100], bw: [70, 130, 220], amp: [0.7, 0.26, 0.1], voice: 0.85, noise: 0.03, dur: 0.08 },
    N: { f: [280, 1700, 2600], bw: [70, 140, 240], amp: [0.68, 0.28, 0.12], voice: 0.85, noise: 0.03, dur: 0.075 },
    NG: { f: [260, 2000, 2800], bw: [70, 160, 260], amp: [0.66, 0.24, 0.1], voice: 0.85, noise: 0.03, dur: 0.085 },
    P: { f: [450, 1200, 2400], bw: [130, 220, 360], amp: [0.55, 0.3, 0.14], voice: 0.04, noise: 0.75, dur: 0.055 },
    R: { f: [360, 1300, 1650], bw: [80, 120, 130], amp: [0.78, 0.28, 0.34], voice: 0.9, noise: 0.04, dur: 0.08 },
    S: { f: [2600, 5200, 7800], bw: [600, 1000, 1500], amp: [0.22, 0.8, 0.5], voice: 0.03, noise: 1, dur: 0.085 },
    SH: { f: [1800, 3400, 6200], bw: [500, 900, 1500], amp: [0.34, 0.78, 0.48], voice: 0.03, noise: 1, dur: 0.095 },
    T: { f: [520, 2200, 4200], bw: [150, 320, 600], amp: [0.45, 0.5, 0.26], voice: 0.04, noise: 0.8, dur: 0.055 },
    TH: { f: [1100, 3600, 6200], bw: [450, 900, 1500], amp: [0.24, 0.68, 0.36], voice: 0.04, noise: 0.85, dur: 0.08 },
    V: { f: [1200, 4200, 7000], bw: [500, 900, 1400], amp: [0.2, 0.56, 0.3], voice: 0.45, noise: 0.62, dur: 0.08 },
    W: { f: [300, 760, 2200], bw: [70, 100, 160], amp: [0.76, 0.36, 0.16], voice: 0.9, noise: 0.03, dur: 0.075 },
    Y: { f: [280, 2250, 3000], bw: [60, 100, 130], amp: [0.72, 0.42, 0.18], voice: 0.9, noise: 0.03, dur: 0.075 },
    Z: { f: [2400, 5000, 7600], bw: [600, 1000, 1500], amp: [0.2, 0.7, 0.42], voice: 0.45, noise: 0.7, dur: 0.085 },
    ZH: { f: [1700, 3300, 5900], bw: [500, 900, 1500], amp: [0.3, 0.68, 0.42], voice: 0.45, noise: 0.68, dur: 0.09 },
  }

  const speechGraphemes = [
    ["tion", ["SH", "AH", "N"]],
    ["sion", ["ZH", "AH", "N"]],
    ["ough", ["OW"]],
    ["augh", ["AO"]],
    ["eigh", ["EY"]],
    ["th", ["TH"]],
    ["sh", ["SH"]],
    ["ch", ["T", "SH"]],
    ["ng", ["NG"]],
    ["ph", ["F"]],
    ["ck", ["K"]],
    ["wh", ["W"]],
    ["qu", ["K", "W"]],
    ["oo", ["UW"]],
    ["ee", ["IY"]],
    ["ea", ["IY"]],
    ["ai", ["EY"]],
    ["ay", ["EY"]],
    ["oa", ["OW"]],
    ["ow", ["AW"]],
    ["ou", ["AW"]],
    ["oi", ["OY"]],
    ["oy", ["OY"]],
    ["ar", ["AA", "R"]],
    ["er", ["ER"]],
    ["ir", ["ER"]],
    ["or", ["AO", "R"]],
    ["ur", ["ER"]],
  ]

  const speechLetters = {
    a: ["AH"],
    b: ["B"],
    c: ["K"],
    d: ["D"],
    e: ["EH"],
    f: ["F"],
    g: ["G"],
    h: ["H"],
    i: ["IH"],
    j: ["D", "ZH"],
    k: ["K"],
    l: ["L"],
    m: ["M"],
    n: ["N"],
    o: ["OW"],
    p: ["P"],
    q: ["K"],
    r: ["R"],
    s: ["S"],
    t: ["T"],
    u: ["UH"],
    v: ["V"],
    w: ["W"],
    x: ["K", "S"],
    y: ["Y"],
    z: ["Z"],
  }

  const addSpeechPhoneme = (segments, phoneme, durSec = undefined) => {
    const key = String(phoneme).toUpperCase()
    const ph = speechPhonemes[key] ?? speechPhonemes.SP
    const prev = segments[segments.length - 1]
    if (key === "SP" && prev?.phoneme === "SP") {
      prev.durSec += durSec ?? ph.dur
      return
    }
    segments.push({ phoneme: key, durSec: durSec ?? ph.dur })
  }

  const addSpeechToken = (segments, token, durSec = undefined) => {
    const parts = String(token).trim().toUpperCase().split(/\s+/)
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) addSpeechPhoneme(segments, parts[i], durSec)
    }
  }

  const textToSpeechSegments = (text) => {
    const segments = []
    const s = String(text).toLowerCase()
    let i = 0
    while (i < s.length) {
      const c = s[i]
      if (c === " " || c === "\n" || c === "\t" || c === "," || c === "." || c === "!" || c === "?") {
        addSpeechPhoneme(segments, "SP", c === "," ? 0.14 : c === "." || c === "!" || c === "?" ? 0.2 : 0.08)
        i++
        continue
      }
      let matched = false
      for (let j = 0; j < speechGraphemes.length; j++) {
        const [grapheme, phonemes] = speechGraphemes[j]
        if (s.startsWith(grapheme, i)) {
          for (let k = 0; k < phonemes.length; k++) addSpeechPhoneme(segments, phonemes[k])
          i += grapheme.length
          matched = true
          break
        }
      }
      if (matched) continue
      const phonemes = speechLetters[c]
      if (phonemes) {
        for (let j = 0; j < phonemes.length; j++) addSpeechPhoneme(segments, phonemes[j])
      }
      i++
    }
    return segments
  }

  const normalizeSpeechSegments = (textOrSegments, opts) => {
    const raw = []
    if (Array.isArray(textOrSegments)) {
      for (let i = 0; i < textOrSegments.length; i++) {
        const item = textOrSegments[i]
        if (typeof item === "string") {
          addSpeechToken(raw, item)
        } else if (item && typeof item === "object") {
          addSpeechToken(raw, item.phoneme ?? item.p ?? "SP", item.durSec ?? item.dur)
        }
      }
    } else {
      raw.push(...textToSpeechSegments(textOrSegments ?? ""))
    }

    const rate = Math.max(0.05, opts.rate ?? 1)
    const scale = (opts.phonemeSec ?? 1) / rate
    let startSec = 0
    const segments = []
    for (let i = 0; i < raw.length; i++) {
      const key = raw[i].phoneme
      const ph = speechPhonemes[key] ?? speechPhonemes.SP
      const durSec = Math.max(0.005, raw[i].durSec * scale)
      segments.push({ startSec, durSec, ph })
      startSec += durSec
    }
    return { segments, durSec: startSec }
  }

  // Formant-based speech synthesizer.
  //
  // `textOrSegments` may be a text string, an array of phoneme names, or segment objects:
  // `{ phoneme: "AH", durSec: 0.12 }`.
  //
  // The returned function carries `.spectralEnvelope(t, bandsHz, gains)` which writes the vocal-tract gain at each
  // of `bandsHz` into `gains` and returns the unvoiced (noise) share. `ivocoder` uses it in place of analysis.
  const formantSpeech = (textOrSegments, opts = {}) => {
    const { segments, durSec } = normalizeSpeechSegments(textOrSegments, opts)
    const pitchHz = opts.pitchHz ?? 120
    const gain = opts.gain ?? 0.75
    const panPos = opts.pan ?? 0
    const transitionSec = opts.transitionSec ?? 0.035
    const maxHarmonics = opts.maxHarmonics ?? 48
    const spectralTilt = opts.spectralTilt ?? 0.85
    const out = alloc()

    const formantGain = (hz, phA, phB, alpha, mouth) => {
      let g = 0
      for (let i = 0; i < 3; i++) {
        const centerHz = lerp(phA.f[i], phB.f[i], alpha) * mouth
        const bwHz = lerp(phA.bw[i], phB.bw[i], alpha)
        const amp = lerp(phA.amp[i], phB.amp[i], alpha)
        const x = (hz - centerHz) / bwHz
        g += amp * Math.exp(-0.5 * x * x)
      }
      return g
    }

    // Aspiration and frication: noise shaped by the same three formants as the voiced part, like the parallel
    // noise branch in Klatt, "Software for a cascade/parallel formant synthesizer" (JASA, 1980).
    // Each formant is a `bandNoise` with a constant center per phoneme. Phonemes are crossfaded rather than their
    // centers interpolated, since sweeping a ring-modulation carrier would chirp.
    const formantNoise = (t, ph, mouth) => {
      let s = 0
      for (let i = 0; i < 3; i++) s += ph.amp[i] * bandNoise(t, ph.f[i] * mouth, ph.bw[i] * 1.5, i * 0.37)
      return s
    }

    // The segment at `t`, its crossfade `alpha` into the next one, and the declick `gate`.
    // Returns null outside of the utterance.
    const frame = { idx: 0, seg: null, next: null, alpha: 0, gate: 0 }
    const locate = (t) => {
      if (t < 0 || t >= durSec || segments.length === 0) return null

      let idx = 0
      while (idx < segments.length - 1 && t >= segments[idx].startSec + segments[idx].durSec) idx++

      const seg = segments[idx]
      const localSec = t - seg.startSec
      const fadeSec = Math.min(0.012, seg.durSec * 0.45)
      frame.idx = idx
      frame.seg = seg
      frame.next = segments[idx + 1] ?? seg
      frame.gate =
        fadeSec <= 0 ? 1 : Math.min(1, Math.max(0, localSec / fadeSec), Math.max(0, (seg.durSec - localSec) / fadeSec))
      frame.alpha =
        transitionSec <= 0 || idx >= segments.length - 1
          ? 0
          : Math.max(0, Math.min(1, (localSec - (seg.durSec - transitionSec)) / transitionSec))
      return frame
    }

    const fn = (t) => {
      const located = locate(t)
      if (located === null) {
        out[L] = 0
        out[R] = 0
        return out
      }
      const { seg, next, alpha, gate } = located

      const baseHz = Math.max(40, E(t, pitchHz))
      const vibratoHz = E(t, opts.vibratoHz ?? 5.2)
      const vibratoDepth = E(t, opts.vibratoDepth ?? 0.012)
      const vibratoPhase =
        vibratoHz === 0 ? 0 : (-baseHz * vibratoDepth * Math.cos(t * vibratoHz * TAU)) / (TAU * vibratoHz)
      const phase = baseHz * t + vibratoPhase
      const voicedHz = baseHz * (1 + vibratoDepth * sin(t, vibratoHz || 1))
      const mouth = E(t, opts.mouth ?? 1)
      const breath = E(t, opts.breath ?? 0.22)
      const voice = lerp(seg.ph.voice, next.ph.voice, alpha)
      const noiseAmt = lerp(seg.ph.noise, next.ph.noise, alpha)
      const harmonicCount = Math.min(maxHarmonics, Math.floor((sampleRate * 0.45) / voicedHz))

      let voiced = 0
      let norm = 0
      for (let k = 1; k <= harmonicCount; k++) {
        const hz = voicedHz * k
        const a = formantGain(hz, seg.ph, next.ph, alpha, mouth) / Math.pow(k, spectralTilt)
        voiced += Math.sin(TAU * k * phase + k * 0.19) * a
        norm += a
      }
      if (norm > 0) voiced /= norm

      const hissAmt = noiseAmt * breath
      let hiss = 0
      if (hissAmt > 0) {
        hiss = formantNoise(t, seg.ph, mouth)
        if (alpha > 0) hiss = lerp(hiss, formantNoise(t, next.ph, mouth), alpha)
      }
      const s = (voiced * voice + hiss * hissAmt * 2) * gate * gain
      const p = Math.max(-1, Math.min(1, E(t, panPos)))
      const angle = (p + 1) * Math.PI * 0.25
      out[L] = s * Math.cos(angle)
      out[R] = s * Math.sin(angle)
      return out
    }
    fn.spectralEnvelope = (t, bandsHz, gains) => {
      const located = locate(t)
      if (located === null) {
        gains.fill(0)
        return 0
      }
      const { seg, next, alpha, gate } = located
      const mouth = E(t, opts.mouth ?? 1)
      const voice = lerp(seg.ph.voice, next.ph.voice, alpha)
      const noiseAmt = lerp(seg.ph.noise, next.ph.noise, alpha)
      // Fricatives sit well below vowels in natural speech; matches the `hissAmt` level of the synth itself.
      const level = Math.max(voice, noiseAmt * 0.4) * gate * gain
      for (let i = 0; i < bandsHz.length; i++) gains[i] = formantGain(bandsHz[i], seg.ph, next.ph, alpha, mouth) * level
      return noiseAmt * gate
    }
    fn.dur = durSec
    return fn
  }

  // Impure virtual-analog voice, the subtractive synth of a modern soft synth.
  //
  // - `voices` unison PolyBLEP oscillators detuned across ±`detuneCents`, panned across `spread`, with fixed phase
  //   offsets so they never start aligned. An optional square sub one octave down and noise.
  // - `tanh` drive into a resonant zero-delay-feedback lowpass (see `svfStep`) whose cutoff follows its own ADSR
  //   by `envOct` octaves and the pitch by `keyTrack` (1 tracks fully, relative to C4).
  // - Exponential amp and filter ADSRs; the release starts at `gateSec`.
  //
  // Options (numbers may be functions of t except voices, detuneCents, spread and gateSec):
  // - wave: "saw" | "square" | (t, hz) => number  ("saw")
  // - voices (3), detuneCents (12), spread (0.7)
  // - sub (0), noise (0)
  // - cutoffHz (900), q (1), envOct (3), keyTrack (0.5)
  // - drive (1.5)
  // - gateSec (Infinity)
  // - amp: { attackSec (0.003), decaySec (0.3), sustain (0.7), releaseSec (0.2) }
  // - filter: { attackSec (0.001), decaySec (0.25), sustain (0.2), releaseSec (0.3) }
  // - gain (1)
  const isynth = (hz, opts = {}) => {
    const sr = sampleRate
    const osc = typeof opts.wave === "function" ? opts.wave : opts.wave === "square" ? square : saw
    const voices = opts.voices ?? 3
    const detuneCents = opts.detuneCents ?? 12
    const spread = opts.spread ?? 0.7
    const gateSec = opts.gateSec ?? Infinity
    const ampEnv = adsr({
      attackSec: 0.003,
      decaySec: 0.3,
      sustain: 0.7,
      releaseSec: 0.2,
      ...opts.amp,
      releaseTime: gateSec,
    })
    const filterEnv = adsr({
      attackSec: 0.001,
      decaySec: 0.25,
      sustain: 0.2,
      releaseSec: 0.3,
      ...opts.filter,
      releaseTime: gateSec,
    })

    const ratios = new Float64Array(voices)
    const phases = new Float64Array(voices)
    const gainsL = new Float64Array(voices)
    const gainsR = new Float64Array(voices)
    for (let i = 0; i < voices; i++) {
      const x = voices === 1 ? 0 : (2 * i) / (voices - 1) - 1
      const angle = (spread * x + 1) * Math.PI * 0.25
      ratios[i] = Math.pow(2, (x * detuneCents) / 1200)
      // Golden-ratio phase offsets are as far from each other as possible.
      phases[i] = (i * 0.618034) % 1
      gainsL[i] = (Math.cos(angle) * Math.SQRT2) / Math.sqrt(voices)
      gainsR[i] = (Math.sin(angle) * Math.SQRT2) / Math.sqrt(voices)
    }

    const state = new Float64Array(4)
    const out = alloc()
    let last = -1

    const render = (n) => {
      const t = n / sr
      const f0 = E(t, hz)
      let l = 0,
        r = 0
      for (let i = 0; i < voices; i++) {
        const s = osc(t + phases[i] / f0, f0 * ratios[i])
        l += s * gainsL[i]
        r += s * gainsR[i]
      }
      const sub = E(t, opts.sub ?? 0) * square(t, f0 * 0.5)
      const hiss = E(t, opts.noise ?? 0)
      const drive = E(t, opts.drive ?? 1.5)
      const driveNorm = 1 / Math.tanh(drive)
      const xl = Math.tanh(drive * (l + sub + hiss * noise(n))) * driveNorm
      const xr = Math.tanh(drive * (r + sub + hiss * noise(n + 0.5))) * driveNorm

      const cutoffHz =
        E(t, opts.cutoffHz ?? 900) *
        Math.pow(2, E(t, opts.envOct ?? 3) * filterEnv(t)) *
        Math.pow(f0 / 261.63, E(t, opts.keyTrack ?? 0.5))
      const g = svfCoef(cutoffHz)
      const k = 1 / E(t, opts.q ?? 1)
      const amp = ampEnv(t) * E(t, opts.gain ?? 1) * 0.25
      out[L] = svfStep(state, 0, xl, g, k)[0] * amp
      out[R] = svfStep(state, 2, xr, g, k)[0] * amp
    }

    return (t) => {
      const frame = Math.round(t * sr)
      if (frame < last || frame > last + sr) {
        state.fill(0)
        last = frame - 1
      }
      while (last < frame) render(++last)
      return out
    }
  }

  // fm2 is a 2-op FM voice in the style of the DX7 (Chowning, "The Synthesis of Complex Audio Spectra by Means of
  // Frequency Modulation", 1973).
  //
  // - A sine modulator at `ratio * hz` drives the carrier sine. Its index decays from `modIndex` to
  //   `modSustain * modIndex` over `modDecaySec`.
  // - `keyScale` lowers the index above 220Hz like DX7 keyboard level scaling, so high notes do not turn harsh.
  // - `feedback` self-modulates the modulator, which adds saw-like harmonics. The feedback loop is solved by two
  //   fixed-point iterations, which keeps the voice pure and is close to the DX7's one-sample feedback.
  // - Mid/side stereo like `pad`: mid is the voice, side the difference of two copies detuned by ±`detuneCents`.
  const fm2 = (hz, opts = {}) => {
    const env = opts.env ?? adsr({ releaseTime: 0.1, attackSec: 0.005, decaySec: 0.15, sustain: 0.5, releaseSec: 0.3 })
    const detuneRatio = Math.pow(2, (opts.detuneCents ?? 4) / 1200)
    const keyScale = opts.keyScale ?? 0.5
    const out = alloc()
    const operator = (t, hz, ratio, index, feedback) => {
      const modPhase = t * hz * ratio * TAU
      let m = Math.sin(modPhase)
      m = Math.sin(modPhase + feedback * m)
      m = Math.sin(modPhase + feedback * m)
      return Math.sin(t * hz * TAU + index * m)
    }
    return (t) => {
      const hzNow = E(t, hz)
      const ratio = E(t, opts.ratio ?? 2)
      const modIndex = E(t, opts.modIndex ?? 4)
      const modDecaySec = E(t, opts.modDecaySec ?? 0.3)
      const modSustain = E(t, opts.modSustain ?? 0.08)
      const feedback = E(t, opts.feedback ?? 0.2)
      const indexEnv = modSustain + (1 - modSustain) * Math.exp(-t / modDecaySec)
      const index = modIndex * indexEnv * Math.min(1, Math.pow(220 / hzNow, keyScale))
      const g = env(t) * 0.3
      const mid = operator(t, hzNow, ratio, index, feedback)
      const side =
        (operator(t, hzNow * detuneRatio, ratio, index, feedback) -
          operator(t, hzNow / detuneRatio, ratio, index, feedback)) *
        0.5
      out[L] = (mid + side) * g * STEREO_NORM
      out[R] = (mid - side) * g * STEREO_NORM
      return out
    }
  }

  // Drums
  // #####
  // Drum voices have the form `f(opts) -> t -> [l, r]`.

  // Synthetic kick drum.
  //
  // Sine with a fast exponential pitch sweep from `6*tuneHz` to `tuneHz`.
  // The sweep is integrated analytically so phase stays continuous:
  //   hz(t) = tune + sweep * exp(-t / pitchDecaySec)
  //   phase(t) = tune*t + sweep * pitchDecaySec * (1 - exp(-t/pitchDecaySec))
  //
  // The amplitude follows the gamma-shaped `(1 + x) * exp(-x)` which has zero slope at the hit, so the body holds
  // before it decays. `tanh` saturation adds the upper harmonics that keep the kick audible on small speakers and
  // a short band-limited noise burst provides the beater click.
  const kick = (opts = {}) => {
    const attackSec = opts.attackSec ?? 0.002
    const decaySec = opts.decaySec ?? 0.3
    const tuneHz = opts.tuneHz ?? 50
    const pitchDecaySec = opts.pitchDecaySec ?? 0.05
    const drive = opts.drive ?? 1.8
    const click = opts.click ?? 0.5
    const sweepHz = tuneHz * 5
    const bodySec = decaySec * 0.6
    const driveNorm = 1 / Math.tanh(drive)
    const out = alloc()
    return (t) => {
      if (t <= 0) {
        out[L] = 0
        out[R] = 0
        return out
      }
      const pitchEnv = Math.exp(-t / pitchDecaySec)
      const phase = tuneHz * t + sweepHz * pitchDecaySec * (1 - pitchEnv)
      const x = t / bodySec
      const hit = t < attackSec ? t / attackSec : 1
      const amp = hit * (1 + x) * Math.exp(-x)
      const body = Math.tanh(drive * amp * Math.sin(phase * TAU)) * driveNorm
      const beater = bandNoise(t, 3200, 2400, 0.71) * Math.exp(-t / 0.003) * click
      const s = (body + beater) * 0.33
      out[L] = s
      out[R] = s
      return out
    }
  }

  // Synthetic snare.
  //
  // Follows Gordon Reid, "Synth Secrets: Practical Snare Drum Synthesis" (Sound On Sound, 2002):
  // - Two drum-head modes at the 1 : 1.59 ratio of the (0,1) and (1,1) circular-membrane modes. The pitch drop
  //   is integrated analytically like in `kick`.
  // - Snare wires as two bands of noise (0.5-6.5kHz and 5-13kHz).
  // - A short, differentiated noise crack for the stick.
  const snare = (opts = {}) => {
    const attackSec = opts.attackSec ?? 0.001
    const decaySec = opts.decaySec ?? 0.18
    const tuneHz = opts.tuneHz ?? 180
    const noiseAmt = opts.noiseAmt ?? 0.7
    const snap = opts.snap ?? 0.35
    const tonalAmt = 1 - noiseAmt
    const dropSec = 0.02
    const dropHz = tuneHz * 0.4
    const out = alloc()
    return (t) => {
      if (t <= 0) {
        out[L] = 0
        out[R] = 0
        return out
      }
      const frame = Math.floor(t * sampleRate)
      const hit = t < attackSec ? t / attackSec : 1
      const bodyEnv = hit * Math.exp(-t / (decaySec * 0.5))
      const wireEnv = hit * Math.exp(-t / decaySec)
      const rattleEnv = hit * Math.exp(-t / (decaySec * 1.6))
      const crackEnv = hit * Math.exp(-t / 0.005)

      const headPhase = tuneHz * t + dropHz * dropSec * (1 - Math.exp(-t / dropSec))
      const head = Math.sin(headPhase * TAU) * 0.75 + Math.sin(headPhase * 1.59 * TAU) * 0.35
      const body = Math.tanh(1.5 * head) * tonalAmt * bodyEnv

      const wiresL = bandNoise(t, 3500, 3000, 0.13) * wireEnv + bandNoise(t, 9000, 4000, 0.37) * rattleEnv * 0.6
      const wiresR = bandNoise(t, 3500, 3000, 0.53) * wireEnv + bandNoise(t, 9000, 4000, 0.79) * rattleEnv * 0.6
      const crackL = (noise(frame) - noise(frame - 1)) * crackEnv * snap
      const crackR = (noise(frame + 0.5) - noise(frame - 0.5)) * crackEnv * snap

      out[L] = (body + wiresL * noiseAmt * 1.4 + crackL * 0.5) * 0.27
      out[R] = (body + wiresR * noiseAmt * 1.4 + crackR * 0.5) * 0.27
      return out
    }
  }

  // Synthetic hihat.
  //
  // Metal: two FM pairs with irrational frequency ratios produce a dense inharmonic spectrum around `shimmerHz`
  // (Chowning, "The Synthesis of Complex Audio Spectra by Means of Frequency Modulation", 1973). The modulation
  // index decays with the hit, so the hat darkens as it rings out.
  // Noise: a second difference `n[k] - 2n[k-1] + n[k-2]` is a 12dB/oct highpass on white noise, plus an air band.
  // `open: true` switches to a long decay for the open variant; closed is a tight tick.
  const hihat = (opts = {}) => {
    const open = opts.open ?? false
    const attackSec = opts.attackSec ?? 0.001
    const decaySec = opts.decaySec ?? (open ? 0.35 : 0.05)
    const shimmerHz = opts.shimmerHz ?? 7000
    const tone = opts.tone ?? 0.18
    const chokeSec = open ? decaySec * 0.55 : decaySec * 0.42
    const out = alloc()
    const metal = (t, env) => {
      const index = 1 + 2.5 * env
      const a = Math.sin(TAU * shimmerHz * t + index * sin(t, shimmerHz * Math.SQRT2))
      const b = Math.sin(TAU * shimmerHz * 0.7231 * t + index * sin(t, shimmerHz * 1.6619))
      return (a + b) * 0.5
    }
    const highpass = (frame) => (noise(frame) - 2 * noise(frame - 1) + noise(frame - 2)) * 0.5
    return (t) => {
      if (t <= 0) {
        out[L] = 0
        out[R] = 0
        return out
      }
      const frame = Math.floor(t * sampleRate)
      const hit = t < attackSec ? t / attackSec : 1
      const bodyEnv = hit * Math.exp(-t / chokeSec)
      const airEnv = hit * Math.exp(-t / decaySec)
      const tickEnv = hit * Math.exp(-t / 0.004)

      const m = metal(t, bodyEnv) * tone * 1.6
      const hpL = highpass(frame)
      const hpR = highpass(frame + 0.5)
      const airL = bandNoise(t, 11000, 4000, 0.29)
      const airR = bandNoise(t, 11000, 4000, 0.61)
      const stick = hpL * tickEnv * 0.5

      out[L] = ((hpL * (1 - tone) + m) * bodyEnv + airL * airEnv * 0.5 + stick) * 0.15
      out[R] = ((hpR * (1 - tone) + m * 0.92) * bodyEnv + airR * airEnv * 0.5 + stick * 0.5) * 0.15
      return out
    }
  }

  return {
    // osc
    sin,
    cos,
    saw,
    suprsaw,
    tri,
    square,
    bell,
    stepSin,
    noise,
    valueNoise,
    bandNoise,

    // utils
    alloc,
    wrap,
    E,
    lerp,
    stereo,
    vol,
    sum,
    mul,
    mix,
    crossfade,
    pan,
    smooth,
    pitch,
    chord,
    sec,
    id,
    pattern,

    // envelopes
    lfo,
    adsr,
    fadeIn,
    fadeOut,
    window,
    muteFor,

    // song structure
    section,
    song,

    // tempo
    tempoBpm,
    tempoLfo,
    tempoRamp,

    // time
    timeReverse,
    timeRepeat,
    ibuf,

    // sequencers
    shuffle,
    seq,
    polyseq,

    // fx
    delay,
    idelay,
    ilpf,
    iflanger,
    ichorus,
    iphaser,
    distort,
    icomp,
    ivocoder,
    isvf,
    ireverb,

    // synths
    pluck,
    pad,
    iacid,
    isynth,
    ikarplus,
    speechPhonemes,
    formantSpeech,
    fm2,

    // drums
    kick,
    snare,
    hihat,
  }
})()

const A = Æ

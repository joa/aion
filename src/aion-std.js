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

  const saw = (t, hz) => {
    const p = t * hz
    return 2 * (p - Math.floor(p)) - 1
  }

  const suprsaw = (t, hz) => {
    let s = 0.0,
      g = 1.0,
      norm = 0.0
    for (let i = 0; i < 4; i++) {
      g *= 0.5
      s += (saw(t, hz + i) * 0.75 + 0.25 * (saw(t, hz - i * 2) + saw(t, hz + i * 2))) * g
      norm += 1.25 * g
    }
    return s / norm
  }

  const tri = (t, hz) => {
    const p = t * hz - Math.floor(t * hz)
    return 1 - 4 * Math.abs(p - 0.5)
  }

  // Centered ±1 square. For PWM, compose: `(t, hz) => (saw(t, hz) < -0.4 ? -1 : 1)`.
  const square = (t, hz) => {
    const p = t * hz - Math.floor(t * hz)
    return p < 0.5 ? -1 : 1
  }

  const bell = (t, hz) => 0.5 - 0.5 * cos(t, hz)

  // Creates and returns a sin oscillator with `n` steps.
  const stepSin = (n) => (t, hz) => Math.sin((Math.floor(t * hz * n) / n) * TAU)

  // Deterministic pseudo-random noise in [-1, 1].
  const noise = (t) => {
    const x = Math.sin(t * 12.9898 + 78.233) * 43758.5453
    return 2 * (x - Math.floor(x)) - 1
  }

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

  // ADSR envelope.
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
      if (dt < a) return dt / a
      if (dt < a + d) return 1 - ((1 - s) * (dt - a)) / d
      return s
    }
    const peak = held(t1)
    return (t) => {
      if (t < t1) return held(t)
      const dt = t - t1
      return dt >= r ? 0 : peak * (1 - dt / r)
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

  // Step sequencer.
  //
  // Monophonic. Voices receive local time. `null` or undefined entries are skipped.
  //
  // Example:
  //   - `seq([voice1, voice2, voice3, voice4], "1/4", tempoBpm(120))` plays each voice for 1/4 at 120bpm.
  //   - `seq([bd, null, null, null], "1/16", tempoBpm(120))` 4-to-the-floor
  const seq = (voices, division, tempo) => {
    const safe = voices.map((v) => v ?? NULL_VOICE)
    const [num, den = 1] = division.split("/").map(Number)
    const stepsPerBeat = den / (4 * num)
    return (t) => {
      const p = tempo.phase(t) * stepsPerBeat
      const idx = Math.floor(p)
      const slot = wrap(idx, safe.length)
      const stepsPerSec = (tempo.value(t) / 60) * stepsPerBeat
      return safe[slot]((p - idx) / stepsPerSec)
    }
  }

  // Polyphonic step sequencer.
  //
  // Like `seq`, but up to `maxVoices` are played. The cost is `O(maxVoices)`.
  //
  // NOTE: `maxVoices` is clamped to `voices.length` and the same voice is never evaluated
  //       twice as stateful functions (`delay`, `lpf`, ...) would not work properly.
  const polyseq = (voices, division, tempo, maxVoices = undefined) => {
    const safe = voices.map((v) => v ?? NULL_VOICE)
    const [num, den = 1] = division.split("/").map(Number)
    const stepsPerBeat = den / (4 * num)
    const mv = Math.min(maxVoices ?? safe.length, safe.length)
    const out = alloc()
    return (t) => {
      const p = tempo.phase(t) * stepsPerBeat
      const idx = Math.floor(p)
      const stepsPerSec = (tempo.value(t) / 60) * stepsPerBeat
      let l = 0,
        r = 0
      for (let k = 0; k < mv; k++) {
        const j = idx - k
        if (j < 0) break
        const slot = wrap(j, safe.length)
        const [vl, vr] = safe[slot]((p - j) / stepsPerSec)
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

  // Synths
  // ######
  // Synths have always the form `f(hz, ...) -> t -> [l, r]`

  // Pluck with a short ADSR env.
  const pluck = (hz, f) => {
    const env = adsr({ releaseTime: 0.05, attackSec: 0.005, decaySec: 0.08, sustain: 0.4, releaseSec: 0.18 })
    const out = alloc()
    return (t) => {
      const s = f(t, E(t, hz)) * 0.3 * env(t)
      out[L] = s
      out[R] = s
      return out
    }
  }

  // Pad with a longer ADSR env.
  const pad = (hz, f) => {
    const env = adsr({ releaseTime: 0.6, attackSec: 0.4, decaySec: 0.2, sustain: 0.7, releaseSec: 2.0 })
    const out = alloc()
    return (t) => {
      const s = f(t, E(t, hz)) * 0.25 * env(t)
      out[L] = s
      out[R] = s
      return out
    }
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

  // fm2 is a simple 2-op fm.
  //
  // Uses a sine modulator at `ratio * hz` for the carrier sine signal.
  const fm2 = (hz, opts = {}) => {
    const env = opts.env ?? adsr({ releaseTime: 0.1, attackSec: 0.005, decaySec: 0.15, sustain: 0.5, releaseSec: 0.3 })
    const out = alloc()
    return (t) => {
      const hzNow = E(t, hz)
      const ratio = E(t, opts.ratio ?? 2)
      const modIndex = E(t, opts.modIndex ?? 4)
      const modDecaySec = E(t, opts.modDecaySec ?? 0.3)
      const modAmp = modIndex * Math.exp(-t / modDecaySec)
      const modSig = Math.sin(t * hzNow * ratio * TAU) * modAmp
      const s = Math.sin(t * hzNow * TAU + modSig) * env(t) * 0.3
      out[L] = s
      out[R] = s
      return out
    }
  }

  // Drums
  // #####
  // Drum voices have the form `f(opts) -> t -> [l, r]`.

  // Synthetic kick drum.
  //
  // Sine + triangle blend with a fast exponential pitch sweep from `6*tuneHz` to `tuneHz`.
  // The sweep is integrated analytically so phase stays continuous:
  //   hz(t) = tune + sweep * exp(-t / pitchDecaySec)
  //   phase(t) = tune*t + sweep * pitchDecaySec * (1 - exp(-t/pitchDecaySec))
  const kick = (opts = {}) => {
    const attackSec = opts.attackSec ?? 0.002
    const decaySec = opts.decaySec ?? 0.3
    const tuneHz = opts.tuneHz ?? 50
    const pitchDecaySec = opts.pitchDecaySec ?? 0.05
    const startHz = tuneHz * 6
    const sweep = startHz - tuneHz
    const out = alloc()
    return (t) => {
      if (t <= 0) {
        out[L] = 0
        out[R] = 0
        return out
      }
      const pitchEnv = Math.exp(-t / pitchDecaySec)
      const phase = tuneHz * t + sweep * pitchDecaySec * (1 - pitchEnv)
      const amp = t < attackSec ? t / attackSec : Math.exp(-(t - attackSec) / decaySec)
      const p = phase - Math.floor(phase)
      const triCentered = 1 - 2 * Math.abs(2 * p - 1) // tri in [-1, 1]
      const s = (Math.sin(phase * TAU) * 0.7 + triCentered * 0.3) * amp * 0.55
      out[L] = s
      out[R] = s
      return out
    }
  }

  // Synthetic snare.
  //
  // Tonal sine at `tuneHz` blended with deterministic noise.
  const snare = (opts = {}) => {
    const attackSec = opts.attackSec ?? 0.001
    const decaySec = opts.decaySec ?? 0.18
    const tuneHz = opts.tuneHz ?? 180
    const noiseAmt = opts.noiseAmt ?? 0.7
    const snap = opts.snap ?? 0.35
    const tonalAmt = 1 - noiseAmt
    const out = alloc()
    return (t) => {
      if (t <= 0) {
        out[L] = 0
        out[R] = 0
        return out
      }
      const frame = Math.floor(t * sampleRate)
      const amp = t < attackSec ? t / attackSec : Math.exp(-(t - attackSec) / decaySec)
      const bodyEnv = Math.exp(-t / (decaySec * 0.65))
      const snapEnv = Math.exp(-t / 0.018)
      const whiteL = noise(frame + 17)
      const whiteR = noise(frame + 113)
      const bandL = (whiteL - 0.55 * noise(frame - 7)) * 0.7
      const bandR = (whiteR - 0.55 * noise(frame - 11)) * 0.7
      const body = (sin(t, tuneHz) * 0.7 + sin(t, tuneHz * 1.52) * 0.3) * tonalAmt * bodyEnv
      out[L] = (body + bandL * noiseAmt * amp + whiteL * snap * snapEnv) * 0.34
      out[R] = (body + bandR * noiseAmt * amp + whiteR * snap * snapEnv) * 0.34
      return out
    }
  }

  // Synthetic Hihat.
  //
  // Deterministic noise + a high sine shimmer.
  //`open: true` switches to a long decay for the open variant; closed is a 50 ms tick.
  const hihat = (opts = {}) => {
    const open = opts.open ?? false
    const attackSec = opts.attackSec ?? 0.001
    const decaySec = opts.decaySec ?? (open ? 0.35 : 0.05)
    const shimmerHz = opts.shimmerHz ?? 7000
    const tone = opts.tone ?? 0.18
    const out = alloc()
    return (t) => {
      if (t <= 0) {
        out[L] = 0
        out[R] = 0
        return out
      }
      const frame = Math.floor(t * sampleRate)
      const amp = t < attackSec ? t / attackSec : Math.exp(-(t - attackSec) / decaySec)
      const n0 = noise(frame + 31)
      const n1 = noise(frame - 5)
      const n2 = noise(frame - 19)
      const bright = n0 - 0.62 * n1 + 0.28 * n2
      const metal = (square(t, shimmerHz) + square(t, shimmerHz * 1.342) + square(t, shimmerHz * 1.731)) / 3
      const s = (bright * (1 - tone) + metal * tone) * amp * 0.16
      out[L] = s
      out[R] = s * 0.92 + bright * amp * 0.012
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

    // synths
    pluck,
    pad,
    iacid,
    ikarplus,
    fm2,

    // drums
    kick,
    snare,
    hihat,
  }
})()

const A = Æ

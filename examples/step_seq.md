```js
const TAU = 2 * Math.PI
let sin = (t, hz) => Math.sin(t * hz * TAU)
let semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
let pitch = (name) => {
  const m = name.match(/^([A-Ga-g])([#b]?)-?(\d+)$/)
  const off = semitones[m[1].toUpperCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0)
  return 440 * Math.pow(2, (12 * (parseInt(m[3], 10) + 1) + off - 69) / 12)
}
let adsr = ({
  triggerTime: t0 = 0,
  releaseTime: tR = Infinity,
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
  const peak = held(tR)
  return (t) => {
    if (t < tR) return held(t)
    const dtR = t - tR
    return dtR >= r ? 0 : peak * (1 - dtR / r)
  }
}
let seq = (voices, stepSec) => (t) => {
  const idx = Math.floor(t / stepSec)
  const slot = ((idx % voices.length) + voices.length) % voices.length
  return voices[slot](t - idx * stepSec)
}

let pluck = (hz) => {
  const env = adsr({ releaseTime: 0.05, attackSec: 0.005, decaySec: 0.08, sustain: 0.4, releaseSec: 0.18 })
  return (t) => {
    const a = sin(t, hz) * 0.3 * env(t)
    return [a, a]
  }
}

seq([pluck(pitch("A4")), pluck(pitch("C#5")), pluck(pitch("E5")), pluck(pitch("A5"))], 0.25)
```

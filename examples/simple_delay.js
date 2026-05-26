const osc = (t, hz) => Math.sin(t * hz * 2 * Math.PI)   // a simple sine oscillator
const pluck = (t) => Math.exp(-5 * (t % 1))             // a 1Hz repeating pluck envelope

(t, depth = 0) => {
  if (t < 0 || depth > 7) return [0, 0]                 // guarding against explosion
  const dry = osc(t, 220) * pluck(t) * 0.2              // producing a dry signal
  const [wetL,] = $(t - 0.124, depth + 1)               // jumping back in time by 124ms
  const [,wetR] = $(t - 0.126, depth + 1)               // jumping back in time by 126ms
  return [dry + 0.8 * wetL, dry + 0.8 * wetR]           // producing the final output signal
}
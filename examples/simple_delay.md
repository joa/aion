```js
const TAU = 2 * Math.PI
let sin = (t, hz) => Math.sin(t * hz * TAU)

(t) => {
  if (t < 0) return [0, 0]
  const dry = sin(t, 220) * 0.2
  const [el, er] = $(t - 0.25)
  return [dry + 0.5 * el, dry + 0.5 * er]
}
```

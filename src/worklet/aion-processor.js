class AionProcessor extends AudioWorkletProcessor {
  #fn = () => [0, 0]
  #frame = 0
  #self

  constructor() {
    super()
    this.#self = (...args) => this.#fn(...args) // $ in user code is bound to #self so we even survive recompiles
    this.port.onmessage = (e) => this.#onMessage(e.data)
  }

  #onMessage({ type, code }) {
    if (type === "reset") {
      this.#frame = 0
      return
    }
    if (type !== "compile") return
    try {
      const fixedCode = code.replace(/\n\s*\n(\s*)([([])/g, "\n\n$1;$2") // prepend a defensive ; to ( or [ to dodge ASI for blank lines
      const ctor = new Function("$", "sampleRate", `return eval(${JSON.stringify(fixedCode)})`)
      const fn = ctor(this.#self, sampleRate)
      if (typeof fn !== "function") {
        // TODO(joa): add support for `{ foo: (t) => .., _ignored: (t) => .., bar: (t) => .. }`
        throw new TypeError("code must evaluate to a function")
      }
      this.#fn = fn
      this.port.postMessage({ type: "compiled" })
    } catch (err) {
      this.port.postMessage({ type: "error", message: String(err) })
    }
  }

  process(inputs, outputs) {
    const out = outputs[0]
    const left = out[0]
    const right = out[1] ?? out[0]
    const sr = sampleRate
    for (let i = 0; i < left.length; i++) {
      ;[left[i], right[i]] = this.#fn(this.#frame++ / sr)
    }
    return true
  }
}

registerProcessor("aion", AionProcessor)

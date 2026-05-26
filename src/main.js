import AionHost from "./aion-host"
import AionStd from "./aion-std.js?raw"

import "./style.css"

const exampleModules = import.meta.glob("../examples/*.js", { query: "?raw", import: "default", eager: true })

const pad = (v, d = 10) => v < d ? "0" :""
const format = (t) => {
  const min = (t / 60)|0
  const sec = (t % 60)|0
  const ms = Math.floor((t - (t|0))*1000)
  return `${pad(min)+min}:${pad(sec)+sec}.${pad(ms,100)+pad(ms)+ms}`
}

const codeEl = document.getElementById("code")
const statusEl = document.getElementById("status")
const exampleEl = document.getElementById("example")
const startBtn = document.getElementById("start")
const stopBtn = document.getElementById("stop")
const applyBtn = document.getElementById("apply")

const examples = Object.entries(exampleModules)
  .map(([path, code]) => ({
    name: path.split("/").pop(),
    code,
  }))
  .sort((a, b) => (a.name === "default.js" ? -1 : b.name === "default.js" ? 1 : a.name.localeCompare(b.name)))

const setStatus = (text, kind = "info") => {
  statusEl.textContent = text
  statusEl.dataset.kind = kind
}

const host = new AionHost({
  stdlib: AionStd,
  onError: (msg) => setStatus(`error: ${msg}`, "error"),
  onCompiled: () => setStatus(host.state === "running" ? "running" : "ready", "ok"),
  onTime: (t) => setStatus((host.state === "running" ? "running" : "ready")+" "+format(t), "ok"),
})

for (const example of examples) {
  const option = document.createElement("option")
  option.value = example.name
  option.textContent = example.name
  exampleEl.append(option)
}

const loadExample = (name) => {
  const example = examples.find((item) => item.name === name) ?? examples[0]
  if (!example) return
  exampleEl.value = example.name
  codeEl.value = example.code.trim()
  setStatus(`loaded ${example.name}`, "info")
}

loadExample("default.js")

exampleEl.addEventListener("change", () => loadExample(exampleEl.value))

startBtn.addEventListener("click", async () => {
  try {
    await host.start(codeEl.value)
    setStatus("running", "ok")
  } catch (err) {
    setStatus(String(err), "error")
  }
})

stopBtn.addEventListener("click", async () => {
  await host.stop()
  setStatus("stopped", "info")
})

applyBtn.addEventListener("click", () => host.apply(codeEl.value))

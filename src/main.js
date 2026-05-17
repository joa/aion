import AionHost from "./aion-host"
import AionStd from "./aion-std.js?raw"

import "./style.css"

const codeEl = document.getElementById("code")
const statusEl = document.getElementById("status")
const startBtn = document.getElementById("start")
const stopBtn = document.getElementById("stop")
const applyBtn = document.getElementById("apply")

const setStatus = (text, kind = "info") => {
  statusEl.textContent = text
  statusEl.dataset.kind = kind
}

const host = new AionHost({
  stdlib: AionStd,
  onError: (msg) => setStatus(`compile error: ${msg}`, "error"),
  onCompiled: () => setStatus(host.state === "running" ? "running" : "ready", "ok"),
})

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

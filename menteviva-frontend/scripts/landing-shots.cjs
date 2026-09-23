// Capturas de la landing a pantalla completa, por tramos de un viewport.
// Uso (con `npm run dev` corriendo):
//   npm run shots -- ../docs/checkpoint-landing-fase2
//   SHOTS_GPU=1 npm run shots -- <dir>   -> GPU real en vez de SwiftShader
//   SHOTS_URL=http://localhost:5173/?debug=brain npm run shots -- <dir>
const fs = require("fs")
const { chromium } = require("playwright")

const out = process.argv[2]
if (!out) {
  console.error("Falta la carpeta destino: npm run shots -- <dir>")
  process.exit(1)
}
fs.mkdirSync(out, { recursive: true })
const url = process.env.SHOTS_URL || "http://localhost:5173/"
const args = process.env.SHOTS_GPU
  ? ["--enable-gpu", "--ignore-gpu-blocklist"]
  : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]

;(async () => {
  const b = await chromium.launch({ args })
  for (const [name, w, h] of [["desk", 1440, 900], ["mob", 390, 844]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } })
    await p.goto(url, { waitUntil: "networkidle" })
    await p.waitForTimeout(4000)
    const H = await p.evaluate(() => document.body.scrollHeight)
    let i = 0
    for (let y = 0; y < H; y += h) {
      await p.evaluate((y) => window.scrollTo(0, y), y)
      await p.waitForTimeout(1500)
      await p.screenshot({ path: `${out}/${name}_${String(i++).padStart(2, "0")}.png` })
    }
    console.log(name, "H=", H, "shots=", i)
  }
  await b.close()
})()

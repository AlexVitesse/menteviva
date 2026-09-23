const { chromium } = require("C:/Users/pcdec/OneDrive/Documentos/Mente Viva/menteviva-frontend/node_modules/playwright");
(async () => {
  const b = await chromium.launch({ args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
  for (const [name, w, h] of [["desk", 1440, 900], ["mob", 390, 844]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errs = [];
    p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto("http://127.0.0.1:8765/local.html", { waitUntil: "networkidle" });
    await p.waitForTimeout(4500);
    const H = await p.evaluate(() => document.body.scrollHeight);
    const stops = name === "desk" ? [0, 0.14, 0.27, 0.40, 0.53, 0.70, 0.86, 1] : [0, 0.3, 0.55, 1];
    let i = 0;
    for (const f of stops) {
      await p.evaluate((y) => window.scrollTo(0, y), Math.max(0, (H - h) * f));
      await p.waitForTimeout(2200);
      await p.screenshot({ path: `${name}_${String(i++).padStart(2, "0")}.png` });
    }
    console.log(name, "H=", H, "errors:", errs.slice(0, 5));
    await p.close();
  }
  await b.close();
})();

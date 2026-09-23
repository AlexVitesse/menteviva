# Prototipo: el cerebro como ambiente (2026-09-23)

`index.html` es la pagina que se publico como artifact para que Eric la viera (el artifact ya se borro a su pedido;
la version en React vive en `menteviva-frontend/src/components/landing/`).
Para correrla local: copiar `menteviva-frontend/public/models/brain.glb` a `models/` y generar
`models/brain.js` (`window.BRAIN_B64 = "<base64 del glb>"`), luego servir la carpeta con
`python -m http.server` y abrirla envuelta en `<!doctype html><html><head>...</head><body>`.
`shots.cjs` toma capturas (desk 1440x900, mob 390x844) con la GPU real via Playwright.
Las capturas `desk_*.png` / `mob_*.png` son de la primera pasada (antes de bajar reflejo e intensidad).
Plan: `docs/plans/21_landing_cerebro_ambiente.md`.

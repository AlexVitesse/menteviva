# 2026-08-18 — La landing usa el cerebro 3D de `thebuggeddev/anatomy`

## Que cambio

`components/landing/brain-scene.tsx` dejaba de generar el cerebro proceduralmente
(icosfera de 40k vertices + simplex noise) y ahora carga un modelo real:

- **Nuevo**: `public/models/brain.glb` (2.5 MB) — mesh de 377k triangulos,
  `EXT_meshopt_compression` + `KHR_mesh_quantization` + texturas WebP
  (baseColor, normal, metallicRoughness).
- `useGLTF` de drei enchufa el `MeshoptDecoder` por defecto: no hizo falta
  configurar loaders ni copiar decodificadores a `public/`.
- El glb se centra y se normaliza a 2.4 unidades en runtime (`THREE.Box3`), asi el
  aura (radio 2.6) y las particulas de la escena siguen encajando sin retocar nada.
- **Borrado**: `useBrainGeometry` (~50 lineas de ruido), el overlay de wireframe
  (existia para marcar los pliegues de la esfera; el mesh ya los trae, y evitamos
  un segundo draw de 377k triangulos) y `BrainStem` (el cilindro + esfera que
  simulaban tronco y cerebelo: el modelo los incluye). 277 -> 185 lineas.
- `<Suspense>` alrededor del cerebro dentro del `<Canvas>`: aura y particulas se
  ven mientras el glb descarga.

## Procedencia del asset

El modelo se tomo de `https://github.com/thebuggeddev/anatomy`
(`public/models/brain.glb`). **Ese repositorio no tiene LICENSE**, asi que por
defecto son todos los derechos reservados; se advirtio y **el usuario decidio
usarlo igual**. El mesh esta generado con Tripo AI (el nodo se llama
`tripo_node_938185c2-…`), no es un asset medico curado.

Si mas adelante hace falta limpiar la procedencia: generar uno equivalente con
Tripo/Meshy o bajar uno CC0 del NIH 3D Print Exchange, decimarlo a ~50k triangulos
y sustituir el archivo — el codigo no cambia, solo `public/models/brain.glb`.

## Verificacion

- `npm run build` (tsc + vite) OK. El chunk `brain-scene` baja a 2.8 kB.
- Screenshot con Playwright (chromium + swiftshader) contra `vite preview`: el
  cerebro renderiza en la landing, con pliegues y tronco visibles.
- Una sola peticion a `/models/brain.glb` (el `useGLTF.preload` no duplica la
  descarga).

## Pendiente / dials

- El modelo trae sus texturas propias (tono rosado-marron). Sobre el fondo `#08071A`
  y las luces violeta/teal se ve organico pero no "de marca"; teñirlo de violeta es
  cambiar el material en `Brain()` (una linea).
- 2.5 MB extra en la landing. Se descarga lazy (la escena ya iba en un chunk aparte)
  pero cuenta en movil.

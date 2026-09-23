// Guion del cerebro por acto (plan 21). Es la perilla de calibracion: se
// ajustan numeros, no codigo. El cerebro esta fijo en el origen (diametro 2.4)
// y lo que se mueve es la CAMARA: eso da los primeros planos. ANCHORS vive en
// el espacio del cerebro normalizado; se leen con ?debug=brain.

export type Zone = "amygdala" | "pfc" | "broca" | "temporal" | "parietal"

// En este modelo el frente del cerebro apunta a -x y el lado visible en el
// acto 1 es +z.
export const ANCHORS: Record<Zone, [number, number, number]> = {
  amygdala: [-0.35, -0.3, 0.35],
  pfc: [-0.95, 0.3, 0.2],
  broca: [-0.6, 0.0, 0.6],
  temporal: [0.05, -0.35, 0.6],
  parietal: [0.35, 0.65, 0.3],
}

export type ActState = {
  cam: [number, number, number]
  look: [number, number, number]
  rot: number
  fresnel: number // 0-1
  synapses: number // 0-1 opacidad de los puntos
  bloom: number // strength del UnrealBloomPass
  zones: Partial<Record<Zone, [color: string, intensity: number]>>
  // Derrame de luz sobre la pagina: que punto se proyecta y con que color.
  bleed: [where: Zone | "center", color: string]
}

const V = "#A855F7"
const T = "#22D3EE"
const R = "#EF4444"

export const ACTS: Record<number, ActState> = {
  1: { cam: [0, -0.45, 3.1], look: [0, -0.45, 0], rot: 0.0, fresnel: 1.0, synapses: 1.0, bloom: 0.75,
       zones: {}, bleed: ["center", "rgba(124,58,237,0.30)"] },
  2: { cam: [-1.4, 0.1, 5.2], look: [-1.4, 0, 0], rot: 0.6, fresnel: 0.35, synapses: 0.15, bloom: 0.5,
       zones: {}, bleed: ["center", "rgba(124,58,237,0.16)"] },
  // Primer plano: la camara se acerca a la amigdala; la corteza llena la pantalla.
  3: { cam: [-0.3, -0.3, 2.5], look: [0.3, -0.3, 0], rot: -0.5, fresnel: 0.55, synapses: 0.25, bloom: 0.8,
       zones: { amygdala: [R, 1.5] }, bleed: ["amygdala", "rgba(220,38,38,0.16)"] },
  // El cerebro gira para dar la cara: el lobulo frontal se enciende en teal.
  4: { cam: [-0.2, 0.2, 2.9], look: [0.35, 0.15, 0], rot: 0.9, fresnel: 0.65, synapses: 0.6, bloom: 0.8,
       zones: { amygdala: [R, 0.4], pfc: [T, 1.5] }, bleed: ["pfc", "rgba(6,182,212,0.16)"] },
  // Colores de marca hasta tener puntajes reales; entonces, semaforo por habilidad.
  5: { cam: [-1.3, 0.05, 4.3], look: [-1.3, 0, 0], rot: 0.4, fresnel: 0.55, synapses: 0.5, bloom: 0.9,
       zones: { pfc: [V, 1.1], broca: [T, 1.1], amygdala: [R, 0.9], temporal: [T, 1.1] },
       bleed: ["center", "rgba(124,58,237,0.22)"] },
  6: { cam: [0, -1.1, 7.5], look: [0, -1.1, 0], rot: 0.8, fresnel: 0.25, synapses: 0.15, bloom: 0.45,
       zones: {}, bleed: ["center", "rgba(124,58,237,0.14)"] },
  7: { cam: [0, -1.1, 7.5], look: [0, -1.1, 0], rot: 1.1, fresnel: 0.25, synapses: 0.15, bloom: 0.45,
       zones: {}, bleed: ["center", "rgba(124,58,237,0.14)"] },
  8: { cam: [0, -0.4, 3.4], look: [0, -0.4, 0], rot: 1.5, fresnel: 1.0, synapses: 1.0, bloom: 0.95,
       zones: { amygdala: [V, 0.8], pfc: [T, 1.1], broca: [V, 0.8], parietal: [T, 0.8] },
       bleed: ["center", "rgba(124,58,237,0.26)"] },
}

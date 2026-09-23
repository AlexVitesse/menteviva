import { useEffect } from "react"
import { ACTS, ANCHORS, type ActState, type Zone } from "./acts"

export const isBrainDebug = () =>
  new URLSearchParams(window.location.search).get("debug") === "brain"

// Golpe extra de luz por zona (late con cada linea del guion); decae en useFrame.
export const kicks: Partial<Record<Zone, number>> = {}

// Pose objetivo interpolada entre el acto que se va y el que llega. Objeto
// mutable de modulo: useFrame lo lee cada frame sin re-render de React.
export const pose: ActState = {
  cam: [...ACTS[1].cam],
  look: [...ACTS[1].look],
  rot: ACTS[1].rot,
  fresnel: ACTS[1].fresnel,
  synapses: ACTS[1].synapses,
  bloom: ACTS[1].bloom,
  zones: {},
  bleed: ACTS[1].bleed,
}

let sections: HTMLElement[] = []
let centers: number[] = []

export function measureActs() {
  sections = Array.from(document.querySelectorAll<HTMLElement>("[data-act]"))
  centers = sections.map((s) => s.offsetTop + s.offsetHeight / 2)
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const ZONE_IDS = Object.keys(ANCHORS) as Zone[]

/**
 * Escribe en `pose` la interpolacion continua por scroll: el centro de la
 * pantalla entre los centros de dos secciones da `t`. En movil (aspect < 1)
 * el cerebro vive arriba y mas lejos; el texto va debajo.
 */
export function samplePose(aspect: number) {
  if (!sections.length) return
  const sc = window.scrollY + window.innerHeight / 2
  let i = 0
  while (i < centers.length - 1 && sc > centers[i + 1]) i++
  const A = ACTS[Number(sections[i].dataset.act)] ?? ACTS[1]
  const B = ACTS[Number(sections[Math.min(i + 1, sections.length - 1)].dataset.act)] ?? A
  const span = Math.max(1, (centers[i + 1] ?? centers[i] + 1) - centers[i])
  const t = i === centers.length - 1 ? 0 : smooth(Math.min(1, Math.max(0, (sc - centers[i]) / span)))

  for (let k = 0; k < 3; k++) {
    pose.cam[k] = lerp(A.cam[k], B.cam[k], t)
    pose.look[k] = lerp(A.look[k], B.look[k], t)
  }
  if (aspect < 1) {
    // Centrado en x (el desplazamiento lateral es para el texto de escritorio).
    pose.look[0] *= 0.25
    pose.cam[0] *= 0.25
    pose.look[1] -= 0.85
    for (let k = 0; k < 3; k++) pose.cam[k] = pose.look[k] + (pose.cam[k] - pose.look[k]) * 1.75
    pose.cam[1] -= 0.85
  }
  pose.rot = lerp(A.rot, B.rot, t)
  pose.fresnel = lerp(A.fresnel, B.fresnel, t)
  pose.synapses = lerp(A.synapses, B.synapses, t)
  pose.bloom = lerp(A.bloom, B.bloom, t)
  for (const id of ZONE_IDS) {
    const za = A.zones[id]
    const zb = B.zones[id]
    const color = (t < 0.5 ? za ?? zb : zb ?? za)?.[0] ?? "#000000"
    pose.zones[id] = [color, lerp(za?.[1] ?? 0, zb?.[1] ?? 0, t)]
  }
  pose.bleed = t < 0.5 ? A.bleed : B.bleed
}

/**
 * Mide las secciones y marca `.in` cuando cruzan la banda central (revelado
 * de lineas). Si la seccion trae `data-kick`, cada linea que aparece hace
 * latir esa zona.
 */
export function useActObserver() {
  useEffect(() => {
    const debug = isBrainDebug()
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    measureActs()
    const timers = [setTimeout(measureActs, 800), setTimeout(measureActs, 3000)]
    window.addEventListener("resize", measureActs)

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const el = e.target as HTMLElement
          el.classList.add("in")
          if (debug) console.log("[brain] acto", el.dataset.act)
          const zone = el.dataset.kick as Zone | undefined
          if (zone && !reduce && !el.dataset.kicked) {
            el.dataset.kicked = "1"
            el.querySelectorAll(".lp-r").forEach((_, i) =>
              timers.push(setTimeout(() => { kicks[zone] = 1.6 }, 550 * i + 150))
            )
          }
        }
      },
      { rootMargin: "-20% 0px -20% 0px" }
    )
    document.querySelectorAll("[data-act]").forEach((el) => io.observe(el))
    return () => {
      io.disconnect()
      timers.forEach(clearTimeout)
      window.removeEventListener("resize", measureActs)
    }
  }, [])
}

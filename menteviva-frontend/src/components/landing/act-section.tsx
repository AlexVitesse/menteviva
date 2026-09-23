import type { ReactNode } from "react"
import type { Zone } from "./acts"

type Side = "left" | "right" | "center"

const COLUMN: Record<Side, string> = {
  left: "lg:mr-auto",
  right: "lg:ml-auto",
  center: "lg:mx-auto lg:text-center",
}

// Velo detras del texto: en los primeros planos la corteza llena la pantalla y
// el texto necesita suelo. En escritorio sale del lado del texto (62 % del
// ancho); en movil el texto va debajo del cerebro y el velo sube desde abajo.
const VEIL: Record<Side, string> = {
  left: "lg:inset-y-0 lg:left-0 lg:right-auto lg:top-0 lg:w-[62%] lg:bg-gradient-to-r lg:from-ink/95 lg:via-ink/60 lg:to-transparent",
  right: "lg:inset-y-0 lg:right-0 lg:left-auto lg:top-0 lg:w-[62%] lg:bg-gradient-to-l lg:from-ink/95 lg:via-ink/60 lg:to-transparent",
  center: "lg:hidden",
}

/**
 * Un "acto" de la landing: la camara (ver acts.ts) toma la pose de ACTS[act]
 * mientras esta seccion cruza el centro de la pantalla. `side` es donde va el
 * texto; el cerebro se para del lado contrario. `kick` hace latir esa zona con
 * cada linea `.lp-r` que aparece.
 */
export function ActSection({
  act,
  id,
  side,
  kick,
  children,
}: {
  act: number
  id?: string
  side: Side
  kick?: Zone
  children: ReactNode
}) {
  return (
    <section
      data-act={act}
      data-kick={kick}
      id={id}
      className="relative flex min-h-[100svh] items-center px-4 pb-16 pt-[44svh] sm:px-6 lg:px-8 lg:py-24"
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 bottom-0 top-[30svh] bg-gradient-to-t from-ink via-ink/85 to-transparent ${VEIL[side]}`}
      />
      <div className="relative mx-auto w-full max-w-6xl">
        <div className={`max-w-2xl lg:w-1/2 ${COLUMN[side]}`}>{children}</div>
      </div>
    </section>
  )
}

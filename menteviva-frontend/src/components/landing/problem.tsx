import { ActSection } from "./act-section"

// Acto 2. Borrador de copy para que Brandon lo corrija.
export function Problem() {
  return (
    <ActSection act={2} side="left">
      <h2 className="lp-h2">
        Los talleres enseñan qué decir. Nadie practica decirlo.
      </h2>
      <div className="mt-10 grid gap-6 border-l-2 border-cream/20 pl-6 sm:grid-cols-2">
        <p className="lp-body">Un curso se ve. Un roleplay con un colega no mide.</p>
        <p className="lp-body">
          Cuando llega el cliente real, es la primera vez.
        </p>
      </div>
    </ActSection>
  )
}

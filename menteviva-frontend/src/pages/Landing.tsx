import { lazy, Suspense } from "react";
import { Navbar } from "../components/landing/navbar";
import { Hero } from "../components/landing/hero";
import { Conversations } from "../components/landing/conversations";
import { HowItWorks } from "../components/landing/how-it-works";
import { ForTeams } from "../components/landing/for-teams";
import { Comparison } from "../components/landing/comparison";
import { CTA } from "../components/landing/cta";
import { Footer } from "../components/landing/footer";

// three + drei + el glb de 2.5 MB no bloquean el primer paint del texto.
const BrainScene = lazy(() =>
  import("../components/landing/brain-scene").then((mod) => ({ default: mod.BrainScene }))
);

export function Landing() {
  return (
    <main className="relative min-h-[100dvh] overflow-x-hidden bg-ink">
      <Suspense fallback={null}>
        <BrainScene />
      </Suspense>

      <div className="relative z-10">
        <Navbar />
        <Hero />
        <div id="conversaciones">
          <Conversations />
        </div>
        <div id="como-funciona">
          <HowItWorks />
        </div>
        <div id="para-equipos">
          <ForTeams />
        </div>
        <div id="comparativa">
          <Comparison />
        </div>
        <CTA />
        <Footer />
      </div>
    </main>
  );
}

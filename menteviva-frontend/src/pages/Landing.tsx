import { lazy, Suspense } from "react";
import { Navbar } from "../components/landing/navbar";
import { Hero } from "../components/landing/hero";
import { HowItWorks } from "../components/landing/how-it-works";
import { Features } from "../components/landing/features";
import { Comparison } from "../components/landing/comparison";
import { CTA } from "../components/landing/cta";
import { Footer } from "../components/landing/footer";

// Brain 3D scene (three.js) se carga lazy para no bloquear el primer paint.
const BrainScene = lazy(() =>
  import("../components/landing/brain-scene").then((mod) => ({ default: mod.BrainScene }))
);

export function Landing() {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-ink">
      <Suspense fallback={<div className="fixed inset-0 z-0 bg-ink" />}>
        <BrainScene />
      </Suspense>

      <div className="relative z-10">
        <Navbar />
        <Hero />
        <div id="como-funciona">
          <HowItWorks />
        </div>
        <div id="caracteristicas">
          <Features />
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

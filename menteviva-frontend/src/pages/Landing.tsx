import { Navbar } from "../components/landing/navbar";
import { Hero } from "../components/landing/hero";
import { HowItWorks } from "../components/landing/how-it-works";
import { ForTeams } from "../components/landing/for-teams";
import { Features } from "../components/landing/features";
import { Comparison } from "../components/landing/comparison";
import { CTA } from "../components/landing/cta";
import { Footer } from "../components/landing/footer";

export function Landing() {
  return (
    <main className="relative min-h-[100dvh] overflow-x-hidden bg-ink">
      <Navbar />
      <Hero />
      <div id="como-funciona">
        <HowItWorks />
      </div>
      <div id="para-equipos">
        <ForTeams />
      </div>
      <div id="caracteristicas">
        <Features />
      </div>
      <div id="comparativa">
        <Comparison />
      </div>
      <CTA />
      <Footer />
    </main>
  );
}

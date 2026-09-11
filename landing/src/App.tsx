import { ScrollProgress } from "@/components/ScrollProgress";
import { Nav } from "@/sections/Nav";
import { Hero } from "@/sections/Hero";
import { CapabilityBar } from "@/sections/CapabilityBar";
import { Stats } from "@/sections/Stats";
import { Problem } from "@/sections/Problem";
import { Features } from "@/sections/Features";
import { CanvasShowcase } from "@/sections/CanvasShowcase";
import { TaskEngine } from "@/sections/TaskEngine";
import { HowItWorks } from "@/sections/HowItWorks";
import { Security } from "@/sections/Security";
import { Pricing } from "@/sections/Pricing";
import { Testimonials } from "@/sections/Testimonials";
import { FAQ } from "@/sections/FAQ";
import { CTA } from "@/sections/CTA";
import { Footer } from "@/sections/Footer";

export function App() {
  return (
    <div className="relative min-h-dvh bg-background">
      <ScrollProgress />
      <Nav />
      <main>
        <Hero />
        <CapabilityBar />
        <Stats />
        <Problem />
        <Features />
        <CanvasShowcase />
        <TaskEngine />
        <HowItWorks />
        <Security />
        <Pricing />
        <Testimonials />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

import { Dock, Nav } from "@/sections/Nav";
import { Hero } from "@/sections/Hero";
import { Problem } from "@/sections/Problem";
import { Features } from "@/sections/Features";
import { LessonFlow } from "@/sections/LessonFlow";
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
      <a href="#main" className="skip-link">К содержимому</a>
      <Nav />
      <Dock />
      <main id="main">
        <Hero />
        <Problem />
        <Features />
        <LessonFlow />
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

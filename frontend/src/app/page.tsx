import ClosingCTA from "@/components/ClosingCTA";
import FinancialControlSection from "@/components/FinancialControlSection";
import FeaturesSection from "@/components/FeaturesSection";
import Footer from "@/components/Footer";
import HeroSection from "@/components/HeroSection";
import HowItWorks from "@/components/HowItWorks";
import Navbar from "@/components/Navbar";
import PayoutTransparencySection from "@/components/PayoutTransparencySection";

export default function Home() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-forest focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-canvas"
      >
        Skip to content
      </a>
      <Navbar />
      <main id="main" className="flex-1">
        <div id="top" />
        <HeroSection />
        <HowItWorks />
        <FinancialControlSection />
        <PayoutTransparencySection />
        <FeaturesSection />
        <ClosingCTA />
      </main>
      <Footer />
    </>
  );
}

import { AcrossTraditions } from "@/components/concord/AcrossTraditions";
import { ConcordProvider } from "@/components/concord/config";

/**
 * Demo study shell. In PassageLab, "Across Traditions" is a tab alongside
 * the existing study tabs (spec §11), available on Free.
 *
 * NEXT_PUBLIC_CONCORD_STATIC=1 (the GitHub Pages build) runs the whole
 * pipeline in the visitor's browser - no server, no keys, no cost.
 */
const isStaticBuild = process.env.NEXT_PUBLIC_CONCORD_STATIC === "1";

export default function StudyPage() {
  return (
    <main className="shell">
      <header className="study-header">
        <h1>Across Traditions</h1>
        <p className="passage">Romans 3:21&ndash;26 &middot; PassageLab study</p>
      </header>

      <div className="tabs">
        <button className="tab" disabled>
          Study
        </button>
        <button className="tab" disabled>
          Notes
        </button>
        <button className="tab active">Across Traditions</button>
      </div>

      <ConcordProvider engine={isStaticBuild ? "client" : "server"}>
        <AcrossTraditions initialQuery="What do the traditions teach about justification in Romans 3:21-26?" />
      </ConcordProvider>

      <p className="footer-note">
        Every statement Concord makes is traceable to a source you can open and read
        yourself. When it doesn&apos;t know, it says so.
      </p>
    </main>
  );
}

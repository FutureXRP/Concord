import { ConcordProvider } from "@/components/concord/config";
import { DemoShell } from "@/components/concord/DemoShell";

/**
 * Demo shell for the four free layers Concord contributes to PassageLab:
 *
 *   Across Traditions — sourced comparative answers (spec §11)
 *   Find a passage    — deterministic discovery over all 31,102 KJV verses
 *   Places & Art      — the biblical atlas + Doré engravings
 *   Memorize          — SM-2 spaced-repetition scripture memorization
 *
 * NEXT_PUBLIC_CONCORD_STATIC=1 (the GitHub Pages build) runs the whole
 * pipeline in the visitor's browser - no server, no keys, no cost.
 */
const isStaticBuild = process.env.NEXT_PUBLIC_CONCORD_STATIC === "1";

export default function StudyPage() {
  return (
    <main className="shell">
      <header className="study-header">
        <h1>Concord</h1>
        <p className="passage">
          The Comparative Traditions Layer &middot; every claim traceable to a source
        </p>
      </header>

      <ConcordProvider engine={isStaticBuild ? "client" : "server"}>
        <DemoShell initialQuery="What do the traditions teach about justification in Romans 3:21-26?" />
      </ConcordProvider>

      <p className="footer-note">
        Every statement Concord makes is traceable to a source you can open and read
        yourself. When it doesn&apos;t know, it says so.
      </p>
    </main>
  );
}

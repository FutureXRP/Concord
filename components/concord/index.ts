/**
 * Public embedding surface for host apps (PassageLab).
 *
 *   import { ConcordProvider, AcrossTraditions } from ".../components/concord";
 *
 *   <ConcordProvider apiBaseUrl={CONCORD_URL} translation="niv">
 *     <AcrossTraditions passage="Romans 3:21-26" autoRun />
 *   </ConcordProvider>
 */

export { ConcordProvider, useConcordConfig } from "./config";
export { AcrossTraditions, type AcrossTraditionsProps } from "./AcrossTraditions";
export { CitationChip, chipLabel, type ResolvedSource } from "./CitationChip";
export { SourcePanel } from "./SourcePanel";
export { InsufficiencyNotice } from "./InsufficiencyNotice";

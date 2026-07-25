"use client";

/**
 * Embedding configuration for host apps (PassageLab).
 *
 * Module drop-in (same Next.js app): no config needed - components call
 * /api/concord/* same-origin.
 *
 * Service mode (Concord deployed separately): wrap the tab in
 * <ConcordProvider apiBaseUrl="https://concord.example.app"> and set
 * CONCORD_ALLOWED_ORIGINS on the Concord deployment.
 */

import { createContext, useContext } from "react";

export interface ConcordConfig {
  /** Base URL for the Concord API. Empty string = same origin. */
  apiBaseUrl: string;
  /** Preferred reading translation for scripture chips (Tier C proxied). */
  translation?: string;
}

const ConcordConfigContext = createContext<ConcordConfig>({ apiBaseUrl: "" });

export function ConcordProvider({
  apiBaseUrl = "",
  translation,
  children,
}: Partial<ConcordConfig> & { children: React.ReactNode }) {
  return (
    <ConcordConfigContext.Provider value={{ apiBaseUrl, translation }}>
      {children}
    </ConcordConfigContext.Provider>
  );
}

export function useConcordConfig(): ConcordConfig {
  return useContext(ConcordConfigContext);
}

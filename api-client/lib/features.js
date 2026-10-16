export const FEATURES = {
  cache: false,      // needs GET /cache (404 today) and a real patch-cache
  silentDrift: false, // needs drift-detector (stub today); enables the "silent" filter and badge
  safety: false,     // folded into Drift events (halts). Standalone page only if time remains
  metrics: false,    // benchmark page, Phase 5
};

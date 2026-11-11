/** Latency levels of the realtime transcription model (lower = earlier text, higher = accuracy). */
export const LIVE_DELAYS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type LiveDelay = (typeof LIVE_DELAYS)[number];

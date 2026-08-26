/**
 * Next.js calls this once at server startup.
 *
 * The AI SDK emits no spans at all until a telemetry integration is registered,
 * and says nothing about it — so this runs before any route can reach the
 * model.
 */
export async function register(): Promise<void> {
  const { ensureTelemetry } = await import("./src/config/telemetry");
  if (!ensureTelemetry()) {
    console.warn("[telemetry] AI SDK tracing is NOT on — model calls will be invisible.");
  }
}

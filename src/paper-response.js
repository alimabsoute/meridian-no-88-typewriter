// Damped sheet response in metres. Only the free edge receives this displacement;
// the platen path and UVs remain fixed, so text cannot slip across the sheet.
export function stepPaperResponse(state, { delta, carriageDelta = 0, feedDelta = 0, impact = 0, reducedMotion = false }) {
  if (reducedMotion) return { position: 0, velocity: 0 };
  const dt = Math.max(0, Math.min(1 / 25, Number.isFinite(delta) ? delta : 0));
  let position = Number.isFinite(state.position) ? state.position : 0;
  let velocity = Number.isFinite(state.velocity) ? state.velocity : 0;
  velocity += Math.max(-0.13, Math.min(0.13, carriageDelta * 0.12 + feedDelta * 0.6 + impact * 0.1 * dt * 60));
  // Substeps keep damping stable on slower devices and tab-resume frames.
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    velocity += (-95 * position - 10 * velocity) * h;
    position += velocity * h;
  }
  return { position: Math.max(-0.035, Math.min(0.035, position)), velocity: Math.max(-0.3, Math.min(0.3, velocity)) };
}

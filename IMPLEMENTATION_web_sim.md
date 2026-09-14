# HZD Browser Comparison

Approved scope: replace the fixed-base arm demo with two independent full-body G1 simulations, Teacher and HZD-Tube. Shared five-command controls, synchronized play/pause/reset, matched world-frame torso pushes, measured motion readouts. Hardware footage remains separate. No recording pipeline or robot deployment changes.

## Implementation

- [x] Package the current WBO5 deployment bundles and the native sim2sim scene. Preserve physical parameters, ONNX files, command order, model provenance and 29-joint mapping. Test against native observation/action fixtures.
- [x] Implement 102-input observation construction and 200 Hz physics / 50 Hz inference using MuJoCo WASM and ONNX Runtime Web. Test phase at rest, changing T, joint ordering and PD torque limits.
- [x] Build two unframed Three.js viewports using actual G1 meshes, shared command controls and world-frame force pulses. Keep heavy assets lazy-loaded and clean up resources on exit/failure.
- [x] Replace the old public FADA experiment content with an HZD page using the paper title, abstract and framework. Do not fabricate authors, results, hardware videos or acceptance status.
- [x] Verify typecheck/build, native versus browser inference, moving/nonblank canvas checks and Playwright desktop/mobile interaction. Start a local preview and document policy versions and browser limitations.

## Verification (2026-09-14)

- Asset unittest: passed. Observation/phase/PD tests: 5 passed.
- Typecheck and production build: passed. npm audit: 0 vulnerabilities.
- Python CPU ORT versus browser WASM: maximum observation difference 0, maximum action difference 6.08e-6 across both policies and three state/command fixtures.
- Independent 10 s forward rollouts: neither world fell. Reset and force expiration checked.
- Playwright desktop 1440x1100 and mobile-width 390x844: launch, pause, shared reset/stop, push, no horizontal overflow, nonblank robot pixels checked.
- Injected tube download failure: Retry recreated canvas contexts and successfully reloaded both worlds. Command input edits checked.
- Production preview: http://localhost:4176/ . Heavy runtime is loaded only after Launch, without cross-origin isolation headers.
- Engine versions are not identical to native C++ deployment. README explains the distinction. No claim of bitwise trajectory equivalence or comprehensive robustness testing.

## Boundaries

Only files under this website are changed. Model preparation reads existing deployment assets without modifying them. Browser simulations are genuine physics, not animation or prerecorded video. Both worlds advance identical numbers of fixed steps. Slow devices may run below real time rather than altering the physical timestep. Falls remain visible and are never silently reset. WBO preprocessing is already inside ONNX and must not be applied twice. No display smoothing that conceals policy jitter.

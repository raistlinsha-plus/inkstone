# Contributing

Inkstone is an Apache-2.0 source preview for macOS 13+ on Apple Silicon. Windows, Linux and Intel Mac have not been accepted as supported targets. The v0.7 candidate includes optional companions with static candidate artwork; the separate design prototype is not production acceptance evidence.

Use Node 24.14.0, npm 11.9.0, Rust 1.99.1 and Apple's command-line developer tools. Install with `npm ci`, then run `npm run desktop`. `npm run verify` runs the complete local gates; `npm run verify:changed` is scoped feedback and cannot substitute for final integration. `npm run bundle` produces a locally ad-hoc signed app, not a notarized distribution.

Use one behavior or one mechanical module extraction per change. Keep document identity, space boundaries, conflict handling, source hashes, citations and recovery protections intact. Add focused regressions for data-loss, identity, concurrency and evidence-policy changes. Do not lower quality targets after seeing evaluation results.

Use synthetic text and a temporary directory in tests. The default gate must not read production credentials, send document content to models, or enable `desktop-e2e` in a production app. Real API evaluation requires explicit transient environment variables and incurs provider usage; see [the evaluation guide](evals/v0.6.6/README.md).

Do not commit keys, passwords, `.env` files, application data, personal documents or unredacted logs/screenshots. If a dependency changes, regenerate and review the third-party notices with `npm run licenses`. Preserve applicable upstream notices and licenses, including MPL-2.0 transitive packages; do not describe every dependency as MIT.

Before a pull request, run the complete gate, describe the trigger and resulting behavior, and include relevant validation and remaining limits. Native IME, VoiceOver, real model quality and cross-machine acceptance must be reported separately from simulated events or process startup probes.

In a public snapshot, normal CI checks documentation links and permits source edits. `node scripts/check-public-docs.mjs --integrity` verifies the untouched original delivery; a legitimate code edit is expected to change that original fingerprint. It is not a requirement to retain the original archive hash in every pull request.

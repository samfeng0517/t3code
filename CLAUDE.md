@AGENTS.md

## This fork

- Do not change `apps/mobile`. This fork ships no mobile build; its users connect with the official T3 Code mobile app. This overrides the mobile entries under "Hit every surface" in AGENTS.md, so a new feature may be web and desktop only.
- Keep the server compatible with the official app. Wire changes in `packages/contracts` stay additive: new fields are optional, and no RPC method, field, or enum value the app sends or reads is renamed or removed.
- When a change in a shared package (`packages/client-runtime`, `packages/shared`, `packages/contracts`) breaks the mobile typecheck, make the smallest fix that keeps it green; do not extend the feature to mobile.

# Slotly documentation update

This package contains the revised agent guide and the detailed, on-demand reference documents.

## Apply to the project

Copy these files into the project root / `docs` folder:

- Replace root `AGENTS.md` with this package's `AGENTS.md`.
- Replace `docs/UI_DESIGN.md` with this package's `docs/UI_DESIGN.md`.
- Add `docs/DATABASE.md`, `docs/API.md`, and `docs/TESTING.md`.

The old `SLOTLY_AGENT_AND_PLAN.md` name is no longer used. The new OpenCode prompt refers to `AGENTS.md` correctly. If an old duplicate exists in the repository, archive/remove it after confirming nothing else depends on it.

## Scope of this update

- Documentation and static Figma design references only.
- No React/Worker source code, D1 migration, remote Cloudflare resource, production data or deployment was changed.
- Figma is updated in the linked Slotly file; the local code repository was not mounted/edited in this session.

## Phase alignment

Phase 2 = UI/UX design and approval. Phase 3 = database/backend foundation. UI implementation occurs later (Phases 4–9). The revised UI handoff states this explicitly.

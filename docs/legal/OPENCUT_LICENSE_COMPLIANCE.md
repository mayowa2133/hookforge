# OpenCut Fork Compliance Policy

## Purpose

This document defines how HookForge uses and maintains OpenCut-derived code while meeting upstream license obligations.

## Scope

- Applies to all code copied or forked from OpenCut.
- Applies to all releases that include OpenCut-derived frontend/editor components.

## Required Compliance Steps

1. Maintain a public fork repository for OpenCut-derived code used by HookForge.
2. Preserve upstream license files, notices, and copyright headers.
3. Record the exact upstream commit/tag used as baseline for each sync cycle.
4. Keep a modification log for HookForge-specific changes.
5. Include attribution in product/legal documentation and release notes where required.
6. Keep proprietary HookForge backend/services separate from OpenCut-derived code when license boundaries require it.

## Baseline Tracking

- Upstream repository: `https://github.com/OpenCut-app/OpenCut` (update if upstream canonical URL changes).
- HookForge fork repository: `https://github.com/mayowa2133/hookforge-opencut` (create/keep updated).
- Baseline pin file: `docs/legal/OPENCUT_UPSTREAM_BASELINE.md` (to be updated each sync).

## Sync Procedure

Use:

```bash
pnpm opencut:sync-upstream
```

The sync command must:

1. Verify current branch is clean.
2. Fetch `upstream`.
3. Rebase or merge onto configured upstream branch.
4. Record updated baseline commit in compliance logs.

## Release Checklist

Before any release containing OpenCut-derived code:

1. Confirm upstream license files are present and unmodified unless explicitly allowed.
2. Confirm attribution references in docs are current.
3. Confirm modification log includes all HookForge deltas since last sync.
4. Confirm legal review sign-off for the release branch.

## Non-Goals

- This document does not replace legal counsel.
- This document does not authorize use outside upstream license terms.

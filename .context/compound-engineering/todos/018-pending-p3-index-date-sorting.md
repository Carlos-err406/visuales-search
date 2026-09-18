---
status: pending
priority: p3
issue_id: "018"
tags: [core, search, indexing, research]
dependencies: []
---

# Research Date-Based Index Sorting

## Problem Statement

The user wants index sorting that takes advantage of Apache directory listings ordered by date.

## Findings

- User reports that the Apache server supports listing items by date and explicitly requested research first.
- Actual server behavior, available date metadata, and its relationship to listado.html remain unverified.
- Existing automatic indexing follows parsed listado order, without folder-specific prioritization.

## Proposed Solutions

Research server-side date sorting and the date metadata available in listings. Compare using server ordering with persisting dates in the shared index and sorting locally. Determine whether the desired scope is browsing/search result order, indexing traversal order, or both before implementation.

## Recommended Action

Pending research. Document supported sort parameters, ascending/descending behavior, timestamp meaning, missing-date handling, and cache implications before proposing an implementation.

## Acceptance Criteria

- [ ] Verify date-sorted listing behavior against the actual Visuales Apache server.
- [ ] Establish whether usable dates are available in listado.html, directory listings, or both.
- [ ] Document date semantics, limitations, and interaction with cached/indexed data.
- [ ] Propose an approach and confirm sorting scope before changing indexing or UI behavior.

## Work Log

- 2026-09-17: Added to the bucket as a research-first item at the user's request. No research, implementation, or release performed in this pass.

# Design QA — 任课关系分组合并表格

## Evidence

- Implementation URL: `http://localhost:5173/scheduling/assignments?grade=1&view=class`
- Before screenshots: `/Users/leslielau/project/dev/timetable/artifacts/audit/grouped-views/01-class-flat.png` through `04-room-flat.png`
- Final screenshots: `/Users/leslielau/project/dev/timetable/artifacts/audit/grouped-views/06-class-merged-table.png` through `09-room-merged-table.png`
- Final class-view screenshot: `/Users/leslielau/project/dev/timetable/artifacts/audit/grouped-views/11-final-class-merged-table.png`
- Combined comparison: `/Users/leslielau/project/dev/timetable/artifacts/audit/grouped-views/10-flat-vs-merged-comparison.png`

## State and intent

- The former class, teacher, course, and room perspectives all rendered the same flat assignment rows.
- Each perspective now uses its named resource as a semantic row group header with a real `rowSpan` merge.
- Assignment details remain individual rows so users can compare course, target, teacher, room, progress, state, and actions without opening another surface.
- Pagination counts groups and never splits one merged group across pages.

## Findings

- No actionable P0, P1, or P2 issue remains in the scoped grouped-table experience.
- Class view merges class cells and expands its courses below each class.
- Teacher view merges teacher cells and includes both primary and collaborating roles.
- Course view merges course cells and expands its assigned classes or teaching groups.
- Room view merges resolved classroom cells, including fixed, specified, class-default, and unassigned cases.
- The merged cell is a semantic `th scope="rowgroup"`, not a decorative card or a separate sidebar.
- Group separators, draft-row warning fill, compact actions, and established theme tokens remain consistent with the system.
- Search matches both group labels and child rows, resets pagination to page one, and preserves the whole matching group.
- Room types use Chinese labels instead of leaking backend enum values.

## Pagination and data checks

- Class: 8 merged groups on the tested grade; first group spans 17 detail rows.
- Teacher: 80 groups; next-page navigation was exercised and the first page-two group retained its full 4-row span.
- Course: 18 groups; first visible group spans 24 detail rows.
- Room: 55 groups; first visible group spans 9 detail rows.
- Search for “周磊” returned one teacher group with an 8-row span and page 1 selected.

## Verification

- `pnpm --filter @timetable/web exec vp check --fix` — passed with no warnings, lint errors, or type errors.
- `pnpm --filter @timetable/web test --run` — 5 files, 19 tests passed.
- `pnpm --filter @timetable/web build` — passed.
- A fresh browser reload produced no console warnings or errors.

final result: passed

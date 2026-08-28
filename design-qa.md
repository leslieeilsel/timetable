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

---

# Design QA — 通用资源选择器

## Evidence

- Implementation URL: `http://localhost:5173/semesters/3/assignments?grade=1`
- Selected teacher design: `/Users/leslielau/.codex/generated_images/01a04296-14d5-74e1-84bf-f8b0555fd3e2/exec-ac53ace1-ffc4-417e-ae30-7f65df3f42ce.png` (`1717×916`)
- Light desktop: `/Users/leslielau/project/dev/timetable/artifacts/design-qa/resource-picker/teacher-picker-light-final-v2.jpg` (`1440×900`)
- Dark desktop: `/Users/leslielau/project/dev/timetable/artifacts/design-qa/resource-picker/teacher-picker-dark-final.jpg` (`1440×900`)
- Mobile: `/Users/leslielau/project/dev/timetable/artifacts/design-qa/resource-picker/teacher-picker-320-final-v2.jpg` (`320×800`)
- Full comparison: `/Users/leslielau/project/dev/timetable/artifacts/design-qa/resource-picker/teacher-picker-comparison-final.png`
- Focused comparison: `/Users/leslielau/project/dev/timetable/artifacts/design-qa/resource-picker/teacher-picker-focused-comparison-final.png`

## Tested states and interactions

- Teacher picker: course facet, overflow subject menu, current value, pinyin initials, Enter-to-search, immediate clear, selectable-only filter, light and dark themes.
- Class picker: 24 real classes, grade facets, current selection, resource switching from the timetable toolbar.
- Room picker: 58 real rooms, Chinese type facets and labels, selectable-only filter.
- Course picker: 18 real courses, enabled/disabled facets, current selection.
- Assignment picker: 360 real teaching assignments, grade and course facets, confirmed-only behavior.
- Keyboard: Arrow Up/Down moves row focus, Enter commits, Space marks a row, Escape/close preserves the parent dialog.
- Responsive: `1440×900` and `320×800`; the table scrolls inside the dialog without expanding the page, and persistent actions remain visible.

## Findings and fix history

- P2 — Subject facets overflowed the desktop dialog and created a page-like horizontal scrollbar. Fixed by keeping the most useful subjects visible and moving the remainder into a “更多” menu.
- P1 — Initial typography and rows were too dense compared with the selected design and the accessibility goal. Increased title, search, table, row, and footer text sizing while retaining the app's existing tokens and font.
- P2 — Mobile footer actions wrapped awkwardly at 320 px. Fixed with a two-column mobile footer and an independent scrolling result table.
- P2 — An existing selection could open outside the visible result area. Fixed by scrolling the selected row into view on open.
- P2 — Timetable teacher data omitted course metadata, so the generic toolbar could not show subject filtering. Reconstructed each teacher's course set from real teaching assignments.
- P2 — Room type enums were exposed in English. Replaced them with the system's existing Chinese room-type labels while retaining enum and pinyin search terms.
- Post-fix comparison found no remaining actionable P0, P1, or P2 issue. The implementation keeps the selected design's search-first hierarchy, facet row, high-readability table, selected-row treatment, persistent footer actions, and semantic status colors.

## Verification

- `pnpm --filter @timetable/web exec vp check` — passed; 88 files formatted, no warnings, lint errors, or type errors.
- `pnpm --filter @timetable/web test -- --run` — 9 files, 48 tests passed.
- `pnpm --filter @timetable/web build` — passed; 3434 modules transformed.
- `git diff --check` — passed.
- Real browser checks completed without console errors or warnings; only Vite development/debug messages were present.

final result: passed

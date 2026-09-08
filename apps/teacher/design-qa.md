# Teacher H5 Design QA

## Comparison target

- Source visual truth: `/Users/leslielau/project/dev/timetable/docs/design/teacher-h5-approved-style/03-my-schedule-day.png`
- Normalized source: `/Users/leslielau/project/dev/timetable/docs/design/teacher-h5-approved-style/qa/source-my-schedule-day-390x844.png`
- Final implementation screenshot: `/Users/leslielau/project/dev/timetable/docs/design/teacher-h5-approved-style/qa/implementation-my-schedule-day-final.png`
- Side-by-side evidence: `/Users/leslielau/project/dev/timetable/docs/design/teacher-h5-approved-style/qa/comparison-my-schedule-day-final.png`
- Viewport: 390 × 844 CSS px; device scale factor 1.
- Source pixels: 852 × 1846, normalized to 390 × 844.
- Implementation pixels: 390 × 844.
- State: authenticated teacher, 我的课表，日视图，选中 2026-09-03，展示下一节课程。

## Full-view comparison evidence

The final side-by-side comparison confirms matching mobile composition: centered context selector, right-aligned teacher avatar, date/view row, seven-day strip, pale next-lesson surface, horizontal lesson rows, near-white palette, restrained borders, and no bottom navigation or decorative vertical rules.

The source uses generated sample data and a class context, while the implementation uses live seeded teacher data and the “我的课表” context. These copy and data differences are expected. The serif typography is an intentional post-design change requested by the user.

## Focused comparison evidence

A separate crop was not needed: both 390 px panels remain legible in the 780 × 844 side-by-side image, including header alignment, date typography, featured lesson spacing, course hierarchy, metadata, borders, and selected-date treatment.

## Required fidelity surfaces

- Fonts and typography: CSS prefers licensed `FZYaSongS-R-GB`; self-hosted Noto Serif SC 400/700 is the deployable fallback. Numeric and form controls use a system UI sans stack for clarity. Key course and count information is bold.
- Spacing and layout rhythm: 430 px maximum H5 shell, 18 px content gutters, compact header, 7-column date strip, aligned time column, and horizontal rhythm match the selected design.
- Colors and tokens: near-white canvas, charcoal foreground, pale neutral highlighted lesson, fine gray dividers, and small semantic outline labels are preserved.
- Image quality and assets: the selected design contains no raster content or custom illustrations. Interface icons use the product's existing Lucide dependency.
- Copy and content: teacher-facing labels, read-only context switching, day/week controls, adjustment states, empty state, password flow, and account actions are present.

## Interaction and browser checks

- Successful login with the local seeded teacher account.
- Opened and selected an authorized class from the centered context menu.
- Checked personal and class day views, class week view, date selection, account menu, and navigation to change password.
- Checked the empty-day state and its next-course lookup.
- Verified no horizontal overflow at 390 × 844.
- Browser console errors and warnings: none.

## Comparison history

1. Initial comparison: `/Users/leslielau/project/dev/timetable/docs/design/teacher-h5-approved-style/qa/comparison-my-schedule-day.png`
   - P2: lesson rows used smaller typography and a narrower time column than the source.
   - P2: the initial API range displayed seven days starting from the current date rather than the calendar week.
   - Fixes: enlarged the time/course/metadata hierarchy, aligned the course column, increased featured-card spacing, normalized the strip to Monday–Sunday, and disabled out-of-semester dates.
2. Final comparison: `/Users/leslielau/project/dev/timetable/docs/design/teacher-h5-approved-style/qa/comparison-my-schedule-day-final.png`
   - No actionable P0, P1, or P2 differences remain.

## Findings

- No blocking or material fidelity issues remain.

## Follow-up polish

- P3: replace the Noto Serif SC fallback with the licensed 方正标雅宋 webfont files if the project later purchases embedding authorization.

final result: passed

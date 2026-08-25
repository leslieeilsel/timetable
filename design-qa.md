# Design QA — 教务排课中心最终稿

## Comparison target

- Source visual truth: `docs/design/final-mockups/01-login.png` through `docs/design/final-mockups/14-settings.png`.
- Normalized source set: `docs/design/qa/normalized-reference/01-login.png` through `docs/design/qa/normalized-reference/14-settings.png`.
- Browser-rendered implementation: `docs/design/qa/01-login.png` through `docs/design/qa/14-settings.png`.
- Latest density-correction source: `/var/folders/zg/g866782x6rv7d60_z94qjmgc0000gn/T/codex-clipboard-b52ef029-3d4b-4c5b-9579-f5ff68b2dc98.png`.
- Latest density-correction implementation: `docs/design/qa/density-grades-final-1920x1080.png`.
- Same-input comparison evidence: `docs/design/qa/density-grades-final-comparison.png`.
- Latest collapsed-sidebar source: `/var/folders/zg/g866782x6rv7d60_z94qjmgc0000gn/T/codex-clipboard-be283656-e579-4a9a-927b-9119851961bb.png`.
- Latest collapsed-sidebar implementation: `docs/design/qa/sidebar-collapsed-final.png`.
- Collapsed-sidebar focused comparison: `docs/design/qa/sidebar-collapsed-comparison.png`.
- Local implementation URL: `http://127.0.0.1:5173/`.

## Viewport, density, and state

- Intended CSS viewport: 1440 × 1024 px, light theme.
- Source pixels: 1487 × 1058 px for every mockup. The source artboards represent the same 1440 × 1024 desktop viewport at an approximately 1.033 export density.
- Density normalization: every source was resized to 1440 × 1024 px before the final comparison. The source and implementation were then opened together at original resolution in the same comparison input.
- Implementation pixels: 1440 × 1024 px, `deviceScaleFactor: 1`.
- Density-correction comparison: source and implementation are both 1920 × 1080 px at `deviceScaleFactor: 1`; no resizing was needed before the side-by-side comparison.
- Collapsed-sidebar comparison: the 1018 × 856 px source is an approximately 3× focused crop. The 1425 × 891 px implementation capture came from a 1440 × 900 CSS viewport at `deviceScaleFactor: 1`; its 340 × 286 px top-left region was normalized to 1018 × 856 px for the same-input comparison.
- Auth/data state: blank focused login form for screen 01; authenticated demo administrator for screens 02–14; realistic seeded medium-school data; current demo context is 2026–2027 学年（演示当前）上学期.
- Responsive state: dashboard, teacher list, sidebar, the revised year-detail header, and the action-only table toolbar were checked at the mobile breakpoint. The final grade capture at 390 × 844 px has no horizontal overflow and keeps the action area above the table.

## Full-view comparison evidence

All 14 normalized source images were paired with their corresponding latest browser screenshots. The comparison covered:

- 01–03: login, change password, dashboard.
- 04–07: grades, teachers, subjects, venues.
- 08–11: academic years, academic-year detail, semester setup, teaching tasks.
- 12–14: timetable, users, settings.

The final pass found the same information hierarchy, warm-white/indigo token system, navigation structure, panel proportions, table density, semantic states, form grouping, and action emphasis across the reference and implementation. Real data creates expected row-count and ordering differences without changing the design hierarchy.

The density-correction pass additionally confirmed that the repeated visual page-intro block is removed, the global header contains no business actions, summary-only table rows are gone, and create/export actions live in the relevant content toolbar above the table or grid. When filters exist, actions share that same toolbar; when filters do not exist, the toolbar contains only the necessary actions and can expand to multiple buttons without modifying column headers.

The collapsed-sidebar pass confirmed that every 32 px icon button is centered inside the 48 px rail, the brand mark no longer touches the border, and active menu items contain no clipped label or chevron fragments.

## Focused-region evidence

The original 14-screen pass did not require separate crops because both artifacts were opened at the same 1440 × 1024 pixel size with original-detail rendering. For the collapsed-sidebar correction, a focused same-input comparison was required because the user's source was a zoomed crop; `docs/design/qa/sidebar-collapsed-comparison.png` compares the normalized source and implementation at equal 1018 × 856 px dimensions. The login illustration itself was additionally inspected as the 800 × 418 px source-derived raster asset at `apps/web/public/assets/login-workflow-grid.png`.

## Required fidelity surfaces

- Typography: consistent Inter with Chinese system fallbacks, restrained 600-weight headings, readable table text, and stable wrapping. Minor raster/font-rendering differences from the generated source are non-actionable P3 variance.
- Spacing and layout: desktop shell, 256 px sidebar, header rhythm, panel padding, table rows, tabs, and action alignment preserve the mockup hierarchy. Long real-data tables intentionally scroll before their pagination footer.
- Colors and tokens: warm neutral canvas, subtle borders, indigo primary actions, emerald success, amber warning, muted disabled states, and low-contrast row hover/selection states are consistent.
- Image and asset fidelity: the login workflow grid is a real source-derived PNG asset, not CSS/div art. Product UI icons use the Lucide family with consistent stroke weight; no emoji, handcrafted SVG, or placeholder illustration remains.
- Copy and content: all labels are standalone product copy in Chinese; destructive and lifecycle actions include consequence-oriented guidance; counts and status labels are driven by current data.
- Accessibility and behavior: semantic buttons/links/forms, visible focus rings, accessible labels on icon-only actions, keyboard search shortcut, minimum practical mobile targets, and responsive navigation were checked.

## Comparison history and fixes

### Iteration 1 — blocked

- [P0] Settings crashed while formatting the current school time. Fixed the invalid `Intl.DateTimeFormat` option combination and recaptured `docs/design/qa/14-settings.png`.
- [P2] Login lacked the reference's quiet workflow-grid identity and its major vertical anchors drifted. Added the source-derived raster asset, aligned the brand/hero/form to the reference, and recaptured `docs/design/qa/01-login.png`.
- [P2] Password visibility and live desktop requirement feedback were incomplete. Added visibility controls to all password fields and kept the four requirements visible beside the new-password field; recaptured `docs/design/qa/02-change-password.png`.
- [P2] Resource rows repeated generic visual markers. Added course- and room-specific Lucide glyph mapping and varied teacher avatar tones; recaptured `docs/design/qa/05-teachers.png`, `06-courses.png`, and `07-rooms.png`.
- [P2] Teaching-task header exposed a secondary migration action too prominently. Moved it into the overflow action and recaptured `docs/design/qa/11-teaching-tasks.png`.
- [P2] Year detail lacked the reference's direct return affordance and summary context. Added a round back action plus lifecycle, class, and semester metadata; recaptured `docs/design/qa/09-academic-year-detail.png`.
- [P2] User and settings screens lacked some semantic differentiation. Added varied user avatar tones and the pre-switch warning treatment; recaptured `docs/design/qa/13-users.png` and `14-settings.png`.

### Iteration 2 — passed

- Reopened every normalized reference and revised implementation pair at 1440 × 1024.
- No actionable P0, P1, or P2 visual, usability, responsive, asset-fidelity, or accessibility findings remain.
- Accepted variance: real seeded data changes row order and how far a long table must scroll; it does not alter pagination availability or task completion.

### Iteration 3 — blocked

- [P2] The first density revision moved page actions into the global header. This reduced vertical space but mixed navigation/account chrome with page-specific business operations and did not scale safely to multiple actions.

### Iteration 4 — blocked

- [P2] The next revision placed create actions inside the table column header. This avoided an extra row but overloaded column semantics and would not scale when a page gains several actions.

### Iteration 5 — passed

- Restored a dedicated, compact action area directly above each table/grid.
- Pages with filters combine search, filters, counts, and actions in one responsive toolbar.
- Pages without filters render an action-only toolbar; no summary-only filler content remains.
- Global headers and table column headers contain no page business actions.
- Desktop 1920 × 1080 and mobile 390 × 844 captures show no overlap or horizontal overflow. No actionable P0, P1, or P2 finding remains.

### Iteration 6 — blocked

- [P2] The 36 px collapsed menu buttons exceeded the usable width left by the rail's 8 px group padding, shifting icons right and clipping the brand mark against the divider.
- [P2] Collapsed labels and the resource chevron remained in layout; overflow clipping left visible glyph fragments at the active item's right edge.

### Iteration 7 — passed

- Reduced collapsed menu buttons and the brand mark to 32 px, restoring exact centering within the 48 px rail.
- Converted collapsed labels to screen-reader-only content and hid the resource chevron, removing all visible remnants without losing accessible names.
- The focused comparison and measured element bounds show no remaining P0, P1, or P2 issue.

## Primary interactions tested

- Login/logout and password visibility controls.
- Resource submenu navigation, teacher search, subject/status filtering.
- Grade create dialog opened successfully from the table action area; the global header text was inspected and contains no business action.
- Page-size change, numbered pagination, and next-page data change.
- `⌘K`/`Ctrl+K` search focus.
- Teaching-task subject filtering and bulk-selection state.
- User role filtering.
- Timetable class/teacher/venue views and adjacent-resource navigation.
- Mobile sidebar open/close and responsive table/header containment.
- All 13 authenticated routes opened after the final density changes; none had horizontal overflow at 1920 × 1080.
- Collapsed-sidebar buttons were measured inside the 48 px rail; visible label remnants were absent and icon-only controls retained accessible names.

## Console and automated verification

- Fresh-tab final route sweep: 0 browser warnings, 0 browser errors.
- `pnpm check:web`: passed; formatting, lint, and type checks clean.
- `pnpm test:web -- --run`: passed; 1 test file, 3 tests.
- `pnpm build:web`: passed; production bundle generated.

## Implementation checklist

- [x] 14 reference screens implemented and captured.
- [x] Basic resources split into independent submenu routes.
- [x] Pagination added to every potentially high-volume table.
- [x] Core filters, forms, tabs, menus, shortcuts, and timetable views work.
- [x] Responsive and console checks pass.
- [x] No open P0/P1/P2 design findings.

final result: passed

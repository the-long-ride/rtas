---
name: accessible-responsive-ui
description: Implement semantic, keyboard-accessible, responsive UI for Tauri webviews. Use for components, forms, dialogs, navigation, dense tools, and layout behavior.
---

# Accessible and Responsive UI

## Semantics first
- Use native elements before ARIA.
- Give controls accessible names and visible labels where needed.
- Keep heading order and landmarks meaningful.
- Associate errors and help text with their fields.
- Do not communicate status using color alone.

## Interaction
- Every action must work by keyboard.
- Preserve visible focus.
- Manage dialog focus, escape behavior, and focus return.
- Make disabled and busy behavior explicit.
- Respect reduced-motion preferences.
- Provide useful loading, empty, error, and recovery states.

## Responsive behavior
Design from available space, not device labels:
- Avoid horizontal scrolling except intentional data surfaces.
- Allow text to wrap and controls to grow.
- Use min/max/clamp and fluid layouts.
- Test narrow, medium, wide, zoomed, and long-content cases.
- Keep touch targets usable even in desktop webviews.

## Verification
Test keyboard-only use, 200% zoom, high text length, and a narrow Tauri window. Use automated accessibility checks as support, not as the only proof.

## Routing
Pair with `css-design-system` for implementation or `frontend-visual-design` for redesign work.

---
name: css-design-system
description: Build maintainable, token-driven CSS with low specificity, modern layout, and predictable component boundaries. Use for styling systems, themes, component CSS, or large visual refactors.
---

# CSS Design System

## Foundations
Define a small token layer for:
- Color roles, not raw component colors.
- Typography scale and line heights.
- Spacing rhythm.
- Radius, border, shadow, motion, and layout limits.

Use CSS custom properties and semantic names. Keep component defaults local and expose only intentional customization points.

## Authoring
- Prefer Grid and Flexbox over positional hacks.
- Prefer logical properties for international and adaptable layouts.
- Keep selectors shallow and specificity low.
- Use cascade layers when the project benefits from explicit ordering.
- Avoid `!important` except documented override boundaries.
- Avoid fixed heights for text-bearing controls and panels.
- Use container queries when behavior depends on component space.
- Remove dead rules while changing nearby CSS.

## States
Style hover, focus-visible, active, disabled, selected, loading, error, and empty states intentionally.

## Performance
Avoid broad expensive selectors, layout-triggering animation, and unbounded visual effects. Animate transform and opacity when appropriate.

## Routing
Pair with `frontend-visual-design` for aesthetic direction and `accessible-responsive-ui` for interaction and layout checks.

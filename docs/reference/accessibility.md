# Accessibility Profiles

Section 50 is implemented as a product-level accessibility profile layer.

## Records

- `accessibility_profiles` stores keyboard navigation, screen-reader mode, high-contrast mode, font scale, color scheme, linked theme profile, and machine-readable check results.
- `keyboard_shortcuts` provides the keyboard navigation registry.
- `theme_profiles` provides light, dark, system-following, and high-contrast visual modes.
- Agent output accessibility remains enforced through output contracts and artifact validation.

## Default Profile

The default `accessible_default` profile enables:

- Keyboard navigation backed by the shortcut registry.
- Screen-reader support expectations for semantic HTML, ARIA names, and non-visual labels.
- High-contrast mode linked to the `highContrast` theme preset.
- Font size adjustment through `fontScale`.
- Color scheme selection through `system`, `light`, or `dark`.

## API

- `POST /api/accessibility/profiles/seed`
- `GET /api/accessibility/profiles`
- `POST /api/accessibility/profiles`
- `POST /api/accessibility/profiles/:id/evaluate`

The frontend helpers in `src/lib/api.ts` expose `seedAccessibilityProfiles`, `fetchAccessibilityProfiles`, `createAccessibilityProfile`, and `evaluateAccessibilityProfile`.

## Check Keys

Every evaluated profile stores five check results:

- `keyboard_navigation`
- `screen_reader_support`
- `high_contrast_mode`
- `font_size_adjustment`
- `color_scheme`

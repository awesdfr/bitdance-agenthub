# Browser Automation Traps

Section 91 turns common browser automation failure modes into a record-only evaluation service.

## Covered Traps

- Extension interference: ad blockers, password managers, translators, writing assistants, and unknown extensions are treated as reasons to switch to a clean Agent browser profile.
- Rendering drift: browser zoom, DPI scaling, viewport size, dark mode, GPU rendering, pixel-perfect screenshots, and image/OCR-only locators are flagged before retrying.
- CAPTCHA and bot detection: Cloudflare, reCAPTCHA, hCaptcha, generic challenge pages, and bot-detection messages pause automation and notify the user.

## Stabilization Defaults

- Use an isolated browser profile with extensions disabled.
- Set zoom to 100%.
- Use a fixed 1280x720 viewport and device scale factor 1.
- Prefer CSS selectors or XPath before image recognition.
- Use SSIM or structural checks instead of pixel-perfect screenshot comparison.

## APIs

- `POST /api/browser-automation-traps/policies/seed`
- `GET /api/browser-automation-traps/policies?status=active`
- `POST /api/browser-automation-traps/evaluate`
- `GET /api/browser-automation-traps/evaluations?status=needs_user`

## Safety Boundary

This service does not control a real browser, solve CAPTCHA, bypass bot detection, or call third-party CAPTCHA services. v1 behavior is pause-and-notify with optional user-approved session reuse.

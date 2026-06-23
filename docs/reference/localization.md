# Localization And I18n Contract

Section 49 is implemented as an i18n contract layer over the localization runtime. Section 162 covers the broader technical architecture; this page documents the product-facing contract that keeps v1 Chinese-first while preserving multilingual growth.

## Runtime Records

- `localization_settings` stores the default locale, fallback locale, enabled locales, namespaces, output-language policy, and formatting defaults.
- `localization_resources` stores translated strings by `locale`, `namespace`, and `key`.
- `agent_localization_policies` stores Agent-level output language, date/time locale, and number locale rules.
- `i18n_contract_checks` stores the required product-level i18n checks from Section 49.

## Required Contract Checks

The default contract checks are:

- `ui_text_keys`: UI copy is represented by i18n keys in the `ui` namespace.
- `agent_system_prompt_persona_language`: Agent system prompt language follows `persona.language` when supplied.
- `locale_datetime_number_formatting`: dates, times, and numbers are formatted through `Intl` by locale.
- `localized_error_messages`: errors live in the `errors` namespace.
- `localized_documentation`: documentation navigation labels live in the `docs` namespace.

## API

- `POST /api/localization/seed`
- `GET /api/localization/settings`
- `GET /api/localization/resources`
- `POST /api/localization/resources`
- `POST /api/localization/translate`
- `POST /api/localization/resolve`
- `GET /api/localization/agent-policies`
- `POST /api/localization/agent-policies`
- `POST /api/localization/contract/seed`
- `GET /api/localization/contract/checks`
- `POST /api/localization/contract/evaluate`

`/api/localization/resolve` accepts `personaLanguage` and returns `systemPromptLocale`, `systemPromptLocaleSource`, and `systemPromptRule` so Agent Profile persona language can drive the system prompt while output language still follows the configured policy.

## Supported Locales

The default locale is `zh-CN`. The reserved supported locales are:

- `zh-CN`
- `en-US`
- `ja-JP`
- `zh-TW`

The default namespaces are `ui`, `errors`, `agent-prompts`, and `docs`.

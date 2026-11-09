# ChatGPT subscription provider

RU AI Assist can use the official **Sign in with ChatGPT** direct Responses route for eligible ChatGPT accounts. This is a separate provider, not an API key pasted into a Chat Completions endpoint.

## Setup (desktop only)

1. In RU AI Assist settings, select **ChatGPT (subscription)**.
2. Choose **Continue with ChatGPT**. Review the plugin's explanation, then complete the OpenAI browser authorization yourself. Sign-in does not send a prompt or note to a model.
3. Grant ChatGPT plan usage if it is available for the selected account/workspace. An identity-only connection cannot run inference.
4. Fetch the available models and select one. No model name is guessed.
5. The optional test button sends only `ping` and consumes plan allowance. A completed request, not just sign-in, verifies access.

The provider does not import your ChatGPT conversations, dot memory or an existing assistant identity. It preserves RU AI Assist's own sidebar, context selection, private chat and note-edit approval behavior. Selected note context and attachments are sent to OpenAI only when you submit a request.

## Billing and limits

The provider uses the connected account's eligible ChatGPT plan or available credits. It never silently falls back to an API-key provider. Eligibility, model access, serving region and app-specific limits are controlled by OpenAI. A limit error does not prove the entire plan is exhausted or establish a reset time.

The usage link opens ChatGPT; follow **Settings → Usage**. A stable direct Usage deep link has not been verified.

## Security

- OAuth code flow with PKCE, fresh state/nonce and a loopback-only callback.
- ID tokens are verified against OpenAI's published JWKS, issuer, audience, expiry and expected identity.
- Credentials are encrypted with Electron `safeStorage` under Obsidian's local application data, outside the vault. No plaintext fallback, credentials in plugin settings, tokens in history, or browser-storage persistence.
- Separate account registrations, serialized refresh, and explicit disconnect/revocation.
- Auth requests accept only the official auth host. Inference accepts only the fixed public OpenAI `/v1/models` and `/v1/responses` routes. Redirects are not followed.
- Closing settings or unloading the plugin cancels a pending sign-in locally. If the browser already approved access, check ChatGPT settings because a local cancellation cannot guarantee remote revocation.

## Protocol and current limits

Requests use streaming Responses with `store: false`. Temperature and output-token-limit controls do not apply. Function tools are namespaced; request-local reasoning/function items are replayed within the tool loop but not persisted in history. A stream must reach `response.completed`; failed, incomplete and disconnected streams do not become successful edits.

The subscription route does not support every hosted Responses tool. This integration uses the plugin's existing local note tools; it does not add hosted connectors, image generation, transcription, shell execution or a Codex agent harness. The provider is desktop-only; existing API providers remain available on mobile.

## Development and verification

- `npm run build`: type-check and bundle locally. **Does not deploy.**
- `npm run test:all`: existing regression tests plus offline subscription and auth checks.
- `npm run build:deploy`: explicit build and copy to the existing absolute plugin directory supplied through `AI_ASSIST_VAULT_PLUGIN`. No personal destination is bundled. The command fails if the destination is missing or invalid. Use only when you intend to install the build.

Offline tests use synthetic tokens and mocked transports. They do not log in, read real credentials, or consume inference. Real browser sign-in, refresh, revocation, account eligibility and end-to-end model/tool behavior must still be tested with a user-authorized connection. The provider checks safeStorage at runtime and refuses to save credentials if protected storage is unavailable.

## Official references

- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
- https://developers.openai.com/siwc/ui-ux-guidelines

## Model, effort and quota controls

The settings model picker uses the signed-in account's model catalog (Fetch models).
The sidebar model menu also supports choosing an account model. Reasoning effort is
remembered separately for each model and used for subscription requests only.
Documented values are validated before sending `reasoning.effort`; unrecognized
models/values use the server default. Effort applies on the next request. No paid
API fallback is introduced.

The native allowance display refreshes only when requested. It uses the official
Codex app-server `account/read` (without forced token refresh) and
`account/rateLimits/read`, through an already signed-in local Codex CLI. Only a
matching account email may show percentages. This is the shared Codex/ChatGPT Work
allowance, not the SIWC app cap, and equal workspace identity is not established.
No conversation, note, inference request, credential copy, login or background
poll is sent. Snapshots are marked historical after one minute and hidden at the reported
reset; use Refresh allowance for current data. API credits are not shown.
The direct SIWC app-specific remaining percentage has no verified public endpoint.

Sources: https://developers.openai.com/api/docs/guides/latest-model
https://developers.openai.com/api/docs/guides/reasoning
https://developers.openai.com/codex/app-server
https://learn.chatgpt.com/docs/sign-in-with-chatgpt

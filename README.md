# Crisp Focus

Crisp Focus adds a spring-eased caret, tactile typing feedback, and local
ambient soundscapes to Obsidian.

## Features

- One Focus mode master switch that preserves individual feature choices.
- Four atomic Focus scenes for silent, typewriter, rainy, and ocean writing.
- Adjustable animated cursor with reduced-motion support.
- Five synthesized typing themes with a shared output limiter.
- Four bundled local ambient soundscapes with normalized loudness.
- IME-aware typing feedback and pop-out window support.
- Local Ed25519 signature validation with online device verification.
- No analytics or telemetry.

## Focus scenes

Choose a scene from the settings page or the command palette. A scene applies
its cursor, typing feedback, and ambient sound choices as one atomic preset.
`Silent writing` is available without activation. Scenes that contain paid
audio stay locked until the current license is verified. Changing an
individual scene-controlled setting marks the setup as `Custom`.

## License verification and privacy

The animated cursor is available without activation. Typing feedback and
ambient soundscapes require a valid Crisp license. License signatures are
validated locally first. The plugin then sends the license code, the current
Obsidian app/device identifier, and the plugin ID to the Crisp license service
to register or verify the device. If the service is temporarily unreachable,
a previously verified license receives a seven-day offline grace period.

The license code is stored only in the current vault's plugin `data.json`.
Keep that file private and exclude it from shared archives.

## Development

```bash
npm run check
```

The runtime release contains `main.js`, `manifest.json`, `styles.css`, and the
`audio/` directory. Keep each vault's `data.json` when deploying an update.

## Distribution checklist

Before public distribution, verify that all bundled audio files have
redistribution rights compatible with the repository's source-code license.

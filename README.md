# Crisp Focus

Crisp Focus adds a spring-eased caret, tactile typing feedback, and local
ambient soundscapes to Obsidian.

## Features

- One Focus mode master switch that preserves individual feature choices.
- Adjustable animated cursor with reduced-motion support.
- Five synthesized typing themes with a shared output limiter.
- Four bundled local ambient soundscapes with normalized loudness.
- IME-aware typing feedback and pop-out window support.
- No network requests, accounts, analytics, or telemetry.

## Development

```bash
npm run check
```

The runtime release contains `main.js`, `manifest.json`, `styles.css`, and the
`audio/` directory. Keep each vault's `data.json` when deploying an update.

## Distribution checklist

Before public distribution, add the chosen source-code license and verify that
all bundled audio files have redistribution rights compatible with that
license.

# Crisp Focus

Crisp Focus adds a spring-eased caret, tactile typing feedback, and local
ambient soundscapes to Obsidian.

## Features

- One Focus mode master switch that preserves individual feature choices.
- Four atomic Focus scenes for silent, typewriter, rainy, and ocean writing.
- Clean typing (requires activation): collapses both sidebars and hides tabs, view header, ribbon and (optionally) the status bar, leaving only the page (desktop).
- Restorable 1–240 minute focus sessions with pause, resume, and status-bar controls.
- Pomodoro timer (requires activation): focus and break phases with a long break after each set, a status-bar panel, phase chimes, and a daily goal.
- Dual-mode typewriter scrolling (requires activation) with adjustable eye-line height, a soft tolerance band, and viewport-aware end padding.
- Manual wheel, touch, and scrollbar movement temporarily yields control until writing resumes; mouse clicks and drag selections never move the page.
- Adjustable animated cursor with reduced-motion support.
- Five synthesized typing themes with a shared output limiter.
- Independent space/IME confirmation and Enter bell switches. The space preference survives scene changes.
- Four bundled local ambient soundscapes with normalized loudness.
- IME-aware typing feedback and pop-out window support.
- Local Ed25519 signature validation with online device verification.
- No analytics or telemetry.

## Focus scenes

Choose a scene from the settings page or the command palette. A scene applies
its cursor, typewriter scrolling, typing feedback, and ambient sound choices as one atomic preset.
`Silent writing` is available without activation; its typewriter scrolling
turns on once the license is verified. Scenes that contain paid
audio stay locked until the current license is verified. Changing an
individual scene-controlled setting marks the setup as `Custom`.

## Clean typing

Run `Toggle clean typing` or use the switch in settings. Both sidebars collapse
and the tab bar, view header, left ribbon and sidebar buttons disappear; the
status bar hides too unless you keep it in settings. Move the pointer to the top
of the window to bring the tab bar back while switching notes; the top strip
still drags the window. Leaving clean typing reopens only the sidebars that were
open before. The mode is not saved: it ends when the plugin unloads or Obsidian
restarts. The view header is hidden only for notes, so other views keep their
actions. Desktop only; requires a valid Crisp license.

## Focus sessions

Start a custom-duration session from settings, use the 25/50-minute command
palette shortcuts, or open the panel from the status bar. The status bar shows
the remaining time; clicking it opens the pomodoro panel, where a running
session can be paused, resumed or ended. Ambient sound stays silent while a session is paused. Session state is stored in the
current vault so an unfinished countdown survives plugin reloads. Completing
or stopping a session turns Focus mode off and stops ambient audio.

## Pomodoro

Click the status-bar item (or run `Open pomodoro timer`) to open the pomodoro
panel. A pomodoro alternates focus and break phases: 25-minute focus and
5-minute short breaks by default, with a 15-minute long break after every four.
Breaks turn Focus effects and ambient sound off; the next focus phase turns them
back on. By default the next focus waits for you after a break. A soft two-note
chime marks the end of each phase. The pomodoro timer requires a valid Crisp
license; single focus sessions stay free.

Other plugins can follow sessions through the `crisp-focus:session` workspace
event (`apiVersion` 1). Each event carries the session id, `kind` (`focus` or
`break`), `phase`, planned minutes, elapsed time and whether it completed;
Crisp Pulse uses it to record focus time.

## License verification and privacy

The animated cursor and single focus sessions are available without
activation. Typewriter scrolling, clean typing, the pomodoro timer, typing
feedback and ambient soundscapes require a valid Crisp license. Without one,
saved typewriter choices are kept but have no effect until activation. A
license with an expiry date stops unlocking these features at that moment,
even while Obsidian stays open. License signatures are
validated locally first. The plugin then sends the license code, the current
Obsidian app/device identifier, and the plugin ID to the Crisp license service
to register or verify the device. If the service is unreachable, a license
with a valid local signature keeps working offline; an explicit rejection from
the service (revoked, device limit reached) disables paid audio.

The license code is stored only in the current vault's plugin `data.json`.
Keep that file private and exclude it from shared archives.
If `data.json` becomes unreadable (for example after an interrupted sync), the
plugin copies it to `data.json.corrupt-<timestamp>` before falling back to
defaults, and never overwrites it when that copy cannot be made.

## Development

```bash
npm run check
```

The runtime release contains `main.js`, `manifest.json`, `styles.css`, and the
`audio/` directory. Keep each vault's `data.json` when deploying an update.

## Distribution checklist

Before public distribution, verify that all bundled audio files have
redistribution rights compatible with the repository's source-code license.

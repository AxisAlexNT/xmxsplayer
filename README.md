# xmxsplayer

A cross-platform desktop workspace for transcription by ear and live MIDI performance.

## Status

M1 shell: secure UI and hidden engine windows, typed message bus, engine crash recovery, and the design frame with bundled fonts. Project folders, MIDI, sound and editing are not connected yet.

## Development

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

The application opens the shell. Stop development with Ctrl+C.

- `npm run build`: compile the process and renderer entries.
- `npm run check`: typecheck, lint, and run unit tests.
- `npm run test`: run Vitest; use `npx vitest run tests/path/to/file.test.ts` for one file.
- `npm run smoke`: build and check Electron startup; Linux requires a display or `xvfb-run -a npm run smoke`.
- `npm run dist:linux`: build an AppImage.
- `npm run dist:win`: build Windows x64 portable and zip artifacts.

Packaging configuration and release validation follow in the release milestone. The current scaffold is not a release-ready application.

## License

[MIT](LICENSE)

# App Icon

`app-icon.svg` is the editable master: a white V with a negative-space download arrow on solid teal (`#007c89`). Keep the internal geometry sharp and the transparent outer margin intact. Launcher corners are independent of the UI's 1px radius rule.

The app header references the master's `visuales-mark` path inside its 1px-corner tile. Keep that ID stable. The browser favicon uses the complete master.

Regenerate from the repository root using the installed Tauri CLI:

```sh
npm --prefix apps/desktop run tauri -- icon app-icon.svg --output ../../.cache/icon-generation
cp .cache/icon-generation/icon.png .cache/icon-generation/icon.ico .cache/icon-generation/icon.icns apps/desktop/src-tauri/icons/
```

The existing Tauri configuration bundles those PNG, Windows ICO, and macOS ICNS files. Inspect the generated 16/32px variants before rebuilding. Mobile exports are not installed; Android adaptive icons need their own foreground/background treatment when mobile work begins.

## Development Icons

Development uses the same teal tile and V with slim Lucide `Code` brackets tucked around the mark, without a separate badge. The header, About page, popup, and browser favicon select `app-icon-dev.svg` through Vite's development flag. Production keeps the original master.

Start the native development app with `npm run desktop:dev` from the repository root, or `npm run dev:desktop` from `apps/desktop`. Both apply `src-tauri/tauri.dev.conf.json`, which selects the development PNG/ICO/ICNS icons for windows and the macOS Dock. For direct Tauri CLI use, pass `--config src-tauri/tauri.dev.conf.json` to `tauri dev`. The overlay changes only icons, not the app identifier, settings, cache, or updater configuration.

macOS development uses the same integrated mark in a compact 54-by-32 monochrome tray template. Windows/Linux use the square development icon. Production tray rendering is unchanged. Do not pass the development overlay to release builds.

Regenerate the dev variants from the original master and installed Lucide glyph with:

```sh
npm run icons:dev
npm run test:dev-icons
```

Generation uses Tauri's icon tooling and Playwright Chromium for the transparent tray bitmap; set `BROWSER_CHANNEL=chrome` to use installed Chrome instead. Only the dev assets are replaced. The preview test checks dev and production builds and writes size comparisons to `.cache/desktop-ui/dev-icons.png`. The native macOS tray smoke also checks the development icon context and tray width.

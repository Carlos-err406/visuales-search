# App Icon

`app-icon.svg` is the editable master: a white V with a negative-space download arrow on solid teal (`#007c89`). Keep the internal geometry sharp and the transparent outer margin intact. Launcher corners are independent of the UI's 1px radius rule.

The app header references the master's `visuales-mark` path inside its 1px-corner tile. Keep that ID stable. The browser favicon uses the complete master.

Regenerate from the repository root using the installed Tauri CLI:

```sh
npm --prefix apps/desktop run tauri -- icon app-icon.svg --output ../../.cache/icon-generation
cp .cache/icon-generation/icon.png .cache/icon-generation/icon.ico .cache/icon-generation/icon.icns apps/desktop/src-tauri/icons/
```

The existing Tauri configuration bundles those PNG, Windows ICO, and macOS ICNS files. Inspect the generated 16/32px variants before rebuilding. Mobile exports are not installed; Android adaptive icons need their own foreground/background treatment when mobile work begins.

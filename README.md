# Messenger Chat Exporter

Chrome extension for exporting Facebook Messenger conversations to JSON, with local browser memory for saved exports and quick re-downloads.

## What It Does

- Scrapes the currently open Messenger conversation from the active tab
- Exports the conversation as a formatted JSON file
- Saves successful exports in browser storage for later re-export
- Includes a shadcn-style popup UI with a lightweight Meta-blue accent

## Development

```bash
npm install
npm run dev
```

Then open `chrome://extensions`, enable Developer mode, and load the `dist` directory as an unpacked extension.

## Production Build

```bash
npm run build
```

The production zip is generated in `release/`.

## GitHub Pages

The repository includes a lightweight static site in `docs/` for GitHub Pages, including a home page
and a privacy policy page suitable for extension listing requirements.

Deployment is handled by [deploy-pages.yml](/c:/Developer/fb-chat-exporter/.github/workflows/deploy-pages.yml).

Suggested one-time GitHub CLI setup:

```bash
gh auth login
git add docs .github/workflows/deploy-pages.yml README.md
git commit -m "Add GitHub Pages site and workflow"
git push origin main
gh api --method POST repos/LironeFitoussi/fb-chat-exporter/pages -F build_type=workflow
```

If Pages already exists for the repository, use:

```bash
gh api --method PUT repos/LironeFitoussi/fb-chat-exporter/pages -F build_type=workflow
```

After that, every push to `main` that changes `docs/` or the workflow will publish the site automatically.

If you also want to set the repository homepage URL:

```bash
gh repo edit --homepage "https://lironefitoussi.github.io/fb-chat-exporter/"
```

Expected URLs:

- Site home: `https://lironefitoussi.github.io/fb-chat-exporter/`
- Privacy policy: `https://lironefitoussi.github.io/fb-chat-exporter/privacy.html`

## Icon Pipeline

The raw brand source lives at `logo.png`.

Generate extension and store-ready icons with:

```bash
npm run icons
```

This script creates:

- `public/icons/icon-16.png`
- `public/icons/icon-32.png`
- `public/icons/icon-48.png`
- `public/icons/icon-128.png`
- `public/icons/icon-256.png`
- `public/icons/icon-512.png`
- `public/icons/icon-1024.png`
- `public/icons/app-icon.ico`

The icon generator crops the symbol portion of the raw logo, removes the title text area, and outputs square assets for the extension and store listing workflow.

## Project Structure

- `manifest.config.ts` - extension manifest source
- `src/popup/` - popup application
- `src/content/` - Messenger content script bridge
- `src/lib/facebook-export.ts` - scraper logic
- `src/lib/export-archive.ts` - browser-side saved export memory
- `scripts/generate_extension_icons.py` - icon conversion pipeline

## Release Notes

Before publishing:

1. Run `npm run icons`
2. Run `npm run build`
3. Reload the extension in Chrome and verify icons, popup UI, scraping, and re-export behavior
4. Package the generated release zip for distribution

# Spoiler Stopper

Spoiler Stopper is a Manifest V3 Chrome extension that protects YouTube sports results by blurring thumbnails and replacing spoiler-heavy titles with safer event context.

## Development

Requirements: Node.js and npm.

```sh
npm install
npm run build
```

The unpacked extension is written to `dist/`. To test it, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the `dist` directory.

## Release package

```sh
npm run package
```

This creates `spoiler-stopper-0.1.0.zip` at the repository root. Increment the version in both `public/manifest.json` and the package script before each subsequent upload.

## Privacy

Spoiler Stopper processes YouTube page content locally. See [PRIVACY.md](PRIVACY.md).

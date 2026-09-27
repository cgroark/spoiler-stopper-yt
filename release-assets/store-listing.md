# Chrome Web Store listing draft

## Summary

Hide sports spoilers on YouTube by blurring thumbnails and replacing result-heavy titles with safer event context.

## Description

Spoiler Stopper helps you browse YouTube without accidentally seeing sports results before you are ready.

It works directly on YouTube to:

- Blur video and Shorts thumbnails.
- Replace spoiler-heavy titles with safer event or competition context.
- Protect titles shown on watch pages and fullscreen player overlays.
- Let you turn protection on or off from YouTube.

All title analysis happens locally in your browser. Spoiler Stopper does not send your YouTube activity to a server and does not include analytics, advertising, or tracking.

Because YouTube changes frequently and sports titles vary widely, this beta may occasionally miss a spoiler or hide more detail than necessary.

## Category

Productivity

## Single purpose

Prevent accidental sports-result spoilers while browsing and watching videos on YouTube by obscuring thumbnails and sanitizing result-heavy titles.

## Permission justification

### storage

Stores only the user's local enabled/disabled preference so Spoiler Stopper remembers whether protection should be active.

### youtube.com site access

Reads and modifies visible YouTube video cards and titles locally to identify and obscure potential sports spoilers. Page content is not transmitted or retained.

## Remote code

No. All executable code is included in the extension package.

## Data-use disclosure

The extension locally processes website content displayed on YouTube, including video titles, links, channel names, and durations, solely to provide spoiler protection. It does not collect or transmit this information, and it does not sell or share user data.

## Reviewer test instructions

1. Install the extension and open `https://www.youtube.com/`.
2. Choose **Turn on protection** in the consent dialog.
3. Search for sports highlights or visit a sports-heavy homepage.
4. Confirm video and Shorts thumbnails are blurred and protected by overlays.
5. Open a protected video and confirm spoiler-heavy watch-page and fullscreen overlay titles are sanitized.
6. Use **Turn off Spoiler Stopper** on YouTube and confirm original thumbnails and titles are restored.

import './content.css';

console.log('🛡️ Spoiler Shield loaded!');

declare const chrome: {
  storage?: {
    local?: {
      get(
        keys: string[],
        callback: (
          values: Record<string, unknown>
        ) => void
      ): void;
      set(
        values: Record<string, unknown>,
        callback?: () => void
      ): void;
    };
  };
};

const CONSENT_STORAGE_KEY =
  'spoilerShieldConsent';

type ConsentChoice = 'enabled' | 'disabled';

let protectionObserver:
  | MutationObserver
  | null = null;

const observedShortsContainers =
  new WeakSet<HTMLElement>();

function getVideoMetadata(card: HTMLElement) {
  let channel = '';

  // Newer lockup cards / side panel
  const metadataRows = card.querySelectorAll<HTMLElement>(
    'yt-content-metadata-view-model .ytContentMetadataViewModelMetadataRow'
  );

  if (metadataRows.length > 0) {
    // The first metadata row is normally the channel.
    channel =
      metadataRows[0]
        ?.textContent
        ?.trim() || '';
  }

  // Older homepage/feed cards
  if (!channel) {
    channel =
      card
        .querySelector<HTMLAnchorElement>(
          'a.ytAttributedStringLink'
        )
        ?.textContent
        ?.trim() || '';
  }

  // Search results / older video renderer
  if (!channel) {
    channel =
      card
        .querySelector<HTMLElement>(
          'ytd-channel-name yt-formatted-string'
        )
        ?.textContent
        ?.trim() || '';
  }

  // Newer channel-link variants
  if (!channel) {
    channel =
      card
        .querySelector<HTMLAnchorElement>(
          'a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"]'
        )
        ?.textContent
        ?.trim() || '';
  }

  const duration =
    card
      .querySelector('.ytBadgeShapeText')
      ?.textContent
      ?.trim() || '';

  return {
    channel: channel || '',
    duration,
    details: ''
  };
}

function getVideoTitle(card: HTMLElement) {
  // Newer homepage / recommendation / side-panel lockup
  let title = card
    .querySelector<HTMLElement>(
      '.ytLockupMetadataViewModelTitle'
    )
    ?.textContent
    ?.trim();

  // Search results
  if (!title) {
    title = card
      .querySelector<HTMLAnchorElement>(
        'a#video-title'
      )
      ?.title
      ?.trim();
  }

  // Shorts
  if (!title) {
    title = card
      .querySelector<HTMLAnchorElement>(
        'a.shortsLockupViewModelHostOutsideMetadataEndpoint'
      )
      ?.title
      ?.trim();
  }

  return title || '';
}

function generateSafeTitle(title: string) {
  const source =
    title.match(/\|\s*(.+)$/)?.[1]?.trim();

  /*
   * Detect sporting events.
   */
  const event = title.match(
    /\b(?:(Men'?s|Women'?s|Mixed)\s+)?(10000m|5000m|3000m(?:\s+steeplechase)?|1500m|800m|400m(?:\s+hurdles)?|200m|100m(?:\s+hurdles)?|110m(?:\s+hurdles)?|60m|10k|5k|Marathon|Pole\s+Vault|High\s+Jump|Long\s+Jump|Triple\s+Jump|Discus|Shot\s+Put|Hammer\s+Throw|Javelin|Decathlon|Heptathlon|4x100m(?:\s+(?:Mixed\s+)?Relay)?|4x200m(?:\s+(?:Mixed\s+)?Relay)?|4x400m(?:\s+(?:Mixed\s+)?Relay)?|4x800m(?:\s+(?:Mixed\s+)?Relay)?|Freestyle|Backstroke|Breaststroke|Butterfly|Individual\s+Medley|Relay)\b/i
  );

  const eventName = event
    ? `${event[1] ? `${event[1]} ` : ''}${event[2]}`
    : '';

  /*
   * Words/phrases that almost always reveal an outcome.
   */
  const spoilerVerb =
    /\b(wins?|won|claims?|claimed|captures?|captured|secures?|secured|takes?|took|beats?|beat|defeats?|defeated|dusts?|dusted|dominates?|dominated|crushes?|crushed|edges?|edged|holds?|held|storms?|stormed|prevails?|prevailed|outduels?|outdueled|outlasts?|outlasted|outkicks?|outkicked|becomes?|became|earns?|earned|clinches?|clinched|qualifies?|qualified|advances?|advanced|eliminates?|eliminated|sets?|set|breaks?|broke|goes?|went|cruises?|cruised|surges?|surged|delivers?|delivered|ices?|iced|regains?|regained|reclaims?|reclaimed|sneaks?|snuck|seals?|sealed|flourishes?|flourished|smashes?|smashed|retains?|retained|defends?|defended|defend|repeats?|repeated)\b/i;

  /*
   * Additional result/outcome phrases.
   */
  const spoilerPhrase =
    /\b(gold(?:\s+medal)?|silver(?:\s+medal)?|bronze(?:\s+medal)?|medal|relay\s+title|title\s+defen[cs]e|repeat(?:s)?\s+as\s+(?:champion|champions)|back[-\s]?to[-\s]?back|successfully\s+defends?|keeps?\s+(?:the\s+)?title|kept\s+(?:the\s+)?title|retains?\s+(?:the\s+)?crown|defends?\s+(?:the\s+)?crown|new\s+champion|new\s+champions|first\s+gold|first\s+medal|first\s+(?:pro\s+)?national\s+championship|stunner|sneaks?\s+past|pulls?\s+off\s+a\s+stunner|world\s+record|world[-\s]?lead|full\s+second|personal\s+best|national\s+record|olympic\s+record|come[-\s]?from[-\s]?behind|anchor\s+leg|ices?|explodes?|seal(?:s|ed)?|youngest|ever|defends?|retain(?:s|ed)?\s+(?:the\s+)?title)\b/i;

  /*
   * Special case:
   *
   * "English Wins"
   * "Burgin Withdraws"
   *
   * Both the winner and the withdrawal are results, so we
   * want to rebuild from the event rather than leave either
   * name/result combination visible.
   */
  const resultPhrase =
    /\b(?:[A-Z][a-z'’]+(?:\s+[A-Z][a-z'’]+)*)\s+(?:wins?|won|withdraws?|withdrew|loses?|lost|qualifies?|qualified|advances?|advanced|fails?|failed|places?|placed)\b/i;

  /*
   * If this looks like a spoiler and we know the event,
   * rebuild the title from the safe event information.
   */
  if (
    (spoilerVerb.test(title) ||
      spoilerPhrase.test(title) ||
      resultPhrase.test(title)) &&
    eventName
  ) {
    return source
      ? `${eventName} | ${source}`
      : eventName;
  }

  let safeTitle = title;

  /*
   * Preserve event names while removing numbers.
   */
  const preservedEvents: string[] = [];

  safeTitle = safeTitle.replace(
    /\b(10000m|5000m|3000m|1500m|800m|400m|200m|100m|110m|60m|10k|5k|4x100m|4x200m|4x400m|4x800m)\b/gi,
    (match) => {
      const placeholder =
        `__EVENT_${preservedEvents.length}__`;

      preservedEvents.push(match);

      return placeholder;
    }
  );

  /*
   * Remove athlete/team name and everything before a
   * spoiler-producing verb.
   */
  safeTitle = safeTitle.replace(
    /^.*?\b(wins?|won|claims?|claimed|captures?|captured|secures?|secured|takes?|took|beats?|beat|defeats?|defeated|dusts?|dusted|dominates?|dominated|crushes?|crushed|edges?|edged|holds?|held|storms?|stormed|prevails?|prevailed|outduels?|outdueled|outlasts?|outlasted|outkicks?|outkicked|becomes?|became|earns?|earned|clinches?|clinched|qualifies?|qualified|advances?|advanced|eliminates?|eliminated|sets?|set|breaks?|broke|goes?|went|cruises?|cruised|surges?|surged|delivers?|delivered|ices?|iced|regains?|regained|reclaims?|reclaimed|sneaks?|snuck|seals?|sealed|flourishes?|flourished|smashes?|smashed|retains?|retained|defends?|defended|defend|repeats?|repeated)\b\s*/i,
    ''
  );

  /*
   * Remove relay/title-defense spoiler phrases.
   */
  safeTitle = safeTitle.replace(
    /\b(retains?|retain|retained|defends?|defended|defend|relay\s+title|title\s+defense|title\s+defence|repeat(?:s)?\s+as\s+(?:champion|champions)|repeats?\s+as\s+(?:champion|champions)|back[-\s]?to[-\s]?back|successfully\s+defends?|successfully\s+defended|keeps?\s+(?:the\s+)?title|kept\s+(?:the\s+)?title|retains?\s+(?:the\s+)?crown|defends?\s+(?:the\s+)?crown|new\s+champion|new\s+champions)\b/gi,
    ''
  );

  /*
   * Remove scores and performance times.
   */
  safeTitle = safeTitle.replace(
    /\b\d+\s*[-:]\s*\d+\b/g,
    ''
  );

  safeTitle = safeTitle.replace(
    /\b\d+:\d+(?:\.\d+)?\b/g,
    ''
  );

  safeTitle = safeTitle.replace(
    /\b\d+\.\d+\b/g,
    ''
  );

  /*
   * Remove explicit achievement/result language.
   */
  safeTitle = safeTitle.replace(
    /\b(world\s+record|olympic\s+record|personal\s+best|national\s+record|gold\s+medal|silver\s+medal|bronze\s+medal|world-lead|world\s+lead|first\s+gold(?:\s+medal)?|first\s+medal|makes?\s+history|history\s+made|final\s+score|game\s+winner|walk[- ]?off|buzzer[- ]?beater|comeback|revenge|anchor\s+leg|full\s+second)\b/gi,
    ''
  );

  /*
   * Remove presentation/replay language.
   */
  safeTitle = safeTitle.replace(
    /\b(highlights?|full\s+game|full\s+match|full\s+race|recap|reaction|analysis|breakdown|extended|ending|postgame|post-game|on\s+loop)\b/gi,
    ''
  );

  /*
   * Remove standalone result statements such as:
   *
   * "English Wins"
   * "Burgin Withdraws"
   *
   * This is deliberately done after preserving the event.
   */
  safeTitle = safeTitle.replace(
    /\b[A-Z][a-z'’]+(?:\s+[A-Z][a-z'’]+)*\s+(?:wins?|won|withdraws?|withdrew|loses?|lost|qualifies?|qualified|advances?|advanced|fails?|failed|places?|placed)\b/gi,
    ''
  );

  /*
   * Restore preserved event names.
   */
  preservedEvents.forEach((event, index) => {
    safeTitle = safeTitle.replace(
      `__EVENT_${index}__`,
      event
    );
  });

  safeTitle = safeTitle
    .replace(/[|()[\]–—:]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  /*
   * IMPORTANT:
   *
   * Do NOT fall back to the original spoiler title.
   *
   * If we've identified result language but can't produce
   * something sufficiently safe, return a generic title
   * instead of exposing the original.
   */
  if (safeTitle.length >= 3) {
    return safeTitle;
  }

  if (eventName) {
    return source
      ? `${eventName} | ${source}`
      : eventName;
  }

  /*
   * Last-resort safe fallback.
   *
   * Better to show a generic "Sports video" label than
   * reveal the original title.
   */
  return 'Sports video';
}

function protectCurrentVideoTitle() {
  const titleElement =
    document.querySelector<HTMLElement>(
      '#title h1 yt-formatted-string'
    );

  if (!titleElement) {
    return;
  }

  /*
   * YouTube keeps the complete original title in the
   * `title` attribute.
   *
   * Always use this as the source rather than textContent,
   * because textContent may already contain our sanitized
   * title after a previous MutationObserver run.
   */
  const originalTitle =
    titleElement.getAttribute('title')?.trim() || '';

  if (!originalTitle) {
    return;
  }

  const safeTitle =
    generateSafeTitle(originalTitle);

  /*
   * Nothing to sanitize.
   */
  if (safeTitle === originalTitle) {
    return;
  }

  /*
   * YouTube can trigger the MutationObserver many times
   * while rendering the watch page. Don't keep replacing
   * the title if we've already applied this exact value.
   */
  if (
    titleElement.getAttribute(
      'data-spoiler-shield-safe-title'
    ) === safeTitle
  ) {
    return;
  }

  /*
   * Replace the contents of yt-formatted-string with
   * plain text.
   *
   * This intentionally removes YouTube's nested hashtag
   * link/spans because we're replacing the entire title
   * with our safe version.
   */
  titleElement.textContent = safeTitle;

  titleElement.setAttribute(
    'data-spoiler-shield-safe-title',
    safeTitle
  );

  document
    .querySelector<HTMLElement>('#title')
    ?.classList.add(
      'spoiler-shield-title-protected'
    );
}

function isShortCard(card: HTMLElement) {
  return (
    card.matches(
      'ytm-shorts-lockup-view-model-v2'
    ) ||
    card.matches(
      'ytm-shorts-lockup-view-model'
    )
  );
}

function isShortsShelf(card: HTMLElement) {
  return (
    card.matches(
      'ytm-shorts-lockup-view-model'
    ) &&
    card.querySelector(
      'ytm-shorts-lockup-view-model-v2'
    ) !== null
  );
}

function removeOverlayFromCard(card: HTMLElement) {
  card
    .querySelectorAll<HTMLAnchorElement>(
      '.spoiler-shield-overlay'
    )
    .forEach((overlay) => {
      overlay.remove();
    });

  const content =
    getBlurContainer(card);

  if (content) {
    content.classList.remove(
      'spoiler-shield-content-blurred'
    );
  }

  card.classList.remove(
    'spoiler-shield-card-host'
  );

  card
    .querySelectorAll<HTMLElement>(
      '.spoiler-shield-card-host'
    )
    .forEach((host) => {
      host.classList.remove(
        'spoiler-shield-card-host'
      );
    });
}

function getShortsThumbnailContainer(
  card: HTMLElement
) {
  return card.querySelector<HTMLElement>(
    '.shortsLockupViewModelHostThumbnailParentContainer'
  );
}

function hasDirectShortsLink(card: HTMLElement) {
  return (
    Array.from(
      card.querySelectorAll<HTMLAnchorElement>(
        'a.shortsLockupViewModelHostOutsideMetadataEndpoint, a.shortsLockupViewModelHostEndpoint'
      )
    ).some((link) => {
      const owner = link.closest(
        'ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model'
      );

      return owner === card;
    })
  );
}

function getBlurContainer(card: HTMLElement) {
  /*
   * Search results / normal video cards.
   */
  if (card.matches('ytd-video-renderer')) {
    return card.querySelector<HTMLElement>(
      '#dismissible'
    );
  }

  /*
   * Homepage / subscription / recommendation cards.
   */
  if (card.matches('ytd-rich-item-renderer')) {
    return card.querySelector<HTMLElement>(
      '#content'
    );
  }

  /*
   * Related-video / side-panel lockups.
   *
   * We blur the actual lockup rather than the parent
   * item-section container.
   */
  if (card.matches('yt-lockup-view-model')) {
    return card.querySelector<HTMLElement>(
      '.ytLockupViewModelHost'
    ) || card;
  }

  /*
   * Shorts search results.
   *
   * Blur the thumbnail/link inside the individual Short,
   * not the Short host itself. If the host gets blurred,
   * the overlay we append to it gets blurred and can be
   * affected by YouTube's hover treatment.
   */
  if (
    card.matches(
      'ytm-shorts-lockup-view-model-v2'
    ) ||
    card.matches(
      'ytm-shorts-lockup-view-model'
    )
  ) {
    if (
      isShortsShelf(card) ||
      !hasDirectShortsLink(card)
    ) {
      return null;
    }

    return (
      card.querySelector<HTMLElement>(
        'yt-thumbnail-view-model'
      ) ??
      card.querySelector<HTMLElement>(
        '.ytThumbnailViewModelImage'
      ) ??
      card.querySelector<HTMLElement>(
        'img'
      )
    );
  }

  return null;
}

function getOverlayContainer(
  card: HTMLElement
) {
  if (isShortCard(card)) {
    return getShortsThumbnailContainer(card);
  }

  return card;
}

function reinforceShortsOverlay(
  card: HTMLElement
) {
  if (!isShortCard(card)) {
    return;
  }

  const overlayContainer =
    getOverlayContainer(card);

  const content = getBlurContainer(card);

  const overlay =
    overlayContainer?.querySelector<HTMLElement>(
      ':scope > .spoiler-shield-overlay'
    );

  if (!overlayContainer || !overlay || !content) {
    return;
  }

  content.classList.add(
    'spoiler-shield-content-blurred'
  );

  overlayContainer.classList.add(
    'spoiler-shield-card-host'
  );

  if (overlayContainer.lastElementChild !== overlay) {
    overlayContainer.appendChild(overlay);
  }
}

function observeShortsOverlayContainer(
  card: HTMLElement
) {
  const overlayContainer =
    getOverlayContainer(card);

  if (
    !isShortCard(card) ||
    !overlayContainer ||
    observedShortsContainers.has(overlayContainer)
  ) {
    return;
  }

  observedShortsContainers.add(overlayContainer);

  let queued = false;

  const observer =
    new MutationObserver(() => {
      if (queued) {
        return;
      }

      queued = true;

      window.requestAnimationFrame(() => {
        queued = false;
        reinforceShortsOverlay(card);
      });
    });

  observer.observe(overlayContainer, {
    childList: true,
    subtree: true
  });
}

function getVideoLink(card: HTMLElement) {
  /*
   * Search results / normal video renderer.
   */
  if (card.matches('ytd-video-renderer')) {
    return (
      card.querySelector<HTMLAnchorElement>(
        'a#thumbnail'
      ) ??
      card.querySelector<HTMLAnchorElement>(
        'a#video-title'
      )
    );
  }

  /*
   * Shorts.
   */
  if (isShortCard(card)) {
    const shortsLink =
      card.querySelector<HTMLAnchorElement>(
        'a.shortsLockupViewModelHostOutsideMetadataEndpoint'
      ) ??
      card.querySelector<HTMLAnchorElement>(
        'a.shortsLockupViewModelHostEndpoint'
      );

    if (shortsLink) {
      return shortsLink;
    }
  }

  /*
   * Homepage / recommendations / side panel.
   */
  return card.querySelector<HTMLAnchorElement>(
    'a.ytLockupViewModelContentImage'
  );
}

function addOverlay(card: HTMLElement) {
  const overlayContainer =
    getOverlayContainer(card);

  if (!overlayContainer) {
    return;
  }

  if (
    overlayContainer.querySelector(
      ':scope > .spoiler-shield-overlay'
    )
  ) {
    return;
  }

  const content = getBlurContainer(card);

  if (!content) {
    return;
  }

  const link = getVideoLink(card);

  if (!link) {
    return;
  }

  /*
   * Ensure the actual video card is the positioning
   * context for the overlay.
   *
   * This prevents a Shorts shelf or search-results
   * container from becoming one giant overlay.
   */
  card.classList.add(
    'spoiler-shield-card-host'
  );

  overlayContainer.classList.add(
    'spoiler-shield-card-host'
  );

  content.classList.add(
    'spoiler-shield-content-blurred'
  );

  const metadata = getVideoMetadata(card);

  const originalTitle = getVideoTitle(card);
  const safeTitle =
    generateSafeTitle(originalTitle);

  const overlay =
    document.createElement('a');

  overlay.className =
    'spoiler-shield-overlay';

  /*
   * Use the exact URL from the underlying YouTube
   * link so native browser link behavior works:
   *
   * - left click
   * - middle click
   * - Ctrl/Cmd click
   * - right click → Open link in new tab
   * - right click → Copy link address
   */
  overlay.href = link.href;

  overlay.setAttribute(
    'aria-label',
    safeTitle || originalTitle || 'Sports video'
  );

  const isShort = isShortCard(card);

  /*
   * Shorts don't expose a channel name in the card
   * markup we have seen, so don't show "Unknown channel".
   */
  const showChannel =
    !isShort && !!metadata.channel;

  const showDuration =
    !isShort && !!metadata.duration;

  const overlayCard =
    document.createElement('div');

  overlayCard.className =
    'spoiler-shield-card';

  const icon =
    document.createElement('div');

  icon.className =
    'spoiler-shield-icon';

  icon.textContent = '🛡️';

  const title =
    document.createElement('div');

  title.className =
    'spoiler-shield-title';

  title.textContent =
    safeTitle || 'Sports video';

  overlayCard.append(icon, title);

  if (showChannel) {
    const channel =
      document.createElement('div');

    channel.className =
      'spoiler-shield-channel';

    channel.textContent = metadata.channel;
    overlayCard.appendChild(channel);
  }

  if (showDuration) {
    const details =
      document.createElement('div');

    details.className =
      'spoiler-shield-details';

    details.textContent = metadata.duration;
    overlayCard.appendChild(details);
  }

  overlay.appendChild(overlayCard);
  overlayContainer.appendChild(overlay);

  observeShortsOverlayContainer(card);
}

function protectVideo(card: HTMLElement) {
  /*
   * Never process a container that contains another
   * supported video-card type.
   *
   * This is the key protection against a giant overlay
   * over an entire search page or Shorts shelf.
   */
  if (isShortsShelf(card)) {
    removeOverlayFromCard(card);
    return;
  }

  const currentLink = getVideoLink(card);

  if (!currentLink) {
    return;
  }

  const currentHref = currentLink.href;

  if (isShortCard(card)) {
    card.classList.remove(
      'spoiler-shield-content-blurred'
    );
  }

  const existingOverlay =
    card.querySelector<HTMLAnchorElement>(
      ':scope > .spoiler-shield-overlay'
    ) ??
    getOverlayContainer(card)
      ?.querySelector<HTMLAnchorElement>(
        ':scope > .spoiler-shield-overlay'
      ) ??
    null;

  /*
   * Existing overlay is already for this exact video.
   */
  if (
    existingOverlay &&
    existingOverlay.href === currentHref
  ) {
    reinforceShortsOverlay(card);
    observeShortsOverlayContainer(card);
    return;
  }

  /*
   * Renderer was reused for a different video.
   * Remove old overlay and blur state.
   */
  if (existingOverlay) {
    existingOverlay.remove();
  }

  removeOverlayFromCard(card);

  addOverlay(card);
}

function getVideoCards(): HTMLElement[] {
  const cards: HTMLElement[] = [];

  // Main homepage, search, and subscription cards.
  document
    .querySelectorAll<HTMLElement>(
      'ytd-rich-item-renderer, ytd-video-renderer'
    )
    .forEach((card) => cards.push(card));

  // Side-panel / related-video lockups.
  // Exclude lockups already contained in a main card.
  document
    .querySelectorAll<HTMLElement>(
      'yt-lockup-view-model'
    )
    .forEach((card) => {
      if (
        !card.closest(
          'ytd-rich-item-renderer, ytd-video-renderer'
        )
      ) {
        cards.push(card);
      }
    });

  // Shorts search results.
  // Only process the individual Shorts lockup,
  // not the surrounding shelf.
  document
    .querySelectorAll<HTMLElement>(
      'ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model'
    )
    .forEach((card) => {
      if (
        !isShortsShelf(card) &&
        hasDirectShortsLink(card)
      ) {
        cards.push(card);
      }
    });

  return cards;
}

function processVideos(): void {
  getVideoCards().forEach((card) => {
    protectVideo(card);
  });

  protectCurrentVideoTitle();
}

function removeProtection(): void {
  document
    .querySelectorAll<HTMLElement>(
      '.spoiler-shield-overlay'
    )
    .forEach((overlay) => {
      overlay.remove();
    });

  document
    .querySelectorAll<HTMLElement>(
      '.spoiler-shield-content-blurred'
    )
    .forEach((content) => {
      content.classList.remove(
        'spoiler-shield-content-blurred'
      );
    });

  document
    .querySelectorAll<HTMLElement>(
      '.spoiler-shield-card-host'
    )
    .forEach((card) => {
      card.classList.remove(
        'spoiler-shield-card-host'
      );
    });

  const titleElement =
    document.querySelector<HTMLElement>(
      '#title h1 yt-formatted-string'
    );

  const originalTitle =
    titleElement
      ?.getAttribute('title')
      ?.trim();

  if (titleElement && originalTitle) {
    titleElement.textContent = originalTitle;
    titleElement.removeAttribute(
      'data-spoiler-shield-safe-title'
    );
  }

  document
    .querySelector<HTMLElement>('#title')
    ?.classList.remove(
      'spoiler-shield-title-protected'
    );
}

function getStoredConsent(
  callback: (choice: ConsentChoice | null) => void
) {
  const storage = chrome?.storage?.local;

  if (!storage) {
    callback(null);
    return;
  }

  storage.get([CONSENT_STORAGE_KEY], (values) => {
    const choice = values[
      CONSENT_STORAGE_KEY
    ];

    callback(
      choice === 'enabled' ||
        choice === 'disabled'
        ? choice
        : null
    );
  });
}

function storeConsent(
  choice: ConsentChoice,
  callback: () => void
) {
  const storage = chrome?.storage?.local;

  if (!storage) {
    callback();
    return;
  }

  storage.set(
    {
      [CONSENT_STORAGE_KEY]: choice
    },
    callback
  );
}

function showConsentModal(
  onChoice: (choice: ConsentChoice) => void
) {
  if (
    document.querySelector(
      '.spoiler-shield-consent'
    )
  ) {
    return;
  }

  const modal =
    document.createElement('div');

  modal.className =
    'spoiler-shield-consent';

  modal.setAttribute(
    'role',
    'dialog'
  );

  modal.setAttribute(
    'aria-modal',
    'true'
  );

  modal.setAttribute(
    'aria-labelledby',
    'spoiler-shield-consent-title'
  );

  modal.innerHTML = `
    <div class="spoiler-shield-consent-panel">
      <div class="spoiler-shield-consent-mark">
        🛡️
      </div>

      <h1 id="spoiler-shield-consent-title">
        Keep YouTube spoiler-safe?
      </h1>

      <p>
        Spoiler Stopper can blur video thumbnails and rewrite titles that may reveal sports results before you are ready to see them.
      </p>

      <p>
        Your choice is saved in this browser. Spoiler Stopper does not send your YouTube activity anywhere.
      </p>

      <div class="spoiler-shield-consent-actions">
        <button
          class="spoiler-shield-consent-primary"
          type="button"
          data-spoiler-shield-choice="enabled"
        >
          Turn on protection
        </button>

        <button
          class="spoiler-shield-consent-secondary"
          type="button"
          data-spoiler-shield-choice="disabled"
        >
          No thanks
        </button>
      </div>
    </div>
  `;

  modal.addEventListener('click', (event) => {
    const button =
      (event.target as HTMLElement).closest<
        HTMLButtonElement
      >('[data-spoiler-shield-choice]');

    if (!button) {
      return;
    }

    const choice =
      button.dataset.spoilerShieldChoice;

    if (
      choice !== 'enabled' &&
      choice !== 'disabled'
    ) {
      return;
    }

    storeConsent(choice, () => {
      modal.remove();
      onChoice(choice);
    });
  });

  document.body.appendChild(modal);

  modal
    .querySelector<HTMLButtonElement>(
      '[data-spoiler-shield-choice="enabled"]'
    )
    ?.focus();
}

function updateToggleButton(
  choice: ConsentChoice
) {
  const button =
    document.querySelector<HTMLButtonElement>(
      '.spoiler-shield-toggle'
    );

  if (!button) {
    return;
  }

  const isEnabled = choice === 'enabled';

  button.textContent = isEnabled
    ? 'Turn off Spoiler Stopper'
    : 'Turn on Spoiler Stopper';

  button.setAttribute(
    'aria-label',
    button.textContent
  );

  button.dataset.spoilerShieldState =
    choice;
}

function showToggleButton(
  choice: ConsentChoice
) {
  const existing =
    document.querySelector<HTMLButtonElement>(
      '.spoiler-shield-toggle'
    );

  if (existing) {
    updateToggleButton(choice);
    return;
  }

  const button =
    document.createElement('button');

  button.className =
    'spoiler-shield-toggle';

  button.type = 'button';

  button.addEventListener('click', () => {
    const nextChoice: ConsentChoice =
      button.dataset.spoilerShieldState ===
      'enabled'
        ? 'disabled'
        : 'enabled';

    storeConsent(nextChoice, () => {
      applyConsentChoice(nextChoice);
    });
  });

  document.body.appendChild(button);
  updateToggleButton(choice);
}

function startProtection() {
  if (protectionObserver) {
    processVideos();
    return;
  }

  processVideos();

  protectionObserver =
    new MutationObserver(() => {
      processVideos();
    });

  protectionObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function stopProtection() {
  protectionObserver?.disconnect();
  protectionObserver = null;
  removeProtection();
}

function applyConsentChoice(
  choice: ConsentChoice
) {
  if (choice === 'enabled') {
    startProtection();
  } else {
    stopProtection();
  }

  showToggleButton(choice);
}

function initializeSpoilerShield() {
  getStoredConsent((choice) => {
    if (choice) {
      applyConsentChoice(choice);
      return;
    }

    showConsentModal((selectedChoice) => {
      applyConsentChoice(selectedChoice);
    });
  });
}

initializeSpoilerShield();

import './content.css';

console.log('🛡️ Spoiler Shield loaded!');

function getVideoMetadata(card: HTMLElement) {
  let channel = '';

  // Homepage/feed — newer YouTube lockup cards
  const metadataRow = card.querySelector<HTMLElement>(
    'yt-content-metadata-view-model .ytContentMetadataViewModelMetadataRow'
  );

  if (metadataRow) {
    channel = metadataRow.textContent?.trim() || '';
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
    channel: channel || 'Unknown channel',
    duration,
    details: ''
  };
}

function getVideoTitle(card: HTMLElement) {
  let title = card.querySelector<HTMLElement>(
    '.ytLockupMetadataViewModelTitle'
  )?.textContent?.trim();

  if (!title) {
    title = card.querySelector<HTMLAnchorElement>(
      'a#video-title'
    )?.title?.trim();
  }

  // Shorts
  if (!title) {
    title = card.querySelector<HTMLAnchorElement>(
      'a.shortsLockupViewModelHostOutsideMetadataEndpoint'
    )?.title?.trim();
  }

  return title || '';
}

function generateSafeTitle(title: string) {
  const source = title.match(/\|\s*(.+)$/)?.[1]?.trim();

  /*
   * Detect the sporting event.
   *
   * This deliberately includes both individual events and
   * relay events such as 4x200m Freestyle.
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
    /\b(wins?|won|claims?|claimed|captures?|captured|secures?|secured|takes?|took|beats?|beat|defeats?|defeated|dusts?|dusted|dominates?|dominated|crushes?|crushed|edges?|edged|holds?|held|storms?|stormed|prevails?|prevailed|outduels?|outdueled|outlasts?|outlasted|outkicks?|outkicked|becomes?|became|earns?|earned|clinches?|clinched|qualifies?|qualified|advances?|advanced|eliminates?|eliminated|sets?|set|breaks?|broke|goes?|went|cruises?|cruised|surges?|surged|delivers?|delivered|ices?|iced|regains?|regained|reclaims?|reclaimed|sneaks?|snuck|seals?|sealed|flourishes?|flourished|smashes?|smashed|)\b/i;
  /*
   * Additional outcome phrases.
   *
   * These catch titles where the spoiler is expressed without
   * a normal "wins/claims/beats" verb.
   *
   * Examples:
   *   GB RETAIN RELAY TITLE!
   *   Athlete DEFENDS TITLE
   *   Team REPEAT AS CHAMPIONS
   *   Athlete IS THE NEW CHAMPION
   *   Athlete RETAINS CROWN
   */
 const spoilerPhrase =
  /\b(gold(?:\s+medal)?|silver(?:\s+medal)?|bronze(?:\s+medal)?|medal|regains?|reclaims?|retains?|retain|retained|defends?|defended|defend|relay\s+title|title\s+defen[cs]e|repeat(?:s)?\s+as\s+(?:champion|champions)|back[-\s]?to[-\s]?back|successfully\s+defends?|keeps?\s+(?:the\s+)?title|kept\s+(?:the\s+)?title|retains?\s+(?:the\s+)?crown|defends?\s+(?:the\s+)?crown|new\s+champion|new\s+champions|first\s+gold|first\s+medal|stunner|sneaks?\s+past|pulls?\s+off\s+a\s+stunner|ices?|world\s+record|full\s+second|personal\s+best|come[-\s]?from[-\s]?behind)\b/i;
  /*
   * If this looks like a spoiler title and we know the event,
   * rebuild it from the event rather than attempting to clean
   * the original sentence.
   *
   * This is especially useful for:
   *
   * "Nathan Green claims his first pro national championship
   *  with gritty 1500m win | NBC Sports"
   *
   * → "1500m | NBC Sports"
   *
   * and:
   *
   * "GB RETAIN RELAY TITLE! 🇬🇧 | Men's Swimming
   *  4X200m Freestyle Highlights"
   *
   * → "Men's 4x200m Freestyle | ..."
   */
  if ((spoilerVerb.test(title) || spoilerPhrase.test(title)) && eventName) {
    return source
      ? `${eventName} | ${source}`
      : eventName;
  }

  let safeTitle = title;

  /*
   * Preserve event names while removing times/scores/numbers.
   */
  const preservedEvents: string[] = [];

  safeTitle = safeTitle.replace(
    /\b(10000m|5000m|3000m|1500m|800m|400m|200m|100m|110m|60m|10k|5k|4x100m|4x200m|4x400m|4x800m)\b/gi,
    (match) => {
      const placeholder = `__EVENT_${preservedEvents.length}__`;

      preservedEvents.push(match);

      return placeholder;
    }
  );

  /*
   * Remove athlete/team name and everything before a spoiler verb.
   */
  safeTitle = safeTitle.replace(
    /^.*?\b(wins?|won|claims?|claimed|captures?|captured|secures?|secured|takes?|took|beats?|beat|defeats?|defeated|dusts?|dusted|dominates?|dominated|crushes?|crushed|edges?|edged|holds?|held|storms?|stormed|prevails?|prevailed|outduels?|outdueled|outlasts?|outlasted|outkicks?|outkicked|becomes?|became|earns?|earned|clinches?|clinched|qualifies?|qualified|advances?|advanced|eliminates?|eliminated|sets?|set|breaks?|broke|goes?|went|cruises?|cruised|surges?|surged)\b\s*/i,
    ''
  );

  /*
   * Remove relay/title-defense spoiler phrases when we're
   * cleaning rather than rebuilding the title.
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
    /\b(world\s+record|olympic\s+record|personal\s+best|national\s+record|gold\s+medal|silver\s+medal|bronze\s+medal|world-lead|world\s+lead|makes?\s+history|history\s+made|final\s+score|game\s+winner|walk[- ]?off|buzzer[- ]?beater|comeback|revenge)\b/gi,
    ''
  );

  /*
   * Remove presentation/replay language.
   */
  safeTitle = safeTitle.replace(
    /\b(highlights?|full\s+game|full\s+match|recap|reaction|analysis|breakdown|extended|ending|postgame|post-game)\b/gi,
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

  return safeTitle.length >= 3
    ? safeTitle
    : title;
}

function getBlurContainer(card: HTMLElement) {
  if (card.matches('ytd-video-renderer')) {
    return card.querySelector<HTMLElement>('#dismissible');
  }

  if (card.matches('ytd-rich-item-renderer')) {
    return card.querySelector<HTMLElement>('#content');
  }

  return null;
}

function getVideoLink(card: HTMLElement) {
  // Search results
  if (card.matches('ytd-video-renderer')) {
    return (
      card.querySelector<HTMLAnchorElement>('a#thumbnail') ??
      card.querySelector<HTMLAnchorElement>('a#video-title')
    );
  }

  // Shorts
  const shortsLink = card.querySelector<HTMLAnchorElement>(
    'a.shortsLockupViewModelHostOutsideMetadataEndpoint'
  );

  if (shortsLink) {
    return shortsLink;
  }

  // Homepage / recommendations
  return card.querySelector<HTMLAnchorElement>(
    'a.ytLockupViewModelContentImage'
  );
}

function addOverlay(card: HTMLElement) {
  if (card.querySelector('.spoiler-shield-overlay')) {
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

  content.classList.add(
    'spoiler-shield-content-blurred'
  );

  const metadata = getVideoMetadata(card);

  const originalTitle = getVideoTitle(card);
  const safeTitle = generateSafeTitle(originalTitle);

  /*
   * Use a real <a> element so native browser link behavior
   * continues to work:
   *
   * - left click
   * - middle click
   * - Ctrl/Cmd click
   * - right click → Open link in new tab
   * - right click → Copy link address
   */
  const overlay = document.createElement('a');

  overlay.className = 'spoiler-shield-overlay';

  // Use the exact URL from the underlying YouTube link.
  overlay.href = link.href;

  overlay.setAttribute(
    'aria-label',
    safeTitle || originalTitle
  );

  const isShort =
    card.querySelector(
      'ytm-shorts-lockup-view-model'
    ) !== null;

  overlay.innerHTML = `
    <div class="spoiler-shield-card">
      <div class="spoiler-shield-icon">
        🛡️
      </div>

      <div class="spoiler-shield-title">
        ${safeTitle}
      </div>

      ${
        !isShort && metadata.channel
          ? `
            <div class="spoiler-shield-channel">
              ${metadata.channel}
            </div>
          `
          : ''
      }

      ${
        !isShort && metadata.duration
          ? `
            <div class="spoiler-shield-details">
              ${metadata.duration}
            </div>
          `
          : ''
      }
    </div>
  `;

  card.appendChild(overlay);
}

function protectVideo(card: HTMLElement) {
  /*
   * YouTube reuses renderer elements when navigating/searching.
   *
   * Don't rely solely on a "processed" class because the
   * underlying video can change while the same renderer
   * element remains in the DOM.
   */
  const currentLink = getVideoLink(card);

  if (!currentLink) {
    return;
  }

  const currentHref = currentLink.href;

  const existingOverlay =
    card.querySelector<HTMLAnchorElement>(
      '.spoiler-shield-overlay'
    );

  /*
   * Existing overlay is already for this exact video.
   */
  if (
    existingOverlay &&
    existingOverlay.href === currentHref
  ) {
    return;
  }

  /*
   * Renderer was reused for a different video.
   * Remove the old overlay and blur state before rebuilding.
   */
  if (existingOverlay) {
    existingOverlay.remove();
  }

  const content = getBlurContainer(card);

  if (content) {
    content.classList.remove(
      'spoiler-shield-content-blurred'
    );
  }

  addOverlay(card);
}

function processVideos() {
  const cards = document.querySelectorAll<HTMLElement>(
    'ytd-rich-item-renderer, ytd-video-renderer'
  );

  cards.forEach((card) => {
    protectVideo(card);
  });
}

processVideos();

const observer = new MutationObserver(() => {
  processVideos();
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
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

type ConsentChoice =
  | 'enabled'
  | 'disabled';

let protectionObserver:
  | MutationObserver
  | null = null;

const observedShortsContainers =
  new WeakSet<HTMLElement>();

/*
 * Keep the original watch-page title outside of
 * YouTube's DOM mutations.
 *
 * This is important because once we replace the title,
 * YouTube may mutate/re-render the title element and
 * its attributes. We never want to use our sanitized
 * title as the source for a second sanitization pass.
 */
let originalWatchTitle = '';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function isSponsoredCard(
  card: HTMLElement
): boolean {
  /*
   * Do not run Spoiler Shield on ads/sponsored content.
   *
   * YouTube's ad DOM changes fairly frequently, so we
   * deliberately check several known indicators.
   */
  if (
    card.matches(
      'ytd-ad-slot-renderer, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer'
    )
  ) {
    return true;
  }

  if (
    card.querySelector(
      '[aria-label*="Sponsored" i], [aria-label*="Ad" i]'
    )
  ) {
    return true;
  }

  const text =
    card.textContent
      ?.trim()
      .toLowerCase() || '';

  /*
   * Only use this fallback when the card is very clearly
   * an advertising card. We don't want ordinary sports
   * titles containing words like "ad" to be excluded.
   */
  if (
    text.includes('sponsored') ||
    text.includes('sponsored content')
  ) {
    return true;
  }

  return false;
}

function cleanText(
  value: string
): string {
  return value
    .replace(/\s+/g, ' ')
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Metadata                                                                   */
/* -------------------------------------------------------------------------- */

function getVideoMetadata(
  card: HTMLElement
) {
  let channel = '';

  /*
   * Newer lockup cards / side panel.
   */
  const metadataRows =
    card.querySelectorAll<HTMLElement>(
      'yt-content-metadata-view-model .ytContentMetadataViewModelMetadataRow'
    );

  if (metadataRows.length > 0) {
    channel =
      cleanText(
        metadataRows[0]?.textContent || ''
      );
  }

  /*
   * Older homepage/feed cards.
   */
  if (!channel) {
    channel =
      cleanText(
        card
          .querySelector<HTMLAnchorElement>(
            'a.ytAttributedStringLink'
          )
          ?.textContent || ''
      );
  }

  /*
   * Search results / older renderer.
   */
  if (!channel) {
    channel =
      cleanText(
        card
          .querySelector<HTMLElement>(
            'ytd-channel-name yt-formatted-string'
          )
          ?.textContent || ''
      );
  }

  /*
   * Newer channel-link variants.
   */
  if (!channel) {
    channel =
      cleanText(
        card
          .querySelector<HTMLAnchorElement>(
            'a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"]'
          )
          ?.textContent || ''
      );
  }

  const duration =
    cleanText(
      card
        .querySelector('.ytBadgeShapeText')
        ?.textContent || ''
    );

  return {
    channel,
    duration,
    details: ''
  };
}

/* -------------------------------------------------------------------------- */
/* Title extraction                                                           */
/* -------------------------------------------------------------------------- */

function getVideoTitle(
  card: HTMLElement
): string {
  /*
   * Newer homepage / recommendation / side-panel lockups.
   */
  let title =
    card
      .querySelector<HTMLElement>(
        '.ytLockupMetadataViewModelTitle'
      )
      ?.textContent
      ?.trim() || '';

  /*
   * Search results.
   */
  if (!title) {
    const element =
      card.querySelector<HTMLAnchorElement>(
        'a#video-title'
      );

    title =
      element?.getAttribute('title')?.trim() ||
      element?.textContent?.trim() ||
      '';
  }

  /*
   * Shorts.
   */
  if (!title) {
    const element =
      card.querySelector<HTMLAnchorElement>(
        'a.shortsLockupViewModelHostOutsideMetadataEndpoint'
      );

    title =
      element?.getAttribute('title')?.trim() ||
      element?.textContent?.trim() ||
      '';
  }

  /*
   * Additional Shorts variant.
   */
  if (!title) {
    const element =
      card.querySelector<HTMLAnchorElement>(
        'a.shortsLockupViewModelHostEndpoint'
      );

    title =
      element?.getAttribute('title')?.trim() ||
      element?.textContent?.trim() ||
      '';
  }

  /*
   * Older / alternate video title selectors.
   */
  if (!title) {
    title =
      card
        .querySelector<HTMLElement>(
          '#video-title yt-formatted-string'
        )
        ?.textContent
        ?.trim() || '';
  }

  if (!title) {
    title =
      card
        .querySelector<HTMLElement>(
          '#video-title'
        )
        ?.textContent
        ?.trim() || '';
  }

  /*
   * Generic fallback for newer YouTube title elements.
   */
  if (!title) {
    title =
      card
        .querySelector<HTMLElement>(
          'h3, yt-formatted-string'
        )
        ?.textContent
        ?.trim() || '';
  }

  return cleanText(title);
}

/* -------------------------------------------------------------------------- */
/* Safe title generation                                                      */
/* -------------------------------------------------------------------------- */

function generateSafeTitle(
  title: string
): string {
  const originalTitle =
    cleanText(title);

  if (!originalTitle) {
    return 'Sports video';
  }

  /*
   * ------------------------------------------------------------------------
   * Safe source / publisher
   * ------------------------------------------------------------------------
   *
   * Example:
   *
   * "Messi scores 4 goals | ESPN FC"
   *
   * becomes:
   *
   * "Inter Miami vs. CF Montreal | ESPN FC"
   */
  const source =
    originalTitle.match(
      /\|\s*([^|]+?)\s*$/
    )?.[1]?.trim() || '';

  /*
   * ------------------------------------------------------------------------
   * Sporting event detection
   * ------------------------------------------------------------------------
   *
   * These describe WHAT is happening rather than WHO won.
   */
  const event =
    originalTitle.match(
      /\b(?:(Men'?s|Women'?s|Mixed)\s+)?(Mile|10000m|5000m|3000m(?:\s+steeplechase)?|1500m|800m|400m(?:\s+hurdles)?|200m|100m(?:\s+hurdles)?|110m(?:\s+hurdles)?|60m|10k|5k|Marathon|Pole\s+Vault|High\s+Jump|Long\s+Jump|Triple\s+Jump|Discus|Shot\s+Put|Hammer\s+Throw|Javelin|Decathlon|Heptathlon|4x100m(?:\s+(?:Mixed\s+)?Relay)?|4x200m(?:\s+(?:Mixed\s+)?Relay)?|4x400m(?:\s+(?:Mixed\s+)?Relay)?|4x800m(?:\s+(?:Mixed\s+)?Relay)?|Freestyle|Backstroke|Breaststroke|Butterfly|Individual\s+Medley|Relay)\b/i
    );

  const eventName =
    event
      ? `${event[1] ? `${event[1]} ` : ''}${event[2]}`
      : '';

  /*
   * ------------------------------------------------------------------------
   * Team / player vs. team / player detection
   * ------------------------------------------------------------------------
   *
   * Examples:
   *
   * Inter Miami vs. CF Montreal
   * Arsenal vs Chelsea
   * Lakers vs Celtics
   * Djokovic versus Alcaraz
   */
  const teamVsTeam =
    originalTitle.match(
      /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9.'’&-]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ0-9.'’&-]+){0,5})\s+(?:vs?\.?|versus)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9.'’&-]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ0-9.'’&-]+){0,5})/i
    );

  let matchupName = '';

  if (teamVsTeam) {
    matchupName =
      `${teamVsTeam[1].trim()} vs. ${teamVsTeam[2].trim()}`;

    /*
     * Strip obvious trailing competition/network words
     * that accidentally got captured.
     */
    matchupName =
      matchupName.replace(
        /\s+(?:MLS|NBA|NFL|NHL|NWSL|EPL|ESPN|FOX|CBS|NBC|TNT|TBS)\b.*$/i,
        ''
      );
  }

  /*
   * ------------------------------------------------------------------------
   * Competition / event context
   * ------------------------------------------------------------------------
   *
   * This is especially useful for track titles such as:
   *
   * "# UNBELIEVABLE! Josh Kerr STUNS and Breaks Mile for
   *  at London Diamond League 2026"
   *
   * We can safely preserve "London Diamond League 2026"
   * while removing the result.
   */
  const competition =
    originalTitle.match(
      /\b((?:London|Paris|Rome|Tokyo|Boston|New York|Los Angeles|Oregon|Doha|Brussels|Monaco|Zurich|Stockholm|Oslo)\s+(?:Diamond League|Grand Prix|Marathon|Games)\b(?:\s+\d{4})?)/i
    )?.[1]?.trim() || '';

  /*
   * More generic competition names.
   */
  const genericCompetition =
    originalTitle.match(
      /\b((?:Diamond League|World Championships?|Olympic Games?|Olympics|European Championships?|World Athletics|NCAA Championships?|College Football Playoff|Champions League|Europa League|Premier League|La Liga|Serie A|Bundesliga|MLS|NBA|NFL|NHL|NWSL|EPL)(?:\s+\d{4})?)\b/i
    )?.[1]?.trim() || '';

  const competitionName =
    competition ||
    genericCompetition;

  /*
   * ------------------------------------------------------------------------
   * Spoiler verbs
   * ------------------------------------------------------------------------
   */
  const spoilerVerb =
    /\b(?:wins?|won|win|claims?|claimed|captures?|captured|secures?|secured|takes?|took|beats?|beat|defeats?|defeated|dusts?|dusted|dominates?|dominated|crushes?|crushed|edges?|edged|holds?|held|storms?|stormed|prevails?|prevailed|outduels?|outdueled|outlasts?|outlasted|outkicks?|outkicked|becomes?|became|earns?|earned|clinches?|clinched|qualifies?|qualified|advances?|advanced|eliminates?|eliminated|sets?|set|breaks?|broke|goes?|went|cruises?|cruised|surges?|surged|delivers?|delivered|ices?|iced|regains?|regained|reclaims?|reclaimed|sneaks?|snuck|seals?|sealed|flourishes?|flourished|smashes?|smashed|retains?|retained|defends?|defended|defend|repeats?|repeated|stuns?|stunned|shocks?|shocked|upsets?|upset|stuns?|stunning)\b/i;

  /*
   * ------------------------------------------------------------------------
   * Result / achievement phrases
   * ------------------------------------------------------------------------
   */
  const spoilerPhrase =
    /\b(?:gold(?:\s+medal)?|silver(?:\s+medal)?|bronze(?:\s+medal)?|medal|relay\s+title|title\s+defen[cs]e|repeat(?:s)?\s+as\s+(?:champion|champions)|back[-\s]?to[-\s]?back|successfully\s+defends?|keeps?\s+(?:the\s+)?title|kept\s+(?:the\s+)?title|retains?\s+(?:the\s+)?crown|defends?\s+(?:the\s+)?crown|new\s+champion|new\s+champions|first\s+gold|first\s+medal|first\s+(?:pro\s+)?national\s+championship|stunner|sneaks?\s+past|pulls?\s+off\s+a\s+stunner|world\s+record|world[-\s]?lead|full\s+second|personal\s+best|national\s+record|olympic\s+record|come[-\s]?from[-\s]?behind|anchor\s+leg|youngest|ever|history(?:\s+made)?|makes?\s+history|comeback|revenge|buzzer[-\s]?beater|walk[-\s]?off|game\s+winner)\b/i;

  /*
   * ------------------------------------------------------------------------
   * Short result statements
   * ------------------------------------------------------------------------
   */
  const resultPhrase =
    /\b[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+(?:\s+[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+)*\s+(?:wins?|won|withdraws?|withdrew|loses?|lost|qualifies?|qualified|advances?|advanced|fails?|failed|places?|placed)\b/i;

  /*
   * ------------------------------------------------------------------------
   * Individual performance
   * ------------------------------------------------------------------------
   */
  const performanceSpoiler =
    /\b(?:scores?|scored|nets?|netted|bags?|bagged|drops?|dropped|hits?|hit|throws?|threw|runs?|ran)\s+(?:\d+\s+)?(?:goals?|times?|points?|runs?|home\s+runs?|touchdowns?|tries?|assists?|rebounds?|yards?|meters?|metres?)\b/i;

  /*
   * ------------------------------------------------------------------------
   * Scoring achievements
   * ------------------------------------------------------------------------
   */
  const scoringAchievement =
    /\b(?:hat[-\s]?trick|four[-\s]?goal(?:\s+haul)?|five[-\s]?goal(?:\s+haul)?|four\s+goals?|five\s+goals?|three\s+goals?|two\s+goals?)\b/i;

  /*
   * ------------------------------------------------------------------------
   * Explicit scorelines
   * ------------------------------------------------------------------------
   */
  const scoreline =
    /\b\d+\s*[-:–—]\s*\d+\b/;

  /*
   * ------------------------------------------------------------------------
   * Track/field result patterns
   *
   * These catch constructions like:
   *
   * "Breaks Mile"
   * "Breaks World Record"
   * "Sets New Record"
   * ------------------------------------------------------------------------
   */
  const athleticAchievement =
    /\b(?:breaks?|broke|sets?|set|smashes?|smash(?:es)?|runs?|ran)\s+(?:the\s+)?(?:mile|world\s+record|record|national\s+record|olympic\s+record|world\s+lead|personal\s+best)\b/i;

  /*
   * ------------------------------------------------------------------------
   * Overall spoiler detection
   * ------------------------------------------------------------------------
   */
  const hasSpoiler =
    spoilerVerb.test(originalTitle) ||
    spoilerPhrase.test(originalTitle) ||
    resultPhrase.test(originalTitle) ||
    performanceSpoiler.test(originalTitle) ||
    scoringAchievement.test(originalTitle) ||
    scoreline.test(originalTitle) ||
    athleticAchievement.test(originalTitle);

  /*
   * ------------------------------------------------------------------------
   * Best safe reconstruction
   * ------------------------------------------------------------------------
   *
   * Matchup is the most useful safe context.
   */
  if (hasSpoiler && matchupName) {
    return source
      ? `${matchupName} | ${source}`
      : matchupName;
  }

  /*
   * Track/field event + competition.
   *
   * Example:
   *
   * "# UNBELIEVABLE! Josh Kerr STUNS and Breaks Mile for
   *  at London Diamond League 2026"
   *
   * becomes approximately:
   *
   * "Mile | London Diamond League 2026"
   */
  if (hasSpoiler && eventName) {
    if (competitionName) {
      return `${eventName} | ${competitionName}`;
    }

    if (source) {
      return `${eventName} | ${source}`;
    }

    return eventName;
  }

  /*
   * If we have competition context but no formal event,
   * preserve that rather than returning "Sports video".
   */
  if (hasSpoiler && competitionName) {
    return competitionName;
  }

  /*
   * ------------------------------------------------------------------------
   * Generic sanitization fallback
   * ------------------------------------------------------------------------
   *
   * We only use this path when no clean matchup/event was
   * detected. Importantly, we NEVER return the original title
   * after spoiler detection.
   */
  let safeTitle =
    originalTitle;

  /*
   * Preserve numeric sporting events before removing
   * potentially spoiler-ish numeric information.
   */
  const preservedEvents: string[] = [];

  safeTitle =
    safeTitle.replace(
      /\b(10000m|5000m|3000m|1500m|800m|400m|200m|100m|110m|60m|10k|5k|4x100m|4x200m|4x400m|4x800m)\b/gi,
      (match) => {
        const placeholder =
          `__EVENT_${preservedEvents.length}__`;

        preservedEvents.push(match);

        return placeholder;
      }
    );

  /*
   * Remove scorelines.
   */
  safeTitle =
    safeTitle.replace(
      /\b\d+\s*[-:–—]\s*\d+\b/g,
      ''
    );

  /*
   * Remove performance statistics.
   */
  safeTitle =
    safeTitle.replace(
      /\b\d+\s+(?:goals?|points?|runs?|home\s+runs?|touchdowns?|tries?|assists?|rebounds?|yards?)\b/gi,
      ''
    );

  /*
   * Remove individual scoring language.
   */
  safeTitle =
    safeTitle.replace(
      /\b(?:scores?|scored|nets?|netted|bags?|bagged|drops?|dropped|hits?|hit)\b/gi,
      ''
    );

  /*
   * Remove athletic result constructions.
   */
  safeTitle =
    safeTitle.replace(
      /\b(?:breaks?|broke|sets?|set|smashes?|smash(?:es)?|stuns?|stunned|shocks?|shocked|upsets?|upset)\s+(?:the\s+)?(?:mile|world\s+record|record|national\s+record|olympic\s+record|world\s+lead|personal\s+best)\b/gi,
      ''
    );

  /*
   * Remove general result language.
   */
  safeTitle =
    safeTitle.replace(
      /\b(?:wins?|won|claims?|claimed|captures?|captured|secures?|secured|takes?|took|beats?|beat|defeats?|defeated|dusts?|dusted|dominates?|dominated|crushes?|crushed|edges?|edged|prevails?|prevailed|qualifies?|qualified|advances?|advanced|eliminates?|eliminated|clinches?|clinched|repeats?|repeated|defends?|defended|defend|retains?|retained|reclaims?|reclaimed|seals?|sealed|stuns?|stunned|shocks?|shocked|upsets?|upset)\b/gi,
      ''
    );

  /*
   * Remove explicit achievement phrases.
   */
  safeTitle =
    safeTitle.replace(
      /\b(?:world\s+record|olympic\s+record|personal\s+best|national\s+record|gold\s+medal|silver\s+medal|bronze\s+medal|world[-\s]?lead|first\s+gold(?:\s+medal)?|first\s+medal|makes?\s+history|history\s+made|final\s+score|game\s+winner|walk[-\s]?off|buzzer[-\s]?beater|comeback|revenge|anchor\s+leg|full\s+second|hat[-\s]?trick|stunner)\b/gi,
      ''
    );

  /*
   * Remove obvious hype words.
   */
  safeTitle =
    safeTitle.replace(
      /\b(?:unbelievable|unbelievable!|insane|incredible|incredible!|amazing|shocking|shocking!|wow|wow!|epic)\b/gi,
      ''
    );

  /*
   * Remove presentation/replay language.
   */
  safeTitle =
    safeTitle.replace(
      /\b(?:highlights?|full\s+game|full\s+match|full\s+race|recap|reaction|analysis|breakdown|extended|ending|postgame|post-game|on\s+loop)\b/gi,
      ''
    );

  /*
   * Remove short result statements.
   */
  safeTitle =
    safeTitle.replace(
      /\b[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+(?:\s+[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+)*\s+(?:wins?|won|withdraws?|withdrew|loses?|lost|qualifies?|qualified|advances?|advanced|fails?|failed|places?|placed)\b/gi,
      ''
    );

  /*
   * Restore event names.
   */
  preservedEvents.forEach(
    (eventValue, index) => {
      safeTitle =
        safeTitle.replace(
          `__EVENT_${index}__`,
          eventValue
        );
    }
  );

  /*
   * Clean punctuation.
   */
  safeTitle =
    safeTitle
      .replace(
        /[|()[\]{}–—:]/g,
        ' '
      )
      .replace(
        /\s{2,}/g,
        ' '
      )
      .trim();

  /*
   * Remove leading/trailing decorative punctuation.
   */
  safeTitle =
    safeTitle.replace(
      /^[#\-–—:!?.\s]+|[#\-–—:!?.\s]+$/g,
      ''
    );

  /*
   * If spoiler detected and useful content remains,
   * return the sanitized version.
   */
  if (
    hasSpoiler &&
    safeTitle.length >= 3
  ) {
    return source
      ? `${safeTitle} | ${source}`
      : safeTitle;
  }

  /*
   * Never expose the original title once a spoiler
   * has been positively identified.
   */
  if (hasSpoiler) {
    return 'Sports video';
  }

  /*
   * No spoiler detected.
   */
  return originalTitle;
}

/* -------------------------------------------------------------------------- */
/* Current video / watch page                                                 */
/* -------------------------------------------------------------------------- */

function getCurrentWatchTitleElement() {
  return document.querySelector<HTMLElement>(
    '#title h1 yt-formatted-string, #title h1'
  );
}

function getOriginalWatchTitle(
  titleElement: HTMLElement
): string {
  /*
   * First preference: our own stored value.
   *
   * This survives our own textContent replacement and
   * protects us from MutationObserver re-processing.
   */
  const stored =
    titleElement.getAttribute(
      'data-spoiler-shield-original-title'
    )?.trim();

  if (stored) {
    return stored;
  }

  /*
   * Next try YouTube's title attribute.
   */
  const attributeTitle =
    titleElement
      .getAttribute('title')
      ?.trim();

  /*
   * Finally use textContent.
   */
  const textTitle =
    titleElement.textContent
      ?.trim() || '';

  const original =
    attributeTitle ||
    textTitle;

  if (original) {
    titleElement.setAttribute(
      'data-spoiler-shield-original-title',
      original
    );
  }

  return original;
}

function protectCurrentVideoTitle() {
  const titleElement =
    getCurrentWatchTitleElement();

  if (!titleElement) {
    return;
  }

  /*
   * Capture the original title once.
   *
   * This is deliberately done before any replacement.
   */
  const originalTitle =
    originalWatchTitle ||
    getOriginalWatchTitle(
      titleElement
    );

  if (!originalTitle) {
    return;
  }

  originalWatchTitle =
    originalTitle;

  const safeTitle =
    generateSafeTitle(
      originalTitle
    );

  /*
   * No sanitization required.
   */
  if (
    safeTitle === originalTitle
  ) {
    return;
  }

  /*
   * Already applied.
   */
  if (
    titleElement.getAttribute(
      'data-spoiler-shield-safe-title'
    ) === safeTitle
  ) {
    return;
  }

  /*
   * Keep the original permanently on our own
   * data attribute.
   */
  titleElement.setAttribute(
    'data-spoiler-shield-original-title',
    originalTitle
  );

  titleElement.textContent =
    safeTitle;

  titleElement.setAttribute(
    'data-spoiler-shield-safe-title',
    safeTitle
  );

  document
    .querySelector<HTMLElement>(
      '#title'
    )
    ?.classList.add(
      'spoiler-shield-title-protected'
    );
}

/* -------------------------------------------------------------------------- */
/* Shorts                                                                     */
/* -------------------------------------------------------------------------- */

function isShortCard(
  card: HTMLElement
) {
  return (
    card.matches(
      'ytm-shorts-lockup-view-model-v2'
    ) ||
    card.matches(
      'ytm-shorts-lockup-view-model'
    )
  );
}

function isShortsShelf(
  card: HTMLElement
) {
  return (
    card.matches(
      'ytm-shorts-lockup-view-model'
    ) &&
    card.querySelector(
      'ytm-shorts-lockup-view-model-v2'
    ) !== null
  );
}

function removeOverlayFromCard(
  card: HTMLElement
) {
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

function hasDirectShortsLink(
  card: HTMLElement
) {
  return Array.from(
    card.querySelectorAll<HTMLAnchorElement>(
      'a.shortsLockupViewModelHostOutsideMetadataEndpoint, a.shortsLockupViewModelHostEndpoint'
    )
  ).some((link) => {
    const owner =
      link.closest(
        'ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model'
      );

    return owner === card;
  });
}

function getBlurContainer(
  card: HTMLElement
) {
  /*
   * Search results.
   */
  if (
    card.matches(
      'ytd-video-renderer'
    )
  ) {
    return card.querySelector<HTMLElement>(
      '#dismissible'
    );
  }

  /*
   * Homepage / subscription / recommendation cards.
   */
  if (
    card.matches(
      'ytd-rich-item-renderer'
    )
  ) {
    return card.querySelector<HTMLElement>(
      '#content'
    );
  }

  /*
   * Related-video / side-panel lockups.
   */
  if (
    card.matches(
      'yt-lockup-view-model'
    )
  ) {
    return (
      card.querySelector<HTMLElement>(
        '.ytLockupViewModelHost'
      ) || card
    );
  }

  /*
   * Shorts.
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
    return getShortsThumbnailContainer(
      card
    );
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

  const content =
    getBlurContainer(card);

  const overlay =
    overlayContainer?.querySelector<HTMLElement>(
      ':scope > .spoiler-shield-overlay'
    );

  if (
    !overlayContainer ||
    !overlay ||
    !content
  ) {
    return;
  }

  content.classList.add(
    'spoiler-shield-content-blurred'
  );

  overlayContainer.classList.add(
    'spoiler-shield-card-host'
  );

  if (
    overlayContainer.lastElementChild !==
    overlay
  ) {
    overlayContainer.appendChild(
      overlay
    );
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
    observedShortsContainers.has(
      overlayContainer
    )
  ) {
    return;
  }

  observedShortsContainers.add(
    overlayContainer
  );

  let queued = false;

  const observer =
    new MutationObserver(() => {
      if (queued) {
        return;
      }

      queued = true;

      window.requestAnimationFrame(
        () => {
          queued = false;
          reinforceShortsOverlay(
            card
          );
        }
      );
    });

  observer.observe(
    overlayContainer,
    {
      childList: true,
      subtree: true
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Video links                                                                */
/* -------------------------------------------------------------------------- */

function getVideoLink(
  card: HTMLElement
) {
  /*
   * Search results.
   */
  if (
    card.matches(
      'ytd-video-renderer'
    )
  ) {
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
    return (
      card.querySelector<HTMLAnchorElement>(
        'a.shortsLockupViewModelHostOutsideMetadataEndpoint'
      ) ??
      card.querySelector<HTMLAnchorElement>(
        'a.shortsLockupViewModelHostEndpoint'
      )
    );
  }

  /*
   * Homepage / recommendations / side panel.
   */
  return card.querySelector<HTMLAnchorElement>(
    'a.ytLockupViewModelContentImage'
  );
}

/* -------------------------------------------------------------------------- */
/* Overlay                                                                    */
/* -------------------------------------------------------------------------- */

function addOverlay(
  card: HTMLElement
) {
  if (isSponsoredCard(card)) {
    return;
  }

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

  const content =
    getBlurContainer(card);

  if (!content) {
    return;
  }

  const link =
    getVideoLink(card);

  if (!link) {
    return;
  }

  const originalTitle =
    getVideoTitle(card);

  /*
   * If YouTube hasn't exposed a title yet,
   * don't manufacture "Sports video".
   *
   * The MutationObserver will try again once the
   * card finishes rendering.
   */
  if (!originalTitle) {
    return;
  }

  const safeTitle =
    generateSafeTitle(
      originalTitle
    );

  card.classList.add(
    'spoiler-shield-card-host'
  );

  overlayContainer.classList.add(
    'spoiler-shield-card-host'
  );

  content.classList.add(
    'spoiler-shield-content-blurred'
  );

  const metadata =
    getVideoMetadata(card);

  const overlay =
    document.createElement('a');

  overlay.className =
    'spoiler-shield-overlay';

  overlay.href =
    link.href;

  overlay.setAttribute(
    'aria-label',
    safeTitle ||
      originalTitle
  );

  const isShort =
    isShortCard(card);

  const showChannel =
    !isShort &&
    !!metadata.channel;

  const showDuration =
    !isShort &&
    !!metadata.duration;

  const overlayCard =
    document.createElement('div');

  overlayCard.className =
    'spoiler-shield-card';

  const icon =
    document.createElement('div');

  icon.className =
    'spoiler-shield-icon';

  icon.textContent =
    '🛡️';

  const title =
    document.createElement('div');

  title.className =
    'spoiler-shield-title';

  title.textContent =
    safeTitle ||
    originalTitle;

  overlayCard.append(
    icon,
    title
  );

  if (showChannel) {
    const channel =
      document.createElement('div');

    channel.className =
      'spoiler-shield-channel';

    channel.textContent =
      metadata.channel;

    overlayCard.appendChild(
      channel
    );
  }

  if (showDuration) {
    const details =
      document.createElement('div');

    details.className =
      'spoiler-shield-details';

    details.textContent =
      metadata.duration;

    overlayCard.appendChild(
      details
    );
  }

  overlay.appendChild(
    overlayCard
  );

  overlayContainer.appendChild(
    overlay
  );

  observeShortsOverlayContainer(
    card
  );
}

/* -------------------------------------------------------------------------- */
/* Card protection                                                            */
/* -------------------------------------------------------------------------- */

function protectVideo(
  card: HTMLElement
) {
  /*
   * Never process ads.
   */
  if (isSponsoredCard(card)) {
    removeOverlayFromCard(card);
    return;
  }

  /*
   * Never process a Shorts shelf as though it were
   * an individual video.
   */
  if (isShortsShelf(card)) {
    removeOverlayFromCard(card);
    return;
  }

  const currentLink =
    getVideoLink(card);

  if (!currentLink) {
    return;
  }

  const currentHref =
    currentLink.href;

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
   * Existing overlay belongs to the same video.
   */
  if (
    existingOverlay &&
    existingOverlay.href ===
      currentHref
  ) {
    reinforceShortsOverlay(card);
    observeShortsOverlayContainer(
      card
    );
    return;
  }

  /*
   * Renderer reused for a different video.
   */
  if (existingOverlay) {
    existingOverlay.remove();
  }

  removeOverlayFromCard(card);

  addOverlay(card);
}

/* -------------------------------------------------------------------------- */
/* Card discovery                                                             */
/* -------------------------------------------------------------------------- */

function getVideoCards(): HTMLElement[] {
  const cards: HTMLElement[] = [];

  /*
   * Main homepage/search/subscription cards.
   */
  document
    .querySelectorAll<HTMLElement>(
      'ytd-rich-item-renderer, ytd-video-renderer'
    )
    .forEach((card) => {
      if (!isSponsoredCard(card)) {
        cards.push(card);
      }
    });

  /*
   * Related-video / side-panel lockups.
   */
  document
    .querySelectorAll<HTMLElement>(
      'yt-lockup-view-model'
    )
    .forEach((card) => {
      if (
        !card.closest(
          'ytd-rich-item-renderer, ytd-video-renderer'
        ) &&
        !isSponsoredCard(card)
      ) {
        cards.push(card);
      }
    });

  /*
   * Shorts search results.
   */
  document
    .querySelectorAll<HTMLElement>(
      'ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model'
    )
    .forEach((card) => {
      if (
        !isShortsShelf(card) &&
        hasDirectShortsLink(card) &&
        !isSponsoredCard(card)
      ) {
        cards.push(card);
      }
    });

  return cards;
}

/* -------------------------------------------------------------------------- */
/* Processing                                                                 */
/* -------------------------------------------------------------------------- */

function processVideos(): void {
  getVideoCards().forEach(
    (card) => {
      protectVideo(card);
    }
  );

  protectCurrentVideoTitle();
}

/* -------------------------------------------------------------------------- */
/* Remove protection                                                          */
/* -------------------------------------------------------------------------- */

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
    getCurrentWatchTitleElement();

  /*
   * Restore from OUR stored original rather than
   * relying on YouTube's title attribute.
   */
  const originalTitle =
    titleElement
      ?.getAttribute(
        'data-spoiler-shield-original-title'
      )
      ?.trim() ||
    originalWatchTitle;

  if (
    titleElement &&
    originalTitle
  ) {
    titleElement.textContent =
      originalTitle;

    titleElement.removeAttribute(
      'data-spoiler-shield-safe-title'
    );

    /*
     * Keep the original attribute around temporarily
     * so a re-render doesn't accidentally lose it.
     */
    titleElement.setAttribute(
      'data-spoiler-shield-original-title',
      originalTitle
    );
  }

  document
    .querySelector<HTMLElement>(
      '#title'
    )
    ?.classList.remove(
      'spoiler-shield-title-protected'
    );

  originalWatchTitle = '';
}

/* -------------------------------------------------------------------------- */
/* Consent                                                                    */
/* -------------------------------------------------------------------------- */

function getStoredConsent(
  callback: (
    choice:
      | ConsentChoice
      | null
  ) => void
) {
  const storage =
    chrome?.storage?.local;

  if (!storage) {
    callback(null);
    return;
  }

  storage.get(
    [CONSENT_STORAGE_KEY],
    (values) => {
      const choice =
        values[
          CONSENT_STORAGE_KEY
        ];

      callback(
        choice === 'enabled' ||
          choice === 'disabled'
          ? choice
          : null
      );
    }
  );
}

function storeConsent(
  choice: ConsentChoice,
  callback: () => void
) {
  const storage =
    chrome?.storage?.local;

  if (!storage) {
    callback();
    return;
  }

  storage.set(
    {
      [CONSENT_STORAGE_KEY]:
        choice
    },
    callback
  );
}

function showConsentModal(
  onChoice: (
    choice: ConsentChoice
  ) => void
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

  modal.addEventListener(
    'click',
    (event) => {
      const button =
        (
          event.target as HTMLElement
        ).closest<
          HTMLButtonElement
        >(
          '[data-spoiler-shield-choice]'
        );

      if (!button) {
        return;
      }

      const choice =
        button.dataset
          .spoilerShieldChoice;

      if (
        choice !== 'enabled' &&
        choice !== 'disabled'
      ) {
        return;
      }

      storeConsent(
        choice,
        () => {
          modal.remove();
          onChoice(choice);
        }
      );
    }
  );

  document.body.appendChild(
    modal
  );

  modal
    .querySelector<HTMLButtonElement>(
      '[data-spoiler-shield-choice="enabled"]'
    )
    ?.focus();
}

/* -------------------------------------------------------------------------- */
/* Toggle                                                                     */
/* -------------------------------------------------------------------------- */

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

  const isEnabled =
    choice === 'enabled';

  button.textContent =
    isEnabled
      ? 'Turn off Spoiler Stopper'
      : 'Turn on Spoiler Stopper';

  button.setAttribute(
    'aria-label',
    button.textContent
  );

  button.dataset
    .spoilerShieldState =
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
    document.createElement(
      'button'
    );

  button.className =
    'spoiler-shield-toggle';

  button.type = 'button';

  button.addEventListener(
    'click',
    () => {
      const nextChoice:
        ConsentChoice =
        button.dataset
          .spoilerShieldState ===
        'enabled'
          ? 'disabled'
          : 'enabled';

      storeConsent(
        nextChoice,
        () => {
          applyConsentChoice(
            nextChoice
          );
        }
      );
    }
  );

  document.body.appendChild(
    button
  );

  updateToggleButton(choice);
}

/* -------------------------------------------------------------------------- */
/* Start / stop                                                               */
/* -------------------------------------------------------------------------- */

function startProtection() {
  if (protectionObserver) {
    processVideos();
    return;
  }

  processVideos();

  protectionObserver =
    new MutationObserver(
      () => {
        processVideos();
      }
    );

  protectionObserver.observe(
    document.body,
    {
      childList: true,
      subtree: true
    }
  );
}

function stopProtection() {
  protectionObserver?.disconnect();
  protectionObserver = null;

  removeProtection();
}

/* -------------------------------------------------------------------------- */
/* Consent application                                                        */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Initialization                                                             */
/* -------------------------------------------------------------------------- */

function initializeSpoilerShield() {
  getStoredConsent(
    (choice) => {
      if (choice) {
        applyConsentChoice(
          choice
        );
        return;
      }

      showConsentModal(
        (selectedChoice) => {
          applyConsentChoice(
            selectedChoice
          );
        }
      );
    }
  );
}

initializeSpoilerShield();
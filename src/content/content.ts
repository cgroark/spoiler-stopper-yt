import './content.css';

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
 * --------------------------------------------------------------------------
 * Watch-page state
 * --------------------------------------------------------------------------
 */

let originalWatchTitle = '';
let originalWatchVideoId = '';

/*
 * Used to prevent the mutation observer from processing the entire page
 * hundreds of times during a single YouTube render.
 */
let processingQueued = false;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function cleanText(
  value: string
): string {
  return value
    .replace(/\s+/g, ' ')
    .trim();
}

function getCurrentVideoId(): string {
  try {
    const url =
      new URL(
        window.location.href
      );

    return (
      url.searchParams.get('v') ||
      ''
    );
  } catch {
    return '';
  }
}

function isWatchPage(): boolean {
  return (
    window.location.pathname ===
      '/watch' &&
    !!getCurrentVideoId()
  );
}

function isSponsoredCard(
  card: HTMLElement
): boolean {
  /*
   * Do not run Spoiler Shield on ads/sponsored content.
   */
  if (
    card.matches(
      'ytd-ad-slot-renderer, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer'
    ) ||
    card.querySelector(
      'ytd-ad-slot-renderer, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer'
    )
  ) {
    return true;
  }

  /*
   * Do not use an aria-label substring selector for "Ad" here. Video
   * titles and their aria-labels regularly contain those two letters in
   * ordinary words (for example, "Addresses" or "Drama"), which caused
   * legitimate cards to be mistaken for advertisements.
   */
  const labelledElements =
    card.querySelectorAll<HTMLElement>(
      '[aria-label]'
    );

  for (const element of labelledElements) {
    const label = cleanText(
      element.getAttribute('aria-label') || ''
    );

    if (
      /^(?:ad|advertisement|sponsored(?: content)?)(?:$|[\s:·-])/i.test(
        label
      )
    ) {
      return true;
    }
  }

  return false;
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
   *
   * IMPORTANT:
   * Search for the title only inside this individual Shorts card.
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
   * Generic fallback.
   */
  if (!title) {
    title =
      card
        .querySelector<HTMLElement>(
          'h3'
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
   * Source / publisher.
   */
  const source =
    originalTitle.match(
      /\|\s*([^|]+?)\s*$/
    )?.[1]?.trim() || '';

  /*
   * Sporting event detection.
   *
   * Numeric track events are deliberately preserved.
   */
  const event =
    originalTitle.match(
      /\b(?:(Men['’]?s|Women['’]?s|Mixed)\s+)?(Mile|10000m|5000m|3000m(?:\s+steeplechase)?|1500m|800m|400m(?:\s+hurdles)?|200m|100m(?:\s+hurdles)?|110m(?:\s+hurdles)?|60m|10k|5k|Marathon|Pole\s+Vault|High\s+Jump|Long\s+Jump|Triple\s+Jump|Discus|Shot\s+Put|Hammer\s+Throw|Javelin|Decathlon|Heptathlon|4x100m(?:\s+(?:Mixed\s+)?Relay)?|4x200m(?:\s+(?:Mixed\s+)?Relay)?|4x400m(?:\s+(?:Mixed\s+)?Relay)?|4x800m(?:\s+(?:Mixed\s+)?Relay)?|Freestyle|Backstroke|Breaststroke|Butterfly|Individual\s+Medley|Relay)\b/i
    );

  const eventName =
    event
      ? `${event[1] ? `${event[1]} ` : ''}${event[2]}`
      : '';

  /*
   * Matchup detection.
   */
  const teamVsTeam =
    originalTitle.match(
      /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9.'’&-]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ0-9.'’&-]+){0,5})\s+(?:vs?\.?|versus)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9.'’&-]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ0-9.'’&-]+){0,5})/i
    );

  let matchupName = '';

  if (teamVsTeam) {
    matchupName =
      `${teamVsTeam[1].trim()} vs. ${teamVsTeam[2].trim()}`;

    matchupName =
      matchupName.replace(
        /\s+(?:MLS|NBA|NFL|NHL|NWSL|EPL|ESPN|FOX|CBS|NBC|TNT|TBS)\b.*$/i,
        ''
      );
  }

  /*
   * Competition / event context.
   */
  const competition =
    originalTitle.match(
      /\b((?:\d{4}\s+)?(?:London|Paris|Rome|Tokyo|Boston|New York|Los Angeles|Abu Dhabi|Oregon|Doha|Brussels|Monaco|Zurich|Stockholm|Oslo)\s+(?:Diamond League|Grand Prix|Marathon|Games|Olympics)\b(?:\s+\d{4})?)/i
    )?.[1]?.trim() || '';

  /*
   * Generic competition names.
   */
  const genericCompetitionMatches =
    Array.from(
      originalTitle.matchAll(
        /\b((?:\d{4}\s+)?(?:Diamond League|World(?: Athletics| Ultimate)? Championships?|Olympic(?: Games?)?|Olympics|(?:US|U\.S\.) Olympic Trials|European Championships?|World Athletics|NCAA Championships?|NBA Finals|Masters|College Football Playoff|Champions League|Europa League|Premier League|La Liga|Serie A|Bundesliga|MLS|NBA|NFL|NHL|NWSL|EPL)(?:\s+\d{4})?)\b/gi
      )
    )
      .map((match) =>
        match[1]?.trim() || ''
      )
      .filter(Boolean);

  const genericCompetition =
    genericCompetitionMatches.find(
      (name) => /\b\d{4}\b/.test(name)
    ) ||
    genericCompetitionMatches[0] ||
    '';

  const competitionName =
    competition ||
    (/^Olympic$/i.test(genericCompetition)
      ? 'Olympics'
      : genericCompetition);

  const gameContext =
    originalTitle.match(
      /\b(Game\s+\d+)\s+of\s+(?:the\s+)?((?:\d{4}\s+)?(?:NBA|WNBA|NFL|NHL|MLB)\s+Finals?)\b/i
    );

  const gameContextName =
    gameContext
      ? `${gameContext[1]} | ${gameContext[2]}`
      : '';

  /*
   * Spoiler verbs.
   */
  const spoilerVerb =
    /\b(?:wins?|won|claims?|claimed|captures?|captured|secures?|secured|takes?|took|beats?|beat|defeats?|defeated|dusts?|dusted|dominates?|dominated|crushes?|crushed|edges?|edged|holds?|held|storms?|stormed|prevails?|prevailed|outduels?|outdueled|outlasts?|outlasted|outkicks?|outkicked|becomes?|became|earns?|earned|clinches?|clinched|qualifies?|qualified|advances?|advanced|eliminates?|eliminated|sets?|set|breaks?|broke|goes?|went|cruises?|cruised|surges?|surged|delivers?|delivered|ices?|iced|regains?|regained|reclaims?|reclaimed|sneaks?|snuck|seals?|sealed|flourishes?|flourished|smashes?|smashed|retains?|retained|defends?|defended|defend|repeats?|repeated|stuns?|stunned|shocks?|shocked|upsets?|upset)\b/i;

  /*
   * Result / achievement phrases.
   */
  const spoilerPhrase =
    /\b(?:gold(?:\s+medal)?|silver(?:\s+medal)?|bronze(?:\s+medal)?|medal|relay\s+title|world\s+title\s+celebrations?|crowning\s+moment|winning\s+putt|career\s+grand\s+slam|title\s+defen[cs]e|repeat(?:s)?\s+as\s+(?:champion|champions)|back[-\s]?to[-\s]?back|successfully\s+defends?|keeps?\s+(?:the\s+)?title|kept\s+(?:the\s+)?title|retains?\s+(?:the\s+)?crown|defends?\s+(?:the\s+)?crown|new\s+champion|new\s+champions|first\s+gold|first\s+medal|first\s+(?:pro\s+)?national\s+championship|stunner|sneaks?\s+past|pulls?\s+off\s+a\s+stunner|world\s+record|world[-\s]?lead|full\s+second|personal\s+best|national\s+record|olympic\s+record|come[-\s]?from[-\s]?behind|anchor\s+leg|youngest|ever|history(?:\s+made)?|makes?\s+history|comeback|revenge|buzzer[-\s]?beater|walk[-\s]?off|game\s+winner)\b/i;

  const championResult =
    /\b(?:new|reigning|becomes?(?:\s+the)?)\s+(?:(?:men['’]?s|women['’]?s)\s+)?(?:\d{2,5}m\s+)?(?:olympic\s+|world\s+|national\s+)?champions?\b/i;

  const progressionResult =
    /\b(?:coasts?|cruises?|storms?|powers?|eases?|sprints?)\s+(?:comfortably\s+)?into\s+(?:the\s+)?(?:(?:men['’]?s|women['’]?s)\s+)?(?:\d{2,5}m\s+)?(?:semi[-\s]?finals?|finals?)\b/i;

  /*
   * Short result statements.
   */
  const resultPhrase =
    /\b[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+(?:\s+[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+)*\s+(?:wins?|won|withdraws?|withdrew|loses?|lost|qualifies?|qualified|advances?|advanced|fails?|failed|places?|placed)\b/i;

  /*
   * Finishing positions, whether written as "7th place" or
   * "finished 7th", disclose the result just as directly as a win.
   */
  const placementResult =
    /\b(?:(?:finishes?|finished|finishing|places?|placed|placing|takes?|took|taking)\s+(?:\d{1,3}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:\s+place)?|(?:\d{1,3}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+place)\b/i;

  /*
   * Individual performance.
   */
  const performanceSpoiler =
    /\b(?:scores?|scored|nets?|netted|bags?|bagged|drops?|dropped|hits?|hit|throws?|threw|runs?|ran)\s+(?:\d+\s+)?(?:goals?|times?|points?|runs?|home\s+runs?|touchdowns?|tries?|assists?|rebounds?|yards?|meters?|metres?)\b/i;

  /*
   * Scoring achievements.
   */
  const scoringAchievement =
    /\b(?:hat[-\s]?trick|four[-\s]?goal(?:\s+haul)?|five[-\s]?goal(?:\s+haul)?|four\s+goals?|five\s+goals?|three\s+goals?|two\s+goals?)\b/i;

  /*
   * Explicit scorelines.
   */
  const scoreline =
    /\b\d+\s*[-:–—]\s*\d+\b/;

  /*
   * Track / field achievement.
   */
  const athleticAchievement =
    /\b(?:breaks?|broke|sets?|set|smashes?|smashed|runs?|ran|stuns?|stunned)\s+(?:the\s+)?(?:mile|world\s+record|record|national\s+record|olympic\s+record|world\s+lead|personal\s+best)\b/i;

  /*
   * Explicit "breaks + event" pattern.
   */
  const breaksEvent =
    /\b(?:breaks?|broke)\s+(?:the\s+)?(?:mile|10000m|5000m|3000m|1500m|800m|400m|200m|100m|110m|60m|10k|5k)\b/i;

  /*
   * Overall spoiler detection.
   */
  const hasSpoiler =
    spoilerVerb.test(originalTitle) ||
    spoilerPhrase.test(originalTitle) ||
    championResult.test(originalTitle) ||
    progressionResult.test(originalTitle) ||
    resultPhrase.test(originalTitle) ||
    placementResult.test(originalTitle) ||
    performanceSpoiler.test(originalTitle) ||
    scoringAchievement.test(originalTitle) ||
    scoreline.test(originalTitle) ||
    athleticAchievement.test(originalTitle) ||
    breaksEvent.test(originalTitle);

  /*
   * ------------------------------------------------------------------------
   * Best safe reconstruction
   * ------------------------------------------------------------------------
   */

  /*
   * Matchup is the most useful safe context.
   */
  if (
    hasSpoiler &&
    matchupName
  ) {
    return source
      ? `${matchupName} | ${source}`
      : matchupName;
  }

  if (
    hasSpoiler &&
    gameContextName
  ) {
    return gameContextName;
  }

  /*
   * Track / field event + competition.
   */
  if (
    hasSpoiler &&
    eventName
  ) {
    if (competitionName) {
      return `${eventName} | ${competitionName}`;
    }

    if (source) {
      return `${eventName} | ${source}`;
    }

    return eventName;
  }

  /*
   * Competition without a formal event.
   */
  if (
    hasSpoiler &&
    competitionName
  ) {
    return competitionName;
  }

  /*
   * Generic sanitization fallback.
   */

  let safeTitle =
    originalTitle;

  /*
   * Preserve numeric sporting events before removing numbers.
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
      /\b(?:breaks?|broke|sets?|set|smashes?|smashed|stuns?|stunned|shocks?|shocked|upsets?|upset)\s+(?:the\s+)?(?:mile|world\s+record|record|national\s+record|olympic\s+record|world\s+lead|personal\s+best)\b/gi,
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
      /\b(?:world\s+record|olympic\s+record|personal\s+best|national\s+record|gold(?:\s+medal)?|silver(?:\s+medal)?|bronze(?:\s+medal)?|world[-\s]?lead|first\s+gold(?:\s+medal)?|first\s+medal|makes?\s+history|history\s+made|final\s+score|game\s+winner|walk[-\s]?off|buzzer[-\s]?beater|comeback|revenge|anchor\s+leg|full\s+second|hat[-\s]?trick|stunner)\b/gi,
      ''
    );

  safeTitle =
    safeTitle.replace(
      /\s*-\s*YouTube\s*$/i,
      ''
    );

  /*
   * Remove obvious hype words.
   */
  safeTitle =
    safeTitle.replace(
      /\b(?:unbelievable|insane|incredible|amazing|shocking|wow|epic|unreal|ridiculous|sensational)\b/gi,
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
      /^[#\-–—:!?,.\s]+|[#\-–—:!?,.\s]+$/g,
      ''
    );

  /*
   * Never expose the original title after spoiler detection.
   */
  if (
    hasSpoiler &&
    safeTitle.length >= 3
  ) {
    return source
      ? `${safeTitle} | ${source}`
      : safeTitle;
  }

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

function getPlayerOverlayTitleElements(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '.ytp-fullscreen-metadata h2.ytPlayerOverlayVideoDetailsRendererTitle'
    )
  );
}

function setTitleText(
  titleElement: HTMLElement,
  title: string
) {
  const attributedText =
    titleElement.querySelector<HTMLElement>(
      ':scope > .ytAttributedStringHost'
    );

  if (attributedText) {
    attributedText.textContent = title;
  } else {
    titleElement.textContent = title;
  }
}

function getOriginalWatchTitle(
  titleElement: HTMLElement
): string {
  const currentVideoId =
    getCurrentVideoId();

  const storedVideoId =
    titleElement.getAttribute(
      'data-spoiler-shield-video-id'
    ) || '';

  const storedTitle =
    titleElement.getAttribute(
      'data-spoiler-shield-original-title'
    )?.trim() || '';

  if (
    storedTitle &&
    storedVideoId &&
    storedVideoId === currentVideoId
  ) {
    return storedTitle;
  }

  const attributeTitle =
    titleElement
      .getAttribute('title')
      ?.trim();

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

    if (currentVideoId) {
      titleElement.setAttribute(
        'data-spoiler-shield-video-id',
        currentVideoId
      );
    }
  }

  return original;
}

function resetWatchTitleStateIfVideoChanged() {
  const currentVideoId =
    getCurrentVideoId();

  if (
    currentVideoId &&
    currentVideoId !==
      originalWatchVideoId
  ) {
    originalWatchTitle = '';
    originalWatchVideoId =
      currentVideoId;
  }
}

function protectCurrentVideoTitle() {
  if (!isWatchPage()) {
    return;
  }

  resetWatchTitleStateIfVideoChanged();

  const titleElement =
    getCurrentWatchTitleElement();

  if (!titleElement) {
    return;
  }

  const currentVideoId =
    getCurrentVideoId();

  const elementVideoId =
    titleElement.getAttribute(
      'data-spoiler-shield-video-id'
    ) || '';

  /*
   * YouTube reused the title element for a different video.
   */
  if (
    elementVideoId &&
    currentVideoId &&
    elementVideoId !== currentVideoId
  ) {
    titleElement.removeAttribute(
      'data-spoiler-shield-original-title'
    );

    titleElement.removeAttribute(
      'data-spoiler-shield-safe-title'
    );

    titleElement.removeAttribute(
      'data-spoiler-shield-video-id'
    );

    originalWatchTitle = '';
  }

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

  originalWatchVideoId =
    currentVideoId;

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
    titleElement.removeAttribute(
      'data-spoiler-shield-safe-title'
    );

    document
      .querySelector<HTMLElement>(
        '#title'
      )
      ?.classList.remove(
        'spoiler-shield-title-protected'
      );

    return;
  }

  /*
   * Already applied to this exact title/video.
   */
  if (
    titleElement.getAttribute(
      'data-spoiler-shield-safe-title'
    ) === safeTitle &&
    titleElement.getAttribute(
      'data-spoiler-shield-video-id'
    ) === currentVideoId
  ) {
    return;
  }

  titleElement.setAttribute(
    'data-spoiler-shield-original-title',
    originalTitle
  );

  titleElement.setAttribute(
    'data-spoiler-shield-safe-title',
    safeTitle
  );

  titleElement.setAttribute(
    'data-spoiler-shield-video-id',
    currentVideoId
  );

  titleElement.textContent =
    safeTitle;

  document
    .querySelector<HTMLElement>(
      '#title'
    )
    ?.classList.add(
      'spoiler-shield-title-protected'
    );
}

function protectPlayerOverlayTitles() {
  if (!isWatchPage()) {
    return;
  }

  const currentVideoId =
    getCurrentVideoId();

  getPlayerOverlayTitleElements().forEach(
    (titleElement) => {
      const elementVideoId =
        titleElement.getAttribute(
          'data-spoiler-shield-video-id'
        ) || '';

      if (
        elementVideoId &&
        elementVideoId !== currentVideoId
      ) {
        titleElement.removeAttribute(
          'data-spoiler-shield-original-title'
        );
        titleElement.removeAttribute(
          'data-spoiler-shield-safe-title'
        );
        titleElement.removeAttribute(
          'data-spoiler-shield-video-id'
        );
      }

      const originalTitle =
        getOriginalWatchTitle(
          titleElement
        );

      if (!originalTitle) {
        return;
      }

      const safeTitle =
        generateSafeTitle(
          originalTitle
        );

      if (safeTitle === originalTitle) {
        titleElement.removeAttribute(
          'data-spoiler-shield-safe-title'
        );
        return;
      }

      titleElement.setAttribute(
        'data-spoiler-shield-original-title',
        originalTitle
      );
      titleElement.setAttribute(
        'data-spoiler-shield-safe-title',
        safeTitle
      );
      titleElement.setAttribute(
        'data-spoiler-shield-video-id',
        currentVideoId
      );

      if (
        cleanText(
          titleElement.textContent || ''
        ) !== safeTitle
      ) {
        setTitleText(
          titleElement,
          safeTitle
        );
      }
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Shorts                                                                     */
/* -------------------------------------------------------------------------- */

/*
 * A Shorts "shelf" can contain many individual Shorts.
 *
 * We must NEVER treat the shelf itself as the video card.
 *
 * The important distinction is:
 *
 *   ytm-shorts-lockup-view-model
 *       └── ytm-shorts-lockup-view-model-v2
 *
 * If a wrapper contains another Shorts lockup, the wrapper is a container,
 * not an individual video.
 */
function isShortCard(
  card: HTMLElement
): boolean {
  return (
    card.matches(
      'ytm-shorts-lockup-view-model-v2'
    ) ||
    (
      card.matches(
        'ytm-shorts-lockup-view-model'
      ) &&
      !card.querySelector(
        ':scope > ytm-shorts-lockup-view-model-v2'
      )
    )
  );
}

/*
 * A Shorts shelf/wrapper is anything that contains another Shorts card.
 */
function isShortsShelf(
  card: HTMLElement
): boolean {
  return (
    card.matches(
      'ytm-shorts-lockup-view-model'
    ) &&
    (
      card.querySelector(
        ':scope > ytm-shorts-lockup-view-model-v2'
      ) !== null ||
      card.querySelector(
        'ytm-shorts-lockup-view-model-v2'
      ) !== null
    )
  );
}

function removeOverlayFromCard(
  card: HTMLElement
) {
  card
    .querySelectorAll<HTMLElement>(
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

  setShortsTitleProtection(
    card,
    false
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
): HTMLElement | null {
  /*
   * Only search inside this exact Shorts card.
   *
   * :scope prevents us from accidentally climbing into or selecting
   * a shared parent container.
   */
  return (
    card.querySelector<HTMLElement>(
      ':scope > .shortsLockupViewModelHostThumbnailParentContainer'
    ) ??
    card.querySelector<HTMLElement>(
      '.shortsLockupViewModelHostThumbnailParentContainer'
    )
  );
}

function getDirectShortsLink(
  card: HTMLElement
): HTMLAnchorElement | null {
  /*
   * Prefer a link owned by THIS exact Shorts card.
   */
  const links =
    card.querySelectorAll<HTMLAnchorElement>(
      'a.shortsLockupViewModelHostOutsideMetadataEndpoint, a.shortsLockupViewModelHostEndpoint'
    );

  for (const link of links) {
    const owner =
      link.closest(
        'ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model'
      );

    if (owner === card) {
      return link;
    }
  }

  return null;
}

function hasDirectShortsLink(
  card: HTMLElement
): boolean {
  return !!getDirectShortsLink(
    card
  );
}

function setShortsTitleProtection(
  card: HTMLElement,
  protectedTitle: boolean
) {
  if (!isShortCard(card)) {
    return;
  }

  card
    .querySelectorAll<HTMLElement>(
      'a.shortsLockupViewModelHostOutsideMetadataEndpoint, .shortsLockupViewModelHostMetadataTitle'
    )
    .forEach((titleElement) => {
      const owner =
        titleElement.closest(
          'ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model'
        );

      if (owner !== card) {
        return;
      }

      titleElement.classList.toggle(
        'spoiler-shield-short-title-protected',
        protectedTitle
      );
    });
}

function getBlurContainer(
  card: HTMLElement
): HTMLElement | null {
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
   * Homepage / subscriptions / recommendations.
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
   *
   * IMPORTANT:
   * Only an individual Shorts card reaches this branch.
   */
  if (
    isShortCard(card)
  ) {
    const thumbnail =
      card.querySelector<HTMLElement>(
        ':scope > yt-thumbnail-view-model'
      ) ??
      card.querySelector<HTMLElement>(
        ':scope > .ytThumbnailViewModelImage'
      ) ??
      card.querySelector<HTMLElement>(
        ':scope img'
      );

    return thumbnail;
  }

  return null;
}

function getOverlayContainer(
  card: HTMLElement
): HTMLElement | null {
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

  /*
   * Make sure the blur is applied only to this Shorts thumbnail.
   */
  content.classList.add(
    'spoiler-shield-content-blurred'
  );

  setShortsTitleProtection(
    card,
    true
  );

  overlayContainer.classList.add(
    'spoiler-shield-card-host'
  );

  /*
   * YouTube may move/rebuild children during hover.
   *
   * Re-append the overlay to THIS card's thumbnail container rather
   * than allowing it to migrate into a shared Shorts shelf.
   */
  if (
    overlay.parentElement !==
    overlayContainer ||
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

          if (
            document.contains(
              card
            )
          ) {
            reinforceShortsOverlay(
              card
            );
          }
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
): HTMLAnchorElement | null {
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
   *
   * Only return a link belonging to THIS exact Shorts card.
   */
  if (isShortCard(card)) {
    return getDirectShortsLink(
      card
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
  if (
    isSponsoredCard(card) ||
    isShortsShelf(card)
  ) {
    return;
  }

  const overlayContainer =
    getOverlayContainer(card);

  if (!overlayContainer) {
    return;
  }

  /*
   * Only look for a direct overlay belonging to this exact container.
   */
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
   * YouTube sometimes creates the card before its title.
   */
  if (!originalTitle) {
    return;
  }

  const safeTitle =
    generateSafeTitle(
      originalTitle
    );

  /*
   * The card itself is the positioning context for normal videos.
   *
   * For Shorts, the thumbnail container is the positioning context.
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

  setShortsTitleProtection(
    card,
    true
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

  /*
   * IMPORTANT:
   * Append directly to the individual overlay container.
   *
   * We never append to a Shorts shelf.
   */
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
   * Never process a Shorts shelf/container.
   */
  if (isShortsShelf(card)) {
    /*
     * Only remove protection that is directly associated with this
     * container. We don't want removing a shelf-level element to
     * accidentally affect its individual Shorts.
     */
    card
      .querySelectorAll<HTMLElement>(
        ':scope > .spoiler-shield-overlay'
      )
      .forEach((overlay) => {
        overlay.remove();
      });

    return;
  }

  /*
   * A legacy Shorts wrapper that contains another Shorts lockup is
   * still not an individual card.
   */
  if (
    card.matches(
      'ytm-shorts-lockup-view-model'
    ) &&
    !isShortCard(card)
  ) {
    return;
  }

  const currentLink =
    getVideoLink(card);

  if (!currentLink) {
    return;
  }

  const currentHref =
    currentLink.href;

  const overlayContainer =
    getOverlayContainer(card);

  if (!overlayContainer) {
    return;
  }

  /*
   * Only inspect overlays directly belonging to this card/container.
   *
   * This is important for Shorts because querying the whole card can
   * otherwise find an overlay belonging to a nested/adjacent video.
   */
  const existingOverlay =
    overlayContainer.querySelector<HTMLAnchorElement>(
      ':scope > .spoiler-shield-overlay'
    );

  /*
   * Existing overlay belongs to this exact video.
   */
  if (
    existingOverlay &&
    existingOverlay.href ===
      currentHref
  ) {
    if (isShortCard(card)) {
      reinforceShortsOverlay(card);

      observeShortsOverlayContainer(
        card
      );
    }

    return;
  }

  /*
   * YouTube reused this renderer for a different video.
   */
  if (existingOverlay) {
    existingOverlay.remove();
  }

  /*
   * Remove classes associated with this exact card.
   */
  const content =
    getBlurContainer(card);

  content?.classList.remove(
    'spoiler-shield-content-blurred'
  );

  setShortsTitleProtection(
    card,
    false
  );

  card.classList.remove(
    'spoiler-shield-card-host'
  );

  overlayContainer.classList.remove(
    'spoiler-shield-card-host'
  );

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
   * ------------------------------------------------------------------------
   * Shorts
   * ------------------------------------------------------------------------
   *
   * IMPORTANT:
   *
   * Search for both known renderers, but ONLY add actual leaf cards.
   *
   * A wrapper containing another Shorts renderer is deliberately skipped.
   */
  document
    .querySelectorAll<HTMLElement>(
      'ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model'
    )
    .forEach((card) => {
      /*
       * Skip a Shorts shelf / wrapper.
       */
      if (isShortsShelf(card)) {
        return;
      }

      /*
       * Must have a link owned by this exact card.
       */
      if (!hasDirectShortsLink(card)) {
        return;
      }

      /*
       * Don't process sponsored content.
       */
      if (isSponsoredCard(card)) {
        return;
      }

      cards.push(card);
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
  protectPlayerOverlayTitles();
}

function queueProcessVideos(): void {
  if (processingQueued) {
    return;
  }

  processingQueued = true;

  window.requestAnimationFrame(
    () => {
      processingQueued = false;
      processVideos();
    }
  );
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

  document
    .querySelectorAll<HTMLElement>(
      '.spoiler-shield-short-title-protected'
    )
    .forEach((title) => {
      title.classList.remove(
        'spoiler-shield-short-title-protected'
      );
    });

  const titleElement =
    getCurrentWatchTitleElement();

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
    setTitleText(
      titleElement,
      originalTitle
    );

    titleElement.removeAttribute(
      'data-spoiler-shield-safe-title'
    );
  }

  getPlayerOverlayTitleElements().forEach(
    (overlayTitle) => {
      const overlayOriginalTitle =
        overlayTitle.getAttribute(
          'data-spoiler-shield-original-title'
        )?.trim();

      if (overlayOriginalTitle) {
        setTitleText(
          overlayTitle,
          overlayOriginalTitle
        );
      }

      overlayTitle.removeAttribute(
        'data-spoiler-shield-original-title'
      );
      overlayTitle.removeAttribute(
        'data-spoiler-shield-safe-title'
      );
      overlayTitle.removeAttribute(
        'data-spoiler-shield-video-id'
      );
    }
  );

  document
    .querySelector<HTMLElement>(
      '#title'
    )
    ?.classList.remove(
      'spoiler-shield-title-protected'
    );

  originalWatchTitle = '';
  originalWatchVideoId = '';
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
/* YouTube navigation                                                         */
/* -------------------------------------------------------------------------- */

function handleNavigation() {
  /*
   * YouTube is an SPA. Clear watch-page title state whenever navigation
   * happens so a previous video's title cannot leak into the next video.
   */
  originalWatchTitle = '';
  originalWatchVideoId = '';

  if (protectionObserver) {
    queueProcessVideos();
  }
}

/*
 * YouTube's SPA navigation events.
 */
document.addEventListener(
  'yt-navigate-finish',
  () => {
    handleNavigation();
  }
);

document.addEventListener(
  'yt-page-data-updated',
  () => {
    handleNavigation();
  }
);

/*
 * History API fallback.
 */
const originalPushState =
  history.pushState;

history.pushState =
  function (
    ...args: Parameters<
      History['pushState']
    >
  ) {
    originalPushState.apply(
      history,
      args
    );

    handleNavigation();
  };

const originalReplaceState =
  history.replaceState;

history.replaceState =
  function (
    ...args: Parameters<
      History['replaceState']
    >
  ) {
    originalReplaceState.apply(
      history,
      args
    );

    handleNavigation();
  };

window.addEventListener(
  'popstate',
  handleNavigation
);

/* -------------------------------------------------------------------------- */
/* Start / stop                                                               */
/* -------------------------------------------------------------------------- */

function startProtection() {
  if (protectionObserver) {
    queueProcessVideos();
    return;
  }

  processVideos();

  protectionObserver =
    new MutationObserver(
      () => {
        queueProcessVideos();
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

  processingQueued = false;

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

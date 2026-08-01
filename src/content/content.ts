import './content.css';

console.log('🛡️ Spoiler Shield loaded!');

function getVideoMetadata(card: HTMLElement) {
  // Homepage/feed channel
  let channel = card.querySelector(
    'a.ytAttributedStringLink'
  )?.textContent?.trim();

  // Search channel
  if (!channel) {
    channel = card.querySelector(
      'ytd-channel-name yt-formatted-string'
    )?.textContent?.trim();
  }

  // Homepage duration
  let duration = card.querySelector(
    '.ytBadgeShapeText'
  )?.textContent?.trim();

  return {
    channel: channel || 'Unknown channel',
    duration: duration || '',
    details: ''
  };
}

function getVideoTitle(card: HTMLElement) {
  // Homepage/feed title
  let title = card.querySelector<HTMLElement>(
    '.ytLockupMetadataViewModelTitle'
  )?.textContent?.trim();

  // Search title
  if (!title) {
    title = card.querySelector<HTMLAnchorElement>(
      'a#video-title'
    )?.title?.trim();
  }

  return title || '';
}

function generateSafeTitle(title: string) {
  // Try to preserve the broadcaster/network
  const source = title.match(/\|\s*(.+)$/)?.[1]?.trim();

  // Detect event
  const event = title.match(
    /\b(?:(Men'?s|Women'?s)\s+)?(10000m|5000m|3000m(?:\s+steeplechase)?|1500m|800m|400m(?:\s+hurdles)?|200m|100m(?:\s+hurdles)?|110m(?:\s+hurdles)?|60m|10k|5k|Marathon|Pole Vault|High Jump|Long Jump|Triple Jump|Discus|Shot Put|Hammer Throw|Javelin|Decathlon|Heptathlon|4x100m Relay|4x400m Relay)\b/i
  );

  const eventName = event
    ? `${event[1] ? `${event[1]} ` : ''}${event[2]}`
    : '';

  // Words that almost always reveal the outcome
  const spoilerVerb =
    /\b(wins?|won|claims?|claimed|captures?|captured|secures?|secured|takes?|took|beats?|beat|defeats?|defeated|dusts?|dusted|dominates?|dominated|crushes?|crushed|edges?|edged|holds?|held|storms?|stormed|prevails?|prevailed|outduels?|outdueled|outlasts?|outlasted|outkicks?|outkicked|becomes?|became|earns?|earned|clinches?|clinched|qualifies?|qualified|advances?|advanced|eliminates?|eliminated|sets?|set|breaks?|broke)\b/i;

  // If this looks like a spoiler title and we know the event,
  // rebuild it from scratch.
  if (spoilerVerb.test(title) && eventName) {
    return source
      ? `${eventName} | ${source}`
      : eventName;
  }

  let safeTitle = title;

  // Preserve event names while removing numbers
  const preservedEvents: string[] = [];

  safeTitle = safeTitle.replace(
    /\b(10000m|5000m|3000m|1500m|800m|400m|200m|100m|110m|60m|10k|5k)\b/gi,
    (match) => {
      const placeholder = `__EVENT_${preservedEvents.length}__`;
      preservedEvents.push(match);
      return placeholder;
    }
  );

  // Remove athlete name before spoiler verb
  safeTitle = safeTitle.replace(
    /^.*?\b(wins?|won|claims?|claimed|captures?|captured|secures?|secured|takes?|took|beats?|beat|defeats?|defeated|dusts?|dusted|dominates?|dominated|crushes?|crushed|edges?|edged|holds?|held|storms?|stormed|prevails?|prevailed|outduels?|outdueled|outlasts?|outlasted|outkicks?|outkicked|becomes?|became|earns?|earned|clinches?|clinched|qualifies?|qualified|advances?|advanced|eliminates?|eliminated|sets?|set|breaks?|broke|goes?|went|cruises?|cruised|surges?|surged)\b\s*/i,
    ''
  );

  safeTitle = safeTitle.replace(/\b\d+\s*[-:]\s*\d+\b/g, '');
  safeTitle = safeTitle.replace(/\b\d+:\d+(?:\.\d+)?\b/g, '');
  safeTitle = safeTitle.replace(/\b\d+\.\d+\b/g, '');

  safeTitle = safeTitle.replace(
    /\b(world\s+record|olympic\s+record|personal\s+best|national\s+record|gold\s+medal|silver\s+medal|bronze\s+medal|world-lead|world\s+lead|makes?\s+history|history\s+made|final\s+score|game\s+winner|walk[- ]?off|buzzer[- ]?beater|comeback|revenge)\b/gi,
    ''
  );

  safeTitle = safeTitle.replace(
    /\b(highlights?|full\s+game|full\s+match|recap|reaction|analysis|breakdown|extended|ending|postgame|post-game)\b/gi,
    ''
  );

  preservedEvents.forEach((event, index) => {
    safeTitle = safeTitle.replace(`__EVENT_${index}__`, event);
  });

  safeTitle = safeTitle
    .replace(/[|()[\]–—:]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return safeTitle.length >= 3 ? safeTitle : title;
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
  if (card.matches('ytd-video-renderer')) {
    return (
      card.querySelector<HTMLAnchorElement>('a#thumbnail') ??
      card.querySelector<HTMLAnchorElement>('a#video-title')
    );
  }

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

  content.classList.add(
    'spoiler-shield-content-blurred'
  );

  const metadata = getVideoMetadata(card);

  const originalTitle = getVideoTitle(card);
  const safeTitle = generateSafeTitle(originalTitle);

  const overlay = document.createElement('div');

  overlay.className = 'spoiler-shield-overlay';

  overlay.innerHTML = `
    <div class="spoiler-shield-card">
      <div class="spoiler-shield-icon">
        🛡️
      </div>

      <div class="spoiler-shield-title">
        ${safeTitle}
      </div>

      <div class="spoiler-shield-channel">
        ${metadata.channel}
      </div>

      <div class="spoiler-shield-details">
        ${metadata.duration}
      </div>
    </div>
  `;

  overlay.addEventListener('click', () => {
    const link = getVideoLink(card);

    if (link) {
      link.click();
    }
  });

  card.appendChild(overlay);
}

function protectVideo(card: HTMLElement) {
  if (card.classList.contains('spoiler-shield-processed')) {
    return;
  }

  card.classList.add(
    'spoiler-shield-processed'
  );

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
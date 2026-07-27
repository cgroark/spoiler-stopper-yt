import './content.css';

console.log('🛡️ Spoiler Shield loaded!');

function addOverlay(card: HTMLElement) {
  if (card.querySelector('.spoiler-shield-overlay')) {
    return;
  }

  const overlay = document.createElement('div');

  overlay.className = 'spoiler-shield-overlay';

  overlay.innerHTML = `
    <div class="spoiler-shield-message">
      <div>🛡️ Spoiler Hidden</div>
      <small>Click to reveal</small>
    </div>
  `;

  overlay.addEventListener('click', () => {
    overlay.remove();
  });

  card.appendChild(overlay);
}

function protectVideo(card: HTMLElement) {
  if (card.classList.contains('spoiler-shield-processed')) {
    return;
  }

  card.classList.add('spoiler-shield-processed');

  addOverlay(card);
}

function processVideos() {
  const cards = document.querySelectorAll<HTMLElement>(
    'ytd-rich-item-renderer'
  );

  cards.forEach((card) => {
    protectVideo(card);
  });
}

// Initial scan
processVideos();

// Watch for infinite scroll additions
const observer = new MutationObserver(() => {
  processVideos();
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
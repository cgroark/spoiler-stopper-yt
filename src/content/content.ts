import './content.css';

console.log('🛡️ Spoiler Shield loaded!');

function processVideos() {
  const cards = document.querySelectorAll<HTMLElement>(
    'ytd-rich-item-renderer'
  );

  cards.forEach((card) => {
    const thumbnail = card.querySelector<HTMLElement>(
      '.ytThumbnailViewModelImage'
    );

    if (thumbnail && !thumbnail.classList.contains('spoiler-shield-processed')) {
      thumbnail.classList.add(
        'spoiler-shield-blur',
        'spoiler-shield-processed'
      );
    }
  });
}

// Initial scan
processVideos();

// Watch for new videos being added
const observer = new MutationObserver(() => {
  processVideos();
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
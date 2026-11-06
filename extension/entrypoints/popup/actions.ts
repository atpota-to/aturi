import { browser } from '#imports';

export async function writeToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (err) {
    console.warn('[aturi:popup] clipboard write failed, falling back', err);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

/**
 * Close the popup once a link has had its moment: a plain anchor with
 * target="_blank" opens its tab on the click, and closing in the same tick
 * can cancel it.
 */
export function closePopupSoon(): void {
  window.setTimeout(() => window.close(), 50);
}

/** Open an aturi.to page in a new tab from a key press, then close. */
export async function openAturi(url: string): Promise<void> {
  try {
    await browser.tabs.create({ url });
  } catch (err) {
    console.warn('[aturi:popup] could not open tab', err);
    return;
  }
  window.close();
}

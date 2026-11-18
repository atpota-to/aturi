'use client';

import { useEffect } from 'react';

/**
 * Presses the shortcut chips on screen while their keys are held: every
 * `kbd[data-key]` naming a held key (the Kbd component's chips, the header
 * field's palette hint) takes `data-down` until the key comes up
 * (motion.css, "Small details"). Names are the bindings' own (`mod`,
 * `shift`, `k`, `escape`), so `mod` follows the platform: ⌘ on a Mac, Ctrl
 * elsewhere.
 *
 * Purely visual and listens passively: it never handles or stops a key.
 * Renders nothing.
 */
export default function KeyChipPress() {
  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const namesOf = (e: KeyboardEvent): string[] => {
      switch (e.key) {
        case 'Meta':
          return mac ? ['mod', 'meta'] : ['meta'];
        case 'Control':
          return mac ? ['ctrl'] : ['mod', 'ctrl'];
        case 'Shift':
          return ['shift'];
        case 'Alt':
          return ['alt'];
        case ' ':
          return ['space'];
        default:
          return e.key ? [e.key.toLowerCase()] : [];
      }
    };
    const chips = (name: string) =>
      document.querySelectorAll(`kbd[data-key~="${CSS.escape(name)}"]`);
    const releaseAll = () =>
      document.querySelectorAll('kbd[data-down]').forEach((k) => k.removeAttribute('data-down'));

    const down = (e: KeyboardEvent) => {
      for (const name of namesOf(e)) chips(name).forEach((k) => k.setAttribute('data-down', ''));
    };
    const up = (e: KeyboardEvent) => {
      // macOS sends no keyup for a key released while ⌘ is held, so letting
      // go of ⌘ lets go of everything.
      if (e.key === 'Meta') return releaseAll();
      for (const name of namesOf(e)) chips(name).forEach((k) => k.removeAttribute('data-down'));
    };

    window.addEventListener('keydown', down, { passive: true });
    window.addEventListener('keyup', up, { passive: true });
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', releaseAll);
    };
  }, []);
  return null;
}

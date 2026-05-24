import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';

type MessageTree = { [key: string]: string | string[] | MessageTree };

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const messages = (await import(`@/messages/${locale}.json`)).default as MessageTree;
  // Deep-merge over English so any missing key in a non-default locale falls
  // back to the English copy transparently.
  const merged: MessageTree =
    locale === routing.defaultLocale
      ? messages
      : deepMerge(
          (await import(`@/messages/${routing.defaultLocale}.json`)).default as MessageTree,
          messages,
        );

  return {
    locale,
    messages: merged,
    onError(error) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[i18n]', error.message);
      }
    },
    getMessageFallback({ key, namespace }) {
      return namespace ? `${namespace}.${key}` : key;
    },
  };
});

function deepMerge(base: MessageTree, override: MessageTree): MessageTree {
  const out: MessageTree = { ...base };
  for (const key of Object.keys(override)) {
    const a = base[key];
    const b = override[key];
    if (
      a &&
      b &&
      typeof a === 'object' &&
      !Array.isArray(a) &&
      typeof b === 'object' &&
      !Array.isArray(b)
    ) {
      out[key] = deepMerge(a as MessageTree, b as MessageTree);
    } else if (b !== undefined) {
      out[key] = b;
    }
  }
  return out;
}

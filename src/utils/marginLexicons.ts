/**
 * Margin Lexicon Utilities
 * Helper functions for detecting and working with at.margin.* records
 */

export type MarginLexiconType =
  | 'at.margin.annotation'
  | 'at.margin.bookmark'
  | 'at.margin.highlight'
  | 'at.margin.collection'
  | 'at.margin.collectionItem'
  | 'at.margin.reply'
  | 'at.margin.like'
  | null;

/**
 * Check if a collection is a margin lexicon
 */
export function isMarginLexicon(collection: string): boolean {
  return collection.startsWith('at.margin.');
}

/**
 * Get the specific margin lexicon type from a collection string
 */
export function getMarginLexiconType(collection: string): MarginLexiconType {
  if (!isMarginLexicon(collection)) {
    return null;
  }

  // Exact matches for supported margin lexicons
  switch (collection) {
    case 'at.margin.annotation':
      return 'at.margin.annotation';
    case 'at.margin.bookmark':
      return 'at.margin.bookmark';
    case 'at.margin.highlight':
      return 'at.margin.highlight';
    case 'at.margin.collection':
      return 'at.margin.collection';
    case 'at.margin.collectionItem':
      return 'at.margin.collectionItem';
    case 'at.margin.reply':
      return 'at.margin.reply';
    case 'at.margin.like':
      return 'at.margin.like';
    default:
      return null;
  }
}

/**
 * Check if the lexicon type has a custom preview component
 */
export function hasCustomMarginPreview(collection: string): boolean {
  return getMarginLexiconType(collection) !== null;
}

/**
 * Get a human-readable display name for a margin lexicon
 */
export function getMarginLexiconDisplayName(collection: string): string {
  const type = getMarginLexiconType(collection);
  
  switch (type) {
    case 'at.margin.annotation':
      return 'Annotation';
    case 'at.margin.bookmark':
      return 'Bookmark';
    case 'at.margin.highlight':
      return 'Highlight';
    case 'at.margin.collection':
      return 'Collection';
    case 'at.margin.collectionItem':
      return 'Collection Item';
    case 'at.margin.reply':
      return 'Reply';
    case 'at.margin.like':
      return 'Like';
    default:
      return collection.replace('at.margin.', '');
  }
}

/**
 * Get a short description for a margin lexicon type
 */
export function getMarginLexiconDescription(collection: string): string {
  const type = getMarginLexiconType(collection);
  
  switch (type) {
    case 'at.margin.annotation':
      return 'Annotate and comment on web content';
    case 'at.margin.bookmark':
      return 'Bookmarked webpage';
    case 'at.margin.highlight':
      return 'Highlighted text from a webpage';
    case 'at.margin.collection':
      return 'Collection of annotations and bookmarks';
    case 'at.margin.collectionItem':
      return 'Item in a collection';
    case 'at.margin.reply':
      return 'Reply to an annotation';
    case 'at.margin.like':
      return 'Like on an annotation or reply';
    default:
      return 'Margin record';
  }
}

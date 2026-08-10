# Contributing to aturi.to

Thanks for your interest in contributing! This project is open source under GPL v3, and we welcome improvements from the community.

## Ways to Contribute

### 1. Report Issues

Found a bug or have a feature idea? [Open an issue](https://github.com/yourusername/aturi-to/issues) with:
- Clear description of the problem or idea
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Screenshots if relevant

### 2. Add New Waypoints

Want to add support for a new ATProto client?

Edit `src/utils/waypoints.data.ts` and add your platform to `WAYPOINT_DESTINATIONS_DATA`, then add its id to `WAYPOINT_ORDER`:

```typescript
{
  id: 'yourPlatform',
  name: 'Your Platform',
  description: 'View profile on yourplatform.com',
  getUrl: (handle, collection, rkey) => {
    if (collection === 'app.bsky.feed.post' && rkey) {
      return `https://yourplatform.com/profile/${handle}/post/${rkey}`;
    }
    return `https://yourplatform.com/profile/${handle}`;
  },
  supportedTypes: ['post', 'profile', 'record'],
  category: 'blueskyClients',
  redirectCompat: ['bluesky-social'],
  expectedCollections: ['app.bsky.'],
  // Optional: only if your client handles Bluesky-style intent links
  // (https://docs.bsky.app/docs/advanced-guides/intent-links). Omit
  // `textParam` if the route opens the composer but ignores the text.
  composeIntent: { url: 'https://yourplatform.com/intent/compose', textParam: 'text' },
}
```

Only claim `supportedTypes` and `composeIntent` your client actually handles — a route that 404s or silently drops the user on their home feed is worse than not being offered. The packages ship copies of this file, so run `npm run sync` in `packages/waypoints` before opening the PR.

Then submit a pull request!

### 3. Improve Documentation

Documentation improvements are always welcome:
- Fix typos or unclear explanations
- Add examples
- Translate to other languages
- Update setup instructions

### 4. Submit Code Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Test locally: `npm run dev`
5. Commit with clear messages: `git commit -m "Add feature: description"`
6. Push and create a pull request

#### Code Guidelines

- Follow the existing code style
- Keep changes focused and minimal
- Test your changes locally
- Update documentation if needed
- Don't add unnecessary dependencies

### 5. Share Your Fork

Created a fork for a specific community or use case? Let us know! We'd love to feature it.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/aturi-to.git
cd aturi-to

# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:3000
```

## Testing

Before submitting:

1. Test profile links work
2. Test post/record links work
3. Check OG images generate correctly
4. Verify waypoint picker displays properly
5. Test on mobile if UI changes

## License

By contributing, you agree that your contributions will be licensed under GPL v3.

## Questions?

Feel free to open an issue for questions or reach out to the maintainer.

---

Thank you for contributing to the ATProto ecosystem!


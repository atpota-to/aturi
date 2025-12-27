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

Edit `src/utils/waypoints.tsx` and add your platform:

```typescript
{
  id: 'your-platform',
  name: 'Your Platform',
  urlPattern: (repo, collection, rkey) => {
    if (!collection) return `https://yourplatform.com/profile/${repo}`;
    return `https://yourplatform.com/profile/${repo}/post/${rkey}`;
  },
}
```

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


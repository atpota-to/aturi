# aturi.to

Universal links for the ATmosphere. Share ATProto content with anyone, let them choose where to view it.

## What is aturi.to?

aturi.to is a simple service that makes it easy to share ATProto content across different clients. When someone visits an aturi.to link, they see all available platforms where they can view that content (Bluesky, Anisota, Blacksky, Leaflet, pdsls, atp.tools, etc.) and can choose their preferred one.

## Features

- **Universal Sharing**: One link works everywhere
- **Platform Agnostic**: Recipients choose their preferred ATProto client
- **Rich Previews**: Dynamic OpenGraph images for beautiful social sharing
- **Easy Integration**: Simple URL structure, no API keys required

## URL Structure

### For profiles:
```
aturi.to/[handle or did]
```
Example: `aturi.to/alice.bsky.social`

### For records (posts, lists, etc.):
```
aturi.to/[handle or did]/[collection]/[rkey]
```
Example: `aturi.to/alice.bsky.social/app.bsky.feed.post/3k7qw...`

## Running Locally

### Prerequisites

- Node.js 20.9.0 or higher (use `.nvmrc` file with nvm: `nvm use`)

### Steps

1. Clone the repository:
```bash
git clone https://github.com/yourusername/aturi-to.git
cd aturi-to
```

2. Use the correct Node version (if using nvm):
```bash
nvm use
```

3. Install dependencies:
```bash
npm install
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment

This project is designed to be deployed on Vercel for optimal OG image generation:

1. Push your code to GitHub
2. Import the repository in Vercel
3. Deploy!

The site will automatically use Vercel's Edge Runtime for OG image generation.

## Integration

Want to add aturi.to links to your app? Check out the [Integration Guide](https://aturi.to/integrate) for code examples and best practices.

### Quick Example (TypeScript)

```typescript
function toAturiLink(atUri: string): string {
  const uri = atUri.replace('at://', '');
  return `https://aturi.to/${uri}`;
}
```

## Tech Stack

- **Next.js 16** - App Router with React Server Components
- **TypeScript** - Type safety throughout
- **@vercel/og** - Dynamic OpenGraph image generation
- **@vercel/analytics** - Privacy-focused analytics
- **Tailwind CSS** - Utility-first styling (v4)

## Contributing

This is a community tool for the ATProto ecosystem. Contributions are welcome!

## Forking & Custom Domains

Want to run your own instance with a custom domain? aturi.to is designed to be forkable!

### Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/aturi-to.git my-custom-instance
cd my-custom-instance

# Run the interactive setup
npm run setup-fork

# Start developing
npm install
npm run dev
```

**See [QUICKSTART.md](QUICKSTART.md) for a complete 10-minute setup guide.**

The setup script will help you configure:
- Your custom domain
- Site branding and metadata  
- Attribution information
- Environment variables

### More Resources

- [Quick Start Guide](QUICKSTART.md) - Get running in 10 minutes
- [Forking Guide](FORKING.md) - Detailed customization instructions
- [Contributing Guide](CONTRIBUTING.md) - How to contribute back

When forking, please keep your source code open (GPL v3) and credit the original project.

## License

This project is licensed under the GNU General Public License v3.0 or later - see the [LICENSE](LICENSE) file for details.

**GPL v3 ensures:** All forks and modifications must remain open source and credit the original work. When you fork aturi.to, you must share your source code and maintain the same GPL v3 license.

## Acknowledgments

Built for the ATProto ecosystem and inspired by the need for universal, platform-agnostic sharing.

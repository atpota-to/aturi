# Forking aturi.to for Custom Domains

This guide explains how to run your own instance of aturi.to with a custom domain.

## Why Fork?

You might want to fork aturi.to if you:

- Want to run an instance for a specific community or region
- Need to customize the list of available platforms/waypoints
- Want to add custom branding or features
- Prefer to self-host for reliability or privacy reasons

## Prerequisites

- A custom domain name (e.g., `myshare.app`)
- A Vercel account (or similar platform that supports Next.js Edge Runtime)
- Node.js 20.9.0 or higher
- Git

## Setup Steps

### Quick Setup (Recommended)

We provide an interactive setup script that makes forking easy:

```bash
# After cloning, run the setup script
node scripts/setup-fork.js
```

This will:
- Ask for your domain, name, and other details
- Create a `.env.local` file with your configuration
- Provide next steps for customization

### Manual Setup

If you prefer to configure manually:

### Manual Setup

If you prefer to configure manually:

#### 1. Fork the Repository

```bash
git clone https://github.com/yourusername/aturi-to.git my-custom-aturi
cd my-custom-aturi
```

#### 2. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env.local
```

Then edit `.env.local` with your settings:

```bash
NEXT_PUBLIC_DOMAIN=yourdomain.com
NEXT_PUBLIC_SITE_NAME=Your Site Name
NEXT_PUBLIC_AUTHOR_NAME=Your Name
NEXT_PUBLIC_REPO_URL=https://github.com/yourusername/your-fork
```

See `src/lib/config.ts` for all available configuration options.

#### 3. Install Dependencies

```bash
npm install
```

##### 4. Customize Waypoints

Edit `src/utils/waypoints.tsx` to add, remove, or reorder platforms:

```typescript
export const waypoints: Waypoint[] = [
  {
    id: 'bluesky',
    name: 'Bluesky',
    urlPattern: (repo, collection, rkey) => {
      if (!collection) return `https://bsky.app/profile/${repo}`;
      return `https://bsky.app/profile/${repo}/post/${rkey}`;
    },
  },
  // Add your custom platforms here
];
```

#### 5. Update Branding

- Replace logo in `public/` directory
- Update site metadata in `src/app/layout.tsx`
- Customize colors and styles in `src/app/globals.css`

#### 6. Test Locally

```bash
npm run dev
```

Visit `http://localhost:3000` and test your instance.

##### 7. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Add environment variables in Vercel dashboard
# Settings > Environment Variables

# Add your custom domain in Vercel dashboard
# Settings > Domains > Add Domain
```

#### 8. Test Your Instance

Visit your custom domain and test:

- Profile links: `yourdomain.com/alice.bsky.social`
- Post links: `yourdomain.com/alice.bsky.social/app.bsky.feed.post/3k7qw...`
- OG image generation: Check social media previews
- Integration examples on `/integrate` page

## Attribution Requirements

**IMPORTANT:** Per the GPL v3 license, you must:

1. **Keep the source code open** - All forks must remain open source under GPL v3
2. **Provide the LICENSE file** - Include the full GPL v3 license text
3. **Mark your changes** - Indicate what you've modified from the original
4. **Provide source code** - Anyone using your fork must be able to get the source

### Required Attribution

Add attribution in your fork's:

1. **README** - Include the original copyright and attribution:

```markdown
## Attribution

This project is a fork of [aturi.to](https://aturi.to) originally created by dame.

Original repository: https://github.com/yourusername/aturi-to

## License

This project is licensed under the GNU General Public License v3.0 or later, 
same as the original aturi.to project.
```

2. **Source Files** - If you add new files, include GPL v3 headers:

```typescript
/*
 * This file is part of YourFork (based on aturi.to by dame)
 * 
 * YourFork is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
```

3. **Footer/About Page** - Keep or add attribution information in the UI

### GPL v3 Benefits

- **Copyleft protection**: Ensures all derivatives remain free and open
- **Patent protection**: Provides patent license grants
- **Tivoization protection**: Prevents hardware lockdown of software
- **Strong community**: Well-understood, widely-used license

### Optional but Appreciated

- Link back to aturi.to in blog posts or announcements
- Contribute improvements back to the upstream project
- Mention aturi.to when sharing your fork on social media

## Maintaining Your Fork

### Stay Updated with Upstream

Add the original repository as a remote:

```bash
git remote add upstream https://github.com/yourusername/aturi-to.git
git fetch upstream
git merge upstream/main
```

### Handle Conflicts

When merging upstream changes with your customizations:

```bash
git merge upstream/main
# Resolve conflicts in your editor
git add .
git commit -m "Merge upstream updates"
```

## Environment-Specific Configuration

For multi-environment setups (dev/staging/prod):

```typescript
// lib/config.ts
export const config = {
  siteUrl:
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'),
  siteName: process.env.NEXT_PUBLIC_SITE_NAME || 'Custom aturi',
};
```

## Customization Ideas

### Add Analytics

```typescript
// src/app/layout.tsx
import { Analytics } from '@vercel/analytics/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

### Add Custom Waypoints

Create community-specific or regional platforms in your waypoints list.

### Localization

Add translations for different languages in your target audience.

### Rate Limiting

Add rate limiting for API routes to prevent abuse:

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Implement rate limiting logic
  return NextResponse.next();
}
```

## Support

For issues specific to your fork, handle them in your own repository. For issues with the core aturi.to functionality, please report them to the [original repository](https://github.com/yourusername/aturi-to/issues).

## License

Your fork must maintain the same GPL v3 license. See [LICENSE](LICENSE) for full details.

**Key GPL v3 requirements:**
- Keep source code available
- Include the full GPL v3 license text
- Mark modifications clearly
- Maintain copyleft (derivatives must also be GPL v3)


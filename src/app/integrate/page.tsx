'use client';

import Link from 'next/link';
import { ArrowLeft, Code2, FileText } from 'lucide-react';
import { useState } from 'react';

export default function IntegratePage() {
  const [copied, setCopied] = useState(false);

  const markdownContent = `# aturi.to Integration Guide

Add universal sharing to your ATProto application in minutes.

## For Custom Domain Forks

If you're running your own fork with a custom domain, simply replace \`aturi.to\` with your domain in all examples below. See the [FORKING.md](https://github.com/yourusername/aturi-to/blob/main/FORKING.md) guide for complete setup instructions.

## URL Structure

aturi.to uses a simple, predictable URL pattern based on ATProto URIs:

### For profiles:
\`\`\`
aturi.to/[handle or did]
\`\`\`
Example: \`aturi.to/alice.bsky.social\`

### For records (posts, lists, etc.):
\`\`\`
aturi.to/[handle or did]/[collection]/[rkey]
\`\`\`
Example: \`aturi.to/alice.bsky.social/app.bsky.feed.post/3k7qw...\`

## Code Examples

### JavaScript/TypeScript

\`\`\`typescript
// Convert AT URI to aturi.to link (or your custom domain)
function toAturiLink(atUri: string, domain: string = 'aturi.to'): string {
  // at://alice.bsky.social/app.bsky.feed.post/3k7qw...
  const uri = atUri.replace('at://', '');
  return \`https://\${domain}/\${uri}\`;
}

// Usage with aturi.to
const atUri = "at://alice.bsky.social/app.bsky.feed.post/3k7qw...";
const shareLink = toAturiLink(atUri);
// https://aturi.to/alice.bsky.social/app.bsky.feed.post/3k7qw...

// Usage with custom domain
const customLink = toAturiLink(atUri, 'myshare.app');
// https://myshare.app/alice.bsky.social/app.bsky.feed.post/3k7qw...
\`\`\`

### React Component

\`\`\`tsx
import { Share2 } from 'lucide-react';

interface ShareButtonProps {
  atUri: string;
  domain?: string; // Optional custom domain
}

function ShareButton({ atUri, domain = 'aturi.to' }: ShareButtonProps) {
  const shareUrl = \`https://\${domain}/\${atUri.replace('at://', '')}\`;
  
  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({ url: shareUrl });
    } else {
      await navigator.clipboard.writeText(shareUrl);
    }
  };
  
  return (
    <button onClick={handleShare}>
      <Share2 size={16} />
      Share via {domain}
    </button>
  );
}
\`\`\`

### Python

\`\`\`python
def to_aturi_link(at_uri: str, domain: str = 'aturi.to') -> str:
    """
    Convert AT URI to aturi.to link (or custom domain)
    
    Args:
        at_uri: The ATProto URI (e.g., 'at://alice.bsky.social/...')
        domain: The domain to use (default: 'aturi.to')
    
    Returns:
        The shareable URL
    """
    uri = at_uri.replace('at://', '')
    return f'https://{domain}/{uri}'

# Usage with aturi.to
at_uri = "at://alice.bsky.social/app.bsky.feed.post/3k7qw..."
share_link = to_aturi_link(at_uri)
# https://aturi.to/alice.bsky.social/app.bsky.feed.post/3k7qw...

# Usage with custom domain
custom_link = to_aturi_link(at_uri, 'myshare.app')
# https://myshare.app/alice.bsky.social/app.bsky.feed.post/3k7qw...
\`\`\`

## Use Cases

### Share Buttons
Add a "Share via aturi.to" button next to posts, letting users share content that anyone can view on their preferred platform.

### Embedded Links
Use aturi.to links in documentation, email newsletters, or anywhere you want flexible, platform-agnostic sharing.

### QR Codes
Generate QR codes from aturi.to links for physical media, letting people scan and choose their viewing platform.

### Cross-Platform Notifications
Send notifications with aturi.to links that work regardless of which client the recipient prefers.

## Custom Domain Support

Running your own fork of aturi.to with a custom domain? All of the above patterns work the same way - just replace \`aturi.to\` with your domain.

### Why Fork?

- **Community-specific instances**: Run a version for your community with custom branding
- **Regional optimization**: Host closer to your users for better performance  
- **Custom waypoints**: Curate the list of platforms specific to your audience
- **Self-hosting**: Maintain full control over your infrastructure

See our [Forking Guide](https://github.com/yourusername/aturi-to/blob/main/FORKING.md) for complete setup instructions.

### Attribution Requirement

If you fork aturi.to, you must keep it open source under GPL v3. This ensures the software remains free for everyone and all derivatives stay open. Attribution to the original project is appreciated and helps the ecosystem grow.

---

aturi.to is a community tool for the ATProto ecosystem. The service is free and requires no API keys or registration.
`;

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdownContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  return (
    <div className="container-narrow" style={{ padding: '4rem 2rem' }}>
      {/* Back link */}
      <Link
        href="/"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '3rem',
          color: 'var(--text-accent)',
          fontSize: '0.95rem',
        }}
      >
        <ArrowLeft size={16} />
        Back to home
      </Link>

      {/* Header */}
      <header style={{ marginBottom: '3rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Code2 size={32} style={{ color: 'var(--text-accent)' }} />
            <h1>Integration Guide</h1>
          </div>
          <button
            onClick={handleCopyMarkdown}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: copied ? 'var(--bg-elevated)' : 'transparent',
              border: '1px solid var(--border)',
              color: copied ? 'var(--text-accent)' : 'var(--text-secondary)',
              fontSize: '0.875rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <FileText size={16} />
            {copied ? 'Copied!' : 'Copy as Markdown'}
          </button>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.125rem' }}>
          Add universal sharing to your ATProto application in minutes
        </p>
      </header>

      {/* Custom Domain Info */}
      <div className="card" style={{ marginBottom: '3rem', background: 'var(--bg-elevated)', borderLeft: '3px solid var(--text-accent)' }}>
        <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-accent)' }}>Running Your Own Instance?</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          Want to fork aturi.to with a custom domain? Check out our <Link 
            href="/fork"
            style={{ color: 'var(--text-accent)', textDecoration: 'underline' }}
          >Fork Guide</Link> for easy setup instructions. The code examples below will work 
          with your custom domain too!
        </p>
      </div>

      {/* URL Structure */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ marginBottom: '1.5rem', color: 'var(--text-accent)' }}>
          URL Structure
        </h2>
        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
          aturi.to uses a simple, predictable URL pattern based on ATProto URIs:
        </p>

        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>For profiles:</h3>
          <code style={{ display: 'block', fontSize: '0.95rem' }}>
            aturi.to/[handle or did]
          </code>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
            Example: <code>aturi.to/alice.bsky.social</code>
          </p>
        </div>

        <div className="card">
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>For records (posts, lists, etc.):</h3>
          <code style={{ display: 'block', fontSize: '0.95rem' }}>
            aturi.to/[handle or did]/[collection]/[rkey]
          </code>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
            Example: <code>aturi.to/alice.bsky.social/app.bsky.feed.post/3k7qw...</code>
          </p>
        </div>
      </section>

      {/* Code Examples */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ marginBottom: '1.5rem', color: 'var(--text-accent)' }}>
          Code Examples
        </h2>

        <div className="card" style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>JavaScript/TypeScript</h3>
          <pre>{`// Convert AT URI to aturi.to link (or your custom domain)
function toAturiLink(atUri: string, domain: string = 'aturi.to'): string {
  // at://alice.bsky.social/app.bsky.feed.post/3k7qw...
  const uri = atUri.replace('at://', '');
  return \`https://\${domain}/\${uri}\`;
}

// Usage with aturi.to
const atUri = "at://alice.bsky.social/app.bsky.feed.post/3k7qw...";
const shareLink = toAturiLink(atUri);
// https://aturi.to/alice.bsky.social/app.bsky.feed.post/3k7qw...

// Usage with custom domain
const customLink = toAturiLink(atUri, 'myshare.app');
// https://myshare.app/alice.bsky.social/app.bsky.feed.post/3k7qw...`}</pre>
        </div>

        <div className="card" style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>React Component</h3>
          <pre>{`import { Share2 } from 'lucide-react';

interface ShareButtonProps {
  atUri: string;
  domain?: string; // Optional custom domain
}

function ShareButton({ atUri, domain = 'aturi.to' }: ShareButtonProps) {
  const shareUrl = \`https://\${domain}/\${atUri.replace('at://', '')}\`;
  
  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({ url: shareUrl });
    } else {
      await navigator.clipboard.writeText(shareUrl);
    }
  };
  
  return (
    <button onClick={handleShare}>
      <Share2 size={16} />
      Share via {domain}
    </button>
  );
}`}</pre>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Python</h3>
          <pre>{`def to_aturi_link(at_uri: str, domain: str = 'aturi.to') -> str:
    """
    Convert AT URI to aturi.to link (or custom domain)
    
    Args:
        at_uri: The ATProto URI (e.g., 'at://alice.bsky.social/...')
        domain: The domain to use (default: 'aturi.to')
    
    Returns:
        The shareable URL
    """
    uri = at_uri.replace('at://', '')
    return f'https://{domain}/{uri}'

# Usage with aturi.to
at_uri = "at://alice.bsky.social/app.bsky.feed.post/3k7qw..."
share_link = to_aturi_link(at_uri)
# https://aturi.to/alice.bsky.social/app.bsky.feed.post/3k7qw...

# Usage with custom domain
custom_link = to_aturi_link(at_uri, 'myshare.app')
# https://myshare.app/alice.bsky.social/app.bsky.feed.post/3k7qw...`}</pre>
        </div>
      </section>

      {/* Use Cases */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ marginBottom: '1.5rem', color: 'var(--text-accent)' }}>
          Use Cases
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card">
            <h3 style={{ marginBottom: '0.5rem' }}>Share Buttons</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              Add a "Share via aturi.to" button next to posts, letting users share
              content that anyone can view on their preferred platform.
            </p>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: '0.5rem' }}>Embedded Links</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              Use aturi.to links in documentation, email newsletters, or anywhere
              you want flexible, platform-agnostic sharing.
            </p>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: '0.5rem' }}>QR Codes</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              Generate QR codes from aturi.to links for physical media, letting
              people scan and choose their viewing platform.
            </p>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: '0.5rem' }}>Cross-Platform Notifications</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              Send notifications with aturi.to links that work regardless of
              which client the recipient prefers.
            </p>
          </div>
        </div>
      </section>

      {/* Custom Domain Support */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ marginBottom: '1.5rem', color: 'var(--text-accent)' }}>
          Custom Domain Support
        </h2>
        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
          All of the above code examples support custom domains! If you're running your own 
          fork, just pass your domain as a parameter.
        </p>

        <div className="card" style={{ background: 'var(--bg-elevated)' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Want to Run Your Own Instance?</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '0.75rem' }}>
            Fork aturi.to for:
          </p>
          <ul style={{ 
            color: 'var(--text-secondary)', 
            fontSize: '0.95rem',
            paddingLeft: '1.5rem',
            margin: '0 0 1rem 0'
          }}>
            <li>Community-specific instances with custom branding</li>
            <li>Regional optimization for better performance</li>
            <li>Custom platform lists for your audience</li>
            <li>Full control over your infrastructure</li>
          </ul>
          <Link
            href="/fork"
            style={{
              display: 'inline-block',
              padding: '0.5rem 1rem',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              color: 'var(--text-accent)',
              textDecoration: 'none',
              fontSize: '0.95rem',
              transition: 'all 0.2s ease',
            }}
          >
            View Fork Guide →
          </Link>
        </div>
      </section>

      {/* Attribution Notice */}
      <section className="card" style={{ 
        marginBottom: '3rem', 
        background: 'var(--bg-elevated)',
        borderLeft: '3px solid var(--text-accent)'
      }}>
        <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-accent)' }}>
          GPL v3 License
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          If you fork aturi.to, you must keep it open source under GPL v3. This ensures the 
          software remains free for everyone and all derivatives stay open. Attribution to 
          the original project is appreciated and helps the ecosystem grow.
        </p>
      </section>

      {/* Support */}
      <section className="card" style={{ background: 'var(--bg-elevated)', textAlign: 'center' }}>
        <h2 style={{ marginBottom: '1rem', color: 'var(--text-accent)' }}>
          Questions or Feedback?
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          aturi.to is a community tool for the ATProto ecosystem. Feel free to
          reach out with suggestions or bug reports.
        </p>
        <Link
          href="/"
          style={{
            color: 'var(--text-accent)',
            textDecoration: 'underline',
            textUnderlineOffset: '3px',
          }}
        >
          Back to home
        </Link>
      </section>
    </div>
  );
}


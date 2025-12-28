'use client';

import Link from 'next/link';
import { Code2, FileText } from 'lucide-react';
import { useState } from 'react';
import Header from '@/components/Header';

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

### Full AT URI format (also supported):
\`\`\`
aturi.to/at://[did or handle]/[collection]/[rkey]
\`\`\`
Example: \`aturi.to/at://did:plc:lcieujcfkv4jx7gehsvok3pr/app.bsky.feed.threadgate/3lwtzzgb7y22z\`

Note: Modern browsers support the literal \`at://\` in URL paths.

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

// Or keep the literal at:// in the URL
const fullAtUri = "at://did:plc:xxx/app.bsky.feed.post/3k7qw...";
const atUriLink = \`https://aturi.to/\${fullAtUri}\`;
// https://aturi.to/at://did:plc:xxx/app.bsky.feed.post/3k7qw...
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
Add a "Share via aturi.to" button next to posts, letting users share content across curated ATProto platforms.

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
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Site Header */}
      <div style={{ padding: '2rem 2rem 0' }}>
        <Header simple />
      </div>

      {/* Hero Section - Asymmetric */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 5rem',
        padding: '0 2rem'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: '2rem',
          alignItems: 'center',
          marginBottom: '3rem'
        }}>
          <div 
            className="card"
            style={{ 
              gridColumn: 'span 8',
              padding: '3rem',
              transform: 'rotate(-0.3deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.5rem', marginBottom: '1.5rem' }}>
              <Code2 size={40} style={{ color: 'var(--text-accent)', flexShrink: 0 }} />
              <div>
                <h1 style={{ marginBottom: '1rem', fontSize: '2.5rem', fontWeight: 300 }}>
                  Integration Guide
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', lineHeight: 1.7 }}>
                  Add universal sharing to your ATProto application in minutes
                </p>
              </div>
            </div>
          </div>

          <div 
            className="card"
            style={{ 
              gridColumn: 'span 4',
              padding: '2rem',
              transform: 'rotate(0.5deg)',
              transition: 'all 0.4s ease',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center'
            }}
          >
            <button
              onClick={handleCopyMarkdown}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.875rem 1.5rem',
                background: copied ? 'var(--accent-moss)' : 'var(--bg-primary)',
                border: '1px solid',
                borderColor: copied ? 'var(--accent-forest)' : 'var(--border-medium)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                width: '100%',
                justifyContent: 'center',
                fontWeight: 400
              }}
            >
              <FileText size={18} />
              {copied ? 'Copied!' : 'Copy as Markdown'}
            </button>
            <p style={{ 
              color: 'var(--text-tertiary)', 
              fontSize: '0.8rem', 
              marginTop: '0.75rem' 
            }}>
              Full guide as markdown
            </p>
          </div>
        </div>
      </div>

      {/* URL Structure - Staggered */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 6rem',
        padding: '0 2rem'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: '2rem',
          marginBottom: '3rem'
        }}>
          <div style={{ gridColumn: '1 / span 4' }}>
            <h2 style={{ 
              marginBottom: '1rem', 
              color: 'var(--text-accent)',
              fontSize: '2rem',
              fontWeight: 300
            }}>
              URL Structure
            </h2>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Simple, predictable patterns based on ATProto URIs
            </p>
          </div>

          <div style={{ 
            gridColumn: '6 / span 7',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem'
          }}>
            <div 
              className="card" 
              style={{ 
                padding: '2rem',
                transform: 'rotate(0.4deg)',
                transition: 'all 0.4s ease',
              }}
            >
              <h3 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>For profiles:</h3>
              <code style={{ 
                display: 'block', 
                fontSize: '0.95rem',
                padding: '0.75rem',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-medium)',
              }}>
                aturi.to/[handle or did]
              </code>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', marginTop: '0.75rem' }}>
                Example: <code>aturi.to/alice.bsky.social</code>
              </p>
            </div>

            <div 
              className="card"
              style={{ 
                padding: '2rem',
                transform: 'rotate(-0.3deg)',
                transition: 'all 0.4s ease',
              }}
            >
              <h3 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>For records (posts, lists, etc.):</h3>
              <code style={{ 
                display: 'block', 
                fontSize: '0.95rem',
                padding: '0.75rem',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-medium)',
                marginBottom: '0.75rem'
              }}>
                aturi.to/[handle or did]/[collection]/[rkey]
              </code>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                Example: <code>aturi.to/alice.bsky.social/app.bsky.feed.post/3k7qw...</code>
              </p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '1rem', marginBottom: '0.5rem' }}>
                Also supports full AT URI format (literal at:// in URL):
              </p>
              <code style={{ 
                display: 'block', 
                fontSize: '0.85rem',
                padding: '0.75rem',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-medium)',
              }}>
                aturi.to/at://[did or handle]/[collection]/[rkey]
              </code>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', marginTop: '0.75rem' }}>
                Example: <code style={{ fontSize: '0.8rem' }}>aturi.to/at://did:plc:lcieujcfkv4jx7gehsvok3pr/app.bsky.feed.threadgate/3lwtzzgb7y22z</code>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Code Examples - Organic Layout */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 6rem',
        padding: '0 2rem'
      }}>
        <h2 style={{ 
          marginBottom: '3rem', 
          color: 'var(--text-accent)',
          fontSize: '2rem',
          fontWeight: 300,
          textAlign: 'center'
        }}>
          Code Examples
        </h2>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2rem'
        }}>
          <div 
            className="card" 
            style={{ 
              padding: '2.5rem',
              transform: 'rotate(-0.2deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 400 }}>
              JavaScript/TypeScript
            </h3>
            <pre style={{
              background: 'var(--bg-primary)',
              padding: '1.5rem',
              border: '1px solid var(--border-medium)',
              fontSize: '0.9rem',
              lineHeight: 1.6,
              overflow: 'auto'
              }}>{`// Convert AT URI to aturi.to link (or your custom domain)
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

// Or keep the literal at:// in the URL
const fullAtUri = "at://did:plc:xxx/app.bsky.feed.post/3k7qw...";
const atUriLink = \`https://aturi.to/\${fullAtUri}\`;
// https://aturi.to/at://did:plc:xxx/app.bsky.feed.post/3k7qw...`}</pre>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(12, 1fr)',
            gap: '2rem'
          }}>
            <div 
              className="card" 
              style={{ 
                gridColumn: 'span 7',
                padding: '2.5rem',
                transform: 'rotate(0.4deg)',
                transition: 'all 0.4s ease',
              }}
            >
              <h3 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 400 }}>
                React Component
              </h3>
              <pre style={{
                background: 'var(--bg-primary)',
                padding: '1.5rem',
                border: '1px solid var(--border-medium)',
                fontSize: '0.85rem',
                lineHeight: 1.6,
                overflow: 'auto'
              }}>{`import { Share2 } from 'lucide-react';

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

            <div 
              className="card" 
              style={{ 
                gridColumn: 'span 5',
                padding: '2.5rem',
                transform: 'rotate(-0.5deg)',
                transition: 'all 0.4s ease',
              }}
            >
              <h3 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 400 }}>
                Python
              </h3>
              <pre style={{
                background: 'var(--bg-primary)',
                padding: '1.5rem',
                border: '1px solid var(--border-medium)',
                fontSize: '0.85rem',
                lineHeight: 1.6,
                overflow: 'auto'
              }}>{`def to_aturi_link(
    at_uri: str, 
    domain: str = 'aturi.to'
) -> str:
    """Convert AT URI to link"""
    uri = at_uri.replace('at://', '')
    return f'https://{domain}/{uri}'

# Usage
at_uri = "at://alice.bsky..."
link = to_aturi_link(at_uri)

# Custom domain
custom = to_aturi_link(
    at_uri, 
    'myshare.app'
)`}</pre>
            </div>
          </div>
        </div>
      </div>

      {/* Use Cases - Asymmetric Grid */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 6rem',
        padding: '0 2rem'
      }}>
        <h2 style={{ 
          marginBottom: '3rem', 
          color: 'var(--text-accent)',
          fontSize: '2rem',
          fontWeight: 300,
          textAlign: 'center'
        }}>
          Use Cases
        </h2>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: '1.5rem'
        }}>
          <div 
            className="card" 
            style={{ 
              gridColumn: 'span 7',
              padding: '2rem',
              transform: 'rotate(0.3deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '0.75rem', fontSize: '1.25rem' }}>Share Buttons</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6 }}>
              Add a &ldquo;Share via aturi.to&rdquo; button next to posts, letting users share
              content that anyone can view on their preferred platform.
            </p>
          </div>

          <div 
            className="card" 
            style={{ 
              gridColumn: 'span 5',
              padding: '2rem',
              transform: 'rotate(-0.4deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '0.75rem', fontSize: '1.25rem' }}>QR Codes</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6 }}>
              Generate QR codes from aturi.to links for physical media
            </p>
          </div>

          <div 
            className="card" 
            style={{ 
              gridColumn: 'span 5',
              padding: '2rem',
              transform: 'rotate(-0.2deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '0.75rem', fontSize: '1.25rem' }}>Embedded Links</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6 }}>
              Use in documentation, newsletters, or anywhere you want flexible sharing
            </p>
          </div>

          <div 
            className="card" 
            style={{ 
              gridColumn: 'span 7',
              padding: '2rem',
              transform: 'rotate(0.5deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '0.75rem', fontSize: '1.25rem' }}>Cross-Platform Notifications</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6 }}>
              Send notifications with aturi.to links that work regardless of
              which client the recipient prefers.
            </p>
          </div>
        </div>
      </div>

      {/* Custom Domain Support - Diagonal Layout */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 6rem',
        padding: '0 2rem'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: '2rem',
          alignItems: 'start'
        }}>
          <div style={{ gridColumn: '1 / span 5' }}>
            <h2 style={{ 
              marginBottom: '1rem', 
              color: 'var(--text-accent)',
              fontSize: '2rem',
              fontWeight: 300
            }}>
              Custom Domain Support
            </h2>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              All code examples support custom domains! Pass your domain as a parameter if you&apos;re running your own fork.
            </p>
          </div>

          <div 
            className="card" 
            style={{ 
              gridColumn: '7 / span 6',
              padding: '2.5rem',
              background: 'var(--bg-elevated)',
              transform: 'rotate(-0.3deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 400 }}>
              Run Your Own Instance
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '1rem', lineHeight: 1.6 }}>
              Fork aturi.to for:
            </p>
            <ul style={{ 
              color: 'var(--text-secondary)', 
              fontSize: '0.95rem',
              paddingLeft: '1.5rem',
              margin: '0 0 1.5rem 0',
              lineHeight: 1.8
            }}>
              <li>Community-specific instances with custom branding</li>
              <li>Regional optimization for better performance</li>
              <li>Custom platform lists for your audience</li>
              <li>Full control over your infrastructure</li>
            </ul>
            <Link
              href="/fork"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.875rem 1.75rem',
                background: 'var(--accent-moss)',
                border: '1px solid var(--accent-forest)',
                color: 'var(--text-primary)',
                textDecoration: 'none',
                fontSize: '0.95rem',
                transition: 'all 0.3s ease',
                fontWeight: 400
              }}
            >
              View Fork Guide →
            </Link>
          </div>
        </div>
      </div>

      {/* Attribution Notice - Staggered */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 4rem',
        padding: '0 2rem'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: '2rem'
        }}>
          <div 
            className="card" 
            style={{ 
              gridColumn: '2 / span 10',
              padding: '2.5rem',
              background: 'var(--bg-elevated)',
              borderLeft: '3px solid var(--text-accent)',
              transform: 'rotate(-0.2deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '1rem', color: 'var(--text-accent)', fontSize: '1.5rem', fontWeight: 400 }}>
              GPL v3 License
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1.7 }}>
              If you fork aturi.to, you must keep it open source under GPL v3. This ensures the 
              software remains free for everyone and all derivatives stay open. Attribution to 
              the original project is appreciated and helps the ecosystem grow.
            </p>
          </div>
        </div>
      </div>

      {/* Submit Your App Card */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 4rem',
        padding: '0 2rem'
      }}>
        <div 
          className="card" 
          style={{ 
            padding: '3rem',
            background: 'var(--bg-elevated)', 
            textAlign: 'center',
            transform: 'rotate(-0.3deg)',
            transition: 'all 0.4s ease',
            border: '1px solid var(--border-strong)'
          }}
        >
          <h2 style={{ marginBottom: '1rem', color: 'var(--text-accent)', fontSize: '2rem', fontWeight: 400 }}>
            Submit your app as a waypoint
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', lineHeight: 1.7, marginBottom: '2rem' }}>
            Building an ATProto client or tool? We&apos;d love to consider adding it to our curated list of waypoints so users can choose your platform when sharing content.
          </p>
          <div style={{
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            justifyContent: 'center'
          }}>
            <a
              href="mailto:aturi@atpota.to"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '1rem 1.75rem',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-medium)',
                fontSize: '1rem',
                textDecoration: 'none',
                transition: 'all 0.3s ease',
                fontWeight: 400
              }}
            >
              Email aturi@atpota.to
            </a>
            <a
              href="https://bsky.app/profile/aturi.to"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '1rem 1.75rem',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-medium)',
                fontSize: '1rem',
                textDecoration: 'none',
                transition: 'all 0.3s ease',
                fontWeight: 400
              }}
            >
              DM on Bluesky
            </a>
          </div>
        </div>
      </div>

      {/* Support - Full Width Centered */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 4rem',
        padding: '0 2rem'
      }}>
        <div 
          className="card" 
          style={{ 
            padding: '3rem',
            background: 'var(--bg-elevated)', 
            textAlign: 'center',
            transform: 'rotate(0.2deg)',
            transition: 'all 0.4s ease',
          }}
        >
          <h2 style={{ marginBottom: '1rem', color: 'var(--text-accent)', fontSize: '2rem', fontWeight: 400 }}>
            Questions or Feedback?
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', lineHeight: 1.7 }}>
            aturi.to is a community tool for the ATProto ecosystem. Feel free to
            reach out with suggestions or bug reports.
          </p>
        </div>
      </div>
    </div>
  );
}


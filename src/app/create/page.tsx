'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Link2, Copy, Check, AlertCircle, Sparkles, ExternalLink } from 'lucide-react';
import Header from '@/components/Header';
import { convertToAturiLink, isValidInput } from '@/utils/linkGenerator';

export default function CreatePage() {
  const [input, setInput] = useState('');
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = () => {
    if (!input.trim()) {
      setError('Please enter a URL or AT URI');
      setGeneratedLink(null);
      return;
    }

    const link = convertToAturiLink(input);
    
    if (link) {
      setGeneratedLink(link);
      setError(null);
    } else {
      setError('Could not parse input. Please check your URL or AT URI format.');
      setGeneratedLink(null);
    }
  };

  const handleCopy = async () => {
    if (generatedLink) {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    setError(null);
    setGeneratedLink(null);
    setCopied(false);
  };

  return (
    <div style={{ minHeight: '100vh', position: 'relative' }}>
      {/* Header */}
      <div style={{ padding: '2rem 2rem 1rem' }}>
        <Header simple />
      </div>

      {/* Main Content */}
      <main style={{ 
        maxWidth: '800px', 
        margin: '0 auto',
        padding: '2rem',
      }}>
        {/* Page Title Section */}
        <div style={{ 
          marginBottom: '4rem',
          textAlign: 'center',
          position: 'relative'
        }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.75rem',
            marginBottom: '1rem',
            padding: '0.5rem 1rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
          }}>
            <Sparkles size={20} style={{ color: 'var(--text-accent)' }} />
            <span style={{ 
              fontFamily: 'var(--font-mono)', 
              fontSize: '0.875rem',
              color: 'var(--text-secondary)'
            }}>
              Link Generator
            </span>
          </div>
          
          <h2 style={{ 
            fontSize: '2.5rem',
            fontWeight: 300,
            marginBottom: '1rem',
            color: 'var(--text-primary)',
            lineHeight: 1.2
          }}>
            Create your universal link
          </h2>
          
          <p style={{
            fontSize: '1.125rem',
            color: 'var(--text-secondary)',
            maxWidth: '500px',
            margin: '0 auto',
            lineHeight: 1.6
          }}>
            Paste any ATProto URL or AT URI and get a universal aturi.to link
          </p>
        </div>

        {/* Generator Form */}
        <div 
          className="card"
          style={{
            padding: '3rem',
            marginBottom: '2rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            transform: 'rotate(-0.3deg)',
            transition: 'all 0.4s ease'
          }}
        >
          {/* Input Section */}
          <div style={{ marginBottom: '2rem' }}>
            <label 
              htmlFor="input-url"
              style={{
                display: 'block',
                marginBottom: '0.75rem',
                fontSize: '0.95rem',
                color: 'var(--text-secondary)',
                fontWeight: 400
              }}
            >
              Enter URL or AT URI
            </label>
            
            <textarea
              id="input-url"
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
              placeholder="https://bsky.app/profile/alice.bsky.social/post/3m6mwoadjbp2d"
              style={{
                width: '100%',
                minHeight: '120px',
                padding: '1rem',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-primary)',
                fontSize: '0.95rem',
                fontFamily: 'var(--font-mono)',
                resize: 'vertical',
                transition: 'all 0.3s ease',
                lineHeight: 1.6
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'var(--text-accent)';
                e.target.style.outline = 'none';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'var(--border-medium)';
              }}
            />
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={!input.trim()}
            className="generate-button"
            style={{
              width: '100%',
              padding: '1rem 2rem',
              background: input.trim() ? 'var(--accent-moss)' : 'var(--bg-tertiary)',
              color: input.trim() ? 'var(--text-primary)' : 'var(--text-tertiary)',
              border: '1px solid',
              borderColor: input.trim() ? 'var(--accent-forest)' : 'var(--border-medium)',
              fontSize: '1.05rem',
              fontWeight: 400,
              cursor: input.trim() ? 'pointer' : 'not-allowed',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem'
            }}
          >
            <Link2 size={18} />
            <span>Generate Link</span>
          </button>

          {/* Error Message */}
          {error && (
            <div style={{
              marginTop: '1.5rem',
              padding: '1rem',
              background: 'rgba(255, 100, 100, 0.1)',
              border: '1px solid rgba(255, 100, 100, 0.3)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem',
              animation: 'content-appear 0.3s ease-out'
            }}>
              <AlertCircle size={20} style={{ 
                color: '#ff6464', 
                flexShrink: 0,
                marginTop: '0.125rem'
              }} />
              <div>
                <div style={{ 
                  color: '#ff6464', 
                  fontWeight: 400,
                  marginBottom: '0.25rem'
                }}>
                  Invalid input
                </div>
                <div style={{ 
                  color: 'var(--text-secondary)', 
                  fontSize: '0.9rem'
                }}>
                  {error}
                </div>
              </div>
            </div>
          )}

          {/* Generated Link Result */}
          {generatedLink && (
            <div style={{
              marginTop: '2rem',
              padding: '1.5rem',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-strong)',
              animation: 'content-appear 0.4s ease-out'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '1rem',
                color: 'var(--text-accent)'
              }}>
                <Check size={18} />
                <span style={{ fontWeight: 400, fontSize: '0.95rem' }}>
                  Link generated
                </span>
              </div>
              
              <div style={{
                padding: '1rem',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.9rem',
                color: 'var(--text-primary)',
                wordBreak: 'break-all',
                marginBottom: '1rem',
                lineHeight: 1.6
              }}>
                {generatedLink}
              </div>

              {/* Action Buttons */}
              <div style={{
                display: 'flex',
                gap: '1rem',
                flexWrap: 'wrap'
              }}>
                <button
                  onClick={handleCopy}
                  style={{
                    flex: 1,
                    minWidth: '200px',
                    padding: '0.875rem 1.5rem',
                    background: copied ? 'var(--accent-moss)' : 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    border: '1px solid',
                    borderColor: copied ? 'var(--accent-forest)' : 'var(--border-strong)',
                    fontSize: '0.95rem',
                    fontWeight: 400,
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem'
                  }}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  <span>{copied ? 'Copied!' : 'Copy Link'}</span>
                </button>

                <a
                  href={generatedLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1,
                    minWidth: '200px',
                    padding: '0.875rem 1.5rem',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-strong)',
                    fontSize: '0.95rem',
                    fontWeight: 400,
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    textDecoration: 'none'
                  }}
                >
                  <ExternalLink size={16} />
                  <span>Test Link</span>
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Examples Section */}
        <div 
          className="card"
          style={{
            padding: '2rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            transform: 'rotate(0.2deg)',
          }}
        >
          <h3 style={{
            fontSize: '1.25rem',
            fontWeight: 400,
            marginBottom: '1rem',
            color: 'var(--text-accent)'
          }}>
            Supported formats
          </h3>
          
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: '0.95rem',
            marginBottom: '1.5rem',
            lineHeight: 1.6
          }}>
            You can paste any of these formats:
          </p>

          <ul style={{
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          }}>
            {[
              'https://bsky.app/profile/alice.bsky.social',
              'https://bsky.app/profile/alice.bsky.social/post/3m6mwoadjbp2d',
              'at://did:plc:xxx/app.bsky.feed.post/3m6mwoadjbp2d',
              'did:plc:qntsxa2i4sb24noi45fx4np2',
              'alice.bsky.social'
            ].map((example, i) => (
              <li 
                key={i}
                style={{
                  padding: '0.75rem 1rem',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                  wordBreak: 'break-all'
                }}
              >
                {example}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}


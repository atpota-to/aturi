import Link from 'next/link';
import { toolBySlug } from '@/lib/tools/catalog';
import { toolLinksForAccount } from '@/lib/tools/recordLinks';

/**
 * The tools that read a whole account, under its stats: the activity
 * calendar, the lists it is on, its labels, its repository export. Each opens
 * with this account already filled in.
 *
 * The tool pages are static, so these links keep their prefetch; nofollow
 * because each carries a DID, and every account page would otherwise hand a
 * crawler four more URLs.
 */
export default function AccountToolLinks({ did }: { did: string }) {
  return (
    <nav className="fx-acct-tools" aria-label="Tools for this account">
      {toolLinksForAccount(did).map((tool) => {
        const { Icon } = toolBySlug(tool.slug);
        return (
          <Link key={tool.slug} href={tool.href} rel="nofollow" className="fx-btn fx-btn-sm" title={tool.title}>
            <Icon size={14} aria-hidden />
            {tool.label}
          </Link>
        );
      })}
    </nav>
  );
}

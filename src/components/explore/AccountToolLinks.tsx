import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { toolBySlug } from '@/lib/tools/catalog';
import { toolLinksForAccount } from '@/lib/tools/recordLinks';

/**
 * The tools that read a whole account, as a list under the account card in
 * Classic's sidebar: lists and verifications, the activity calendar, mutuals'
 * blocks, the repository export. Each opens its tool with this account
 * filled in. (The label and visibility checks are not here: they run on the
 * card itself and have tabs of their own.) The Workbench and Files rails
 * list the same tools under the account's views (ExplorerShell.tsx).
 *
 * The tool pages are static, so these links keep their prefetch; nofollow
 * because each carries a DID, and every account page would otherwise hand a
 * crawler four more URLs.
 */
export default function AccountToolLinks({ did }: { did: string }) {
  return (
    <nav className="fx-card fx-acct-tools" aria-labelledby="fx-acct-tools-h">
      <h2 id="fx-acct-tools-h" className="fx-acct-tools-h">
        Tools
      </h2>
      {toolLinksForAccount(did).map((tool) => {
        const { Icon } = toolBySlug(tool.slug);
        return (
          <Link key={tool.slug} href={tool.href} rel="nofollow" className="fx-acct-tool" title={tool.title}>
            <Icon size={14} aria-hidden />
            <span>{tool.label}</span>
            <ExternalLink size={12} className="fx-acct-tool-out" aria-hidden />
          </Link>
        );
      })}
    </nav>
  );
}

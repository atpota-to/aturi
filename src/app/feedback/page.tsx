import type { Metadata } from 'next';
import FeedbackBoard from '@/components/feedback/FeedbackBoard';

const TITLE = 'Feedback & Suggestions · aturi.to';
const DESCRIPTION =
  'Report bugs, request features, and vote on what aturi.to builds next. Built on the userinput.app lexicons: every post lives in your own repo.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function FeedbackPage() {
  return <FeedbackBoard />;
}

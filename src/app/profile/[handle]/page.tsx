import { redirect } from 'next/navigation';

type Props = {
  params: Promise<{ handle: string }>;
};

export default async function ProfileRedirectPage({ params }: Props) {
  const { handle } = await params;
  
  // Redirect /profile/handle to /handle
  redirect(`/${handle}`);
}

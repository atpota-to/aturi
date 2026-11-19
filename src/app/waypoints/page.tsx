import type { Metadata } from 'next';
import Header from '@/components/Header';
import WaypointsLanding from '@/components/landing/WaypointsLanding';
import { getWaypointCount } from '@/utils/waypoints';

const DESCRIPTION = `Universal links that open in any Atmosphere app, and the catalog behind them: ${getWaypointCount()} clients, MIT-licensed npm packages and a keyless API to put “Open in…” in your own app.`;

export const metadata: Metadata = {
  title: 'Waypoints · aturi.to',
  description: DESCRIPTION,
  openGraph: {
    title: 'Waypoints · aturi.to',
    description: DESCRIPTION,
    images: ['/api/og/static?page=waypoints'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Waypoints · aturi.to',
    description: DESCRIPTION,
    images: ['/api/og/static?page=waypoints'],
  },
};

export default function WaypointsPage() {
  return (
    <>
      <Header compact />
      <div className="container-narrow fl-container">
        <WaypointsLanding />
      </div>
    </>
  );
}

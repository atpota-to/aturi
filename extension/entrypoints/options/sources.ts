import type { SourceApp } from '@aturi/reverseParsers';

export type SourceDescriptor = {
  id: SourceApp;
  name: string;
  host: string;
};

export const SOURCE_APPS: SourceDescriptor[] = [
  { id: 'bluesky', name: 'Bluesky', host: 'bsky.app' },
  { id: 'bluepy', name: 'Bluepy', host: 'bluepy.social' },
  { id: 'blacksky', name: 'Blacksky', host: 'blacksky.community' },
  { id: 'reddwarf', name: 'Red Dwarf', host: 'reddwarf.app' },
  { id: 'witchsky', name: 'Witchsky', host: 'witchsky.app' },
  { id: 'catsky', name: 'Catsky', host: 'catsky.social' },
  { id: 'deer', name: 'Deer', host: 'deer.social' },
  { id: 'anisota', name: 'Anisota', host: 'anisota.net' },
  { id: 'pinksky', name: 'Pinkleap', host: 'pinkleap.app' },
  { id: 'leaflet', name: 'Leaflet', host: 'leaflet.pub' },
  { id: 'tangled', name: 'Tangled', host: 'tangled.org' },
  { id: 'margin', name: 'Margin', host: 'margin.at' },
  { id: 'pdsls', name: 'PDSls', host: 'pdsls.dev' },
  { id: 'atptools', name: 'atp.tools', host: 'atp.tools' },
  { id: 'semble', name: 'Semble', host: 'semble.so' },
  { id: 'streamplace', name: 'Streamplace', host: 'stream.place' },
  { id: 'grain', name: 'Grain', host: 'grain.social' },
  { id: 'popfeed', name: 'Popfeed', host: 'popfeed.social' },
  { id: 'sifa', name: 'Sifa', host: 'sifa.id' },
  { id: 'blento', name: 'Blento', host: 'blento.app' },
  { id: 'offprint', name: 'Offprint', host: 'offprint.app' },
  { id: 'pckt', name: 'pckt', host: 'pckt.blog' },
];

import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title: 'DryStock · Protection planning', description: 'Weather-aware material protection planning for recycling yards. Local simulated demonstration.'};
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}

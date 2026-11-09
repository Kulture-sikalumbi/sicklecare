import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SickleCare',
    short_name: 'SickleCare',
    description: 'A patient-facing wearable readings and symptom logging prototype.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f7fb',
    theme_color: '#123f4a',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}

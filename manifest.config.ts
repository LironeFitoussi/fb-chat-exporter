import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Messenger Chat Exporter',
  version: pkg.version,
  description: 'Export Facebook Messenger conversations to JSON and re-download saved conversation archives.',
  icons: {
    16: 'public/icons/icon-16.png',
    32: 'public/icons/icon-32.png',
    48: 'public/icons/icon-48.png',
    128: 'public/icons/icon-128.png',
  },
  action: {
    default_icon: {
      16: 'public/icons/icon-16.png',
      32: 'public/icons/icon-32.png',
      48: 'public/icons/icon-48.png',
    },
    default_popup: 'src/popup/index.html',
  },
  permissions: [
    'downloads',
    'storage',
    'tabs',
  ],
  content_scripts: [{
    js: ['src/content/main.tsx'],
    matches: [
      'https://www.facebook.com/messages/*',
      'https://www.messenger.com/*',
    ],
  }],
})

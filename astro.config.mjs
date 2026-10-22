import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Astro hashes processed scripts, but Starlight also ships unprocessed inline
// theme scripts. Derive their hashes from the installed version at build time.
const themeScriptHashes = ['ThemeProvider', 'ThemeSelect'].flatMap(component => {
  const source = readFileSync(new URL(import.meta.resolve(`@astrojs/starlight/components/${component}.astro`)), 'utf8');
  return [...source.matchAll(/<script\s+is:inline>([\s\S]*?)<\/script>/g)].map(
    ([, script]) => `sha256-${createHash('sha256').update(script).digest('base64')}`,
  );
});

export default defineConfig({
  site: 'https://www.pasqualefiorillo.it',
  output: 'static',
  devToolbar: { enabled: false },
  markdown: { syntaxHighlight: false },
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "base-uri 'none'",
        "object-src 'none'",
        "form-action 'none'",
        "frame-src 'none'",
      ],
      scriptDirective: { hashes: themeScriptHashes },
      // Starlight uses style attributes for icon sizes and component variables.
      // Style elements remain restricted to local files and generated hashes.
      styleDirective: {
        resources: [{ resource: "'unsafe-inline'", kind: 'attribute' }],
      },
    },
  },
  integrations: [
    starlight({
      title: 'Pasquale Fiorillo',
      description: "Pasquale 'sid' Fiorillo — Security Consultant & Researcher. CTO at Rooters and offensive security specialist at ISGroup.",
      favicon: '/favicon.svg',
      pagefind: false,
      disable404Route: true,
      lastUpdated: false,
      pagination: false,
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/siddolo' },
        { icon: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/in/pasqualefiorillo/' },
      ],
      customCss: ['./src/styles/custom.css'],
      components: {
        PageFrame: './src/components/PageFrame.astro',
        Header: './src/components/Header.astro',
        Footer: './src/components/Footer.astro',
      },
      head: [
        { tag: 'meta', attrs: { name: 'author', content: 'Pasquale Fiorillo' } },
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://www.pasqualefiorillo.it/social-card.png' } },
        { tag: 'meta', attrs: { property: 'og:image:alt', content: "Pasquale 'sid' Fiorillo — Security Consultant & Researcher" } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
      ],
    }),
  ],
});

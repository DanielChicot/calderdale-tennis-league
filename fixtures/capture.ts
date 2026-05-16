import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fetchHtml } from '../packages/parser/src/http.js';

const main = async () => {
  const [url, name] = process.argv.slice(2);
  if (!url || !name) {
    console.error('Usage: pnpm capture <url> <name>');
    console.error('Example: pnpm capture "https://www.calderdale.tennis-league.org/?navButtonSelect=Directory" clubs-directory');
    process.exit(1);
  }
  const html = await fetchHtml(url);
  const out = resolve('fixtures', `${name}.html`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html, 'utf8');
  console.log(`Wrote ${out} (${html.length} bytes)`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

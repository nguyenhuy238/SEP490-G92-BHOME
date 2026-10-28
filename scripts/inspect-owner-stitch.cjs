const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = path.resolve('../stitch_bhome_owner_web_portal/stitch_bhome_owner_web_portal');
const screens = fs.readdirSync(source).filter((name) => /^\d\d_/.test(name)).sort().map((name) => {
  const doc = new JSDOM(fs.readFileSync(path.join(source, name, 'code.html'), 'utf8')).window.document;
  const main = doc.querySelector('main') || doc.body;
  const text = (element) => element.textContent.replace(/\s+/g, ' ').trim();
  const headings = [...main.querySelectorAll('h1,h2,h3')].map(text);
  const tables = [...main.querySelectorAll('table')].map((table) => ({ headers: [...table.querySelectorAll('thead th')].map(text), rows: [...table.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map(text)) }));
  const buttons = [...main.querySelectorAll('button')].map(text);
  const inputs = [...main.querySelectorAll('input,select,textarea')].map((input) => ({ tag: input.tagName, placeholder: input.getAttribute('placeholder'), type: input.getAttribute('type'), text: text(input) }));
  return { name, headings, tables, buttons, inputs, text: text(main) };
});
fs.mkdirSync('.tmp', { recursive: true });
fs.writeFileSync('.tmp/stitch-inspection.json', JSON.stringify(screens, null, 2));
for (const screen of screens) console.log(JSON.stringify({ name: screen.name, headings: screen.headings, tables: screen.tables.map((table) => ({headers: table.headers, sample: table.rows[0]})), buttons: screen.buttons.slice(0,15), inputs: screen.inputs.slice(0,6) }));

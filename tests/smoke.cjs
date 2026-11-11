// Går igenom hela flödet i en mobilwebbläsare: besök, rum, summering, export, offline och mall.
// Kör: node tests/smoke.cjs [mapp för skärmbilder]
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.argv[2];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const step = (name) => console.log('✓ ' + name);

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'sv-SE', acceptDownloads: true });
  // Tvinga nedladdning i stället för delningsmenyn så att filerna går att kontrollera.
  await ctx.addInitScript(() => { navigator.canShare = undefined; });
  const page = await ctx.newPage();
  const errors = [];
  global.__errors = errors;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
  const field = (id) => page.locator(`[data-field="${id}"]`);
  const settle = () => page.waitForTimeout(600); // autosparning
  const nextRoom = async () => {
    const before = page.url();
    await page.getByRole('button', { name: 'Spara och nytt rum' }).click();
    await page.waitForURL((u) => u.href !== before);
    await field('lokaltyp').waitFor();
  };

  await page.goto(url);
  await page.getByRole('button', { name: '+ Nytt besök' }).click();
  await page.locator('dialog input[type=text]').fill('Testkund AB');
  await page.locator('dialog select').selectOption('skola');
  await page.getByRole('button', { name: 'Starta' }).click();
  await page.waitForURL(/#\/visit\//);
  step('nytt besök skapat');

  // Objektfrågor: frågan för skola visas, vårdfrågan visas inte.
  await assert.doesNotReject(field('antal_elever').waitFor());
  assert.equal(await field('hygienkrav').count(), 0);
  await field('antal_elever').locator('input').fill('240');
  await field('uppgiven_yta').locator('input').fill('1250,5');
  await field('stadtid').getByRole('button', { name: 'Kväll' }).click();
  await page.getByRole('button', { name: '+ Eget fält' }).click();
  await page.locator('dialog input[type=text]').fill('Portkod');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.locator('.custom-field input').fill('1234');
  await settle();
  await shot('1-objekt');
  step('objektfrågor och eget fält');

  // Rum 1: klassrum 8 × 7,5 m, linoleum, två fönsterrader.
  await page.getByRole('link', { name: 'Vidare till rummen' }).click();
  await page.getByRole('button', { name: '+ Lägg till rum' }).click();
  await page.waitForURL(/\/room\//);
  await field('lokaltyp').locator('select').selectOption('Klassrum');
  assert.equal(await field('toaletter').count(), 0, 'toaletter ska inte visas för klassrum');
  assert.equal(await field('tvattstall').count(), 1);
  await field('vaning').locator('input').fill('Plan 2');
  await field('yta').getByLabel('Längd').fill('8');
  await field('yta').getByLabel('Bredd').fill('7,5');
  assert.equal(await field('yta').getByLabel('Yta').inputValue(), '60');
  await field('golvtyp').locator('select').selectOption('Linoleum');
  await page.getByRole('button', { name: '+ Lägg till fönster' }).click();
  const w1 = page.locator('.group-row').nth(0);
  await w1.getByRole('button', { name: '2-luft' }).click();
  await w1.getByRole('button', { name: 'Öka' }).click({ clickCount: 4 });
  await page.getByRole('button', { name: '+ Lägg till fönster' }).click();
  const w2 = page.locator('.group-row').nth(1);
  await w2.getByRole('button', { name: 'Glasdörr' }).click();
  await w2.getByRole('button', { name: 'Öka' }).click();
  await page.locator('input[type=file]').setInputFiles(path.join(ROOT, 'icons/icon-192.png'));
  await page.locator('.photo img').waitFor();
  await settle();
  await shot('2-rum');
  step('rum 1 med fönster och foto');

  // Rum 2: WC 4 m² direkt, klinker, 2 toaletter.
  await nextRoom();
  // Våning och golvtyp följer med från föregående rum, och lokaltypens förval fylls i.
  assert.equal(await field('vaning').locator('input').inputValue(), 'Plan 2');
  assert.equal(await field('golvtyp').locator('select').inputValue(), 'Linoleum');
  assert.equal(await field('toaletter').count(), 0);
  await field('lokaltyp').locator('select').selectOption('WC');
  assert.equal(await field('golvtyp').locator('select').inputValue(), 'Klinker');
  assert.equal(await field('toaletter').locator('input').inputValue(), '1');
  assert.equal(await field('tvattstall').locator('input').inputValue(), '1');
  // Byte av lokaltyp tar bort förvalen igen, och eget svar skrivs inte över.
  await field('lokaltyp').locator('select').selectOption('Förråd');
  assert.equal(await field('golvtyp').locator('select').inputValue(), '');
  await field('golvtyp').locator('select').selectOption('Sten');
  await field('lokaltyp').locator('select').selectOption('WC');
  assert.equal(await field('golvtyp').locator('select').inputValue(), 'Sten');
  await field('golvtyp').locator('select').selectOption('Klinker');
  await field('yta').getByLabel('Yta').fill('4');
  await field('toaletter').getByRole('button', { name: 'Öka' }).click();
  await settle();
  step('förval från föregående rum och lokaltyp');

  // Rum 3: saknar obligatoriska uppgifter.
  await nextRoom();
  await page.locator('#main input[type=text]').first().fill('Rum 3');
  await settle();
  await page.getByRole('link', { name: 'Klar' }).click();
  await page.locator('.room-card').nth(2).waitFor();

  // Kopiera WC:t, så finns två likadana.
  await page.locator('.room-card').nth(1).getByRole('button', { name: 'Kopiera' }).click();
  await page.waitForURL(/\/room\//);
  assert.equal(await field('yta').getByLabel('Yta').inputValue(), '4');
  await field('_count').getByRole('button', { name: 'Öka' }).click({ clickCount: 2 });
  await settle();
  await page.getByRole('link', { name: 'Klar' }).click();
  await page.locator('.room-card').nth(3).waitFor();
  await shot('3-rumslista');
  assert.match(await page.locator('.room-card').nth(2).innerText(), /× 3/);
  step('fyra rader, varav en står för tre likadana rum');

  // Summering.
  await page.getByRole('link', { name: 'Summering' }).click();
  await page.locator('.tiles').waitFor();
  const text = await page.locator('#main').innerText();
  assert.match(text, /3 obligatoriska uppgifter saknas/); // städfrekvens samt rum 3: lokaltyp och yta (golvtypen ärvs)
  assert.match(text, /Objektet: Städfrekvens/);
  assert.match(text, /Rum 3: Yta/);
  assert.deepEqual(await page.locator('.tile-num').allInnerTexts(), ['6', '76']);
  assert.match(text, /Toaletter\s+8 st/);
  assert.match(text, /Tvättställ\s+4 st/);
  assert.match(text, /Linoleum\s+60\s+1/);
  assert.match(text, /Klinker\s+16\s+5/);
  assert.match(text, /2-luft\s+4/);
  assert.match(text, /Glasdörr\s+1/);
  await shot('4-summering');
  step('summering stämmer');

  // Excel.
  const download = async (name) => {
    const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name, exact: true }).click()]);
    const file = await d.path();
    return { name: d.suggestedFilename(), data: fs.readFileSync(file) };
  };
  const xlsx = await download('Excel');
  assert.equal(xlsx.name, `Besok_Testkund_AB_${new Date().toLocaleDateString('sv-SE')}.xlsx`);
  const XLSX = require(path.join(ROOT, 'vendor/xlsx.mini.min.js'));
  const wb = XLSX.read(xlsx.data);
  assert.deepEqual(wb.SheetNames, ['Objekt', 'Rum', 'Fönster', 'Summering']);
  const rows = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 });
  assert.ok(rows('Objekt').some((r) => r[0] === 'Portkod' && r[1] === '1234'));
  assert.ok(rows('Objekt').some((r) => r[0] === 'Total yta enligt kund' && String(r[1]).replace(/\s/g, ' ') === '1 250,5 m²'));
  const rum = rows('Rum');
  assert.equal(rum.length, 5);
  assert.strictEqual(rum[1][rum[0].indexOf('Yta (m²)')], 60);
  assert.strictEqual(rum[1][rum[0].indexOf('Antal foton')], 1);
  assert.deepEqual(rows('Fönster')[1].slice(0, 5), [1, 'Klassrum', 1, '2-luft', 4]);
  assert.strictEqual(rum[3][rum[0].indexOf('Antal likadana rum')], 3);
  assert.strictEqual(rum[3][rum[0].indexOf('Yta totalt (m²)')], 12);
  assert.strictEqual(rum[1][rum[0].indexOf('Toaletter')], '', 'klassrum har ingen toalettuppgift');
  assert.ok(rows('Summering').some((r) => r[0] === 'Total yta' && r[1] === 76));
  step('Excel-filen har rätt innehåll');

  // PDF.
  const pdf = await download('PDF');
  assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.data.length > 5000);
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'rapport.pdf'), pdf.data);
  step('PDF skapad');

  // Säkerhetskopia: läs in igen som ett nytt besök.
  const backup = await download('Säkerhetskopia');
  const backupFile = path.join(require('os').tmpdir(), 'besok-test.json');
  fs.writeFileSync(backupFile, backup.data);
  await page.goto(url + '#/');
  await page.locator('.link-card').first().waitFor();
  await shot('5-start');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Läs in säkerhetskopia' }).click()]);
  await chooser.setFiles(backupFile);
  await page.waitForURL(/#\/visit\//);
  await page.goto(url + '#/');
  await page.locator('.link-card').nth(1).waitFor();
  assert.equal(await page.locator('.link-card').count(), 2);
  step('säkerhetskopia inläst som nytt besök');

  // Mall: lägg till en fråga och kontrollera att gamla besök inte påverkas men nya får den.
  await page.getByRole('link', { name: 'Mall och frågor' }).click();
  const roomCard = page.locator('.card', { hasText: 'Frågor per rum' });
  await roomCard.getByRole('button', { name: '+ Ny fråga' }).click();
  await page.locator('dialog input[type=text]').first().fill('Antal whiteboards');
  await page.locator('dialog select').selectOption('counter');
  await page.locator('dialog').getByLabel('Summera för hela objektet').check();
  await page.locator('dialog .check-grid').getByLabel('Klassrum').check();
  await page.getByRole('button', { name: 'Klar', exact: true }).click();
  await roomCard.getByText('Antal whiteboards').waitFor();
  // Förval: klassrum får 1 whiteboard.
  await roomCard.getByRole('button', { name: /^Lokaltyp/ }).click();
  await page.locator('dialog').getByRole('button', { name: /^Klassrum/ }).click();
  const dlg = page.locator('dialog').last();
  await dlg.locator('[data-field]', { hasText: 'Antal whiteboards' }).getByRole('button', { name: 'Öka' }).click();
  await dlg.getByRole('button', { name: 'Klar', exact: true }).click();
  await page.locator('dialog').getByText('Antal whiteboards: 1').waitFor();
  await page.getByRole('button', { name: 'Klar', exact: true }).click();
  await page.waitForTimeout(300);
  await shot('6-mall');
  const [tplDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportera mall' }).click()]);
  const tpl = JSON.parse(fs.readFileSync(await tplDl.path(), 'utf8'));
  const wb2 = tpl.roomFields.find((f) => f.label === 'Antal whiteboards');
  assert.ok(wb2.sum);
  assert.deepEqual(wb2.roomTypes, ['Klassrum']);
  assert.equal(tpl.roomFields.find((f) => f.role === 'roomType').defaults.Klassrum[wb2.id], 1);
  assert.equal(tpl.origin, undefined);

  await page.goto(url + '#/');
  await page.locator('.link-card').first().click();
  await page.getByRole('link', { name: /^Rum/ }).click();
  await page.locator('.room-main').first().click();
  await field('lokaltyp').waitFor();
  assert.equal(await page.getByText('Antal whiteboards').count(), 0);
  step('gammalt besök behåller sin mall');

  // Offline: ladda om utan nät och skapa ett besök med den nya mallen.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => caches.open('matverktyg-v2').then((c) => c.keys()).then((k) => k.length > 20));
  await ctx.setOffline(true);
  await page.goto(url + '#/');
  await page.reload();
  await page.getByRole('button', { name: '+ Nytt besök' }).click();
  await page.locator('dialog input[type=text]').fill('Offlinekund');
  await page.locator('dialog select').selectOption('kontor');
  await page.getByRole('button', { name: 'Starta' }).click();
  await page.getByRole('link', { name: /^Rum/ }).click();
  await page.getByRole('button', { name: '+ Lägg till rum' }).click();
  await field('lokaltyp').waitFor();
  assert.equal(await page.getByText('Antal whiteboards').count(), 0);
  await field('lokaltyp').locator('select').selectOption('Klassrum');
  assert.equal(await page.locator('[data-field]', { hasText: 'Antal whiteboards' }).locator('input').inputValue(), '1');
  await settle();
  await page.getByRole('link', { name: 'Klar' }).click();
  await page.getByRole('link', { name: 'Summering' }).click();
  const offXlsx = await download('Excel');
  assert.ok(offXlsx.data.length > 1000);
  step('fungerar offline, även export');

  assert.deepEqual(errors, [], 'fel i webbläsarens konsol');
  await browser.close();
  server.close();
  console.log('\nAlla kontroller godkända.');
})().catch((e) => { console.error(e); if (global.__errors?.length) console.error('Konsolfel:', global.__errors); process.exit(1); });

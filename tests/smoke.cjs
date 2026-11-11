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
  const openAll = () => page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  // Envalsfrågor är knappar. Alternativ som inte syns ligger bakom "Fler".
  const picked = async (id) => ((await field(id).locator('.chip.on').count()) ? field(id).locator('.chip.on').innerText() : '');
  const pick = async (id, option) => {
    const btn = field(id).getByRole('button', { name: option, exact: true });
    if (!(await btn.count())) await field(id).getByRole('button', { name: 'Fler …' }).click();
    await btn.click();
  };
  const nextRoom = async () => {
    const before = page.url();
    await page.getByRole('button', { name: 'Nytt rum', exact: true }).click();
    await page.waitForURL((u) => u.href !== before);
    await field('lokaltyp').waitFor();
  };

  await page.goto(url);

  // Snabbinmatningens tolk: fraser och vad de ska ge.
  const parse = (phrases, extra) => page.evaluate(async ([list, add]) => {
    const { parseRoomText } = await import('./js/quick.js');
    const t = await (await fetch('data/default-template.json')).json();
    const fields = t.roomFields.map((f) => ({ ...f, ...(add[f.id] || {}) }));
    return list.map((ph) => {
      const r = parseRoomText(ph, fields);
      const flat = { ...r.values, rest: r.rest };
      if (r.values.yta) flat.yta = r.values.yta.a;
      if (r.count) flat.count = r.count;
      for (const [id, rows] of Object.entries(r.rows)) flat[id] = rows.map(({ _id, ...row }) => row);
      return flat;
    });
  }, [phrases, extra || {}]);
  const cases = {
    'WC, fyra kvadrat, klinker, två toaletter, ett tvättställ':
      { lokaltyp: 'WC', yta: 4, golvtyp: 'Klinker', toaletter: 2, tvattstall: 1, rest: '' },
    'kontorslandskap 8 gånger 7,5 linoleum plan 2 tre fönster':
      { lokaltyp: 'Kontorslandskap', yta: 60, golvtyp: 'Linoleum', vaning: 'Plan 2', fonster: [{ antal: 3 }], rest: '' },
    'kontor 12 kvm parkettgolv fem likadana möblering hög':
      { lokaltyp: 'Kontor', yta: 12, golvtyp: 'Trä / parkett', moblering: 'Hög', count: 5, rest: '' },
    'dusch 6 kvm klinker två duschar':
      { lokaltyp: 'Dusch / omklädning', yta: 6, golvtyp: 'Klinker', duschar: 2, rest: '' },
    'konferensrummet på våning 3 har heltäckningsmatta och 22,5 m2 samt 4 papperskorgar':
      { lokaltyp: 'Konferensrum', yta: 22.5, golvtyp: 'Heltäckningsmatta', vaning: 'Våning 3', papperskorgar: 4, rest: '' },
    'toa 1 handfat 1 wc 2 kvadrat plastgolv':
      { lokaltyp: 'WC', yta: 2, golvtyp: 'Plast / vinyl', toaletter: 1, tvattstall: 1, rest: '' },
    'lager 300 kvadratmeter betong hög takhöjd':
      { lokaltyp: 'Lager / produktion', yta: 300, golvtyp: 'Betong / epoxi', rest: 'hög takhöjd' },
    'det var fint väder': { rest: 'var fint väder' },
  };
  const parsed = await parse(Object.keys(cases));
  Object.entries(cases).forEach(([phrase, want], i) => assert.deepEqual(parsed[i], want, phrase));
  // Egna nyckelord från mallen känns igen.
  assert.deepEqual((await parse(['3 skräpkorgar'], { papperskorgar: { keywords: 'skräpkorg' } }))[0],
    { papperskorgar: 3, rest: '' });
  step('snabbinmatningens tolk');

  await page.getByRole('button', { name: '+ Nytt besök' }).click();
  await page.locator('dialog input[type=text]').fill('Testkund AB');
  await page.locator('dialog select').selectOption('skola');
  await page.getByRole('button', { name: 'Starta' }).click();
  await page.waitForURL(/#\/visit\//);
  step('nytt besök skapat');

  // Besöket öppnas på rumslistan: rundvandringen kommer först.
  await page.locator('.tab.active', { hasText: 'Rum' }).waitFor();

  // Objektfrågor: frågan för skola visas, vårdfrågan visas inte.
  await page.getByRole('link', { name: 'Objekt' }).click();
  await field('antal_elever').waitFor({ state: 'attached' });
  assert.equal(await field('hygienkrav').count(), 0);
  // Sektioner utan obligatoriska frågor är hopfällda, den med Städfrekvens är öppen.
  assert.equal(await field('antal_elever').isVisible(), false);
  assert.equal(await field('stadfrekvens').isVisible(), true);
  await openAll();
  await field('antal_elever').locator('input').fill('240');
  await field('uppgiven_yta').locator('input').fill('1250,5');
  await field('stadtid').getByRole('button', { name: 'Kväll' }).click();
  await page.getByRole('button', { name: '+ Eget fält' }).click();
  await page.locator('dialog input[type=text]').fill('Portkod');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.locator('.custom-field input').fill('1234');
  await page.locator('#saved', { hasText: 'Sparat' }).waitFor();
  const objektet = page.locator('details', { has: page.locator('.fold-title', { hasText: /^Objektet$/ }) });
  assert.match(await objektet.locator('.fold-sum').textContent(), /Antal elever \/ barn 240 st/);
  await shot('1-objekt');
  step('objektfrågor, hopfällda sektioner och eget fält');

  // Rum 1 skapas från rumslistan utan sidbyte: klassrum 8 × 7,5 m, linoleum.
  await page.getByRole('link', { name: /^Rum/ }).click();
  const quick = page.getByLabel('Snabbinmatning');
  const addRoom = page.getByRole('button', { name: 'Lägg till rum', exact: true });
  await quick.fill('klassrum 8 gånger 7,5 linoleum plan 2');
  await addRoom.click();
  await page.locator('.room-card').first().waitFor();
  assert.match(page.url(), /\/rum$/, 'ska stanna kvar på rumslistan');
  assert.match(await page.locator('.room-card').first().innerText(), /1\. Klassrum[\s\S]*60 m²[\s\S]*Linoleum/);
  assert.match(await page.locator('.quick-result').innerText(), /Rum 1 tillagt/);
  assert.match(await page.locator('.tab.active').innerText(), /Rum \(1\)/);
  assert.equal(await quick.inputValue(), '');
  // Foto direkt från raden.
  const fileVia = async (button) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
    await chooser.setFiles(path.join(ROOT, 'icons/icon-192.png'));
  };
  await fileVia(page.locator('.room-card').first().getByRole('button', { name: 'Foto' }));
  await page.locator('.room-card', { hasText: '1 foto' }).waitFor();
  step('rum skapat och fotat från rumslistan');

  // Detaljer i rum 1: två fönsterrader.
  await page.locator('.room-main').first().click();
  await field('lokaltyp').waitFor();
  assert.equal(await picked('lokaltyp'), 'Klassrum');
  assert.equal(await field('toaletter').count(), 0, 'toaletter ska inte visas för klassrum');
  assert.equal(await field('tvattstall').count(), 1);
  assert.equal(await field('yta').getByLabel('Yta').inputValue(), '60');
  assert.equal(await field('tvattstall').isVisible(), false, 'Sanitet ska vara hopfälld');
  await openAll();
  await page.getByRole('button', { name: '+ Lägg till fönster' }).click();
  const w1 = page.locator('.group-row').nth(0);
  await w1.getByRole('button', { name: '2-luft' }).click();
  await w1.getByRole('button', { name: 'Öka' }).click({ clickCount: 4 });
  await page.getByRole('button', { name: '+ Lägg till fönster' }).click();
  const w2 = page.locator('.group-row').nth(1);
  await w2.getByRole('button', { name: 'Glasdörr' }).click();
  await w2.getByRole('button', { name: 'Öka' }).click();
  const glas = page.locator('details', { has: page.locator('.fold-title', { hasText: 'Fönster och glas' }) });
  assert.match(await glas.locator('.fold-sum').textContent(), /Fönster 5/);
  assert.equal(await page.locator('.photo img').count(), 1);
  await settle();
  await shot('2-rum');
  step('rum 1 med fönster');

  // Rum 2 via den fasta raden: WC 4 m², klinker, 2 toaletter.
  await nextRoom();
  // Våning och golvtyp följer med från föregående rum, och lokaltypens förval fylls i.
  assert.equal(await field('vaning').locator('input').inputValue(), 'Plan 2');
  assert.equal(await picked('golvtyp'), 'Linoleum');
  assert.equal(await field('toaletter').count(), 0);
  // Mest använda lokaltypen står först, resten nås via Fler.
  assert.equal(await field('lokaltyp').locator('.chip').first().innerText(), 'Klassrum');
  assert.equal(await field('lokaltyp').getByRole('button', { name: 'WC', exact: true }).count(), 0);
  await pick('lokaltyp', 'WC');
  assert.equal(await picked('golvtyp'), 'Klinker');
  assert.equal(await field('toaletter').locator('input').inputValue(), '1');
  assert.equal(await field('tvattstall').locator('input').inputValue(), '1');
  // Byte av lokaltyp tar bort förvalen igen, och eget svar skrivs inte över.
  await pick('lokaltyp', 'Förråd');
  assert.equal(await picked('golvtyp'), '');
  await pick('golvtyp', 'Sten');
  await pick('lokaltyp', 'WC');
  assert.equal(await picked('golvtyp'), 'Sten');
  await pick('golvtyp', 'Klinker');
  await field('yta').getByLabel('Yta').fill('4');
  await openAll();
  await field('toaletter').getByRole('button', { name: 'Öka' }).click();
  await settle();
  step('förval från föregående rum och lokaltyp');

  // Rum 3: saknar obligatoriska uppgifter.
  await nextRoom();
  await page.locator('#main input[type=text]').first().fill('Rum 3');
  // Snabbinmatning på rumssidan: fyller i, visar vad som tolkades och kan ångras.
  await page.getByLabel('Snabbinmatning').fill('WC 3 kvadrat två toaletter fem likadana gul dörr 4 papperskorgar');
  await page.getByRole('button', { name: 'Fyll i' }).click();
  assert.equal(await picked('lokaltyp'), 'WC');
  assert.equal(await field('yta').getByLabel('Yta').inputValue(), '3');
  assert.equal(await field('toaletter').locator('input').inputValue(), '2');
  assert.equal(await field('tvattstall').locator('input').inputValue(), '1', 'förvalet för WC gäller');
  assert.equal(await field('_count').locator('input').inputValue(), '5');
  assert.match(await page.locator('.quick-result').innerText(), /Tolkades inte: gul dörr/);
  assert.doesNotMatch(await page.locator('#main').innerText(), /\b(false|undefined|null)\b/);
  await page.getByRole('button', { name: 'Lägg i anteckningar' }).click();
  assert.equal(await page.getByLabel('Anteckningar').inputValue(), 'gul dörr');
  await shot('2b-snabbinmatning');
  // En fråga som inte gäller lokaltypen fylls inte i.
  await page.getByLabel('Snabbinmatning').fill('förråd 2 toaletter');
  await page.getByRole('button', { name: 'Fyll i' }).click();
  assert.match(await page.locator('.quick-result').innerText(), /gäller Förråd: Toaletter/);
  await page.getByRole('button', { name: 'Ångra' }).click();
  assert.equal(await picked('lokaltyp'), 'WC');
  // Rummet nollställs för hand för resten av testet: lokaltyp och yta ska saknas.
  await field('lokaltyp').locator('.chip.on').click();
  assert.equal(await picked('lokaltyp'), '');
  await pick('golvtyp', 'Klinker');
  await field('yta').getByLabel('Yta').fill('');
  await field('_count').getByRole('button', { name: 'Minska' }).click({ clickCount: 4 });
  await page.getByLabel('Anteckningar').fill('');
  await settle();
  step('snabbinmatning i rumsformuläret');
  await page.getByRole('link', { name: 'Klar' }).click();
  await page.locator('.room-card').nth(2).waitFor();

  // Rumslistan: det otolkade hamnar i anteckningarna, och Ångra tar bort rummet igen.
  await quick.fill('kontor 10 kvm blå vägg');
  await addRoom.click();
  await page.locator('.room-card').nth(3).waitFor();
  assert.match(await page.locator('.quick-result').innerText(), /Lagt i anteckningarna: blå vägg/);
  await page.locator('.quick-result').getByRole('button', { name: 'Ångra' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.room-card').length === 3);
  assert.equal(await quick.inputValue(), 'kontor 10 kvm blå vägg');
  await quick.fill('');
  // Foto + nytt rum: rummet skapas när bilden är tagen. Tas sedan bort igen.
  await fileVia(page.getByRole('button', { name: 'Foto + nytt rum' }));
  await page.locator('.room-card').nth(3).waitFor();
  assert.match(await page.locator('.room-card').nth(3).innerText(), /1 foto/);
  await page.locator('.room-main').nth(3).click();
  await page.getByRole('button', { name: 'Ta bort rummet' }).click();
  await page.locator('.room-card').nth(2).waitFor();
  assert.equal(await page.locator('.room-card').count(), 3);
  step('ångra och foto först i rumslistan');

  // Kopiera WC:t och låt kopian stå för tre likadana rum.
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
  await page.waitForFunction(() => caches.open('matverktyg-v4').then((c) => c.keys()).then((k) => k.length > 20));
  await ctx.setOffline(true);
  await page.goto(url + '#/');
  await page.reload();
  await page.getByRole('button', { name: '+ Nytt besök' }).click();
  await page.locator('dialog input[type=text]').fill('Offlinekund');
  await page.locator('dialog select').selectOption('kontor');
  await page.getByRole('button', { name: 'Starta' }).click();
  await page.getByRole('button', { name: 'Lägg till rum', exact: true }).click();
  await field('lokaltyp').waitFor();
  assert.equal(await page.getByText('Antal whiteboards').count(), 0);
  await pick('lokaltyp', 'Klassrum');
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

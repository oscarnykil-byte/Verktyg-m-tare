# Kundbesök lokalvård

Ett verktyg för säljare att samla in underlag vid kundbesök: ytor, golvtyper, toaletter, fönster med mera. Det är en webbapp som läggs på mobilens hemskärm och fungerar utan internet. Allt sparas på den egna enheten, inget skickas till någon server.

**Adress:** https://oscarnykil-byte.github.io/Verktyg-m-tare/

## För säljaren

1. **Nytt besök**: ange kund och välj objektstyp. Objektstypen styr vilka frågor som visas. Besöket öppnas på fliken **Rum**, så att rundvandringen kan börja direkt.
2. **Rum**: i rutan *Nytt rum* räknar du upp det du ser och trycker *Lägg till rum*. Rummet hamnar i listan utan att du lämnar sidan.
   - Tryck på mikrofonen på tangentbordet för att diktera. Exempel: *"WC, fyra kvadrat, klinker, två toaletter"* eller *"kontor 4 gånger 3 linoleum plan 2 fem likadana"*.
   - Det som inte tolkas läggs i rummets anteckningar. *Ångra* tar bort rummet igen.
   - *Foto* på en rad tar en bild till det rummet. *Foto + nytt rum* skapar rummet när bilden är tagen, om du vill fota först och fylla i efteråt.
   - Våning och golvtyp följer med från föregående rum, och lokaltypen fyller i förval, till exempel klinker och en toalett för WC.
   - Tom ruta och *Lägg till rum* ger ett tomt rum att fylla i för hand.
3. **Rumssidan**: tryck på ett rum för att komplettera. Lokaltyp och golvtyp är knappar med de mest använda först. Sektioner som Sanitet och Fönster är hopfällda och visar vad som är ifyllt; tryck för att fälla ut. Längst ned finns alltid *Foto*, *Nytt rum* och *Klar*.
   - Ange yta direkt i m², eller längd och bredd så räknas ytan ut.
   - Finns flera likadana rum fylls rummet i en gång och antalet anges i *Antal likadana rum*. Rum som nästan är lika kan kopieras från listan.
4. **Objekt**: uppgifter som gäller hela objektet. De passar bäst vid bordet, före eller efter rundvandringen.
5. **Eget fält**: när mallen inte räcker går det att lägga till en egen fråga på objektet eller rummet.
6. **Summering**: visar total yta, yta per golvtyp och lokaltyp, antal toaletter, fönster per typ och vilka obligatoriska uppgifter som saknas.
7. **Exportera**: Excel för kalkylen, PDF med foton som rapport. Filen delas via mobilens delningsmeny, till exempel med mejl.

Uppe till höger står *Sparat* när det senaste är sparat på enheten.

Uppgifterna finns bara på enheten där de skrevs in. Exportera en **säkerhetskopia** från summeringen om besöket ska flyttas till en annan enhet eller sparas undan.

### Lägga appen på hemskärmen

- **iPhone**: öppna adressen i Safari, tryck på dela-knappen och välj *Lägg till på hemskärmen*.
- **Android**: öppna adressen i Chrome, tryck på menyn och välj *Installera app* eller *Lägg till på startskärmen*.

Öppna appen en gång med täckning. Därefter fungerar den offline.

## För den som ansvarar för mallen

Under **Mall och frågor** på startsidan ändras frågorna utan kod:

- Lägg till, ändra, ta bort och sortera frågor för objektet och för rummen.
- Välj typ av svar: text, tal, yta, räknare, ja/nej, ett eller flera alternativ, eller upprepande rader (som fönster).
- Markera frågor som obligatoriska och begränsa dem till vissa objektstyper.
- Välj vilka tal som ska summeras och vilka alternativ ytan ska delas upp på i summeringen.
- Begränsa en rumsfråga till vissa lokaltyper, så att till exempel toaletter bara efterfrågas i WC.
- Välj vilka svar som ska förifyllas från föregående rum.
- Ange förval per lokaltyp: öppna frågan *Lokaltyp* och tryck på en lokaltyp.
- Lägg till nyckelord för snabbinmatningen på en fråga, så att den känner igen de ord säljarna använder (till exempel *toa* för Toaletter).

Ändringar gäller nya besök. Påbörjade besök behåller mallen de skapades med, men kan bytas till den senaste mallen från summeringen.

### Dela en ändrad mall med säljarna

Det finns två sätt:

- **Skicka filen**: tryck på *Exportera mall* och skicka filen. Säljaren väljer *Läs in mall* i appen.
- **Uppdatera standardmallen**: ersätt `data/default-template.json` i det här repot med den exporterade filen och publicera. Alla som inte har ändrat mallen själva får den automatiskt nästa gång de öppnar appen med täckning.

## Teknik

Ren HTML, CSS och JavaScript utan byggsteg. Mappen kan läggas på vilket webbhotell som helst med HTTPS.

| Fil | Innehåll |
| --- | --- |
| `data/default-template.json` | Standardmallen: frågor, alternativ och objektstyper |
| `js/app.js` | Start och navigering |
| `js/db.js` | Lagring på enheten (IndexedDB) |
| `js/template.js` | Mallhantering och kontroll av inlästa mallar |
| `js/fields.js` | Fälttyperna i formulären |
| `js/quick.js` | Snabbinmatning: tolkar en dikterad eller skriven rad till svar |
| `js/summary.js` | Nyckeltal och kontroll av obligatoriska uppgifter |
| `js/export.js` | Excel, PDF och säkerhetskopia |
| `js/views/` | Skärmarna: start, besök, rum, mallredigerare |
| `sw.js` | Offline-stöd |
| `vendor/` | Bibliotek för Excel och PDF |

När en fil läggs till eller byter namn ska den också in i listan i `sw.js`, och `CACHE` där ska räknas upp.

### Publicering

Appen publiceras med GitHub Pages från grenen `main` (inställningen finns under *Settings → Pages* i repot). Allt som förs över till `main` publiceras automatiskt inom någon minut. Säljarna får den nya versionen nästa gång de öppnar appen med täckning: den hämtas i bakgrunden och visas vid starten därefter.

### Köra lokalt och testa

```
python3 -m http.server 8000     # öppna http://localhost:8000
node tests/smoke.cjs            # kräver Playwright
```

Testet går igenom hela flödet i en mobilwebbläsare: besök, rum, summering, export, säkerhetskopia, mall och offline.

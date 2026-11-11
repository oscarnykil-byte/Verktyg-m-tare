# Kundbesök lokalvård

Ett verktyg för säljare att samla in underlag vid kundbesök: ytor, golvtyper, toaletter, fönster med mera. Det är en webbapp som läggs på mobilens hemskärm och fungerar utan internet. Allt sparas på den egna enheten, inget skickas till någon server.

## För säljaren

1. **Nytt besök**: ange kund och välj objektstyp. Objektstypen styr vilka frågor som visas.
2. **Objekt**: fyll i uppgifter som gäller hela objektet.
3. **Rum**: lägg till ett rum i taget. Ange yta direkt i m², eller längd och bredd så räknas ytan ut. Likadana rum kan kopieras.
4. **Eget fält**: när mallen inte räcker går det att lägga till en egen fråga på objektet eller rummet.
5. **Summering**: visar total yta, yta per golvtyp och lokaltyp, antal toaletter, fönster per typ och vilka obligatoriska uppgifter som saknas.
6. **Exportera**: Excel för kalkylen, PDF med foton som rapport. Filen delas via mobilens delningsmeny, till exempel med mejl.

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
| `js/summary.js` | Nyckeltal och kontroll av obligatoriska uppgifter |
| `js/export.js` | Excel, PDF och säkerhetskopia |
| `js/views/` | Skärmarna: start, besök, rum, mallredigerare |
| `sw.js` | Offline-stöd |
| `vendor/` | Bibliotek för Excel och PDF |

När en fil läggs till eller byter namn ska den också in i listan i `sw.js`, och `CACHE` där ska räknas upp.

### Köra lokalt och testa

```
python3 -m http.server 8000     # öppna http://localhost:8000
node tests/smoke.cjs            # kräver Playwright
```

Testet går igenom hela flödet i en mobilwebbläsare: besök, rum, summering, export, säkerhetskopia, mall och offline.

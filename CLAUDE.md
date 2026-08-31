# CLAUDE.md

Dit bestand geeft richting aan Claude Code (claude.ai/code) bij het werken in deze repository.

## Wat dit is

Een declaratie- en ledenadministratie voor het jeugdwerk van de Hersteld Hervormde Gemeente
Veenendaal. Leidinggevenden dienen declaraties in met een bonnetje, ouders melden hun kind aan
via een publieke link, en de penningmeester keurt goed, betaalt uit via een SEPA-bestand en
koppelt binnengekomen bankbetalingen met behulp van AI.

Live op https://hhgveenendaal.dirkpeterc.workers.dev — dit draait in productie voor een echte
gemeente. Er staan echte namen, IBAN-nummers en betalingen in.

## Commando's

```bash
wrangler deploy                    # deployen (vereist CLOUDFLARE_API_TOKEN)
wrangler secret put NAAM           # secret zetten
wrangler secret list               # secrets tonen (namen, geen waarden)
node --check worker.js             # syntaxcontrole
```

Er is geen buildstap, geen testrunner en geen dependencies. `wrangler deploy` uploadt
`worker.js` met `dashboard.html` als tekst-import. Testen gebeurt tegen de live URL met `curl`;
zie **Testen** hieronder.

## Architectuur

Drie bestanden, geen framework:

- **`worker.js`** — de hele backend. Routering, sessies, Airtable-toegang, SEPA-export,
  CAMT-parser en AI-koppeling. Serveert ook de inlogpagina en de publieke aanmeldpagina's als
  template strings.
- **`dashboard.html`** — de hele frontend als één pagina met inline CSS en JavaScript. Wordt
  via `import dashboard from "./dashboard.html"` als tekst in de worker geladen (zie de
  `[[rules]]`-sectie in `wrangler.toml`) en op `/dashboard` uitgeserveerd.
- **`index.html`** — niet in gebruik, restant van de eerste opzet.

Data staat in Airtable, base `app3zPq4FR5odPXlh`. De worker praat rechtstreeks met de Airtable
REST API; de sleutel blijft server-side.

### Routes

| Route | Toegang | Doel |
|---|---|---|
| `GET /` | publiek | inlogpagina, of doorsturen naar `/dashboard` |
| `POST /` | publiek | inloggen met `APP_PASSWORD` |
| `GET|POST /aanmelden/<slug>` | **publiek** | aanmeldformulier voor ouders |
| `GET /dashboard` | ingelogd | de hele frontend |
| `GET /api/declarations` | ingelogd | declaraties, optioneel `?club=` |
| `POST /api/declarations` | ingelogd | declaratie indienen (multipart) |
| `GET /api/clubs` | ingelogd | clubs met leden/contributie/betaallink |
| `GET /api/leden` | ingelogd | aangemelde leden |
| `GET /api/admin-check` | ingelogd | of de sessie beheerdersrechten heeft |
| `POST /api/admin-login` | ingelogd | beheerder worden met `ADMIN_PASSWORD` |
| `POST /api/declarations/:id/approve` | **beheerder** | goedkeuren, kent referentie toe |
| `POST /api/declarations/:id/reject` | **beheerder** | afkeuren |
| `POST /api/declarations/:id/paid` | **beheerder** | markeren als betaald |
| `POST /api/clubs/:id` | **beheerder** | leden, contributie, betaallink wijzigen |
| `POST /api/leden/:id/paid` | **beheerder** | contributie afvinken |
| `DELETE /api/leden/:id` | **beheerder** | lid verwijderen |
| `GET /api/sepa-export` | **beheerder** | pain.001.001.03 XML voor de bank |
| `POST /api/bank-import` | **beheerder** | CAMT.053 inlezen, geeft voorstellen |
| `POST /api/bank-apply` | **beheerder** | bevestigde koppelingen wegschrijven |
| `GET /api/logout` | publiek | beide cookies wissen |

De aanmeldslugs staan in `CLUB_SLUGS`: `meisjes-5-6`, `jongens-5-6`, `meisjes-7-8`,
`jongens-7-8`, `tienerclub`, `jv-brea`.

## Secrets

Alle zes staan bij Cloudflare, niet in de repo:

`APP_PASSWORD`, `ADMIN_PASSWORD`, `AUTH_SECRET`, `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`,
`AIRTABLE_TABLE_NAME` (= `Declaraties`).

Zet nooit een standaardwaarde als fallback in de code. De inlogcontroles zijn bewust zo
geschreven dat ze falen wanneer het secret ontbreekt, in plaats van iedereen binnen te laten.

## Airtable-schema

**Declaraties** (`tblEJO2VoOd4UEwL1`) — Naam, Club, Bedrag, Datum, Categorie, Omschrijving,
Bonnetje (attachment), Status, IBAN, Referentie, Betaald op, Banktegenrekening, Subgroep,
Bewijs ontbreekt, Reden geen bewijs.
Status doorloopt `Ingediend → Goedgekeurd → Betaald`, met `Afgekeurd` als zijpad.

**Leden** (`tblCLNxyfsx1siBWd`) — Naam kind, Tenaamstelling, Club, Subgroep, Betaald,
Aangemeld, Betaald op, Bankomschrijving.
*Tenaamstelling* is de naam op de bankrekening van de ouder; daar wordt de bankkoppeling op
gebaseerd, niet op de naam van het kind.

**Clubs** (`tblPt4otsM4LwP6UK`) — Club, Leden, Contributie, Betaallink. Zes vaste records.

## Rekenmodel

Tarief per lid per seizoen staat in `RATES` in beide bestanden: € 12,50 voor de vier
kinderclubs, € 20 voor de tienerclub, € 30 voor JV Brea.

```
budget = Leden × tarief  +  Contributie
besteed = som van declaraties met status Goedgekeurd of Betaald
pot     = budget − besteed
```

`Leden` in de Clubs-tabel wordt handmatig ingevuld en is leidend voor de KVD-bijdrage; het
aantal aanmeldingen via het formulier staat er in het adminpaneel naast maar telt niet mee.
Dat is een bewuste keuze van de opdrachtgever.

De tienerclub is opgesplitst in 12+, 13+, 14+ en 15+. Dat is puur categorisering: één club,
één tegel, één pot, één pagina. Leden worden er per groep onder getoond. Verander dit niet in
vier losse clubs.

## Bankkoppeling

`bankImport` verwerkt een CAMT.053-afschrift in twee fases.

Fase 1 loopt alle boekingen langs en classificeert ze:
1. bevat de omschrijving een `HHG-JJJJMMDD-XXX`-referentie die bij een declaratie hoort, dan is
   dat een exacte match — hier komt geen AI aan te pas;
2. is de boeking bij een eerdere import al verwerkt (herkend aan `Bankomschrijving`), dan wordt
   dat gemeld in plaats van dubbel geboekt;
3. anders gaat een inkomende betaling door naar fase 2.

Fase 2 legt de overgebleven betalingen in groepjes van acht aan Workers AI voor, vijf groepjes
tegelijk. Dat is geen optimalisatie maar een noodzaak: één aanroep per betaling loopt rond de
zestig betalingen tegen de limiet op uitgaande verzoeken van Cloudflare aan, waarna de
koppeling stilvalt.

**De verificatielaag is het belangrijkste onderdeel en mag niet worden versoepeld.** Tijdens de
bouw bleek het model matches te verzinnen zodra er geen goede kandidaat was, compleet met een
overtuigend klinkende onderbouwing. `verifieerMatch` rekent elk voorstel daarom deterministisch
na en eist **naamovereenkomst met de tenaamstelling**. Een kloppend bedrag is uitdrukkelijk
niet genoeg: de contributie is per club een vast bedrag, dus vrijwel elke ouder maakt exact
hetzelfde over. Een voorstel dat de controle niet haalt wordt verworpen, niet getoond met een
waarschuwing. Verder kan een lid maar aan één betaling worden gekoppeld, en wordt er nooit iets
weggeschreven zonder dat de beheerder het aanvinkt.

Het model geeft soms `{"koppelingen": [...]}` terug en soms een kale array; `leesJson`
accepteert beide. Valt de AI weg, dan neemt `heuristischeMatch` (naamoverlap plus bedrag) het
over en ziet de beheerder daar een waarschuwing over.

## Valkuilen

**Escapen is verplicht.** Het dashboard bouwt HTML met `innerHTML`. Alles wat van een gebruiker
komt — namen, omschrijvingen, IBAN's, bankgegevens uit een geüpload afschrift — moet door
`esc()`. Het aanmeldformulier is publiek, dus een ouder kan hier script injecteren dat in de
sessie van de penningmeester draait. Dit is één keer misgegaan.

**Airtable pagineert.** Maximaal 100 records per pagina. Gebruik altijd `airtableAlles()`, dat
de offset volgt. Rechtstreeks `fetch` op een tabel laat records stilletjes verdwijnen zodra de
administratie groeit — ook uit de bankkoppeling.

**Valideer op de server.** `controleerDeclaratie()` controleert bedrag, club, categorie, datum
en veldlengtes. Zonder die controle komen negatieve bedragen, `NaN` en `Infinity` in de
administratie; dat verwoest de clubtotalen en laat een SEPA-batch bij de bank stranden.
Controles in het formulier zijn een gemak voor de gebruiker, geen beveiliging.

**Airtable-fouten niet doorgeven.** Toon de gebruiker een begrijpelijke melding; de ruwe
Airtable-tekst zegt niets en verraadt de opbouw achter de schermen.

**`git push` werkt niet altijd.** De omgeving levert soms geen credentials. Lukt push niet, dan
is de GitHub API het alternatief (`mcp__github__push_files`) — maar controleer daarna **altijd**
met `git hash-object <bestand>` tegen `git rev-parse FETCH_HEAD:<bestand>` of de inhoud
byte-voor-byte klopt. Bij een eerdere poging is zo een afgekapt bestand ontdekt.

## Testen

Er is geen testsuite. Testen gaat met `curl` tegen de live URL. Haal eerst een sessie op:

```bash
BASE=https://hhgveenendaal.dirkpeterc.workers.dev
U=$(curl -s -D - -o /dev/null -X POST $BASE/ -d "password=$APP_PASSWORD" \
    | grep -i '^set-cookie: hhg_auth' | sed 's/[Ss]et-[Cc]ookie: //' | cut -d';' -f1)
A=$(curl -s -D - -o /dev/null -X POST $BASE/api/admin-login -H "Cookie: $U" \
    -H 'Content-Type: application/json' -d "{\"password\":\"$ADMIN_PASSWORD\"}" \
    | grep -i '^set-cookie: hhg_admin' | sed 's/[Ss]et-[Cc]ookie: //' | cut -d';' -f1)
```

Test daarna minstens: inloggen met een fout wachtwoord, een zelfverzonnen cookie
(`hhg_auth=1` moet 401 geven), een beheerdersactie zonder beheerderssessie (403), aanmelden via
een publieke link, een declaratie met en zonder bewijs, goedkeuren, SEPA-export, en een
bankimport.

**Ruim testdata daarna op.** Dit is de administratie van een echte gemeente. Verwijder records
via de Airtable API en controleer dat de tellingen weer op nul staan.

## Bewust niet gebouwd

Geen rem op inlogpogingen en geen spamfilter op het publieke aanmeldformulier. De opdrachtgever
weet dit; de links worden persoonlijk rondgestuurd. Bouw het niet ongevraagd alsnog.

## Werkwijze

De opdrachtgever spreekt Nederlands; houd antwoorden, schermteksten en commentaar in het
Nederlands. Codebezeichnungen zijn deels Nederlands (`verifieerMatch`, `airtableAlles`) en
deels Engels (`createDeclaration`, `sepaExport`); sluit aan bij wat er in de buurt staat.

Ontwikkel op branch `claude/create-html-file-lOBLj`. Deploy pas na `node --check`, en
controleer een wijziging tegen de live URL voordat je hem afmeldt.

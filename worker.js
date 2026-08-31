import dashboard from "./dashboard.html";

// De wachtwoorden staan als secret bij Cloudflare, niet in deze broncode.
// Ontbreekt een secret, dan lukt inloggen niet — bewust, in plaats van
// terugvallen op een standaardwaarde die iedereen in de repo kan lezen.
const COOKIE_NAME = "hhg_auth";
const ADMIN_COOKIE = "hhg_admin";
const CLUBS_TABLE = "Clubs";
const LEDEN_TABLE = "Leden";

// Publieke aanmeldlinks: /aanmelden/<slug>
const CLUB_SLUGS = {
    "meisjes-5-6": "Meisjes groep 5 & 6",
    "jongens-5-6": "Jongens groep 5 & 6",
    "meisjes-7-8": "Meisjes groep 7 & 8",
    "jongens-7-8": "Jongens groep 7 & 8",
    "tienerclub": "Tienerclub",
    "jv-brea": "JV Brea",
};
// De tienerclub is opgesplitst in leeftijdsgroepen. Het blijft een club met
// een gedeelde pot; de subgroep dient alleen om leden en uitgaven te ordenen.
const SUBGROEP_CLUB = "Tienerclub";
const SUBGROEPEN = ["12+", "13+", "14+", "15+"];

const DEBTOR_NAME = "HHG Veenendaal";
const DEBTOR_IBAN = "NL50RABO0309378133";
const DEBTOR_BIC = "RABONL2U";

const loginPage = `<!DOCTYPE html>
<html lang="nl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HHG Veenendaal – Inloggen</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: Arial, sans-serif;
            background-color: #f5f3f2;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .login-box {
            background: #fff;
            border: 1px solid #dfe5e6;
            border-radius: 6px;
            box-shadow: 0 0 8px rgba(0,0,0,0.1);
            padding: 32px 40px;
            width: 320px;
        }
        h1 { color: #004b58; font-size: 18px; margin-bottom: 4px; }
        .sub { color: #92aab0; font-size: 12px; margin-bottom: 20px; }
        label { display: block; font-size: 12px; color: #4c4e4f; margin-bottom: 6px; }
        input[type="password"] {
            width: 100%; padding: 8px 10px; border: 1px solid #dfe5e6;
            border-radius: 4px; font-size: 13px; margin-bottom: 16px;
        }
        button {
            width: 100%; background-color: #004b58; color: #fff; border: none;
            border-radius: 4px; padding: 10px; font-size: 13px; cursor: pointer;
        }
        button:hover { background-color: #035765; }
        .error { color: #c00; font-size: 12px; margin-bottom: 12px; }
    </style>
</head>
<body>
    <div class="login-box">
        <h1>HHG Veenendaal</h1>
        <p class="sub">Declaraties Jeugdwerk</p>
        {{error}}
        <form method="POST">
            <label for="password">Wachtwoord</label>
            <input type="password" id="password" name="password" autofocus>
            <button type="submit">Inloggen</button>
        </form>
    </div>
</body>
</html>`;

/* Sessies worden ondertekend met een geheim dat alleen de server kent.
   Een cookie met de hand zetten werkt daardoor niet: zonder geldige
   handtekening is het token waardeloos. */

const SESSIE_DUUR_MS = 30 * 24 * 60 * 60 * 1000; // 30 dagen

async function ondertekenen(secret, data) {
    const key = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
    return btoa(String.fromCharCode(...new Uint8Array(sig)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function maakSessieToken(env, rol) {
    const verloopt = Date.now() + SESSIE_DUUR_MS;
    return `${verloopt}.${await ondertekenen(env.AUTH_SECRET, `${rol}.${verloopt}`)}`;
}

function leesCookie(request, naam) {
    const cookie = request.headers.get("Cookie") || "";
    for (const deel of cookie.split(";")) {
        const [k, ...rest] = deel.trim().split("=");
        if (k === naam) return rest.join("=");
    }
    return null;
}

async function geldigeSessie(request, env, rol, cookieNaam) {
    // Zonder geheim kan niets geverifieerd worden; dan liever iedereen weigeren
    if (!env.AUTH_SECRET) return false;

    const token = leesCookie(request, cookieNaam);
    if (!token) return false;

    const scheiding = token.lastIndexOf(".");
    if (scheiding < 1) return false;

    const verloopt = Number(token.slice(0, scheiding));
    const handtekening = token.slice(scheiding + 1);
    if (!Number.isFinite(verloopt) || Date.now() > verloopt) return false;

    const verwacht = await ondertekenen(env.AUTH_SECRET, `${rol}.${verloopt}`);
    if (handtekening.length !== verwacht.length) return false;

    // Constante-tijdvergelijking, zodat de handtekening niet te raden is
    let verschil = 0;
    for (let i = 0; i < handtekening.length; i++) {
        verschil |= handtekening.charCodeAt(i) ^ verwacht.charCodeAt(i);
    }
    return verschil === 0;
}

function isAuthenticated(request, env) {
    return geldigeSessie(request, env, "gebruiker", COOKIE_NAME);
}

function isAdmin(request, env) {
    return geldigeSessie(request, env, "beheerder", ADMIN_COOKIE);
}

// ISO 13616 / mod-97 IBAN validatie
const IBAN_LENGTHS = { NL: 18, BE: 16, DE: 22, FR: 27, GB: 22, ES: 24, IT: 27, LU: 20, AT: 20, CH: 21 };

function isValidIban(input) {
    const iban = (input || "").replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
    const expected = IBAN_LENGTHS[iban.slice(0, 2)];
    if (expected && iban.length !== expected) return false;
    const rearranged = iban.slice(4) + iban.slice(0, 4);
    let remainder = 0;
    for (const ch of rearranged) {
        const v = ch >= "0" && ch <= "9" ? ch : String(ch.charCodeAt(0) - 55);
        for (const d of v) remainder = (remainder * 10 + Number(d)) % 97;
    }
    return remainder === 1;
}

function generateReference() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `HHG-${y}${m}${d}-${rand}`;
}

/* Airtable geeft maximaal 100 records per pagina terug. Zonder de offset te
   volgen verdwijnen records zodra een tabel groter wordt dan dat — stil, en
   juist bij het koppelen van bankbetalingen zou dat misgaan. */
async function airtableAlles(env, tabel, query = "") {
    const records = [];
    let offset = null;
    do {
        const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(tabel)}`
            + `?pageSize=100${query ? "&" + query : ""}${offset ? "&offset=" + encodeURIComponent(offset) : ""}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "Airtable fout");
        records.push(...(data.records || []));
        offset = data.offset || null;
    } while (offset);
    return records;
}

async function getDeclarations(env, club) {
    let query = "sort[0][field]=Datum&sort[0][direction]=desc";
    if (club) {
        query += `&filterByFormula=${encodeURIComponent(`{Club}="${club.replace(/"/g, '\\"')}"`)}`;
    }
    const records = await airtableAlles(env, env.AIRTABLE_TABLE_NAME, query);
    return new Response(JSON.stringify({ records }), {
        headers: { "Content-Type": "application/json" },
    });
}

const ALLE_CLUBS = Object.values(CLUB_SLUGS);
const CATEGORIEEN = ["Materiaal", "Eten", "Uitje", "Overig"];
const MAX_BEDRAG = 5000;

/* Zonder deze controles komt er onzin in de administratie: een negatief bedrag
   laat de hele SEPA-batch bij de bank stranden, en "abc" of 1e999 maakt van het
   clubtotaal een onbruikbaar getal. */
function controleerDeclaratie({ naam, club, bedrag, datum, omschrijving, categorie }) {
    if (!naam || naam.length < 2 || naam.length > 100) return "Vul een naam in van 2 tot 100 tekens.";
    if (!ALLE_CLUBS.includes(club)) return "Kies een bestaande club.";
    if (!CATEGORIEEN.includes(categorie)) return "Kies een bestaande categorie.";
    if (!omschrijving || omschrijving.length < 3 || omschrijving.length > 1000) {
        return "Vul een omschrijving in van 3 tot 1000 tekens.";
    }
    if (!Number.isFinite(bedrag) || bedrag <= 0) return "Vul een bedrag in dat groter is dan nul.";
    if (bedrag > MAX_BEDRAG) return `Bedragen boven € ${MAX_BEDRAG} kunnen niet online worden gedeclareerd. Neem contact op met de penningmeester.`;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum || "")) return "Kies een geldige datum.";
    const d = new Date(datum + "T12:00:00Z");
    if (Number.isNaN(d.getTime()) || datum !== d.toISOString().slice(0, 10)) return "Kies een geldige datum.";
    const overmorgen = Date.now() + 2 * 24 * 60 * 60 * 1000;
    const tweeJaarTerug = Date.now() - 730 * 24 * 60 * 60 * 1000;
    if (d.getTime() > overmorgen) return "De datum kan niet in de toekomst liggen.";
    if (d.getTime() < tweeJaarTerug) return "Declaraties ouder dan twee jaar kunnen niet meer worden ingediend.";

    return null;
}

async function createDeclaration(request, env) {
    const formData = await request.formData();
    const naam = (formData.get("naam") || "").toString().trim();
    const club = (formData.get("club") || "").toString();
    const bedrag = Math.round(parseFloat(formData.get("bedrag")) * 100) / 100;
    const datum = (formData.get("datum") || "").toString().trim();
    const omschrijving = (formData.get("omschrijving") || "").toString().trim();
    const categorie = (formData.get("categorie") || "").toString();

    const invoerFout = controleerDeclaratie({ naam, club, bedrag, datum, omschrijving, categorie });
    if (invoerFout) {
        return new Response(JSON.stringify({ error: invoerFout }), {
            status: 400, headers: { "Content-Type": "application/json" },
        });
    }
    const iban = (formData.get("iban") || "").trim().replace(/\s+/g, "").toUpperCase();
    const subgroep = (formData.get("subgroep") || "").toString().trim();
    const bonnetje = formData.get("bonnetje");
    const geenBewijs = formData.get("geenBewijs") === "true";
    const redenGeenBewijs = (formData.get("redenGeenBewijs") || "").toString().trim().slice(0, 500);

    if (!isValidIban(iban)) {
        return new Response(JSON.stringify({ error: "Ongeldig IBAN-nummer" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    // Bewijs is verplicht: een bon, of anders een kopie van de bankbetaling.
    // Alleen als beide er echt niet meer zijn kan het met een toelichting.
    const heeftBijlage = bonnetje && bonnetje.size > 0;
    if (!heeftBijlage && !geenBewijs) {
        return new Response(JSON.stringify({
            error: "Voeg een bon of een kopie van de bankbetaling toe. Heb je die geen van beide meer, vink dan aan dat er geen bewijs beschikbaar is.",
        }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (!heeftBijlage && geenBewijs && redenGeenBewijs.length < 10) {
        return new Response(JSON.stringify({
            error: "Leg kort uit waarom er geen bon of bankafschrift meer is.",
        }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const createRes = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                fields: {
                    Naam: naam,
                    Club: club,
                    Bedrag: bedrag,
                    Datum: datum,
                    Omschrijving: omschrijving,
                    Categorie: categorie,
                    IBAN: iban,
                    Status: "Ingediend",
                    ...(club === SUBGROEP_CLUB && SUBGROEPEN.includes(subgroep) ? { Subgroep: subgroep } : {}),
                    ...(heeftBijlage ? {} : { "Bewijs ontbreekt": true, "Reden geen bewijs": redenGeenBewijs }),
                },
            }),
        }
    );

    if (!createRes.ok) {
        // De precieze Airtable-melding is voor de gebruiker onbegrijpelijk en
        // vertelt bovendien iets over de opbouw achter de schermen.
        await createRes.text().catch(() => "");
        return new Response(JSON.stringify({
            error: "Opslaan is niet gelukt. Probeer het opnieuw of neem contact op met de penningmeester.",
        }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    const created = await createRes.json();
    const recordId = created.id;

    let attachmentWarning = null;
    if (bonnetje && bonnetje.size > 0) {
        // Airtable Content API expects JSON with base64-encoded file (max 5 MB)
        const bytes = new Uint8Array(await bonnetje.arrayBuffer());
        let binary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }

        const uploadRes = await fetch(
            `https://content.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${recordId}/Bonnetje/uploadAttachment`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    contentType: bonnetje.type || "application/octet-stream",
                    file: btoa(binary),
                    filename: bonnetje.name || "bonnetje",
                }),
            }
        );

        if (!uploadRes.ok) {
            const err = await uploadRes.json().catch(() => ({}));
            attachmentWarning = err.error?.message || "Bonnetje uploaden mislukt";

            // De declaratie staat er al, maar zonder bewijs. Hem stil laten staan
            // zou de bewijsplicht omzeilbaar maken, dus markeren we hem alsnog.
            await fetch(
                `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}/${recordId}`,
                {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        fields: {
                            "Bewijs ontbreekt": true,
                            "Reden geen bewijs": `Bijlage kon niet worden opgeslagen (${attachmentWarning}). Vraag de indiener het bewijs opnieuw aan te leveren.`,
                        },
                        typecast: true,
                    }),
                }
            );
        }
    }

    return new Response(JSON.stringify({ success: true, id: recordId, attachmentWarning }), {
        headers: { "Content-Type": "application/json" },
    });
}

async function approveDeclaration(recordId, env) {
    const referentie = generateReference();

    const updateRes = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}/${recordId}`,
        {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                fields: {
                    Status: "Goedgekeurd",
                    Referentie: referentie,
                },
            }),
        }
    );

    if (!updateRes.ok) {
        const err = await updateRes.json();
        return new Response(JSON.stringify({ error: err.error?.message || "Airtable fout" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    const updated = await updateRes.json();
    return new Response(JSON.stringify({ success: true, referentie, record: updated }), {
        headers: { "Content-Type": "application/json" },
    });
}

async function markPaid(recordId, env) {
    const res = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}/${recordId}`,
        {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ fields: { Status: "Betaald" }, typecast: true }),
        }
    );
    const updated = await res.json();
    return new Response(JSON.stringify({ success: res.ok, record: updated }), {
        headers: { "Content-Type": "application/json" },
    });
}

async function getClubs(env) {
    const records = await airtableAlles(env, CLUBS_TABLE);
    return new Response(JSON.stringify({ records }), {
        headers: { "Content-Type": "application/json" },
    });
}

async function updateClub(recordId, request, env) {
    const body = await request.json().catch(() => ({}));
    const fields = {};
    if (body.leden != null) fields.Leden = Number(body.leden);
    if (body.contributie != null) fields.Contributie = Number(body.contributie);
    if (body.betaallink != null) fields.Betaallink = String(body.betaallink).trim();

    const res = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${CLUBS_TABLE}/${recordId}`,
        {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ fields }),
        }
    );
    const updated = await res.json();
    return new Response(JSON.stringify({ success: res.ok, record: updated }), {
        headers: { "Content-Type": "application/json" },
    });
}

function xmlEscape(s) {
    return String(s || "").replace(/[<>&"']/g, c => ({
        "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
    }[c]));
}

async function sepaExport(env) {
    // Alle goedgekeurde declaraties ophalen
    const alleRecords = await airtableAlles(
        env, env.AIRTABLE_TABLE_NAME,
        `filterByFormula=${encodeURIComponent('{Status}="Goedgekeurd"')}`
    );
    const all = alleRecords.filter(r => r.fields.Bedrag > 0);
    const records = all.filter(r => isValidIban(r.fields.IBAN));
    const skipped = all.filter(r => !isValidIban(r.fields.IBAN));

    if (records.length === 0) {
        return new Response(JSON.stringify({ error: "Geen goedgekeurde declaraties met geldig IBAN om te exporteren" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
    const msgId = `HHG-EXPORT-${stamp}`;
    const execDate = now.toISOString().slice(0, 10);
    const total = records.reduce((s, r) => s + r.fields.Bedrag, 0).toFixed(2);

    const txs = records.map(r => {
        const f = r.fields;
        const ref = f.Referentie || r.id;
        const remit = `${ref} ${f.Omschrijving || ""}`.trim().substring(0, 140);
        return `      <CdtTrfTxInf>
        <PmtId><EndToEndId>${xmlEscape(ref)}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${f.Bedrag.toFixed(2)}</InstdAmt></Amt>
        <Cdtr><Nm>${xmlEscape(f.Naam)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${xmlEscape(f.IBAN)}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${xmlEscape(remit)}</Ustrd></RmtInf>
      </CdtTrfTxInf>`;
    }).join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${msgId}</MsgId>
      <CreDtTm>${now.toISOString().slice(0, 19)}</CreDtTm>
      <NbOfTxs>${records.length}</NbOfTxs>
      <CtrlSum>${total}</CtrlSum>
      <InitgPty><Nm>${xmlEscape(DEBTOR_NAME)}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${msgId}-1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>false</BtchBookg>
      <NbOfTxs>${records.length}</NbOfTxs>
      <CtrlSum>${total}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${execDate}</ReqdExctnDt>
      <Dbtr><Nm>${xmlEscape(DEBTOR_NAME)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${DEBTOR_IBAN}</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId><BIC>${DEBTOR_BIC}</BIC></FinInstnId></DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${txs}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;

    return new Response(xml, {
        headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Content-Disposition": `attachment; filename="sepa-${execDate}.xml"`,
            "X-Record-Ids": records.map(r => r.id).join(","),
            "X-Skipped-Count": String(skipped.length),
        },
    });
}

async function rejectDeclaration(recordId, env) {
    const updateRes = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}/${recordId}`,
        {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ fields: { Status: "Afgekeurd" } }),
        }
    );

    const updated = await updateRes.json();
    return new Response(JSON.stringify({ success: updateRes.ok, record: updated }), {
        headers: { "Content-Type": "application/json" },
    });
}

// Contributie per lid per club
const RATES = {
    "Meisjes groep 5 & 6": 12.5,
    "Jongens groep 5 & 6": 12.5,
    "Meisjes groep 7 & 8": 12.5,
    "Jongens groep 7 & 8": 12.5,
    "Tienerclub": 20,
    "JV Brea": 30,
};

function esc(s) {
    return String(s ?? "").replace(/[<>&"']/g, c => ({
        "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

async function getLeden(env) {
    const records = await airtableAlles(env, LEDEN_TABLE);
    return new Response(JSON.stringify({ records }), {
        headers: { "Content-Type": "application/json" },
    });
}

async function toggleLidPaid(recordId, request, env) {
    const body = await request.json().catch(() => ({}));
    const res = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${LEDEN_TABLE}/${recordId}`,
        {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ fields: { Betaald: !!body.betaald } }),
        }
    );
    return new Response(JSON.stringify({ success: res.ok, record: await res.json() }), {
        headers: { "Content-Type": "application/json" },
    });
}

async function deleteLid(recordId, env) {
    const res = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${LEDEN_TABLE}/${recordId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } }
    );
    return new Response(JSON.stringify({ success: res.ok }), {
        headers: { "Content-Type": "application/json" },
    });
}

async function clubBetaallink(env, club) {
    const records = await airtableAlles(env, CLUBS_TABLE);
    return records.find(r => r.fields.Club === club)?.fields.Betaallink || "";
}

function registrationPage({ club, slug, betaallink, done, naam, error }) {
    const tarief = RATES[club] || 0;
    const bedrag = "€ " + tarief.toFixed(2).replace(".", ",");

    const body = done
        ? `<div class="done">
             <div class="check">✓</div>
             <h2>Aanmelding ontvangen</h2>
             <p><strong>${esc(naam)}</strong> is aangemeld voor ${esc(club)}.</p>
           </div>
           <div class="pay-block">
             <p class="pay-intro">De contributie bedraagt <strong>${bedrag}</strong> per seizoen.</p>
             ${betaallink
                ? `<a class="btn-pay" href="${esc(betaallink)}" target="_blank" rel="noopener">Nu betalen bij de Rabobank</a>
                   <p class="pay-note">U wordt doorgestuurd naar een beveiligde betaalpagina van de Rabobank.</p>`
                : `<p class="pay-note">De betaallink is nog niet beschikbaar. U ontvangt deze binnenkort van de leiding.</p>`}
           </div>
           <p class="again"><a href="/aanmelden/${esc(slug)}">Nog een kind aanmelden</a></p>`
        : `<p class="intro">Meld uw kind hieronder aan. De contributie bedraagt <strong>${bedrag}</strong> per seizoen; na aanmelding kunt u direct betalen.</p>
           ${error ? `<p class="error">${esc(error)}</p>` : ""}
           <form method="POST">
             <label for="naam">Naam van het kind</label>
             <input type="text" id="naam" name="naam" required autocomplete="off" value="${esc(naam || "")}">

             <label for="tenaamstelling">Tenaamstelling</label>
             <span class="hint">De naam waarop de bankrekening staat waarvan u betaalt, zodat wij uw betaling kunnen herkennen.</span>
             <input type="text" id="tenaamstelling" name="tenaamstelling" required autocomplete="off">
${club === SUBGROEP_CLUB ? `
             <label for="subgroep">Leeftijdsgroep</label>
             <span class="hint">De tienerclub komt samen in vier leeftijdsgroepen.</span>
             <select id="subgroep" name="subgroep" required>
               <option value="">Kies een groep...</option>
               ${SUBGROEPEN.map(s => `<option>${s}</option>`).join("\n               ")}
             </select>
` : ""}
             <button type="submit">Aanmelden</button>
           </form>`;

    return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Aanmelden ${esc(club)} – HHG Veenendaal</title>
<style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; font-size:14px; background:#f5f3f2; color:#4c4e4f;
           min-height:100vh; padding:0 0 40px; }
    header { background:#004b58; color:#fff; padding:18px 20px; }
    header h1 { font-size:16px; }
    header .sub { color:#92aab0; font-size:12px; margin-top:2px; }
    .wrap { max-width:520px; margin:24px auto; padding:0 16px; }
    .card { background:#fff; border:1px solid #dfe5e6; border-radius:6px;
            box-shadow:0 0 6px rgba(0,0,0,.08); padding:24px; }
    h2 { color:#004b58; font-size:18px; margin-bottom:10px; }
    .club-name { color:#035765; font-size:13px; font-weight:bold; margin-bottom:14px; }
    .intro { line-height:1.6; margin-bottom:18px; color:#4c4e4f; }
    label { display:block; font-weight:bold; font-size:13px; color:#004b58; margin-bottom:4px; }
    .hint { display:block; font-size:11px; color:#92aab0; margin-bottom:6px; line-height:1.5; }
    input[type=text] { width:100%; padding:11px 12px; border:1px solid #dfe5e6; border-radius:4px;
                       font-size:15px; margin-bottom:18px; font-family:inherit; }
    input[type=text]:focus, select:focus { outline:none; border-color:#63858e; }
    select { width:100%; padding:11px 12px; border:1px solid #dfe5e6; border-radius:4px;
             font-size:15px; margin-bottom:18px; font-family:inherit; background:#fff; }
    button { width:100%; background:#004b58; color:#fff; border:none; border-radius:4px;
             padding:13px; font-size:15px; cursor:pointer; }
    button:hover { background:#035765; }
    .error { color:#c00; font-size:13px; margin-bottom:14px; }
    .done { text-align:center; padding-bottom:18px; border-bottom:1px solid #e4e8e9; margin-bottom:18px; }
    .check { width:46px; height:46px; line-height:46px; border-radius:50%; background:#e6f4e6;
             color:#2a7a2a; font-size:24px; margin:0 auto 12px; }
    .done p { color:#4c4e4f; line-height:1.6; }
    .pay-block { text-align:center; }
    .pay-intro { margin-bottom:14px; line-height:1.6; }
    .btn-pay { display:block; background:#fc6600; color:#fff; text-decoration:none;
               padding:14px; border-radius:4px; font-size:15px; font-weight:bold; }
    .btn-pay:hover { background:#e35c00; }
    .pay-note { font-size:11px; color:#92aab0; margin-top:10px; line-height:1.5; }
    .again { text-align:center; margin-top:20px; font-size:13px; }
    .again a { color:#035765; }
    footer { text-align:center; color:#92aab0; font-size:11px; margin-top:18px; }
</style>
</head>
<body>
<header>
    <h1>HHG Veenendaal</h1>
    <div class="sub">Jeugdwerk – aanmelden</div>
</header>
<div class="wrap">
    <div class="card">
        <div class="club-name">${esc(club)}</div>
        ${body}
    </div>
    <footer>Hersteld Hervormde Gemeente Veenendaal</footer>
</div>
</body>
</html>`;
}

async function handleRegistration(request, slug, env) {
    const club = CLUB_SLUGS[slug];
    if (!club) {
        return new Response("Onbekende club", { status: 404 });
    }

    const betaallink = await clubBetaallink(env, club);

    if (request.method === "POST") {
        const form = await request.formData();
        const naam = (form.get("naam") || "").toString().trim().slice(0, 100);
        const tenaamstelling = (form.get("tenaamstelling") || "").toString().trim().slice(0, 100);
        const subgroep = (form.get("subgroep") || "").toString().trim();
        const subgroepVereist = club === SUBGROEP_CLUB;

        if (!naam || !tenaamstelling) {
            return new Response(registrationPage({
                club, slug, betaallink, naam,
                error: "Vul alle velden in.",
            }), { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
        }

        if (subgroepVereist && !SUBGROEPEN.includes(subgroep)) {
            return new Response(registrationPage({
                club, slug, betaallink, naam,
                error: "Kies een leeftijdsgroep.",
            }), { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
        }

        const res = await fetch(
            `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${LEDEN_TABLE}`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    fields: {
                        "Naam kind": naam,
                        Tenaamstelling: tenaamstelling,
                        Club: club,
                        Betaald: false,
                        Aangemeld: new Date().toISOString().slice(0, 10),
                        ...(subgroepVereist ? { Subgroep: subgroep } : {}),
                    },
                }),
            }
        );

        if (!res.ok) {
            return new Response(registrationPage({
                club, slug, betaallink, naam,
                error: "Aanmelden is niet gelukt. Probeer het later opnieuw.",
            }), { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
        }

        return new Response(registrationPage({ club, slug, betaallink, done: true, naam }), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
        });
    }

    return new Response(registrationPage({ club, slug, betaallink }), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
}

/* ─── Bankimport (CAMT.053 van de Rabobank) ─── */

const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function tag(block, name) {
    const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
    return m ? m[1].trim() : "";
}

function tagAll(block, name) {
    const out = [];
    const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "g");
    let m;
    while ((m = re.exec(block)) !== null) out.push(m[1].trim());
    return out;
}

// Rabobank levert CAMT.053; elke boeking is een <Ntry>-blok.
function parseCamt053(xml) {
    const entries = tagAll(xml, "Ntry");
    return entries.map((ntry, i) => {
        const amountRaw = tag(ntry, "Amt");
        const bedrag = parseFloat(amountRaw.replace(",", ".")) || 0;
        const richting = tag(ntry, "CdtDbtInd") === "DBIT" ? "af" : "bij";

        const bookg = tag(ntry, "BookgDt");
        const datum = (tag(bookg, "Dt") || tag(bookg, "DtTm") || "").slice(0, 10);

        // Tegenpartij: bij inkomend is dat de debiteur, bij uitgaand de crediteur
        const dbtrNaam = tag(tag(ntry, "Dbtr"), "Nm");
        const cdtrNaam = tag(tag(ntry, "Cdtr"), "Nm");
        const namen = tagAll(ntry, "Nm");
        const naam = (richting === "bij" ? dbtrNaam : cdtrNaam) || namen[0] || "";

        const ibans = tagAll(ntry, "IBAN");
        const iban = ibans.find(x => x && x !== DEBTOR_IBAN) || "";

        const omschrijving = [
            ...tagAll(ntry, "Ustrd"),
            tag(tag(ntry, "Strd"), "Ref"),
        ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

        return {
            id: `tx${i}`,
            datum,
            bedrag: Math.round(bedrag * 100) / 100,
            richting,
            naam,
            iban,
            omschrijving,
            endToEndId: tag(tag(ntry, "Refs"), "EndToEndId"),
        };
    }).filter(t => t.bedrag > 0);
}

function normaliseer(s) {
    return String(s || "")
        .toLowerCase()
        .normalize("NFD").replace(/\p{Mn}/gu, "")
        .replace(/\b(fam|familie|dhr|mevr|mw|de heer|mevrouw)\b\.?/g, " ")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// Fallback wanneer de AI niet beschikbaar is: naamoverlap + bedrag
function heuristischeMatch(tx, kandidaten) {
    const txWoorden = new Set(normaliseer(tx.naam).split(" ").filter(w => w.length > 2));
    let beste = null;
    for (const k of kandidaten) {
        const kWoorden = normaliseer(k.tenaamstelling).split(" ").filter(w => w.length > 2);
        if (!kWoorden.length) continue;
        const overlap = kWoorden.filter(w => txWoorden.has(w)).length / kWoorden.length;
        const bedragOk = Math.abs(tx.bedrag - k.bedrag) < 0.01;
        const score = overlap * (bedragOk ? 1 : 0.6);
        if (score > 0.5 && (!beste || score > beste.score)) {
            beste = { score, lid: k, reden: `Naamovereenkomst met tenaamstelling${bedragOk ? " en bedrag klopt" : ""}` };
        }
    }
    return beste;
}

// De AI kan een match verzinnen als er geen goede kandidaat is. Daarom controleren
// we elk voorstel deterministisch op bedrag en naamovereenkomst voordat we het tonen.
function verifieerMatch(tx, gekozen) {
    if (!gekozen.length) return null;

    const som = gekozen.reduce((s, l) => s + l.bedrag, 0);
    const bedragKlopt = Math.abs(som - tx.bedrag) < 0.01;

    const betalerWoorden = new Set(normaliseer(tx.naam).split(" ").filter(w => w.length > 2));
    const naamKlopt = gekozen.some(l =>
        normaliseer(l.tenaamstelling).split(" ")
            .filter(w => w.length > 2)
            .some(w => betalerWoorden.has(w))
    );

    // Het bedrag alleen is geen bewijs: de contributie is per club een vast bedrag,
    // dus veel ouders maken exact hetzelfde over. Zonder naamovereenkomst verwerpen we
    // het voorstel, ook als de AI overtuigd klinkt.
    if (!naamKlopt) return null;

    return {
        bedragKlopt,
        naamKlopt,
        zekerheid: bedragKlopt ? "hoog" : "midden",
    };
}

/* Cloudflare staat maar een beperkt aantal uitgaande verzoeken per aanroep toe.
   Eén AI-aanroep per betaling loopt daar bij een normaal maandafschrift tegenaan,
   waarna de koppeling stilvalt. Daarom behandelen we de betalingen in groepjes. */
const BETALINGEN_PER_AI_AANROEP = 8;
const MAX_AI_AANROEPEN = 25;
const GROEPEN_TEGELIJK = 5;

/* Het model zet er soms uitleg omheen of geeft meerdere objecten terug. Een
   simpele regex pakt dan te veel; daarom zoeken we het eerste object waarvan
   de accolades netjes in balans zijn. */
function leesJson(tekst) {
    // Het model geeft nu eens een object, dan weer een kale array terug
    const kandidaten = [tekst.indexOf("{"), tekst.indexOf("[")].filter(i => i !== -1);
    if (!kandidaten.length) return null;
    const start = Math.min(...kandidaten);
    const open = tekst[start];
    const sluit = open === "{" ? "}" : "]";

    let diep = 0, inString = false, escape = false;
    for (let i = start; i < tekst.length; i++) {
        const c = tekst[i];
        if (escape) { escape = false; continue; }
        if (c === "\\") { escape = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (c === open) diep++;
        else if (c === sluit && --diep === 0) {
            try { return JSON.parse(tekst.slice(start, i + 1)); } catch { return null; }
        }
    }
    return null;
}

async function aiMatchBatch(env, transacties, kandidaten) {
    const lijstLeden = kandidaten.map((k, i) =>
        `${i}. kind="${k.naamKind}" tenaamstelling="${k.tenaamstelling}" club="${k.club}" verwacht=EUR${k.bedrag.toFixed(2)}`
    ).join("\n");

    const lijstBetalingen = transacties.map((t, i) =>
        `${i}. betaler="${t.naam}" bedrag=EUR${t.bedrag.toFixed(2)} omschrijving="${t.omschrijving}"`
    ).join("\n");

    const prompt = `Je koppelt bankbetalingen aan openstaande contributies van een kerkelijke jeugdclub.

BETALINGEN
${lijstBetalingen}

OPENSTAANDE CONTRIBUTIES
${lijstLeden}

Regels:
- De naam van de betaler hoort bij de "tenaamstelling", niet per se bij de naam van het kind.
- Een ouder kan in een keer voor meerdere kinderen betalen; het bedrag is dan de som. Geef in dat geval meerdere ledennummers.
- Koppel elk lid aan hoogstens een betaling.
- Twijfel je, geef dan een lege lijst in plaats van een gok.

Antwoord met alleen JSON, geen uitleg eromheen. Geef voor elke betaling een regel:
{"koppelingen": [{"betaling": 0, "leden": [3], "zekerheid": "hoog|midden|laag", "reden": "korte reden"}]}`;

    const res = await env.AI.run(AI_MODEL, {
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1200,
        temperature: 0,
    });

    // Workers AI levert afhankelijk van het model een andere vorm terug
    const kandidaatTekst = [
        res?.response,
        res?.result?.response,
        res?.choices?.[0]?.message?.content,
        typeof res === "string" ? res : null,
    ].find(v => typeof v === "string" && v.trim());

    if (!kandidaatTekst) {
        throw new Error("Onbekend AI-antwoordformaat: " + JSON.stringify(res).slice(0, 200));
    }

    const parsed = leesJson(kandidaatTekst);
    if (!parsed) throw new Error("AI gaf geen bruikbare JSON: " + kandidaatTekst.slice(0, 150));

    // Antwoord terugleggen op de betalingen; ontbreekt er een, dan geldt "geen match"
    // Zowel {"koppelingen": [...]} als een kale lijst accepteren
    const koppelingen = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed.koppelingen) ? parsed.koppelingen
        : [];

    const perBetaling = new Map();
    for (const k of koppelingen) {
        if (!Number.isInteger(k.betaling) || !transacties[k.betaling]) continue;
        // Ontdubbelen: het model herhaalt soms een kandidaat om het bedrag te laten kloppen
        const nummers = [...new Set((k.leden || []).filter(n => Number.isInteger(n) && kandidaten[n]))];
        perBetaling.set(k.betaling, {
            leden: nummers.map(n => kandidaten[n]),
            zekerheid: k.zekerheid || "laag",
            reden: k.reden || "",
        });
    }
    return transacties.map((_, i) => perBetaling.get(i) || { leden: [], zekerheid: "laag", reden: "geen match" });
}

async function bankImport(request, env) {
    const form = await request.formData();
    const bestand = form.get("bestand");
    if (!bestand || !bestand.size) {
        return new Response(JSON.stringify({ error: "Geen bestand ontvangen" }), {
            status: 400, headers: { "Content-Type": "application/json" },
        });
    }

    const xml = await bestand.text();
    if (!/<Ntry>/.test(xml)) {
        return new Response(JSON.stringify({
            error: "Dit lijkt geen CAMT.053-bestand. Exporteer bij de Rabobank een bij-/afschrift in XML (CAMT.053).",
        }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const transacties = parseCamt053(xml);

    // Huidige stand uit Airtable
    const [declaraties, leden] = await Promise.all([
        airtableAlles(env, env.AIRTABLE_TABLE_NAME),
        airtableAlles(env, LEDEN_TABLE),
    ]);

    const openstaandeLeden = leden
        .filter(l => !l.fields.Betaald)
        .map(l => ({
            id: l.id,
            naamKind: l.fields["Naam kind"] || "",
            tenaamstelling: l.fields.Tenaamstelling || "",
            club: l.fields.Club || "",
            bedrag: RATES[l.fields.Club] || 0,
        }));

    let aiFouten = 0;
    let aiFoutmelding = null;
    const resultaten = [];
    const teKoppelen = [];

    for (const tx of transacties) {
        // Stap 1: exacte match op onze eigen referentie (HHG-JJJJMMDD-XXX)
        const refMatch = `${tx.omschrijving} ${tx.endToEndId}`.match(/HHG-\d{8}-[A-Z0-9]{3}/);
        if (refMatch) {
            const decl = declaraties.find(d => d.fields.Referentie === refMatch[0]);
            if (decl) {
                resultaten.push({
                    ...tx,
                    type: "declaratie",
                    zekerheid: "zeker",
                    methode: "referentie",
                    reden: `Referentie ${refMatch[0]} gevonden in de omschrijving`,
                    alBetaald: decl.fields.Status === "Betaald",
                    doelen: [{
                        recordId: decl.id,
                        omschrijving: `${decl.fields.Naam} – ${decl.fields.Club}`,
                        bedrag: decl.fields.Bedrag,
                        bedragKlopt: Math.abs((decl.fields.Bedrag || 0) - tx.bedrag) < 0.01,
                    }],
                });
                continue;
            }
        }

        // Stap 2: is deze boeking bij een eerdere import al verwerkt?
        const stempel = `${tx.naam} – ${tx.omschrijving}`.slice(0, 200);
        const eerder = leden.filter(l => l.fields.Betaald && l.fields.Bankomschrijving === stempel);
        if (eerder.length) {
            resultaten.push({
                ...tx, type: "contributie", zekerheid: "zeker", methode: "eerder",
                reden: "Deze boeking is bij een eerdere import al verwerkt",
                alBetaald: true,
                doelen: eerder.map(l => ({
                    recordId: l.id,
                    omschrijving: `${l.fields["Naam kind"]} – ${l.fields.Club}`,
                    bedrag: RATES[l.fields.Club] || 0,
                    bedragKlopt: true,
                })),
            });
            continue;
        }

        // Stap 3: inkomende betaling -> later in groepjes aan de AI voorleggen
        if (tx.richting === "bij" && openstaandeLeden.length) {
            teKoppelen.push({ tx, plek: resultaten.length });
        }
        resultaten.push({
            ...tx, type: "onbekend", zekerheid: "laag", methode: "geen",
            reden: "Geen koppeling gevonden", alBetaald: false, doelen: [],
        });
    }

    // Fase 2: de inkomende betalingen in groepjes voorleggen, zodat we niet
    // tegen de limiet op uitgaande verzoeken aanlopen bij een groot afschrift.
    const terugvallen = (groep) => groep.map(({ tx }) => {
        const h = heuristischeMatch(tx, openstaandeLeden);
        return h ? { leden: [h.lid], zekerheid: "midden", reden: h.reden } : { leden: [] };
    });

    // Groepjes maken en die in parallel afhandelen; achtereenvolgens duurt te lang
    const groepen = [];
    for (let i = 0; i < teKoppelen.length; i += BETALINGEN_PER_AI_AANROEP) {
        groepen.push(teKoppelen.slice(i, i + BETALINGEN_PER_AI_AANROEP));
    }

    const uitkomsten = [];
    for (let i = 0; i < groepen.length; i += GROEPEN_TEGELIJK) {
        const parallel = groepen.slice(i, i + GROEPEN_TEGELIJK).map(async (groep, k) => {
            if (i + k >= MAX_AI_AANROEPEN) {
                return { groep, antwoorden: terugvallen(groep), methode: "heuristiek" };
            }
            try {
                return {
                    groep,
                    antwoorden: await aiMatchBatch(env, groep.map(g => g.tx), openstaandeLeden),
                    methode: "ai",
                };
            } catch (e) {
                aiFouten++;
                if (!aiFoutmelding) aiFoutmelding = String(e && e.message || e).slice(0, 300);
                return { groep, antwoorden: terugvallen(groep), methode: "heuristiek" };
            }
        });
        uitkomsten.push(...(await Promise.all(parallel)));
    }

    // Pas hierna toewijzen, zodat een lid maar bij een betaling kan horen
    const alGekoppeld = new Set();
    for (const { groep, antwoorden, methode } of uitkomsten) {
        groep.forEach(({ tx, plek }, j) => {
            let match = antwoorden[j];
            let gebruikteMethode = methode;

            // Geeft de AI niets terug, dan is naamvergelijking nog een kans;
            // de controle hieronder blijft hoe dan ook gelden.
            if (!match || !match.leden.length) {
                const h = heuristischeMatch(tx, openstaandeLeden);
                if (!h) return;
                match = { leden: [h.lid], zekerheid: "midden", reden: h.reden };
                gebruikteMethode = "heuristiek";
            }

            const leden = match.leden.filter(l => !alGekoppeld.has(l.id));
            const controle = verifieerMatch(tx, leden);
            if (!controle) return;
            leden.forEach(l => alGekoppeld.add(l.id));

            const twijfel = [];
            if (!controle.bedragKlopt) twijfel.push("het bedrag wijkt af");

            resultaten[plek] = {
                ...tx,
                type: "contributie",
                // Nooit hoger dan wat de controle rechtvaardigt
                zekerheid: controle.zekerheid,
                controle: { bedragKlopt: controle.bedragKlopt, naamKlopt: controle.naamKlopt },
                methode: gebruikteMethode,
                reden: (match.reden || "") + (twijfel.length ? ` — let op: ${twijfel.join(" en ")}` : ""),
                alBetaald: false,
                doelen: leden.map(l => ({
                    recordId: l.id,
                    omschrijving: `${l.naamKind} – ${l.club}`,
                    bedrag: l.bedrag,
                    bedragKlopt: controle.bedragKlopt,
                })),
            };
        });
    }

    return new Response(JSON.stringify({
        transacties: resultaten,
        aiBeschikbaar: aiFouten === 0,
        aiFoutmelding,
    }), { headers: { "Content-Type": "application/json" } });
}

async function bankApply(request, env) {
    const body = await request.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items : [];
    let declaraties = 0, contributies = 0;

    for (const item of items) {
        const isDecl = item.type === "declaratie";
        const tabel = isDecl ? encodeURIComponent(env.AIRTABLE_TABLE_NAME) : LEDEN_TABLE;
        const fields = isDecl
            ? { Status: "Betaald", "Betaald op": item.datum || null, Banktegenrekening: item.iban || "" }
            : { Betaald: true, "Betaald op": item.datum || null, Bankomschrijving: `${item.naam} – ${item.omschrijving}`.slice(0, 200) };

        const res = await fetch(
            `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${tabel}/${item.recordId}`,
            {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ fields, typecast: true }),
            }
        );
        if (res.ok) { isDecl ? declaraties++ : contributies++; }
    }

    return new Response(JSON.stringify({ success: true, declaraties, contributies }), {
        headers: { "Content-Type": "application/json" },
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        // Publieke aanmeldpagina voor ouders (geen login vereist)
        const aanmeldMatch = path.match(/^\/aanmelden\/([a-z0-9-]+)\/?$/);
        if (aanmeldMatch) {
            return handleRegistration(request, aanmeldMatch[1], env);
        }

        if (path === "/api/logout") {
            const headers = new Headers({ Location: "/" });
            headers.append("Set-Cookie", `${COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
            headers.append("Set-Cookie", `${ADMIN_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
            return new Response("", { status: 302, headers });
        }

        if (path.startsWith("/api/")) {
            if (!(await isAuthenticated(request, env))) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (path === "/api/admin-login" && request.method === "POST") {
                const body = await request.json().catch(() => ({}));
                if (env.ADMIN_PASSWORD && body.password === env.ADMIN_PASSWORD) {
                    return new Response(JSON.stringify({ success: true }), {
                        headers: {
                            "Content-Type": "application/json",
                            "Set-Cookie": `${ADMIN_COOKIE}=${await maakSessieToken(env, "beheerder")}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${SESSIE_DUUR_MS / 1000}`,
                        },
                    });
                }
                return new Response(JSON.stringify({ error: "Ongeldig wachtwoord" }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (path === "/api/admin-check" && request.method === "GET") {
                return new Response(JSON.stringify({ admin: await isAdmin(request, env) }), {
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (path === "/api/declarations" && request.method === "GET") {
                const club = url.searchParams.get("club") || null;
                return getDeclarations(env, club);
            }

            if (path === "/api/declarations" && request.method === "POST") {
                return createDeclaration(request, env);
            }

            if (path === "/api/clubs" && request.method === "GET") {
                return getClubs(env);
            }

            if (path === "/api/leden" && request.method === "GET") {
                return getLeden(env);
            }

            // Admin-only routes
            const approveMatch = path.match(/^\/api\/declarations\/([^/]+)\/approve$/);
            const rejectMatch = path.match(/^\/api\/declarations\/([^/]+)\/reject$/);
            const paidMatch = path.match(/^\/api\/declarations\/([^/]+)\/paid$/);
            const clubMatch = path.match(/^\/api\/clubs\/([^/]+)$/);
            const lidPaidMatch = path.match(/^\/api\/leden\/([^/]+)\/paid$/);
            const lidMatch = path.match(/^\/api\/leden\/([^/]+)$/);
            const isAdminRoute = approveMatch || rejectMatch || paidMatch || lidPaidMatch ||
                (lidMatch && request.method === "DELETE") ||
                (clubMatch && request.method === "POST") || path === "/api/sepa-export" ||
                path === "/api/bank-import" || path === "/api/bank-apply";

            if (isAdminRoute) {
                if (!(await isAdmin(request, env))) {
                    return new Response(JSON.stringify({ error: "Admin-rechten vereist" }), {
                        status: 403,
                        headers: { "Content-Type": "application/json" },
                    });
                }
                if (lidPaidMatch && request.method === "POST") return toggleLidPaid(lidPaidMatch[1], request, env);
                if (lidMatch && request.method === "DELETE") return deleteLid(lidMatch[1], env);
                if (approveMatch && request.method === "POST") return approveDeclaration(approveMatch[1], env);
                if (rejectMatch && request.method === "POST") return rejectDeclaration(rejectMatch[1], env);
                if (paidMatch && request.method === "POST") return markPaid(paidMatch[1], env);
                if (clubMatch && request.method === "POST") return updateClub(clubMatch[1], request, env);
                if (path === "/api/sepa-export" && request.method === "GET") return sepaExport(env);
                if (path === "/api/bank-import" && request.method === "POST") return bankImport(request, env);
                if (path === "/api/bank-apply" && request.method === "POST") return bankApply(request, env);
            }

            return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
        }

        if (path === "/dashboard") {
            if (!(await isAuthenticated(request, env))) {
                return new Response("", { status: 302, headers: { Location: "/" } });
            }
            return new Response(dashboard, {
                headers: { "Content-Type": "text/html; charset=utf-8" },
            });
        }

        if (request.method === "POST") {
            const body = await request.formData();
            if (env.APP_PASSWORD && body.get("password") === env.APP_PASSWORD) {
                return new Response("", {
                    status: 302,
                    headers: {
                        Location: "/dashboard",
                        "Set-Cookie": `${COOKIE_NAME}=${await maakSessieToken(env, "gebruiker")}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${SESSIE_DUUR_MS / 1000}`,
                    },
                });
            }
            return new Response(loginPage.replace("{{error}}", `<p class="error">Ongeldig wachtwoord.</p>`), {
                status: 401,
                headers: { "Content-Type": "text/html; charset=utf-8" },
            });
        }

        if (await isAuthenticated(request, env)) {
            return new Response("", { status: 302, headers: { Location: "/dashboard" } });
        }

        return new Response(loginPage.replace("{{error}}", ""), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
        });
    },
};

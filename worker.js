import dashboard from "./dashboard.html";

const PASSWORD = "jeugdwerk";
const COOKIE_NAME = "hhg_auth";
const ADMIN_PASSWORD = "penningmeester";
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

function isAuthenticated(request) {
    const cookie = request.headers.get("Cookie") || "";
    return cookie.split(";").some(c => c.trim() === `${COOKIE_NAME}=1`);
}

function isAdmin(request) {
    const cookie = request.headers.get("Cookie") || "";
    return cookie.split(";").some(c => c.trim() === `${ADMIN_COOKIE}=1`);
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

async function getDeclarations(env, club) {
    let formula = "";
    if (club) {
        formula = `&filterByFormula=({Club}="${club.replace(/"/g, '\\"')}")`;
    }
    const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}?sort[0][field]=Datum&sort[0][direction]=desc${formula}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` },
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
    });
}

async function createDeclaration(request, env) {
    const formData = await request.formData();
    const naam = formData.get("naam");
    const club = formData.get("club");
    const bedrag = parseFloat(formData.get("bedrag"));
    const datum = formData.get("datum");
    const omschrijving = formData.get("omschrijving");
    const categorie = formData.get("categorie");
    const iban = (formData.get("iban") || "").trim().replace(/\s+/g, "").toUpperCase();
    const bonnetje = formData.get("bonnetje");

    if (!isValidIban(iban)) {
        return new Response(JSON.stringify({ error: "Ongeldig IBAN-nummer" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
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
                },
            }),
        }
    );

    if (!createRes.ok) {
        const err = await createRes.json();
        return new Response(JSON.stringify({ error: err.error?.message || "Airtable fout" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
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
    const res = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${CLUBS_TABLE}`,
        { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } }
    );
    const data = await res.json();
    return new Response(JSON.stringify(data), {
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
    const res = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}?filterByFormula=({Status}="Goedgekeurd")`,
        { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } }
    );
    const data = await res.json();
    const all = (data.records || []).filter(r => r.fields.Bedrag > 0);
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
    const res = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${LEDEN_TABLE}`,
        { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } }
    );
    return new Response(JSON.stringify(await res.json()), {
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
    const res = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${CLUBS_TABLE}`,
        { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } }
    );
    const data = await res.json();
    const rec = (data.records || []).find(r => r.fields.Club === club);
    return rec?.fields.Betaallink || "";
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
    input[type=text]:focus { outline:none; border-color:#63858e; }
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

        if (!naam || !tenaamstelling) {
            return new Response(registrationPage({
                club, slug, betaallink, naam,
                error: "Vul beide velden in.",
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
            if (!isAuthenticated(request)) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (path === "/api/admin-login" && request.method === "POST") {
                const body = await request.json().catch(() => ({}));
                if (body.password === ADMIN_PASSWORD) {
                    return new Response(JSON.stringify({ success: true }), {
                        headers: {
                            "Content-Type": "application/json",
                            "Set-Cookie": `${ADMIN_COOKIE}=1; Path=/; HttpOnly; SameSite=Strict`,
                        },
                    });
                }
                return new Response(JSON.stringify({ error: "Ongeldig wachtwoord" }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (path === "/api/admin-check" && request.method === "GET") {
                return new Response(JSON.stringify({ admin: isAdmin(request) }), {
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
                (clubMatch && request.method === "POST") || path === "/api/sepa-export";

            if (isAdminRoute) {
                if (!isAdmin(request)) {
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
            }

            return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
        }

        if (path === "/dashboard") {
            if (!isAuthenticated(request)) {
                return new Response("", { status: 302, headers: { Location: "/" } });
            }
            return new Response(dashboard, {
                headers: { "Content-Type": "text/html; charset=utf-8" },
            });
        }

        if (request.method === "POST") {
            const body = await request.formData();
            if (body.get("password") === PASSWORD) {
                return new Response("", {
                    status: 302,
                    headers: {
                        Location: "/dashboard",
                        "Set-Cookie": `${COOKIE_NAME}=1; Path=/; HttpOnly; SameSite=Strict`,
                    },
                });
            }
            return new Response(loginPage.replace("{{error}}", `<p class="error">Ongeldig wachtwoord.</p>`), {
                status: 401,
                headers: { "Content-Type": "text/html; charset=utf-8" },
            });
        }

        if (isAuthenticated(request)) {
            return new Response("", { status: 302, headers: { Location: "/dashboard" } });
        }

        return new Response(loginPage.replace("{{error}}", ""), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
        });
    },
};

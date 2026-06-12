import dashboard from "./dashboard.html";

const PASSWORD = "jeugdwerk";
const COOKIE_NAME = "hhg_auth";
const ADMIN_PASSWORD = "penningmeester";
const ADMIN_COOKIE = "hhg_admin";
const CLUBS_TABLE = "Clubs";
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

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

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

            // Admin-only routes
            const approveMatch = path.match(/^\/api\/declarations\/([^/]+)\/approve$/);
            const rejectMatch = path.match(/^\/api\/declarations\/([^/]+)\/reject$/);
            const paidMatch = path.match(/^\/api\/declarations\/([^/]+)\/paid$/);
            const clubMatch = path.match(/^\/api\/clubs\/([^/]+)$/);
            const isAdminRoute = approveMatch || rejectMatch || paidMatch ||
                (clubMatch && request.method === "POST") || path === "/api/sepa-export";

            if (isAdminRoute) {
                if (!isAdmin(request)) {
                    return new Response(JSON.stringify({ error: "Admin-rechten vereist" }), {
                        status: 403,
                        headers: { "Content-Type": "application/json" },
                    });
                }
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

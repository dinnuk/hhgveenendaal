import dashboard from "./dashboard.html";

const PASSWORD = "jeugdwerk";
const COOKIE_NAME = "hhg_auth";

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
    const bonnetje = formData.get("bonnetje");

    // Create record in Airtable
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

    // Upload attachment if present
    if (bonnetje && bonnetje.size > 0) {
        const uploadForm = new FormData();
        uploadForm.append("file", bonnetje, bonnetje.name || "bonnetje");
        uploadForm.append("filename", bonnetje.name || "bonnetje");

        await fetch(
            `https://content.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${recordId}/Bonnetje/uploadAttachment`,
            {
                method: "POST",
                headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` },
                body: uploadForm,
            }
        );
    }

    return new Response(JSON.stringify({ success: true, id: recordId }), {
        headers: { "Content-Type": "application/json" },
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        // Logout
        if (path === "/api/logout") {
            return new Response("", {
                status: 302,
                headers: {
                    Location: "/",
                    "Set-Cookie": `${COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
                },
            });
        }

        // API routes — require auth
        if (path.startsWith("/api/")) {
            if (!isAuthenticated(request)) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (path === "/api/declarations") {
                if (request.method === "GET") {
                    const club = url.searchParams.get("club") || null;
                    return getDeclarations(env, club);
                }
                if (request.method === "POST") {
                    return createDeclaration(request, env);
                }
            }

            return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
        }

        // Dashboard — serve SPA
        if (path === "/dashboard") {
            if (!isAuthenticated(request)) {
                return new Response("", { status: 302, headers: { Location: "/" } });
            }
            return new Response(dashboard, {
                headers: { "Content-Type": "text/html; charset=utf-8" },
            });
        }

        // Login
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

        // GET / — show login or redirect
        if (isAuthenticated(request)) {
            return new Response("", { status: 302, headers: { Location: "/dashboard" } });
        }

        return new Response(loginPage.replace("{{error}}", ""), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
        });
    },
};

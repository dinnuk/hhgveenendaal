import html from "./index.html";

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
        h1 {
            color: #004b58;
            font-size: 18px;
            margin-bottom: 20px;
        }
        label {
            display: block;
            font-size: 12px;
            color: #4c4e4f;
            margin-bottom: 6px;
        }
        input[type="password"] {
            width: 100%;
            padding: 8px 10px;
            border: 1px solid #dfe5e6;
            border-radius: 4px;
            font-size: 13px;
            margin-bottom: 16px;
        }
        button {
            width: 100%;
            background-color: #004b58;
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 10px;
            font-size: 13px;
            cursor: pointer;
        }
        button:hover { background-color: #035765; }
        .error {
            color: #c00;
            font-size: 12px;
            margin-bottom: 12px;
        }
    </style>
</head>
<body>
    <div class="login-box">
        <h1>HHG Veenendaal</h1>
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

export default {
    async fetch(request) {
        if (isAuthenticated(request)) {
            return new Response(html, {
                headers: { "Content-Type": "text/html; charset=utf-8" },
            });
        }

        if (request.method === "POST") {
            const body = await request.formData();
            if (body.get("password") === PASSWORD) {
                return new Response(html, {
                    status: 200,
                    headers: {
                        "Content-Type": "text/html; charset=utf-8",
                        "Set-Cookie": `${COOKIE_NAME}=1; Path=/; HttpOnly; SameSite=Strict`,
                    },
                });
            }
            return new Response(loginPage.replace("{{error}}", `<p class="error">Ongeldig wachtwoord.</p>`), {
                status: 401,
                headers: { "Content-Type": "text/html; charset=utf-8" },
            });
        }

        return new Response(loginPage.replace("{{error}}", ""), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
        });
    },
};

import { ocrFromBuffer } from "./ocr";
import { checkDiet } from "./dietChecker";
import { lookupCache, insertCache } from "./cache";
import { db } from "./db";
import { ingredientCache, scans } from "./db/schema";
import { desc, eq, sql, count, max } from "drizzle-orm";
import { randomBytes } from "crypto";

const PORT = Number(process.env.PORT) || 3000;
const WEBUI_ENABLED = (process.env.WEBUI ?? "true").toLowerCase() !== "false";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const API_KEY = process.env.API_KEY || "";

// In-memory session store
const sessions = new Set<string>();

function createSession(): string {
  const token = randomBytes(32).toString("hex");
  sessions.add(token);
  return token;
}

function getSessionFromCookie(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)session=([a-f0-9]{64})/);
  return match?.[1] ?? null;
}

function hasValidSession(req: Request): boolean {
  const token = getSessionFromCookie(req);
  return token !== null && sessions.has(token);
}

function hasValidApiKey(req: Request): boolean {
  if (!API_KEY) return true; // no API key configured = open
  const key = req.headers.get("x-api-key") ?? "";
  return key === API_KEY;
}

function isAuthedForApi(req: Request): boolean {
  // Valid if: API key matches, or user has a valid session cookie
  if (hasValidApiKey(req)) return true;
  if (ADMIN_PASSWORD && hasValidSession(req)) return true;
  return false;
}

function unauthorizedResponse(message = "Unauthorized"): Response {
  return Response.json({ error: message }, { status: 401 });
}

// ====== Login page HTML ======
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<meta name="theme-color" content="#0a0a0a"><title>SatvikScan — Login</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;min-height:100dvh;display:flex;align-items:center;justify-content:center}
.login-box{width:100%;max-width:360px;padding:32px 24px;background:#141414;border:1px solid #252525;border-radius:20px;text-align:center}
h1{font-size:1.4rem;font-weight:700;color:#fff;letter-spacing:-0.5px;margin-bottom:4px}
h1 span{color:#4ade80}
.sub{font-size:0.75rem;color:#888;margin-bottom:24px}
input{width:100%;padding:14px 16px;background:#1c1c1c;border:1px solid #252525;border-radius:12px;color:#e5e5e5;font-size:0.95rem;outline:none;transition:border-color 0.2s}
input:focus{border-color:#4ade80}
button{width:100%;padding:14px;margin-top:14px;border:none;border-radius:12px;background:#4ade80;color:#000;font-size:0.95rem;font-weight:700;cursor:pointer;transition:opacity 0.2s}
button:active{opacity:0.85}
.err{color:#f87171;font-size:0.8rem;margin-top:12px;display:none}
</style></head><body>
<div class="login-box">
<h1>Satvik<span>Scan</span></h1>
<div class="sub">Enter admin password to continue</div>
<form id="f"><input type="password" name="password" placeholder="Password" autocomplete="current-password" required>
<button type="submit">Login</button></form>
<div class="err" id="err">Incorrect password</div>
</div>
<script>
document.getElementById('f').addEventListener('submit',async e=>{
  e.preventDefault();
  const pw=e.target.password.value;
  const r=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
  if(r.ok){location.href='/';}
  else{const d=document.getElementById('err');d.style.display='block';d.textContent=(await r.json()).error||'Incorrect password';}
});
</script></body></html>`;

async function handleLogin(req: Request): Promise<Response> {
  try {
    const body = await req.json() as { password?: string };
    const pw = typeof body.password === "string" ? body.password : "";

    if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) {
      return Response.json({ error: "Incorrect password" }, { status: 401 });
    }

    const token = createSession();
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
      },
    });
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
}

function handleLogout(req: Request): Response {
  const token = getSessionFromCookie(req);
  if (token) sessions.delete(token);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": "session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
    },
  });
}

async function handleScan(req: Request): Promise<Response> {
  if (!isAuthedForApi(req)) return unauthorizedResponse("Missing or invalid API key. Provide X-API-Key header.");

  try {
    const formData = await req.formData();
    const file = formData.get("image");
    const userName = (formData.get("name") as string | null)?.trim() || "";
    const userEmail = (formData.get("email") as string | null)?.trim() || "";

    if (!file || !(file instanceof File)) {
      return Response.json({ error: "No image file provided. Send a 'image' field." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Step 1: OCR — also validates it's a food item
    const ocrResult = await ocrFromBuffer(buffer);

    if (!ocrResult?.is_food_item) {
      return Response.json({
        success: false,
        error: ocrResult?.rejection_reason ?? "This does not appear to be a food product. Please upload a food/beverage ingredient label.",
      }, { status: 422 });
    }

    const ingredients = ocrResult.ingredients;
    let compliance;
    let source: string;
    let cacheId: number | null = null;

    // Step 2: Cache lookup
    const cached = await lookupCache(ingredients);

    if (cached) {
      compliance = cached.compliance;
      source = cached.exact ? "cache_exact" : "cache_fuzzy";
    } else {
      // Step 3: LLM diet check
      compliance = await checkDiet(ingredients);
      source = "llm";

      if (compliance) {
        const inserted = await insertCache(ingredients, compliance, "ocr");
        cacheId = inserted ?? null;
      }
    }

    // Log scan if user info provided
    if (userName && userEmail && compliance) {
      await db.insert(scans).values({
        userName,
        userEmail: userEmail.toLowerCase(),
        cacheId,
        compliance,
        ingredients,
        source,
      });
    }

    return Response.json({
      success: true,
      ingredients,
      compliance,
      source,
    });
  } catch (err: any) {
    console.error("Scan error:", err);
    return Response.json({ error: err.message ?? "Internal server error" }, { status: 500 });
  }
}

async function handleHistory(req: Request): Promise<Response> {
  if (!isAuthedForApi(req)) return unauthorizedResponse("Missing or invalid API key. Provide X-API-Key header.");

  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
    const offset = Number(url.searchParams.get("offset")) || 0;

    const rows = await db
      .select({
        id: scans.id,
        userName: scans.userName,
        userEmail: scans.userEmail,
        ingredients: scans.ingredients,
        compliance: scans.compliance,
        source: scans.source,
        scannedAt: scans.scannedAt,
      })
      .from(scans)
      .orderBy(desc(scans.scannedAt))
      .limit(limit)
      .offset(offset);

    return Response.json({ success: true, history: rows });
  } catch (err: any) {
    console.error("History error:", err);
    return Response.json({ error: err.message ?? "Internal server error" }, { status: 500 });
  }
}

async function handleUsers(req: Request): Promise<Response> {
  if (!isAuthedForApi(req)) return unauthorizedResponse("Missing or invalid API key. Provide X-API-Key header.");

  try {
    const rows = await db
      .select({
        userName: scans.userName,
        userEmail: scans.userEmail,
        scanCount: count(scans.id),
        lastScannedAt: max(scans.scannedAt),
      })
      .from(scans)
      .groupBy(scans.userEmail, scans.userName)
      .orderBy(desc(max(scans.scannedAt)));

    return Response.json({ success: true, users: rows });
  } catch (err: any) {
    console.error("Users error:", err);
    return Response.json({ error: err.message ?? "Internal server error" }, { status: 500 });
  }
}

async function handleUserScans(req: Request, email: string): Promise<Response> {
  if (!isAuthedForApi(req)) return unauthorizedResponse("Missing or invalid API key. Provide X-API-Key header.");

  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
    const offset = Number(url.searchParams.get("offset")) || 0;

    const rows = await db
      .select({
        id: scans.id,
        userName: scans.userName,
        userEmail: scans.userEmail,
        ingredients: scans.ingredients,
        compliance: scans.compliance,
        source: scans.source,
        scannedAt: scans.scannedAt,
      })
      .from(scans)
      .where(eq(scans.userEmail, email.toLowerCase()))
      .orderBy(desc(scans.scannedAt))
      .limit(limit)
      .offset(offset);

    return Response.json({ success: true, scans: rows });
  } catch (err: any) {
    console.error("User scans error:", err);
    return Response.json({ error: err.message ?? "Internal server error" }, { status: 500 });
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Auth routes
    if (url.pathname === "/auth/login" && req.method === "POST") {
      return handleLogin(req);
    }

    if (url.pathname === "/auth/logout" && req.method === "GET") {
      return handleLogout(req);
    }

    // API routes
    if (url.pathname === "/api/scan" && req.method === "POST") {
      return handleScan(req);
    }

    if (url.pathname === "/api/history" && req.method === "GET") {
      return handleHistory(req);
    }

    if (url.pathname === "/api/users" && req.method === "GET") {
      return handleUsers(req);
    }

    // /api/users/:email/scans
    const userScansMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/scans$/);
    if (userScansMatch && req.method === "GET") {
      return handleUserScans(req, decodeURIComponent(userScansMatch[1]));
    }

    // Web UI disabled
    if (!WEBUI_ENABLED) {
      return Response.json({ error: "Web UI is disabled. Use the API endpoints." }, { status: 404 });
    }

    // Admin password gate — show login page if not authenticated
    if (ADMIN_PASSWORD && !hasValidSession(req)) {
      return new Response(LOGIN_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Serve static files from public/
    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`./public${filePath}`);

    if (await file.exists()) {
      return new Response(file);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`SatvikScan server running at http://localhost:${server.port}`);
if (!WEBUI_ENABLED) console.log("  Web UI: DISABLED (API-only mode)");
if (ADMIN_PASSWORD) console.log("  Admin password: ENABLED");
if (API_KEY) console.log("  API key: ENABLED");

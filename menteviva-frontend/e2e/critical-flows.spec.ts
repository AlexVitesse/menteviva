import { expect, test, type Page } from "@playwright/test";

const profile = {
  user_id: "e2e-user",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  registro: {
    nombre: "Usuario E2E",
    email: "qa@example.test",
    rol_objetivo: "Lider",
    industria: "Tecnologia",
    experience_level: "mid",
  },
  diagnostico: {
    completed_at: "2026-01-01T00:00:00Z",
    competencias_foco: ["comunicacion"],
    strengths: [],
    gaps: [],
    blind_spot: "Practicar escucha activa",
    reflection_question: "¿Qué preguntarías antes de responder?",
    verbal_patterns: {
      vague_verbs_detected: [],
      we_vs_i_tendency: "media",
      filler_frequency: "baja",
    },
    recommended_next_scenario: "roberto",
    recommended_next_level: "facil",
    is_demo: true,
  },
};

async function mockAuthenticatedFirebase(page: Page) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const idToken = `${encode({ alg: "none", typ: "JWT" })}.${encode({
    sub: "e2e-user", user_id: "e2e-user", email: "qa@example.test",
    auth_time: now, iat: now, exp: now + 3600,
    aud: "mente-viva-e2e", iss: "https://securetoken.google.com/mente-viva-e2e",
    firebase: { sign_in_provider: "password", identities: { email: ["qa@example.test"] } },
  })}.c2ln`;
  const user = {
    localId: "e2e-user", email: "qa@example.test", emailVerified: true,
    displayName: "Usuario E2E", providerUserInfo: [], validSince: "0",
    lastLoginAt: String(Date.now()), createdAt: String(Date.now()),
  };

  await page.unroute("**/identitytoolkit.googleapis.com/**");
  await page.route("**/identitytoolkit.googleapis.com/**", (route) => {
    const lookup = route.request().url().includes("accounts:lookup");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(lookup ? { users: [user] } : {
        kind: "identitytoolkit#VerifyPasswordResponse", idToken,
        refreshToken: "e2e-refresh", expiresIn: "3600", registered: true, ...user,
      }),
    });
  });
  await page.route("**/securetoken.googleapis.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ access_token: idToken, expires_in: "3600", token_type: "Bearer",
      refresh_token: "e2e-refresh", user_id: "e2e-user" }),
  }));
  await page.route("**/api/auth/sync", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(profile),
  }));
  await page.route("**/api/me/sessions**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: "[]",
  }));
}

async function submitValidLogin(page: Page) {
  await mockAuthenticatedFirebase(page);
  await page.goto("/login");
  await page.getByPlaceholder("tu@empresa.com").fill("qa@example.test");
  await page.locator('input[type="password"]').fill("password123");
  await page.getByRole("button", { name: /iniciar sesi/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/identitytoolkit.googleapis.com/**", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "EMAIL_NOT_FOUND" } }),
    }),
  );
});

test("una ruta protegida no expone contenido y redirige a login", async ({ page }) => {
  await page.goto("/simulation");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: /iniciar sesi/i })).toBeVisible();
});

for (const path of ["/diagnostico", "/diagnostico/perfil", "/report", "/mi-plan"]) {
  test(`protege ${path} antes de hidratar identidad`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  });
}

test("login muestra un error accionable con Firebase simulado", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("tu@empresa.com").fill("qa@example.test");
  await page.locator('input[type="password"]').fill("password123");
  await page.getByRole("button", { name: /iniciar sesi/i }).click();
  await expect(page.getByText(/email o contrase.*incorrectos/i)).toBeVisible();
});

test("login válido habilita diagnóstico, simulación y reporte", async ({ page }) => {
  await submitValidLogin(page);

  await page.goto("/diagnostico/perfil");
  await expect(page.getByRole("heading", { name: /esto es lo que observe/i })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /elige tu escenario/i })).toBeVisible();
  await page.getByRole("heading", { name: /roberto/i }).click();
  await page.getByRole("button", { name: /iniciar simulación/i }).click();
  await expect(page).toHaveURL(/\/briefing$/);
  await page.getByRole("button", { name: /iniciar simulacion/i }).click();
  await expect(page).toHaveURL(/\/simulation$/);

  await page.goto("/report");
  await expect(page).toHaveURL(/\/report$/);
  await expect(page.getByRole("button", { name: /iniciar sesi/i })).toHaveCount(0);
});

test("logout autenticado limpia perfil y vuelve a login", async ({ page }) => {
  await submitValidLogin(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("menteviva:user_profile")))
    .not.toBeNull();
  await page.getByRole("button", { name: /menú de usuario/i }).click();
  await page.getByRole("button", { name: /cerrar sesión/i }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("menteviva:user_profile")))
    .toBeNull();
});

test("registro valida el formulario sin llamar proveedores reales", async ({ page }) => {
  await page.goto("/registro");
  await page.getByRole("button", { name: /crear|guardar|comenzar/i }).last().click();
  await expect(page.getByText(/falta completar/i)).toBeVisible();
});

test("registro válido crea perfil y abre configuración de diagnóstico", async ({ page }) => {
  await mockAuthenticatedFirebase(page);
  await page.unroute("**/api/auth/sync");
  await page.route("**/api/auth/sync", (route) => route.fulfill({
    status: 404, contentType: "application/json", body: JSON.stringify({ detail: "sin registro" }),
  }));
  await page.route("**/api/auth/register", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ ...profile, diagnostico: null }),
  }));

  await page.goto("/registro");
  await page.getByPlaceholder("María López").fill("Usuario E2E");
  await page.getByPlaceholder("maria@ejemplo.com").fill("qa@example.test");
  const passwords = page.locator('input[type="password"]');
  await passwords.nth(0).fill("Password1!");
  await passwords.nth(1).fill("Password1!");
  await page.getByPlaceholder("Gerente de Ventas").fill("Lider");
  await page.getByPlaceholder(/SaaS B2B/).fill("Tecnologia");
  await page.getByRole("button", { name: /crear cuenta y continuar/i }).click();
  await expect(page).toHaveURL(/\/diagnostico\/setup$/, { timeout: 15_000 });
});

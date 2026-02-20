import { expect, test } from "@playwright/test";
import { loginAsRole } from "./helpers/auth";
import { canRunRoleSuite } from "./helpers/env";

test("biometric login asks for email before starting auth", async ({ page }) => {
  await page.goto("/login");

  const passkeyButton = page.getByRole("button", { name: /biometr/i });
  await expect(passkeyButton).toBeVisible();

  await passkeyButton.click();
  await expect(
    page
      .locator("div.bg-red-50")
      .filter({ hasText: /email.*biometr|biometr.*email/i })
  ).toBeVisible();
  await expect(page.getByTestId("login-submit")).toBeEnabled();
});

test("traditional login still works with biometric UI enabled", async ({ page }) => {
  test.skip(
    !canRunRoleSuite("manager"),
    "Missing manager credentials or Supabase env for authenticated tests"
  );

  await page.goto("/login");
  await expect(page.getByRole("button", { name: /biometr/i })).toBeVisible();

  await loginAsRole(page, "manager");
  await expect(page).not.toHaveURL(/\/login/);
});

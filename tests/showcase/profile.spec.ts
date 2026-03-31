import { test, expect } from '@playwright/test';

test('should edit display name', async ({ page }) => {
  await page.goto('/profile');
  const displayNameEditInput = page.locator('[data-testid="displayname-edit-input"]');
  await displayNameEditInput.fill('New Display Name');
  // Add any additional steps if necessary
});
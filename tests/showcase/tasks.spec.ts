import { test, expect } from '@playwright/test';

test('should add a task', async ({ page }) => {
  await page.goto('/tasks');
  await page.locator('[data-testid="add-task-button-v2"]').click();
  // Add more steps as needed
});
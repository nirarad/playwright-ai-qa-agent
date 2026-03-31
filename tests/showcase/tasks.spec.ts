import { test, expect } from '@playwright/test';

test('should add a task', async ({ page }) => {
  await page.goto('/tasks');
  
  // Ensure selectors are up to date
  const taskInput = page.locator('#task-input');
  const addTaskButtonV2 = page.locator('[data-testid="add-task-button-v2"]');
  
  await taskInput.fill('Learn Playwright');
  await addTaskButtonV2.click();

  expect(await page.textContent('.task-list li:last-child')).toContainText('Learn Playwright');
});
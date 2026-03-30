import { test, expect } from '../fixtures/base'
import { DashboardPage } from '../pom/dashboard-page'

test.describe('showcase: tasks', () => {
  test('adding task shows the provided title', async ({ loggedInPage: page }) => {
    const dashboardPage = new DashboardPage(page)
    await dashboardPage.addTask('Buy groceries')
    await expect(page.getByText('Buy groceries')).toBeVisible({ timeout: 1500 })
  })

  test('empty input does not create a task', async ({ loggedInPage: page }) => {
    const dashboardPage = new DashboardPage(page)
    await expect(dashboardPage.taskItems).toHaveCount(0)
    await dashboardPage.addTaskButton.click()
    await expect(dashboardPage.taskItems).toHaveCount(0, { timeout: 1500 })
  })

  test('delete removes only targeted task', async ({ loggedInPage: page }) => {
    const dashboardPage = new DashboardPage(page)
    await dashboardPage.addTask('Keep this task')
    await dashboardPage.addTask('Delete this task')

    await dashboardPage.deleteButtons.nth(1).click()

    await expect(page.getByText('Keep this task')).toBeVisible({ timeout: 1500 })
    await expect(page.getByText('Delete this task')).not.toBeVisible({ timeout: 1500 })
  })
})


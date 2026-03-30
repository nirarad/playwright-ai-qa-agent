import { test, expect } from '../fixtures/base'
import { LoginPage } from '../pom/login-page'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

test.describe('showcase: login', () => {
  test('login form renders required fields', async ({ seededPage: page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto(BASE_URL)
    await expect(loginPage.emailInput).toBeVisible()
    await expect(loginPage.passwordInput).toBeVisible()
    await expect(loginPage.submitButton).toBeVisible()
  })

  test('valid credentials redirect to dashboard', async ({ seededPage: page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto(BASE_URL)
    await loginPage.login('test@example.com', 'password123')
    await expect(page).toHaveURL(`${BASE_URL}/dashboard`, { timeout: 1500 })
  })
})


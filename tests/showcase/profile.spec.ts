import { test, expect } from '../fixtures/base'
import { ProfilePage } from '../pom/profile-page'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

test.describe('showcase: profile', () => {
  test('profile displays current user display name', async ({ loggedInPage: page }) => {
    const profilePage = new ProfilePage(page)
    await profilePage.goto(BASE_URL)
    await expect(profilePage.currentDisplayName).toContainText('Test User')
  })

  test('profile update persists in ui', async ({ loggedInPage: page }) => {
    const profilePage = new ProfilePage(page)
    await profilePage.goto(BASE_URL)
    await profilePage.updateDisplayName('Updated Name')
    await expect(profilePage.currentDisplayName).toContainText('Updated Name', {
      timeout: 1500,
    })
  })
})


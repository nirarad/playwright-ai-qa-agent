import type { Locator, Page } from '@playwright/test'
import { BasePage } from './base-page'

export class ProfilePage extends BasePage {
  readonly currentDisplayName: Locator
  readonly editDisplayNameInput: Locator
  readonly saveButton: Locator

  constructor(page: Page) {
    super(page)
    this.currentDisplayName = this.byTestId('profile-displayname')
    this.editDisplayNameInput = this.getByTestId('displayname-edit-input') // Updated here
    this.saveButton = this.byTestId('save-profile-button')
  }

  async goto(baseUrl: string): Promise<void> {
    await this.page.goto(`${baseUrl}/profile`)
  }

  async updateDisplayName(nextName: string): Promise<void> {
    await this.editDisplayNameInput.fill(nextName)
    await this.saveButton.click()
  }
}
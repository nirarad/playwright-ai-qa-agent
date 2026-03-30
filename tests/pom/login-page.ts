import type { Locator, Page } from '@playwright/test'
import { BasePage } from './base-page'

export class LoginPage extends BasePage {
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator
  readonly errorMessage: Locator

  constructor(page: Page) {
    super(page)
    this.emailInput = this.byTestId('email-input')
    this.passwordInput = this.byTestId('password-input')
    this.submitButton = this.byTestId('submit-button')
    this.errorMessage = this.byTestId('error-message')
  }

  async goto(baseUrl: string): Promise<void> {
    await this.page.goto(`${baseUrl}/login`)
  }

  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email)
    await this.passwordInput.fill(password)
    await this.submitButton.click()
  }
}


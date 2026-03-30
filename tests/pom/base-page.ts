import type { Locator, Page } from '@playwright/test'

export class BasePage {
  constructor(protected readonly page: Page) {}

  protected byTestId(testId: string): Locator {
    return this.page.getByTestId(testId)
  }
}


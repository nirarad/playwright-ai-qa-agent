import type { Locator, Page } from '@playwright/test'
import { BasePage } from './base-page'

export class DashboardPage extends BasePage {
  readonly taskInput: Locator
  readonly addTaskButton: Locator
  readonly taskItems: Locator
  readonly deleteButtons: Locator

  constructor(page: Page) {
    super(page)
    this.taskInput = this.byTestId('task-input')
    this.addTaskButton = this.byTestId('add-task-button-v2')
    this.taskItems = this.page.locator("[data-testid^='task-item-']")
    this.deleteButtons = this.page.locator("[data-testid^='task-delete-']")
  }

  async addTask(title: string): Promise<void> {
    await this.taskInput.fill(title)
    await this.addTaskButton.click()
  }
}
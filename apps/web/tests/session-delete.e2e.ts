/** Confirmed Session deletion through the real Loader, browser, Agent lifecycle, and storage. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/session-delete/confirmation.expected.md', import.meta.url))

it('cancels without deleting, then removes the owned Session directory and synchronizes both pages and reload', async () => {
  const scaffold = await launchWebScaffold()
  onTestFinished(() => scaffold.close())
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
  const seed = await readFile(SEED, 'utf8')
  const id = await seedSession(scaffold, seed, 'session-delete-web')
  const other = await seedSession(scaffold, seed, 'session-keep-web')
  await workspace.attachSession(id)
  await workspace.attachSession(other)
  await scaffold.ctx.sessionController.rename({ sessionId: id, title: 'Delete this conversation' })
  await scaffold.ctx.sessionController.rename({ sessionId: other, title: 'Keep this conversation' })
  await scaffold.ctx.sessionPersistence.flush()
  const projects = await readdir(scaffold.persistenceRoot)
  expect(projects).toHaveLength(1)
  const dir = join(scaffold.persistenceRoot, projects[0]!, id)
  await mkdir(join(dir, 'files'))
  await writeFile(join(dir, 'files', 'local-output.txt'), 'Session-owned output')
  await writeFile(join(scaffold.workspaceCwd, 'keep.txt'), 'shared project file')
  const browser = await chromium.launch()
  try {
    const page = await newEnglishPage(browser)
    const second = await newEnglishPage(browser)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-delete'))
    const logs = [watchConsole(page), watchConsole(second)]
    for (const target of [page, second]) {
      await target.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await target.getByText('Delete this conversation', { exact: true }).waitFor()
    }
    const row = page.getByRole('treeitem').filter({
      has: page.getByText('Delete this conversation', { exact: true }),
    })
    await row.click()
    const trigger = row.getByRole('button', { name: 'Session actions for Delete this conversation' })
    await row.hover()
    await trigger.focus()
    await trigger.click()
    await page.getByRole('menuitem', { name: 'Delete session', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Permanently delete this session?' })
    await dialog.waitFor()
    await compareOrRefreshGolden(
      EXPECTED, await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), scaffold.mode,
    )
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await dialog.count()).toBe(0)
    expect((await lstat(dir)).isDirectory()).toBe(true)
    expect(await row.count()).toBe(1)

    await row.hover()
    await trigger.focus()
    await trigger.click()
    await page.getByRole('menuitem', { name: 'Delete session', exact: true }).click()
    await dialog.getByRole('button', { name: 'Delete session', exact: true }).click()
    await expect.poll(() => dialog.count()).toBe(0)
    for (const target of [page, second]) {
      await expect.poll(() => target.getByRole('treeitem').filter({
        has: target.getByText('Delete this conversation', { exact: true }),
      }).count()).toBe(0)
      expect(await target.getByText('Keep this conversation', { exact: true }).count()).toBe(1)
    }
    await expect(lstat(dir)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(scaffold.ctx.agents.get(id)).toBeUndefined()
    expect(scaffold.ctx.sessions.get(id)).toBeUndefined()
    expect(await scaffold.ctx.sessionPersistence.stat(other)).toBeDefined()
    expect(await readFile(join(scaffold.workspaceCwd, 'keep.txt'), 'utf8')).toBe('shared project file')
    expect(workspace.sessionIds).not.toContain(id)
    await page.reload({ waitUntil: 'load' })
    await page.getByText('Keep this conversation', { exact: true }).waitFor()
    expect(await page.getByText('Delete this conversation', { exact: true }).count()).toBe(0)
    expect(logs.flatMap(log => log.pageErrors)).toEqual([])
  } finally {
    await browser.close()
  }
}, 120_000)

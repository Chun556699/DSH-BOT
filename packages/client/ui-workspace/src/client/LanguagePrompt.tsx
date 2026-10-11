/**
 * First-launch language chooser for the Bot workbench: a `shell.overlay`
 * entry shown while no explicit locale preference exists. Choosing a button
 * persists the preference and ends the prompt; closing without choosing
 * dismisses it for this run only.
 */
import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LanguagePromptProps } from './contract/slots.ts'

/**
 * @param props - the visibility gate, the selection write, and the locale seat.
 * @returns the chooser dialog, or null once a preference exists (or after an in-run dismissal).
 */
export function LanguagePrompt({ useLanguagePrompt, selectLanguage, t }: LanguagePromptProps) {
  const visible = useLanguagePrompt(current => current)
  const [dismissed, setDismissed] = useState(false)
  if (!visible || dismissed) return null
  return (
    <Modal
      open
      onClose={() => { setDismissed(true) }}
      closeLabel={t('close')}
      title={t('languagePrompt.title')}
      description={t('languagePrompt.body')}
      footer={(
        <>
          <Button variant="outline" onClick={() => { selectLanguage('zh') }}>{t('languagePrompt.option.zh')}</Button>
          <Button variant="outline" onClick={() => { selectLanguage('en') }}>{t('languagePrompt.option.en')}</Button>
        </>
      )}
    />
  )
}

import { useId, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { TeamActionInjected } from './TeamAction.tsx'
import type { NS } from './locales.ts'
import css from './AddMemberForm.module.css'

/** Props of the inline teammate-creation form. */
export interface AddMemberFormProps {
  /** Session the form renders for; the Lead identity is resolved by the callback. */
  sessionId: SessionId
  /** Injected Remote call creating the teammate. */
  addTeammate: TeamActionInjected['addTeammate']
  /** Report a failure message, or clear it with null. */
  onError: (message: string | null) => void
  /** Team locale seat. */
  t: TranslateNS<typeof NS>
}

/**
 * Inline form that creates one teammate through the Lead's Remote call. It
 * rests as a single add button and expands into name, role, and first-task
 * fields.
 * @param props - target Session, Remote callback, error sink, and locale seat.
 * @returns the add button or the expanded form.
 */
export function AddMemberForm({ sessionId, addTeammate, onError, t }: AddMemberFormProps) {
  const [expanded, setExpanded] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const hintId = useId()

  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const message = await addTeammate(sessionId, {
        name: name.trim(),
        description: description.trim(),
        ...(prompt.trim() === '' ? {} : { prompt: prompt.trim() }),
      })
      if (message === null) {
        setName('')
        setDescription('')
        setPrompt('')
        setExpanded(false)
        onError(null)
      } else {
        onError(message)
      }
    } catch (reason) {
      onError(String(reason))
    } finally {
      setBusy(false)
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        className={css.addMember}
        onClick={() => { setExpanded(true) }}
      >
        <IconPlusOutlineRegular size={14} />
        <span>{t('member.add')}</span>
      </button>
    )
  }

  return (
    <form
      className={css.addForm}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <input
        className={css.field}
        value={name}
        placeholder={t('member.name.placeholder')}
        aria-label={t('member.name')}
        aria-describedby={hintId}
        autoComplete="off"
        disabled={busy}
        onChange={(event) => { setName(event.target.value) }}
      />
      <small id={hintId} className={css.fieldHint}>{t('member.name.hint')}</small>
      <input
        className={css.field}
        value={description}
        placeholder={t('member.description.placeholder')}
        aria-label={t('member.description')}
        autoComplete="off"
        disabled={busy}
        onChange={(event) => { setDescription(event.target.value) }}
      />
      <input
        className={css.field}
        value={prompt}
        placeholder={t('member.prompt.placeholder')}
        aria-label={t('member.prompt')}
        autoComplete="off"
        disabled={busy}
        onChange={(event) => { setPrompt(event.target.value) }}
      />
      <div className={css.addActions}>
        <button
          type="submit"
          className={css.addSubmit}
          disabled={busy || name.trim() === '' || description.trim() === ''}
        >
          {busy ? t('member.adding') : t('member.submit')}
        </button>
        <button
          type="button"
          className={css.addCancel}
          disabled={busy}
          onClick={() => { setExpanded(false); onError(null) }}
        >
          {t('member.cancel')}
        </button>
      </div>
    </form>
  )
}

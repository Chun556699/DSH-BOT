/** Permanent Session deletion action and its frame-wide confirmation. */
import { useRef, useState } from 'react'
import {
  Button, IconTrashOutlineRegular, MenuItemButton, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DeleteSessionInjected, SessionDeleteConfirmProps, SessionMenuItemProps,
} from '../contract/slots.ts'
import css from '../rows/WorkspaceBrowser.module.css'

/**
 * Open permanent deletion confirmation from the Session menu.
 * @param props - Session identity, confirmation callback, and localized copy.
 * @returns a destructive menu row.
 */
export function DeleteSessionMenuItem({
  sessionId, displayTitle, useMenuOpenState, requestSessionDelete, t,
}: SessionMenuItemProps<DeleteSessionInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      danger
      separatorBefore
      icon={<IconTrashOutlineRegular size={14} />}
      onSelect={() => { setMenuOpen(false); requestSessionDelete(sessionId, displayTitle) }}
    >
      {t('menu.deleteSession')}
    </MenuItemButton>
  )
}

/**
 * Confirm irreversible Session deletion; cancellation and dismissal preserve files.
 * @param props - pending target, deletion callback, settlement, and localized copy.
 * @returns the confirmation, or nothing without a pending request.
 */
export function SessionDeleteConfirmDialog(props: SessionDeleteConfirmProps) {
  const request = props.useDeleteRequest(value => value)
  if (request === null) return null
  return <DeleteConfirmForm key={request.sessionId} {...props} sessionId={request.sessionId} displayTitle={request.displayTitle} />
}

/** One target's deletion state; the synchronous guard prevents duplicate destructive requests. */
function DeleteConfirmForm({
  sessionId, displayTitle, deleteSession, settleSessionDelete, t,
}: Pick<SessionDeleteConfirmProps, 'deleteSession' | 'settleSessionDelete' | 't'> & {
  sessionId: SessionMenuItemProps['sessionId']
  displayTitle: string
}) {
  const busy = useRef(false)
  const [deleting, setDeleting] = useState(false)
  const close = () => { if (!busy.current) settleSessionDelete() }
  const confirm = () => {
    if (busy.current) return
    busy.current = true
    setDeleting(true)
    void deleteSession(sessionId).then((deleted) => {
      if (deleted) settleSessionDelete()
    }).finally(() => {
      busy.current = false
      setDeleting(false)
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('delete.session.title')}
      description={t('delete.session.desc', { title: displayTitle || t('session.untitled') })}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={close}>{t('cancel')}</Button>
          <Button variant="outline" className={css.deleteAction} disabled={deleting} onClick={confirm}>
            {t('menu.deleteSession')}
          </Button>
        </>
      )}
    >
      {deleting && <div role="status" className={css.deleteStatus}>{t('delete.session.pending')}</div>}
    </Modal>
  )
}

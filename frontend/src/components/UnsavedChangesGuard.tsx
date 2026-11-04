// Warns before unsaved clinical input is thrown away: browser tab close/reload (beforeunload)
// and in-app navigation (react-router blocker + shared Modal). Render it next to the form.
import { useContext, useEffect, type RefObject } from 'react'
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router'
import { Modal } from './Modal'

interface UnsavedChangesGuardProps {
  dirty: boolean
  /** Set to true just before a deliberate post-save navigation so it is not blocked. */
  bypassRef?: RefObject<boolean>
}

function BeforeUnloadWarning({ dirty }: UnsavedChangesGuardProps) {
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
  return null
}

function RouterNavigationBlocker({ dirty, bypassRef }: UnsavedChangesGuardProps) {
  const blocker = useBlocker(() => dirty && !bypassRef?.current)
  return (
    <Modal
      open={blocker.state === 'blocked'}
      variant="warning"
      title="Discard unsaved changes?"
      description="What you entered on this screen has not been saved and will be lost."
      onClose={() => blocker.reset?.()}
    >
      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          data-autofocus
          onClick={() => blocker.reset?.()}
          className="px-4 py-2 border border-neutral-300 rounded-lg text-sm font-semibold hover:bg-neutral-50 min-h-[44px] cursor-pointer"
        >
          Keep editing
        </button>
        <button
          type="button"
          onClick={() => blocker.proceed?.()}
          className="px-5 py-2 bg-red-800 text-white rounded-lg text-sm font-bold hover:bg-red-900 min-h-[44px] cursor-pointer"
        >
          Discard and leave
        </button>
      </div>
    </Modal>
  )
}

export function UnsavedChangesGuard({ dirty, bypassRef }: UnsavedChangesGuardProps) {
  // useBlocker needs a data router (createBrowserRouter). Component tests mount a plain
  // MemoryRouter, so the in-app blocker is only mounted when a data router exists.
  const hasDataRouter = useContext(UNSAFE_DataRouterContext) != null
  return (
    <>
      <BeforeUnloadWarning dirty={dirty} />
      {hasDataRouter && <RouterNavigationBlocker dirty={dirty} bypassRef={bypassRef} />}
    </>
  )
}

const NO_ALLERGY_VALUES = new Set(['', 'none reported'])

/** True when the patient record carries a reported allergy (anything other than the "None reported" default). */
export function hasReportedAllergies(allergies: string | null | undefined): allergies is string {
  return !NO_ALLERGY_VALUES.has((allergies ?? '').trim().toLowerCase())
}

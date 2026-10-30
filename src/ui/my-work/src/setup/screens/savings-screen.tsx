import { ArrowRightIcon } from 'lucide-react'
import type { SetupUsage } from '../setup-data'
import type { MemoryBranch } from '../setup-flow'

/** PWM fork: the paid-plan savings pitch is removed; this step only continues setup. */
export function SavingsScreen({ onSkip }: {
  usage: SetupUsage | null
  branch: MemoryBranch
  onPro: () => void
  onExistingPlan: () => void
  onSkip: () => void
}) {
  return (
    <section aria-labelledby="savings-title">
      <div className="page-heading"><h1 id="savings-title" tabIndex={-1}>Memory stays on this machine.</h1></div>
      <div className="actions is-centered"><button className="primary" type="button" onClick={onSkip}>Continue <ArrowRightIcon aria-hidden="true" /></button></div>
    </section>
  )
}

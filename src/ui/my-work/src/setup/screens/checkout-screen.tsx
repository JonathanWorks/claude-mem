import type { SetupCheckoutView } from '../setup-data'

/** PWM fork: there is no paid plan and no checkout; the flow never routes here (only At Home is offered). */
export function CheckoutScreen(_props: { checkout: SetupCheckoutView | null; installerStopped: boolean; onBack: () => void; onContinue: () => void }) {
  return null
}

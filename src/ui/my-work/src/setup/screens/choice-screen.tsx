import { ArrowRightIcon, CheckIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { CardSpotlight } from '@/components/aceternity/card-spotlight'
import type { MemoryBranch } from '../setup-flow'
import atHome from '../assets/at-home-modern-computer.webp'
import { PageHeading } from './shared'

/** D4: big agent logos around the phone, left column then right column, top to bottom. */
/** The spotlight that follows the pointer over each card: a soft violet tint (setup.css lays it over the card art). */
const SPOTLIGHT = { className: 'memory-spotlight', radius: 260, color: 'rgba(115, 120, 239, 0.2)' }


/** Step 3: At Home / On The Go (PROTO #route-choice). People already on Pro arrive with On The Go selected. */
export function ChoiceScreen({ branch, onChoose }: { branch: MemoryBranch; onChoose: (branch: MemoryBranch) => void }) {
  const [selected, setSelected] = useState<MemoryBranch>(branch)
  const submit = (event: FormEvent) => { event.preventDefault(); onChoose(selected) }
  return (
    <section aria-labelledby="choice-title">
      <PageHeading id="choice-title" title="Where do you want your memory?" />
      <form onSubmit={submit}>
        <fieldset className="memory-cards">
          <legend className="sr-only">Choose where to store and access your memory</legend>
          <CardSpotlight {...SPOTLIGHT}>
            <label className="memory-card">
              <input className="memory-radio sr-only" type="radio" name="memory-option" value="home" aria-label="At Home, Free" checked={selected === 'home'} onChange={() => setSelected('home')} />
              <span className="selection-check" aria-hidden="true"><CheckIcon strokeWidth={3} /></span>
              <span className="memory-art memory-art-home"><img className="memory-artwork" src={atHome} alt="A modern silver desktop computer displaying the CMEM brain mark" width={840} height={840} /></span>
              <span className="card-copy"><span className="card-title">At Home</span><span className="card-price">Free</span></span>
            </label>
          </CardSpotlight>
        </fieldset>
        <div className="actions is-centered"><button className="primary" type="submit">Continue <ArrowRightIcon aria-hidden="true" /></button></div>
      </form>
    </section>
  )
}

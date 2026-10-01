import type { Intervals, Skill } from '../lib/api'
import { HORIZON_ADJ, HORIZON_LABEL, pct } from '../lib/format'
import { Callout, Term } from './primitives'

/** The honest caveat that sits above every set of predictions. */
export function SkillNote({ horizon, abs, rel, intervals }: { horizon: string; abs: Skill; rel: Skill; intervals?: Intervals }) {
  const lift = abs.accuracy_lift ?? 0
  const noDirectionSkill = lift <= 0.005
  const ic = rel.rank_ic ?? 0
  const t = rel.rank_ic_t_adjusted ?? 0
  const ranking = ic <= 0 ? 'no ranking skill' : t >= 2 ? 'modest but statistically meaningful ranking skill' : 'weak ranking skill that is not statistically conclusive'
  return (
    <Callout tone={noDirectionSkill ? 'warn' : 'info'} title={`How much to trust the ${HORIZON_ADJ[horizon]} predictions`}>
      <p>
        <strong>Direction:</strong> in walk-forward testing the ensemble was right {pct(abs.accuracy)} of the time, versus{' '}
        {pct(abs.naive_accuracy)} for <Term name="Naive accuracy">always guessing “up”</Term>
        {noDirectionSkill ? ' — it has not shown any skill at calling direction.' : ` — a small edge of ${(lift * 100).toFixed(1)} points.`}{' '}
        (<Term name="AUC">AUC</Term> {abs.auc?.toFixed(3) ?? 'n/a'}; 0.5 is a coin flip.)
      </p>
      <p className="mt-1">
        <strong>Ranking:</strong> the model shows {ranking} (<Term name="Rank IC">rank IC</Term> {ic.toFixed(3)}, overlap-adjusted t = {t.toFixed(1)}).
        Its top fifth of picks beat its bottom fifth by {pct(rel.top_minus_bottom, 1, true)} per {HORIZON_LABEL[horizon]} on average relative to the median stock.
        {intervals?.coverage_80 !== undefined && <> The “80%” <Term name="Expected range">expected ranges</Term> actually contained the outcome {pct(intervals.coverage_80, 0)} of the time.</>}
      </p>
    </Callout>
  )
}

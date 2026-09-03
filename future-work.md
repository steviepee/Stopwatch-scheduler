# Future Work

Things deliberately out of scope for baseline. Each entry states the idea, why it is not a
small change against the current model, and the questions to settle before building it.
Not a task list. Nothing here is committed to.

---

## Parallel activities and stacked schedule items

**Raised:** 2026-09-02

Some activities can run at the same time. Laundry runs while you write. Something bakes while
you clean. The scheduler should eventually place those concurrently instead of spending the
day's budget on them serially, which means schedule items need the ability to stack onto each
other rather than sitting end to end.

**Where this came from**

Noticed live on 2026-09-02: a workflow was running in another repo, timed in this app, while
the user was doing unrelated work in a third place. The stopwatch recorded one activity, but
attention was split across several the whole time. Preparing anything tends to look like this
rather than like one thing at a time.

A consequence worth checking before trusting the numbers: existing recordings already contain
divided-attention sessions and are not labeled as such, so historical `average_duration`
values may not mean what a scheduler assumes they mean.

**Why this is not a small change**

The whole engine currently assumes a strictly sequential day. Every strategy in
`backend/app/services/strategies.py` orders activities and then lays them nose to tail from
`start_time` via `_build_timeline`. `ScheduleItem.position` is an ordinal, not a time, so two
items cannot express "these overlap". The calendar grid also assumes blocks never collide.
Allowing overlap changes the data model, the timeline builder, every strategy's notion of a
day being "full", and the rendering, not just one function.

**Questions to settle first**

*What makes two things stackable?*
- Probably not a property of the pair but of each activity: does it demand attention while it
  runs, or does it mostly run itself once started?
- Passive activities can absorb an active one on top. Two active ones cannot stack.
- Attention may be a spectrum rather than a flag, in which case stacking needs a budget rule
  rather than a boolean check.

*What blocks a stack even when attention allows it?*
- Shared physical resources. Two things needing the oven do not overlap however passive both are.
- Location. Stacking only works if both can happen where you are.
- Whether the passive one needs periodic check-ins, which fragments the active one.

*What does duration even mean here?*
- A passive activity has a wall-clock span and a much smaller engaged time. `average_duration`
  currently conflates the two, and recordings measure elapsed time, not attention.
- Deciding this early matters. It affects what the stopwatch is actually recording.

*What breaks downstream?*
- Total scheduled time stops being a sum, so any "does this fit in the day" check needs rewriting.
- Gap-aware placement changes meaning entirely when items may overlap.
- Priority ordering gets ambiguous. If a frog and a passive task share a slot, which one owns it?
- Passive activities often need to start early to finish in time, which can directly contradict
  "hardest thing first". Start-time constraints may matter more than priority for these.
- Peak-hours insights will double-count overlapping time unless the aggregation is changed.

*What has to exist in the schema?*
- Explicit start and end per item rather than an ordinal position.
- Probably a lane or track concept so the calendar can render overlaps without hiding one.

**Touch points when this gets built**

- `backend/app/services/strategies.py` — `_build_timeline` and every registered strategy
- `backend/app/models/schedule.py` — `ScheduleItem.position`
- `backend/app/models/task.py` — wherever an attention or passivity attribute would live
- `frontend/src/components/ScheduleTimeline.tsx`
- `frontend/src/components/calendar/CalendarGrid.tsx` and `SessionBlock.tsx`

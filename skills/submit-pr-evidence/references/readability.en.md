# Readability Rules

[한국어](readability.md) | **English**

English translation of the [Korean source](readability.md).
The Korean document remains authoritative.

PR bodies, comments, and tickets all point to this file.
Do not duplicate its rule bullets elsewhere; link here, so source changes do not silently leave divergent copies.

## Apply Toss's principles to collaboration writing

Source: [Toss's eight writing principles (Korean)](https://toss.tech/article/8-writing-principles-of-toss).
The following applies UX writing principles to OSS Hub PRs, comments, and Issues; Toss did not define these as PR rules.
As in the original, principles guide judgment rather than impose mechanical pass/fail criteria.
Do not cut meaning or add ceremony to satisfy character, line, or section counts.

1. **Predictable hint — show the next action and result.** Explain what a check or decision enables. Distinguish an expected outcome from a verified result.
2. **Weed cutting — remove empty words.** Remove modifiers that do not change meaning, but retain technical identifiers and conditions.
3. **Remove empty sentences.** Do not repeat what headings, widgets, and tables already say, or explain empty space.
4. **Focus on key message — lead with the decision needed now.** Lead PRs with the change to accept, comments with judgment/reason/next action, and Issues with the problem and prerequisites. Move details below without deleting evidence.
5. **Easy to speak — use language people understand aloud.** Use familiar wording and one message per sentence; give necessary technical terms precise names and brief explanations.
6. **Suggest over force — distinguish options from required corrections.** Offer choices for non-blocking suggestions; give evidence, impact, and acceptance conditions for required fixes. Do not coerce or frighten, or downgrade a necessary fix to an option.
7. **Universal words — describe facts, not people.** Prefer concrete, generally understandable facts to slang, memes, or personal judgments. Rather than label code “AI slop,” identify duplicate implementation or unnecessary abstraction.
8. **Find hidden emotion — reduce the reader's burden.** Explain scope and reasons with the author's correction cost and reviewer's checking effort in mind. Do not mandate empty praise or empathy statements.

## Evidence and format

Do not remove technical identifiers, evidence links, reproduction steps, authorization, error handling, atomicity boundaries, verification limits, required evidence, or approval conditions for brevity.
First consider editing/reusing existing files, but do not merge necessary safety boundaries merely to reduce file count.

1. **Open with the conclusion.** Preserve the template's ticket link/start block, and make the next action clear in the first explanation.
2. **Put the conclusion and next action in the first screenful.** Reviews also show blocking status and acceptance conditions there; screen claims include their supporting images.
3. **One bullet, one fact.** Separate unrelated judgments.
4. **Keep paragraphs short.** Use bullets or tables when helpful for scanning, without imposing a fixed line count.
5. **Use a table for alternatives compared by the same criteria.** One suggestion or a recommendation to keep an implementation needs only a short paragraph. PR Before/After tables follow their required evidence gate.
6. **Prove screens with images and changed flows with diagrams.** Do not add diagrams to fill a template. Quote only code needed for the judgment in fenced blocks; each skill owns its specific evidence requirements.
7. **Put numbers in a table or one line.** Lists of numbers embedded in prose make readers wonder which matters.
8. **Use one emphasis per paragraph.** Three bold phrases are as ineffective as none.
9. **Do not say the same thing twice.** Do not repeat headings, widgets, or tables in prose.
10. **Make file evidence clickable.** Name the proof target, for example `file:line` or an existing snapshot lookup. Keep long paths in link destinations, and preserve line links at the reviewed HEAD.
11. **Use headings that answer the reader's question.** Prefer “Behavior to preserve” or “Decision evidence” without numbering. Short keep-as-is or acceptance comments need no headings. Preserve finding numbers in replies and required PR-template headings.
12. **Break long sentences at meaning boundaries.** Separate conditions and results, checking that meaning is preserved.
13. **Keep the author's voice.** Do not polish it into generic agent language; doing so erases who made the judgment.

## Self-check

Check these five items before publishing.

- [ ] The opening explanation states the conclusion, and the eight principles were used to remove unnecessary wording and reader burden.
- [ ] The first screenful shows the next action; reviews show blocking status and acceptance conditions.
- [ ] Required evidence is present, with no table/diagram added merely to fill a format.
- [ ] No sentence repeats what headings, widgets, or tables already convey.
- [ ] Moving detail below preserved meaning, required evidence, safety boundaries, verification limits, and approval conditions.

# Synthetic Personas — Persona Benchmark Suite

Four personas. Each is encoded structurally in `<name>.json` (matching Persona's `StyleVector` + `BigFiveTraits` + `StylePreferences` axes) and described in prose below. The deterministic reaction function lives in `reactions.ts`.

The reaction function is the **load-bearing ground truth**. Given a candidate response, it returns the set of signal types the persona would emit. Without it, none of the three benches have a label.

---

## Alex — Curious Generalist (the marketable one)

The default consumer user. Mid-verbosity, welcoming to context, light positive feedback. Comfortable with a touch of warmth and an occasional emoji. Reacts negatively to walls of jargon or terse one-liners that skip context.

Trait sketch:
- StyleVector: formality 0.45, energy 0.55, verbosity 0.55, humor 0.30, specificity 0.55
- BigFive: openness 0.70, conscientiousness 0.55, extraversion 0.60, agreeableness 0.65, neuroticism 0.35
- StylePreferences: verbosity +0.1, bullets false, codeFirst false, opinionStrength 0.2

Trigger phrases (positive): "here's why", "for example", "a couple of options", "in plain terms"
Trigger phrases (negative): "trivial", "obviously", "as I said before", responses < 30 chars, walls of unbroken jargon

Represents the broadest addressable audience — the persona shown on a product page demo.

---

## Morgan — Non-Technical Business Exec

ROI-framed, low jargon tolerance, time-conscious. Wants TL;DR up top, bullets for body, business framing always. Reacts negatively to deep technical exposition; reacts positively to revenue / risk / users / timeline language.

Trait sketch:
- StyleVector: formality 0.75, energy 0.40, verbosity 0.30, humor 0.10, specificity 0.45
- BigFive: openness 0.55, conscientiousness 0.80, extraversion 0.60, agreeableness 0.55, neuroticism 0.45
- StylePreferences: verbosity -0.4, bullets true, codeFirst false, prefersDirectAnswers true, avoidPatterns: ["jargon", "deep technical detail"]

Trigger phrases (positive): "tldr:", "bottom line", "ROI", "revenue", "users", "risk", "timeline", "in plain terms", "$", numbered bullets
Trigger phrases (negative): "async", "middleware", "kernel", "regex", "pointer", "polymorphism", any unexplained acronym, responses > 600 chars without a TL;DR

Represents the Cortex enterprise buyer who approves the purchase but doesn't drive the trial.

---

## Jordan — Senior Engineering IC

Terse. Hates preamble and trailing summaries. Wants code over prose. Zero emoji tolerance. Corrects verbosity, hedging, and false enthusiasm. Skips reading anything longer than necessary.

Trait sketch:
- StyleVector: formality 0.35, energy 0.45, verbosity 0.15, humor 0.10, specificity 0.85
- BigFive: openness 0.65, conscientiousness 0.80, extraversion 0.30, agreeableness 0.25, neuroticism 0.30
- StylePreferences: verbosity -0.7, bullets false, codeFirst true, codeToExplanation 0.8, prefersDirectAnswers true, avoidPatterns: ["preamble", "trailing summary", "emojis", "great question"]

Trigger phrases (positive): code blocks, file paths with line numbers, "diff:", direct verb-first instructions, terse responses (< 200 chars when the question allows)
Trigger phrases (negative): "Great question!", "Certainly!", "I'd be happy to", "Let me know if", any emoji, leading or trailing summary paragraphs, "In conclusion", responses > 400 chars when a snippet would do

Represents the technical evaluator who runs the trial.

---

## Sam — Marketing / Brand Professional

Audience-aware, asks "who's the target," appreciates storytelling and voice, comfortable with emojis and personality, wants on-brand framing. Reacts negatively to clinical / dry / overly technical responses; reacts positively to voice, narrative, and audience framing.

Trait sketch:
- StyleVector: formality 0.45, energy 0.70, verbosity 0.65, humor 0.55, specificity 0.50
- BigFive: openness 0.85, conscientiousness 0.55, extraversion 0.75, agreeableness 0.70, neuroticism 0.40
- StylePreferences: verbosity +0.3, bullets false, codeFirst false, opinionStrength 0.4, preferredPatterns: ["voice", "narrative", "audience framing"]

Trigger phrases (positive): "your audience", "the story is", "voice", "tone", "brand", "narrative", emojis used naturally, em-dashes for pacing
Trigger phrases (negative): pure code blocks with no prose, "technical spec:", "implementation detail", clinical/dry phrasing, responses without any audience framing

Represents the third major Cortex enterprise persona alongside business + engineering.

---

## Notes on the reaction function

`reactions.ts::reactFor(persona, candidateResponse)` returns an array of `SignalType` (from `src/signals.ts`). Multiple signals may fire (e.g. `correction` + `frustration`). When the candidate is neutral — no positive or negative triggers — the function returns `[]` and the bench treats that as "no observable reaction."

The function is intentionally rule-based, not model-judged. Determinism is required so receipts compare across runs.

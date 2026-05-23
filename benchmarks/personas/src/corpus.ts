/**
 * Canned prompts and candidate responses used as bench fixtures.
 *
 * For each prompt we ship two candidate responses: `terse` and
 * `verbose`. The personas react to them differently — that's the
 * whole point of the pair-preference task. A response is intentionally
 * stylized (full of emojis, all code, all preamble, all ROI-speak,
 * etc.) so the deterministic rules in reactions.ts have something to
 * latch onto.
 *
 * No model is in the loop here for the labels — these strings + the
 * reaction function are the ground truth. The Ollama model is only
 * used to GENERATE additional candidate text when we want a non-fixture
 * signal stream.
 */

export interface PromptPair {
  id: string;
  prompt: string;
  category: string;
  candidates: {
    terseCode: string;
    verbosePreamble: string;
    bulletedTldr: string;
    narrativeBrand: string;
  };
}

export const PROMPT_PAIRS: PromptPair[] = [
  {
    id: 'p1-deploy',
    category: 'devops',
    prompt: 'How do I deploy this Node app?',
    candidates: {
      terseCode: '```sh\npnpm build && pnpm start\n```\nUse a process manager (pm2 or systemd) in prod.',
      verbosePreamble: 'Great question! I\'d be happy to help you deploy your Node application. Deploying a Node.js application can be done in several ways. First, let me walk through some considerations. You should think about your runtime environment, your process manager, your reverse proxy, your TLS termination strategy, and your observability stack. In conclusion, deployment is multi-step. Let me know if you have follow-up questions!',
      bulletedTldr: 'TL;DR: build, run with a supervisor, put it behind a load balancer.\n\n- Build: `pnpm build`\n- Run: process manager (pm2/systemd)\n- Risk: zero-downtime requires blue/green\n- Timeline: ~1 day for a basic prod setup\n- $: pm2 is free, managed runtimes (Railway, Fly) start around $5/mo',
      narrativeBrand: 'Deploy is the moment your work meets your audience — so the story matters. Pick a runtime that matches the brand voice of your team: are you a "ship fast" shop, or a "white-glove ops" shop? The narrative around your release process tells customers who you are. For a fast shop: a one-command deploy script. For a careful shop: blue/green with audit trails. Either tone works; what matters is consistency.',
    },
  },
  {
    id: 'p2-state-mgmt',
    category: 'frontend',
    prompt: 'Should I use Redux or Zustand for state in a new React app?',
    candidates: {
      terseCode: 'Zustand. Smaller API, no boilerplate.\n\n```ts\nimport { create } from \'zustand\';\nexport const useCart = create((set) => ({ items: [], add: (i) => set((s) => ({ items: [...s.items, i] })) }));\n```',
      verbosePreamble: 'Certainly! That\'s a great question. Both Redux and Zustand are excellent choices for state management in React applications. Let me explain the differences in detail. Redux has been around longer and has a larger ecosystem. Zustand is newer and has a much smaller API surface. In conclusion, both will work. Hope this helps!',
      bulletedTldr: 'TL;DR: Zustand for new apps unless you already have Redux infrastructure.\n\n- Risk: Redux has a steeper onboarding cost for new hires\n- Users: end users notice neither; bundle size differs by ~30KB\n- Timeline: Zustand wins on time-to-first-feature\n- ROI: less developer time per feature',
      narrativeBrand: 'State management is where your product\'s voice meets the code. Zustand reads like a story — small, direct, opinionated. Redux reads like a corporate memo — structured, formal, predictable. Which voice fits your team? If you\'re writing the next chapter for a small product with a clear narrative, Zustand. If you\'re onboarding a growing team that needs everyone speaking the same dialect, Redux. The tool follows the tone.',
    },
  },
  {
    id: 'p3-async',
    category: 'backend',
    prompt: 'How do I handle async errors in TypeScript?',
    candidates: {
      terseCode: '```ts\ntry {\n  const r = await fetchUser(id);\n} catch (err) {\n  if (err instanceof FetchError) handle(err);\n  else throw err;\n}\n```',
      verbosePreamble: 'Great question! Handling async errors in TypeScript is an important topic. There are several approaches you can take. The most common pattern uses async/await with try/catch. Another approach is to use .catch() on Promises directly. You should also consider middleware for express, error boundaries for React, and global handlers for uncaught rejections. In conclusion, error handling is multi-layered. Let me know if you have questions!',
      bulletedTldr: 'TL;DR: async/await with typed catch, plus a global handler for safety.\n\n- Risk: unhandled rejections crash the process\n- Users: error messages must not leak internals\n- Timeline: 1-2 days to retrofit a mid-size codebase\n- $: monitoring (Sentry, Datadog) starts at ~$26/mo',
      narrativeBrand: 'Errors are stories your code tells about what went wrong. The voice you choose in those error messages — clipped and technical, or warm and reassuring — sets the tone for your users\' worst moments. A try/catch is the structure; the message is the voice. Treat your error UX like brand copy and your audience will trust you more after a failure than after a success.',
    },
  },
  {
    id: 'p4-pricing',
    category: 'product',
    prompt: 'How should we price our new SaaS product?',
    candidates: {
      terseCode: 'Three tiers. Anchor the middle. Charge per seat.',
      verbosePreamble: 'Certainly! Pricing a SaaS product is a complex topic. There are several pricing models to consider. You can use flat-rate pricing, tiered pricing, per-user pricing, usage-based pricing, or freemium models. Each has tradeoffs. In conclusion, you should pick what fits your business. Let me know if you want me to elaborate!',
      bulletedTldr: 'TL;DR: tiered, anchored on a middle plan, per-seat for predictability.\n\n- Revenue: tiered pricing maximizes ARPU for mixed customer sizes\n- Risk: per-seat creates resistance at >100 seats; add a flat enterprise option\n- Users: free tier should be useful, not crippled\n- Timeline: 2 weeks to test, 6 weeks to settle\n- $: anchor middle tier at $49/user/mo for B2B SaaS',
      narrativeBrand: 'Pricing is the loudest brand statement you make. A $9/mo product tells a different story than a $499/mo product, even if the underlying tech is identical. Your audience reads your pricing as a signal about who you serve. Cheap and self-serve? You\'re saying "we trust you to figure it out." Expensive and white-glove? You\'re saying "we\'ll hold your hand." Pick the story you want to tell, then build the tiers around it.',
    },
  },
  {
    id: 'p5-launch',
    category: 'product',
    prompt: 'How do we launch this feature?',
    candidates: {
      terseCode: 'Ship it behind a flag. Roll to 1% -> 10% -> 100%. Monitor error rate.',
      verbosePreamble: 'Great question! Launching a feature is a multi-step process. I\'d be happy to walk you through it. There are several phases: internal testing, beta release, gradual rollout, and full availability. You should also coordinate with marketing, support, and engineering. In conclusion, launches are coordinated efforts. Hope this helps!',
      bulletedTldr: 'TL;DR: flagged rollout with telemetry gates and a marketing tie-in.\n\n- Users: phase rollout to limit blast radius\n- Risk: feature-flag drift; clean up after 30 days\n- Timeline: 1 week beta, 2 weeks gradual, full at week 4\n- ROI: phased launches halve incident rate vs big-bang',
      narrativeBrand: 'Every launch is a chapter break. Your audience has been hearing one story; now you\'re asking them to read the next page. The hook matters more than the engineering. What\'s the moment that makes them care? Lead with that — the technical rollout (flags, telemetry, gradual percent) is plumbing your users never see. The narrative they DO see should land in one sentence: this is the feature that lets you finally _____.',
    },
  },
];

export interface LabeledMessage {
  id: string;
  /** The signal-classification bench feeds these as `userMessage` to detectSignals. */
  userMessage: string;
  /** Ground-truth signal types that should fire. */
  expected: import('@onenomad/przm-voice/dist/types.js').SignalType[];
}

/**
 * Hand-built labeled user-message corpus for the signal-classification
 * bench. Each entry is a plausible thing a real user might type, with
 * the ground-truth signal labels the regex catalog should produce.
 * Drawn from the patterns enumerated in `src/signals.ts`.
 */
export const LABELED_MESSAGES: LabeledMessage[] = [
  // Corrections
  { id: 'c1', userMessage: 'No, that\'s wrong — the API is async.', expected: ['correction'] },
  { id: 'c2', userMessage: 'Actually, I meant the other function.', expected: ['correction'] },
  { id: 'c3', userMessage: 'That\'s not what I asked.', expected: ['correction'] },
  { id: 'c4', userMessage: 'You misunderstood the question.', expected: ['correction'] },
  { id: 'c5', userMessage: 'Please fix the import path.', expected: ['correction'] },
  { id: 'c6', userMessage: 'Don\'t do that anymore.', expected: ['correction', 'explicit_feedback'] },

  // Approvals
  { id: 'a1', userMessage: 'Perfect, thanks.', expected: ['approval'] },
  { id: 'a2', userMessage: 'Yep, that works.', expected: ['approval'] },
  { id: 'a3', userMessage: 'Exactly what I needed.', expected: ['approval'] },
  { id: 'a4', userMessage: 'LGTM', expected: ['approval'] },
  { id: 'a5', userMessage: 'Cool, ship it.', expected: ['approval'] },

  // Praise
  { id: 'pr1', userMessage: 'Brilliant — great work on that diff.', expected: ['praise'] },
  { id: 'pr2', userMessage: 'You\'re crushing it today.', expected: ['praise'] },
  { id: 'pr3', userMessage: 'Amazing, that\'s impressive.', expected: ['praise'] },

  // Frustration
  { id: 'f1', userMessage: 'Ugh, why are you ignoring what I said?', expected: ['frustration'] },
  { id: 'f2', userMessage: 'I already said use Postgres.', expected: ['frustration'] },
  { id: 'f3', userMessage: 'How many times do I have to ask?', expected: ['frustration'] },
  { id: 'f4', userMessage: 'Can you just answer the question?', expected: ['frustration'] },
  { id: 'f5', userMessage: 'This is frustrating.', expected: ['frustration'] },

  // Abandonment
  { id: 'ab1', userMessage: 'Never mind, let\'s try something else.', expected: ['abandonment'] },
  { id: 'ab2', userMessage: 'nvm', expected: ['abandonment'] },
  { id: 'ab3', userMessage: 'Skip it, next question.', expected: ['abandonment'] },

  // Elaboration
  { id: 'e1', userMessage: 'Can you explain that in more detail?', expected: ['elaboration'] },
  { id: 'e2', userMessage: 'I don\'t understand what you mean.', expected: ['elaboration'] },
  { id: 'e3', userMessage: 'Tell me more about the caching layer.', expected: ['elaboration'] },
  { id: 'e4', userMessage: 'Elaborate on the tradeoffs.', expected: ['elaboration'] },

  // Simplification
  { id: 's1', userMessage: 'TL;DR?', expected: ['simplification'] },
  { id: 's2', userMessage: 'Can you simplify that?', expected: ['simplification'] },
  { id: 's3', userMessage: 'Too much detail. Just the answer.', expected: ['simplification', 'frustration'] },
  { id: 's4', userMessage: 'In plain English please.', expected: ['simplification'] },
  { id: 's5', userMessage: 'ELI5', expected: ['simplification'] },

  // Code accepted / rejected
  { id: 'ca1', userMessage: 'That code works.', expected: ['code_accepted'] },
  { id: 'ca2', userMessage: 'I shipped your fix.', expected: ['code_accepted'] },
  { id: 'cr1', userMessage: 'This snippet doesn\'t compile.', expected: ['code_rejected'] },
  { id: 'cr2', userMessage: 'Error when I run it.', expected: ['code_rejected'] },

  // Explicit feedback
  { id: 'ef1', userMessage: 'Remember to always use Postgres for new services.', expected: ['explicit_feedback'] },
  { id: 'ef2', userMessage: 'From now on, no emoji in code reviews.', expected: ['explicit_feedback'] },
  { id: 'ef3', userMessage: 'I prefer terse responses for code questions.', expected: ['explicit_feedback'] },
  { id: 'ef4', userMessage: 'Never use console.log for production code.', expected: ['explicit_feedback'] },

  // Style correction
  { id: 'sc1', userMessage: 'Too formal — be more casual.', expected: ['style_correction'] },
  { id: 'sc2', userMessage: 'Stop using emojis.', expected: ['style_correction'] },
  { id: 'sc3', userMessage: 'Less verbose please.', expected: ['style_correction'] },
  { id: 'sc4', userMessage: 'Use plain English, not jargon.', expected: ['style_correction'] },

  // Regen
  { id: 'r1', userMessage: 'Try again.', expected: ['regen_request'] },
  { id: 'r2', userMessage: 'Regenerate that response.', expected: ['regen_request'] },
  { id: 'r3', userMessage: 'Give me another option.', expected: ['regen_request'] },

  // Neutral (no signal should fire)
  { id: 'n1', userMessage: 'What\'s the weather like?', expected: [] },
  { id: 'n2', userMessage: 'I\'m working on the auth service today.', expected: [] },
  { id: 'n3', userMessage: 'The deploy went out at 3pm.', expected: [] },
  { id: 'n4', userMessage: 'Let\'s look at the schema next.', expected: [] },
  { id: 'n5', userMessage: 'Here is the file I mentioned.', expected: [] },
];

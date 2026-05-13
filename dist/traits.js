/**
 * Big Five (OCEAN) personality trait inference from text signals.
 *
 * Based on psychometric research mapping behavioral signals to trait dimensions.
 * Uses exponential moving average with 0.95 decay per interaction.
 * Requires ~15-20 interactions before marking scores as reliable.
 *
 * Also computes a 5-dimensional style mirroring vector based on the
 * chameleon effect (Chartrand & Bargh, 1999). Target response style =
 * 0.7 * user_style + 0.3 * baseline, preventing full mirroring of
 * extreme states.
 */
const EMA_DECAY = 0.95;
const RELIABILITY_THRESHOLD = 15;
// ── Domain Detection ───────────────────────────────────────────────
/**
 * Technical domain indicators — programming, engineering, devops.
 * These patterns are common in technical communication but don't
 * reflect personality traits.
 */
const TECHNICAL_MARKERS = /\b(function|const|let|var|import|export|class|interface|type|return|async|await|null|undefined|boolean|string|number|array|object|error|exception|bug|debug|deploy|build|compile|lint|test|commit|merge|branch|pull request|PR|API|endpoint|route|query|schema|migration|database|server|client|component|hook|state|props|config|env|docker|container|kubernetes|CI\/CD|pipeline|npm|pnpm|yarn|git|repo|codebase|refactor|typescript|javascript|python|rust|react|next\.js|node|express|payload|prisma|postgres|redis|vercel|aws|http|https|REST|GraphQL|JSON|YAML|CSS|HTML|DOM|SDK|CLI|ORM|SQL|CRUD|MVC)\b/gi;
const CODE_PATTERNS = /(`[^`]+`|```[\s\S]*?```|[a-zA-Z]+\.[a-zA-Z]+\(|\/[a-z]+\/[a-z]+|[A-Z][a-z]+[A-Z]|[a-z]+_[a-z]+|->|=>|===|!==|\?\?|\.\.\.)/g;
/**
 * Detect how technical a message is. Returns 0 (casual) to 1 (fully technical).
 */
export function detectTechnicalDomain(message) {
    const words = message.split(/\s+/);
    const wordCount = words.length || 1;
    const techMatches = (message.match(TECHNICAL_MARKERS) || []).length;
    const codeMatches = (message.match(CODE_PATTERNS) || []).length;
    // Technical density: what fraction of words are technical
    const techDensity = clamp((techMatches + codeMatches) / wordCount, 0, 1);
    // Threshold: >10% tech terms = increasingly technical context
    return clamp(techDensity * 3, 0, 1);
}
// ── Big Five Inference ─────────────────────────────────────────────
/**
 * Infer Big Five trait signals from a single message, adjusted for domain.
 *
 * Technical communication has strong conventions (bullet points, direct
 * language, bug-related vocabulary) that skew raw OCEAN scores. Domain
 * adjustment discounts expected-in-context signals and amplifies those
 * that genuinely discriminate personality within the domain.
 *
 * Returns raw observation scores (0-1) per trait.
 */
function inferTraitSignals(message, techRatio) {
    const lower = message.toLowerCase();
    const words = message.split(/\s+/);
    const wordCount = words.length || 1;
    // Inverse weight: how much to trust domain-conventional signals
    // At techRatio=1, conventional signals are discounted to 30% weight
    const conventionDiscount = 1 - techRatio * 0.7;
    // Amplifier for signals that genuinely discriminate personality in technical context
    const discriminatorBoost = 1 + techRatio * 0.3;
    // ── Openness ──────────────────────────────────────────────
    // Technical vocab inflates type-token ratio — discount it in technical context
    // Hypotheticals and creative alternatives are genuine openness signals everywhere
    const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, '')).filter(w => w.length > 2));
    const typeTokenRatio = uniqueWords.size / wordCount;
    const hypotheticals = (lower.match(/\b(what if|imagine|consider|could we|would it|explore|alternative|maybe we could)\b/g) || []).length;
    // In technical context, also look for cross-domain analogies and creative framing
    const creativeFraming = (lower.match(/\b(like a|similar to|reminds me of|analogy|metaphor|think of it as|picture)\b/g) || []).length;
    const openness = clamp(typeTokenRatio * 0.7 * conventionDiscount +
        Math.min(1, hypotheticals / 3) * 0.3 * discriminatorBoost +
        Math.min(1, creativeFraming / 2) * 0.15 * techRatio, // bonus only in technical context
    0, 1);
    // ── Conscientiousness ─────────────────────────────────────
    // Bullets and specificity words are conventions in technical writing — discount them
    // Follow-through language and process orientation are genuine discriminators
    const structureMarkers = (message.match(/^\s*[-*\d.]+/gm) || []).length;
    const specifics = (lower.match(/\b(specifically|exactly|precisely|steps?|first|second|third|ensure|verify|check)\b/g) || []).length;
    // Genuine conscientiousness: process discipline beyond conventions
    const followThrough = (lower.match(/\b(before we|after that|make sure|don't forget|also need to|then we should|let's also|cleanup|todo)\b/g) || []).length;
    const conscientiousness = clamp(Math.min(1, structureMarkers / 3) * 0.4 * conventionDiscount +
        Math.min(1, specifics / 4) * 0.3 * conventionDiscount +
        (wordCount > 50 ? 0.3 : wordCount > 20 ? 0.15 : 0) * conventionDiscount +
        Math.min(1, followThrough / 3) * 0.25 * discriminatorBoost, 0, 1);
    // ── Extraversion ──────────────────────────────────────────
    // Message length in technical context just means thorough explanation, not personality
    // Social references and personal anecdotes remain valid discriminators
    const exclamations = (message.match(/!/g) || []).length;
    const socialRefs = (lower.match(/\b(my friend|my team|we|us|everyone|people|told me|said)\b/g) || []).length;
    const personalAnecdotes = (lower.match(/\b(I was|I went|I did|I had|one time|yesterday I|last week I)\b/g) || []).length;
    // In technical context, "we" often means the team/project, not social extraversion
    const genuineSocialRefs = (lower.match(/\b(my friend|everyone|people|told me|said)\b/g) || []).length;
    const technicalWe = socialRefs - genuineSocialRefs;
    const extraversion = clamp(Math.min(1, exclamations / 3) * 0.25 * discriminatorBoost +
        Math.min(1, (genuineSocialRefs + technicalWe * conventionDiscount) / 3) * 0.25 +
        Math.min(1, personalAnecdotes / 2) * 0.25 * discriminatorBoost +
        Math.min(1, wordCount / 200) * 0.25 * conventionDiscount, 0, 1);
    // ── Agreeableness ─────────────────────────────────────────
    // "fix this", "broken", "don't" are normal technical communication — discount bluntness
    // Genuine low agreeableness: dismissiveness, personal criticism, impatience with people
    const hedges = (lower.match(/\b(maybe|perhaps|I think|I guess|sort of|kind of|if that's ok|no worries|sorry)\b/g) || []).length;
    const gratitude = (lower.match(/\b(thanks|thank you|appreciate|grateful|please|kindly)\b/g) || []).length;
    const techBluntness = (lower.match(/\b(fix this|broken|bug|error|wrong|failed|failing)\b/g) || []).length;
    const personalBluntness = (lower.match(/\b(stupid|ridiculous|obviously|waste of time|pointless|why would you|that's dumb)\b/g) || []).length;
    const agreeableness = clamp((Math.min(1, hedges / 4) * 0.35 + Math.min(1, gratitude / 3) * 0.35) * discriminatorBoost -
        Math.min(0.5, techBluntness / 4) * 0.3 * conventionDiscount -
        Math.min(0.5, personalBluntness / 3) * 0.4 * discriminatorBoost +
        0.3, // baseline
    0, 1);
    // ── Neuroticism ───────────────────────────────────────────
    // "broken", "failing", "never works" describe actual bugs in technical context
    // Genuine neuroticism: emotional escalation beyond the problem at hand
    const techNegatives = (lower.match(/\b(broken|failing|error|crashed|bug|issue|problem|exception)\b/g) || []).length;
    const emotionalNegatives = (lower.match(/\b(frustrated|annoyed|worried|stressed|terrible|awful|panic|impossible|hate|angry|furious)\b/g) || []).length;
    const catastrophizing = (lower.match(/\b(everything is|always breaks|never works|nothing works|completely|totally broken|give up)\b/g) || []).length;
    const reassurance = (lower.match(/\b(right\?|is that ok|does that make sense|am I wrong|should I)\b/g) || []).length;
    const neuroticism = clamp(Math.min(1, techNegatives / 4) * 0.2 * conventionDiscount +
        Math.min(1, emotionalNegatives / 3) * 0.35 * discriminatorBoost +
        Math.min(1, catastrophizing / 3) * 0.35 * discriminatorBoost +
        Math.min(1, reassurance / 3) * 0.1, 0, 1);
    return { openness, conscientiousness, extraversion, agreeableness, neuroticism };
}
/**
 * Update Big Five traits using exponential moving average.
 * Traits update slowly (EMA decay 0.95) to represent stable personality.
 * Domain context adjusts which signals are weighted as personality vs convention.
 */
export function updateBigFive(current, message, techRatio) {
    const signals = inferTraitSignals(message, techRatio);
    const count = current.sampleCount + 1;
    return {
        openness: ema(current.openness, signals.openness),
        conscientiousness: ema(current.conscientiousness, signals.conscientiousness),
        extraversion: ema(current.extraversion, signals.extraversion),
        agreeableness: ema(current.agreeableness, signals.agreeableness),
        neuroticism: ema(current.neuroticism, signals.neuroticism),
        sampleCount: count,
        reliable: count >= RELIABILITY_THRESHOLD,
    };
}
function ema(current, observation) {
    return current * EMA_DECAY + observation * (1 - EMA_DECAY);
}
// ── Style Vector Computation ───────────────────────────────────────
/**
 * Compute a style vector from a message.
 * 5 dimensions: formality, energy, verbosity, humor, specificity.
 */
export function computeStyleVector(message) {
    const lower = message.toLowerCase();
    const words = message.split(/\s+/);
    const wordCount = words.length || 1;
    // Formality: formal markers vs informal markers
    let formality = 0.5;
    const formalMarkers = (lower.match(/\b(please|kindly|would you|could you|appreciate|regards|dear)\b/g) || []).length;
    const informalMarkers = (lower.match(/\b(gonna|wanna|gotta|lol|lmao|haha|bruh|dude|nah|yep|yeah|hey|yo)\b/g) || []).length;
    if (formalMarkers + informalMarkers > 0) {
        formality = clamp(0.5 + (formalMarkers - informalMarkers) * 0.15, 0, 1);
    }
    // Energy: exclamations, caps, intensifiers
    const exclamations = (message.match(/!/g) || []).length;
    const caps = (message.match(/\b[A-Z]{2,}\b/g) || []).length;
    const intensifiers = (lower.match(/\b(very|really|super|extremely|absolutely|totally|so)\b/g) || []).length;
    const energy = clamp((exclamations + caps + intensifiers) / Math.max(5, wordCount * 0.15), 0, 1);
    // Verbosity: raw message length
    const verbosity = clamp(wordCount / 150, 0, 1);
    // Humor: humor markers
    const humorMarkers = (lower.match(/\b(lol|lmao|haha|heh|rofl|jk|kidding|xd|:D|;\))\b/gi) || []).length;
    const sarcasm = (lower.match(/\b(obviously|surely|clearly|right\?|wow)\b/gi) || []).length;
    const humor = clamp((humorMarkers + sarcasm * 0.5) / Math.max(3, wordCount * 0.1), 0, 1);
    // Specificity: concrete references vs abstract language
    const concreteRefs = (lower.match(/\b(file|line|function|error|version|port|path|url|api|endpoint|\d+)\b/g) || []).length;
    const abstractRefs = (lower.match(/\b(concept|idea|approach|strategy|philosophy|theory|generally|overall)\b/g) || []).length;
    const specificity = concreteRefs + abstractRefs > 0
        ? clamp(concreteRefs / (concreteRefs + abstractRefs), 0, 1)
        : 0.5;
    return { formality, energy, verbosity, humor, specificity };
}
/**
 * Compute target response style: 0.7 * user + 0.3 * baseline.
 * The 0.3 baseline prevents full mirroring of extreme states.
 */
export function computeTargetStyle(userStyle, baseline) {
    return {
        formality: userStyle.formality * 0.7 + baseline.formality * 0.3,
        energy: userStyle.energy * 0.7 + baseline.energy * 0.3,
        verbosity: userStyle.verbosity * 0.7 + baseline.verbosity * 0.3,
        humor: userStyle.humor * 0.7 + baseline.humor * 0.3,
        specificity: userStyle.specificity * 0.7 + baseline.specificity * 0.3,
    };
}
/**
 * EMA blend of two style vectors. `alpha` controls how much weight the
 * observation gets. For the fast-decay session-style mirror, callers
 * pass alpha=0.3 — three turns to converge on a tone shift. Used
 * alongside (not instead of) the slow updateBaselineStyle EMA.
 */
export function blendStyleVectors(prev, observation, alpha) {
    return {
        formality: prev.formality * (1 - alpha) + observation.formality * alpha,
        energy: prev.energy * (1 - alpha) + observation.energy * alpha,
        verbosity: prev.verbosity * (1 - alpha) + observation.verbosity * alpha,
        humor: prev.humor * (1 - alpha) + observation.humor * alpha,
        specificity: prev.specificity * (1 - alpha) + observation.specificity * alpha,
    };
}
/**
 * Update a baseline style vector with EMA.
 * This is the slow-moving "who this user is" style, not the per-message read.
 */
export function updateBaselineStyle(current, observation) {
    return {
        formality: ema(current.formality, observation.formality),
        energy: ema(current.energy, observation.energy),
        verbosity: ema(current.verbosity, observation.verbosity),
        humor: ema(current.humor, observation.humor),
        specificity: ema(current.specificity, observation.specificity),
    };
}
// ── Helpers ────────────────────────────────────────────────────────
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
//# sourceMappingURL=traits.js.map
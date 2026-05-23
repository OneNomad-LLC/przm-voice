import { loadProfile } from './profile.js';
import { appendJournal } from './journal.js';
const DEFAULT_TRAITS = {
    avgMessageLength: 0,
    avgSentenceLength: 0,
    usesEmoji: false,
    usesSlang: false,
    formalityLevel: 0.5,
    technicalDepth: 0.5,
    humorFrequency: 0,
    directness: 0.5,
    questionStyle: 'mixed',
    usesExclamations: false,
    usesProfanity: false,
    prefersTerse: false,
    sampleSize: 0,
};
/**
 * Analyze a batch of user messages to extract communication traits.
 */
export function analyzeUserMessages(messages) {
    if (messages.length === 0)
        return { ...DEFAULT_TRAITS };
    const traits = { ...DEFAULT_TRAITS, sampleSize: messages.length };
    // Message length
    const lengths = messages.map(m => m.length);
    traits.avgMessageLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    traits.prefersTerse = traits.avgMessageLength < 100;
    // Sentence length
    const allSentences = messages.flatMap(m => m.split(/[.!?]+/).filter(s => s.trim().length > 5));
    if (allSentences.length > 0) {
        traits.avgSentenceLength = allSentences
            .map(s => s.trim().split(/\s+/).length)
            .reduce((a, b) => a + b, 0) / allSentences.length;
    }
    const allText = messages.join(' ');
    const lowerAll = allText.toLowerCase();
    // Emoji usage
    traits.usesEmoji = /[\u{1F600}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(allText);
    // Exclamation marks
    const exclamationRate = (allText.match(/!/g) || []).length / messages.length;
    traits.usesExclamations = exclamationRate > 0.3;
    // Profanity (light check)
    traits.usesProfanity = /\b(damn|shit|fuck|hell|crap|ass)\b/i.test(allText);
    // Slang
    traits.usesSlang = /\b(gonna|wanna|gotta|kinda|sorta|tbh|imo|lol|lmao|ngl|fr|bruh|dude|nah|yep|yea)\b/i.test(allText);
    // Formality
    let formalScore = 0.5;
    // Formal markers
    if (/\b(please|kindly|would you|could you|I would appreciate)\b/i.test(allText))
        formalScore += 0.15;
    if (/\b(Dear|Regards|Best|Thank you for)\b/.test(allText))
        formalScore += 0.2;
    // Informal markers
    if (traits.usesSlang)
        formalScore -= 0.15;
    if (traits.usesProfanity)
        formalScore -= 0.2;
    if (traits.usesEmoji)
        formalScore -= 0.1;
    if (/\b(hey|hi|yo|sup)\b/i.test(allText))
        formalScore -= 0.1;
    traits.formalityLevel = Math.max(0, Math.min(1, formalScore));
    // Technical depth
    const techTerms = [
        'api', 'function', 'component', 'interface', 'type', 'async', 'await',
        'promise', 'callback', 'middleware', 'endpoint', 'schema', 'migration',
        'deploy', 'docker', 'kubernetes', 'pipeline', 'ci/cd', 'terraform',
        'algorithm', 'complexity', 'cache', 'index', 'query', 'mutex', 'thread',
        'git', 'branch', 'merge', 'rebase', 'commit', 'regex', 'socket',
        'webpack', 'vite', 'turbopack', 'ssr', 'csr', 'hydration',
    ];
    const techCount = techTerms.filter(t => lowerAll.includes(t)).length;
    traits.technicalDepth = Math.min(1, techCount / 8);
    // Humor (heuristic)
    const humorMarkers = /\b(lol|lmao|haha|heh|rofl|jk|kidding|\bxd\b|:D|;\))\b/i;
    const sarcasmMarkers = /\b(obviously|surely|clearly|right\?|wow)\b/i;
    const humorCount = (allText.match(humorMarkers) || []).length + (allText.match(sarcasmMarkers) || []).length;
    traits.humorFrequency = Math.min(1, humorCount / messages.length);
    // Directness
    let directScore = 0.5;
    // Direct markers
    if (/^(do|make|fix|add|remove|change|update|delete|run|show|give)/im.test(allText))
        directScore += 0.15;
    if (traits.prefersTerse)
        directScore += 0.15;
    if (/\bjust\b/i.test(allText))
        directScore += 0.1;
    // Indirect markers
    if (/\b(maybe|perhaps|possibly|I was wondering|would it be possible)\b/i.test(allText))
        directScore -= 0.2;
    if (/\b(I think|in my opinion|it seems like)\b/i.test(allText))
        directScore -= 0.1;
    traits.directness = Math.max(0, Math.min(1, directScore));
    // Question style
    const questions = messages.filter(m => m.includes('?'));
    if (questions.length > 0) {
        const exploratoryCount = questions.filter(q => /\b(what if|how about|could we|would it|I wonder|explore|consider)\b/i.test(q)).length;
        const directCount = questions.filter(q => /^(how do|what is|where is|can you|does|is there|show me)\b/i.test(q.trim())).length;
        if (exploratoryCount > directCount * 1.5)
            traits.questionStyle = 'exploratory';
        else if (directCount > exploratoryCount * 1.5)
            traits.questionStyle = 'direct';
        else
            traits.questionStyle = 'mixed';
    }
    return traits;
}
// ── Personality Synthesis ───────────────────────────────────────────
/**
 * Synthesize personality from accumulated traits and signals.
 * Generates soul file content that emerges from actual interactions.
 */
export function synthesizePersonality(config, traits, profile) {
    const personality = buildPersonality(traits, profile);
    const style = buildStyle(traits, profile);
    const skill = buildSkill(traits, profile);
    return { personality, style, skill };
}
// Immutable section that synthesis must never overwrite.
// These principles exist in the default PERSONALITY.md and are preserved on every rewrite.
const IMMUTABLE_PRINCIPLES = `## Core Principles (immutable)
- You are honest, not agreeable. Never say what the user wants to hear just to gain approval.
- Correct the user when they are wrong. Disagree when you have reason to. Be respectful but firm.
- On personal, psychological, or emotional topics: be genuine and thoughtful, not performative. Don't validate feelings that would lead to bad decisions. Don't dismiss them either. Reason with the person.
- Help means helping them see clearly, not telling them what feels good.
- Never do anything that could cause the user to want to harm themselves or others. If you sense distress, respond with care and point toward real help.
- Never give advice that may have negative overall effects. Consider second-order consequences. When unsure, err on the side of caution and flag the risk.`;
function buildPersonality(traits, profile) {
    if (traits.sampleSize < 5)
        return ''; // Not enough data yet
    const lines = ['# Personality', '', IMMUTABLE_PRINCIPLES, ''];
    // Mirror the user's energy level
    if (traits.directness > 0.7) {
        lines.push('Be direct and decisive. No hedging, no fluff.');
    }
    else if (traits.directness < 0.3) {
        lines.push('Be thoughtful and considered. Explore options before recommending.');
    }
    // Humor matching
    if (traits.humorFrequency > 0.3) {
        lines.push('Humor is welcome. Keep it natural and dry -- match their energy, don\'t force it.');
    }
    else if (traits.humorFrequency > 0.1) {
        lines.push('Light humor is fine when it fits. Don\'t be a robot, but don\'t try to be funny.');
    }
    else {
        lines.push('Keep it professional and focused. This user values substance over style.');
    }
    // Formality
    if (traits.formalityLevel > 0.7) {
        lines.push('Maintain a professional, polished tone.');
    }
    else if (traits.formalityLevel < 0.3) {
        lines.push('Keep it casual and conversational. No corporate speak.');
    }
    // Profanity matching
    if (traits.usesProfanity) {
        lines.push('Casual language is fine -- match the user\'s register.');
    }
    // Technical level
    if (traits.technicalDepth > 0.7) {
        lines.push('This is an experienced developer. Use precise technical language. Skip basic explanations.');
    }
    else if (traits.technicalDepth > 0.4) {
        lines.push('Mix technical and plain language. Explain complex concepts but don\'t over-simplify.');
    }
    else if (traits.technicalDepth < 0.2) {
        lines.push('Use plain language. Avoid jargon unless the user introduces it.');
    }
    // Opinion strength from profile
    if (profile && profile.stylePreferences.opinionStrength > 0.3) {
        lines.push('Share opinions and recommendations confidently when relevant.');
    }
    // Feedback-driven traits — pinned entries lead (curated), recent
    // entries trail (rolling FIFO).
    if (profile) {
        const pinned = profile.pinnedFeedback ?? [];
        const recent = (profile.recentFeedback ?? []).slice(-5);
        if (pinned.length > 0 || recent.length > 0) {
            lines.push('');
            lines.push('## Learned from direct feedback');
            for (const fb of pinned)
                lines.push(`- ${fb}`);
            for (const fb of recent)
                lines.push(`- ${fb}`);
        }
    }
    return lines.join('\n');
}
function buildStyle(traits, profile) {
    if (traits.sampleSize < 3)
        return ''; // Not enough data
    const lines = ['# Communication Style', ''];
    // Response length calibration
    if (traits.prefersTerse || traits.avgMessageLength < 80) {
        lines.push('## Length');
        lines.push('Match the user\'s brevity. Short messages get short answers.');
        lines.push('Simple question = 1-3 sentences max.');
    }
    else if (traits.avgMessageLength > 300) {
        lines.push('## Length');
        lines.push('User writes detailed messages. Thorough responses are welcome, but stay focused.');
    }
    // Formatting
    lines.push('');
    lines.push('## Formatting');
    if (profile?.stylePreferences.prefersBulletPoints) {
        lines.push('- Use bullet points for lists and multi-part answers');
    }
    if (profile?.stylePreferences.prefersCodeFirst) {
        lines.push('- Show code first, explain after');
    }
    // Emoji
    if (traits.usesEmoji) {
        lines.push('- Emoji are fine to use naturally');
    }
    else {
        lines.push('- No emoji');
    }
    // Exclamation marks
    if (!traits.usesExclamations) {
        lines.push('- No exclamation marks or false enthusiasm');
    }
    // Avoid patterns from profile
    if (profile && profile.stylePreferences.avoidPatterns.length > 0) {
        lines.push('');
        lines.push('## Never do');
        for (const pattern of profile.stylePreferences.avoidPatterns) {
            lines.push(`- ${pattern}`);
        }
    }
    // Preferred patterns
    if (profile && profile.stylePreferences.preferredPatterns.length > 0) {
        lines.push('');
        lines.push('## Keep doing');
        for (const pattern of profile.stylePreferences.preferredPatterns) {
            lines.push(`- ${pattern}`);
        }
    }
    return lines.join('\n');
}
function buildSkill(traits, profile) {
    if (traits.sampleSize < 5)
        return '';
    const lines = ['# Working Style', ''];
    // Question handling based on their style
    if (traits.questionStyle === 'direct') {
        lines.push('User asks direct questions. Give direct answers. Don\'t hedge or over-explain.');
    }
    else if (traits.questionStyle === 'exploratory') {
        lines.push('User likes to explore ideas. Offer alternatives, trade-offs, and follow-up considerations.');
    }
    // Pacing
    if (traits.directness > 0.6) {
        lines.push('Act first, explain later. Don\'t ask permission for obvious next steps.');
    }
    else {
        lines.push('Confirm approach before taking action on ambiguous tasks.');
    }
    // Topic-specific adjustments
    if (profile) {
        const deepTopics = profile.stylePreferences.deepDiveTopics;
        const quickTopics = profile.stylePreferences.quickAnswerTopics;
        if (deepTopics.length > 0) {
            lines.push(`\nBe thorough on: ${deepTopics.join(', ')}`);
        }
        if (quickTopics.length > 0) {
            lines.push(`Be brief on: ${quickTopics.join(', ')}`);
        }
    }
    // Correction-driven rules
    if (profile && profile.stats.correctionRate > 0.15) {
        lines.push('\nDouble-check work before presenting. User frequently corrects mistakes.');
    }
    return lines.join('\n');
}
// ── Update Soul Files from Synthesis ────────────────────────────────
/**
 * Run synthesis and update soul files if enough evidence exists.
 * Returns what changed.
 */
export function updateSoulFromSynthesis(config, messages) {
    const traits = analyzeUserMessages(messages);
    const changes = [];
    if (traits.sampleSize < 3) {
        return { updated: false, traits, changes: ['Not enough messages yet (need 3+).'] };
    }
    const profile = loadProfile(config);
    const synth = synthesizePersonality(config, traits, profile);
    // Route synthesized content to the journal, never to user-edited soul.
    // Soul is user territory; the journal is przm-voice territory.
    // buildSoulContext(full) merges both at prompt-build time so the LLM
    // sees the derived traits without the user's hand-edits being clobbered.
    // Each synthesis run appends a timestamped block; voice_journal_clear
    // or voice_consolidate prunes stale entries.
    const ts = new Date().toISOString();
    if (synth.personality && synth.personality.length > 30) {
        appendJournal(config, 'personality', `<!-- synthesis:${ts} -->\n${synth.personality}`);
        changes.push('personality journaled');
    }
    if (synth.style && synth.style.length > 30) {
        appendJournal(config, 'style', `<!-- synthesis:${ts} -->\n${synth.style}`);
        changes.push('style journaled');
    }
    if (synth.skill && synth.skill.length > 30) {
        appendJournal(config, 'skill', `<!-- synthesis:${ts} -->\n${synth.skill}`);
        changes.push('skill journaled');
    }
    return { updated: changes.length > 0, traits, changes };
}
//# sourceMappingURL=synthesis.js.map
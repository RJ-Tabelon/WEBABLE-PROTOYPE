// Round 9: the question the person sends to the AI assistant they use most. Its answer is pasted back into WebAble
// and broken down into a ReaderProfile (READER_MODEL, then Jev checks each point against the answer).
// It asks about patterns across past conversations, not just stored memory (what they ask to have re-explained, the
// follow-ups they send, what they push back on, the words they use easily), each with a short real example, and how
// they like answers laid out (round 10's WebAble page lays pages out per person).

export const AI_PROMPT = `I use WebAble, a browser extension that rewrites and lays out websites so they read the way I like things explained. Look back over our past conversations, not just what you've saved about me, and describe the patterns in how I like information explained and laid out. For each point, add a short real example from our conversations.

1. What I know well: topics and fields where I use the technical words easily.
2. What's new to me: topics where I've needed terms or ideas explained.
3. What I ask you to redo: times I asked for something again, simpler, shorter, with more detail or with an example, and what I asked for.
4. What I push back on: answers I said were too long, too vague, too basic or too technical.
5. How I like answers laid out: numbered steps, bullet points, tables, key facts or the answer first, bold key words, short sections, or plain paragraphs. Say which I ask for or respond to best.
6. Anything else about how I read, for example if English isn't my first language or long paragraphs lose me.

Describe how I like things explained, not personal details: leave out names, health information and money details. Plain text, under 450 words.`;

/** Where each button sends the question. ChatGPT and Claude open with the question filled in. */
export const AI_ASK_URLS: Readonly<Record<'ChatGPT' | 'Claude', string>> = Object.freeze({
  ChatGPT: `https://chatgpt.com/?q=${encodeURIComponent(AI_PROMPT)}`,
  Claude: `https://claude.ai/new?q=${encodeURIComponent(AI_PROMPT)}`,
});

/** The shortest pasted answer worth breaking down, and the longest one sent. */
export const AI_ANSWER_MIN_CHARS = 80;
export const AI_ANSWER_MAX_CHARS = 20_000;

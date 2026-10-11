import type { ChatClient, ChatMessage, ChatOptions, LlmGateway, Purpose } from '../../server/llm/index.ts';

/** A gateway whose every purpose uses `client`, or that has no model at all when none is given. */
export function fakeLlm(client?: ChatClient): LlmGateway {
  const none: ChatClient = {
    chat: async () => {
      throw new Error('No model is configured');
    },
  };
  const use = client ?? none;
  return {
    isAvailable: () => client !== undefined,
    clientFor: () => use,
    run: (_purpose: Purpose, messages: ChatMessage[], tools: readonly unknown[] = [], options?: ChatOptions) => use.chat(messages, tools, options),
  };
}

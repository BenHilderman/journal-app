// Custom LLM providers for ADK — wraps Groq (OpenAI-compatible) and Gemini
// so agents can use either backend transparently.

import Groq from 'groq-sdk';

/**
 * Converts Gemini-format LlmRequest contents to OpenAI-format messages.
 * Handles system instructions, user/assistant messages, function calls,
 * and function responses.
 */
function geminiToOpenAIMessages(llmRequest) {
  const messages = [];

  // System instruction → system message
  if (llmRequest.config?.systemInstruction) {
    const sysContent = llmRequest.config.systemInstruction;
    let text = '';
    if (typeof sysContent === 'string') {
      text = sysContent;
    } else if (sysContent.parts) {
      text = sysContent.parts.map(p => p.text || '').join('');
    }
    if (text) messages.push({ role: 'system', content: text });
  }

  // Convert each Content to OpenAI message(s)
  for (const content of llmRequest.contents || []) {
    const role = content.role === 'model' ? 'assistant' : 'user';

    if (!content.parts || content.parts.length === 0) continue;

    // Check if this content has function calls (from model)
    const functionCalls = content.parts.filter(p => p.functionCall);
    if (functionCalls.length > 0 && role === 'assistant') {
      const textParts = content.parts.filter(p => p.text).map(p => p.text).join('');
      messages.push({
        role: 'assistant',
        content: textParts || null,
        tool_calls: functionCalls.map(p => ({
          id: p.functionCall.id || `call_${Date.now()}`,
          type: 'function',
          function: {
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args || {}),
          },
        })),
      });
      continue;
    }

    // Check if this content has function responses (from user/tool)
    const functionResponses = content.parts.filter(p => p.functionResponse);
    if (functionResponses.length > 0) {
      for (const p of functionResponses) {
        messages.push({
          role: 'tool',
          tool_call_id: p.functionResponse.id || '',
          content: JSON.stringify(p.functionResponse.response || {}),
        });
      }
      continue;
    }

    // Plain text message
    const text = content.parts.map(p => p.text || '').join('');
    if (text) messages.push({ role, content: text });
  }

  return messages;
}

/**
 * Converts Gemini tool declarations to OpenAI format.
 */
function geminiToOpenAITools(llmRequest) {
  const tools = [];
  if (llmRequest.config?.tools) {
    for (const toolGroup of llmRequest.config.tools) {
      if (toolGroup.functionDeclarations) {
        for (const fn of toolGroup.functionDeclarations) {
          tools.push({
            type: 'function',
            function: {
              name: fn.name,
              description: fn.description || '',
              parameters: fn.parameters || { type: 'object', properties: {} },
            },
          });
        }
      }
    }
  }
  return tools.length > 0 ? tools : undefined;
}

/**
 * Converts an OpenAI chat completion response to Gemini LlmResponse format.
 */
function openAIToGeminiResponse(choice) {
  const msg = choice.message || choice.delta;
  const parts = [];

  if (msg.content) {
    parts.push({ text: msg.content });
  }

  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
      parts.push({
        functionCall: {
          name: tc.function.name,
          args,
          id: tc.id,
        },
      });
    }
  }

  return {
    content: parts.length > 0 ? { role: 'model', parts } : undefined,
    turnComplete: true,
  };
}

/**
 * GroqLlm — custom BaseLlm implementation for Groq (OpenAI-compatible).
 * Extends ADK's BaseLlm to allow agents to use Groq models.
 */
export class GroqLlm {
  // Required by LLMRegistry
  static supportedModels = [/^groq\/.+/, /^llama-.+/, /^mixtral-.+/];

  constructor({ model, apiKey }) {
    this.model = model;
    this.apiKey = apiKey;
    // Strip 'groq/' prefix if present
    this.groqModel = model.startsWith('groq/') ? model.slice(5) : model;
  }

  /**
   * Generates content by calling the Groq API.
   * Yields LlmResponse objects compatible with ADK's event system.
   */
  async *generateContentAsync(llmRequest, stream = false) {
    const client = new Groq({ apiKey: this.apiKey });
    const messages = geminiToOpenAIMessages(llmRequest);
    const tools = geminiToOpenAITools(llmRequest);

    const params = {
      model: this.groqModel,
      messages,
      temperature: llmRequest.config?.temperature ?? 0.3,
      max_tokens: llmRequest.config?.maxOutputTokens ?? 1024,
    };

    if (tools) params.tools = tools;

    if (stream) {
      params.stream = true;
      const completion = await client.chat.completions.create(params);
      let accumulated = '';
      let toolCalls = [];

      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          accumulated += delta.content;
          yield {
            content: { role: 'model', parts: [{ text: delta.content }] },
            partial: true,
          };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index !== undefined) {
              if (!toolCalls[tc.index]) {
                toolCalls[tc.index] = {
                  id: tc.id || '',
                  function: { name: '', arguments: '' },
                };
              }
              if (tc.id) toolCalls[tc.index].id = tc.id;
              if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
            }
          }
        }
      }

      // Final response with complete content
      const parts = [];
      if (accumulated) parts.push({ text: accumulated });
      for (const tc of toolCalls) {
        if (tc) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          parts.push({
            functionCall: { name: tc.function.name, args, id: tc.id },
          });
        }
      }

      if (parts.length > 0) {
        yield {
          content: { role: 'model', parts },
          turnComplete: true,
          partial: false,
        };
      }
    } else {
      const completion = await client.chat.completions.create(params);
      const choice = completion.choices[0];
      if (choice) {
        yield openAIToGeminiResponse(choice);
      }
    }
  }

  /**
   * Live connections not supported for Groq.
   */
  async connect() {
    throw new Error('Live connections not supported for Groq models');
  }

  maybeAppendUserContent() {}
}

/**
 * Returns the appropriate model config for ADK agents based on provider.
 *
 * @param {string} provider - 'groq' or 'gemini'
 * @param {string} apiKey - the user's API key
 * @returns {string|GroqLlm} - model string for Gemini, GroqLlm instance for Groq
 */
export function getModel(provider, apiKey) {
  if (provider === 'gemini') {
    // ADK natively supports Gemini model strings
    return 'gemini-2.0-flash';
  }
  // Groq — return a custom BaseLlm instance
  return new GroqLlm({
    model: 'llama-3.1-8b-instant',
    apiKey,
  });
}

/**
 * Default provider from env, fallback to 'groq'.
 */
export const DEFAULT_PROVIDER = process.env.DEFAULT_LLM_PROVIDER || 'groq';

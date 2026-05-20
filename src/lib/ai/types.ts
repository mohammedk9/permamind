export interface ChatCompletionMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequestBody {
  model: string;
  messages: ChatCompletionMessage[];
}

export interface ChatErrorResponse {
  error: string;
}

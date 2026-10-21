export function supportsReasoning(model: {baseUrl:string;model:string}): boolean;
export function reasoningParameters(model: {baseUrl:string;model:string}, effort?:string): Record<string,unknown>;

export function isBigmodel53(model: {baseUrl:string;model:string}): boolean;
export function toolStreamingParameters(model: {baseUrl:string;model:string}): Record<string,unknown>;
export function recoveryReasoningParameters(model: {baseUrl:string;model:string}, stage?:string): Record<string,unknown>;

export function decisionReasoningParameters(model: {baseUrl:string;model:string}, stage?:string): Record<string,unknown>;
